import { randomUUID } from "node:crypto";
import { Interface, getAddress } from "ethers";
import type { ServiceConfig } from "./config.js";
import type { Amendment, PlayerRecord, ServerGameCommand } from "./domain.js";
import { badRequest, conflict, notFound, unavailable } from "./errors.js";
import type {
  ChainClient,
  CheckpointQueue,
  Clock,
  GameRulesEngine,
  PlayerPersistence,
  ProofKind,
  SnapshotStore,
  StateCorePort,
} from "./ports.js";
import { checkpointDto, playerStateDto, playerSummaryDto } from "./dto.js";
import { MintPaymentVerifier } from "./payment.js";
import { normalizeHash, normalizeWallet } from "./wallet.js";

const erc20 = new Interface(["function approve(address spender,uint256 amount)"]);
const scroll = new Interface(["function mint()"]);
const ZERO_ROOT = `0x${"00".repeat(32)}` as `0x${string}`;

export class ScrollService {
  constructor(
    private readonly persistence: PlayerPersistence,
    private readonly snapshots: SnapshotStore,
    private readonly queue: CheckpointQueue,
    private readonly core: StateCorePort,
    private readonly rules: GameRulesEngine,
    private readonly chain: ChainClient,
    private readonly paymentVerifier: MintPaymentVerifier,
    private readonly clock: Clock,
    private readonly config: ServiceConfig,
  ) {}

  async register(rawWallet: unknown) {
    const wallet = normalizeWallet(rawWallet);
    const now = this.clock.now();
    const state = this.core.createInitialState(wallet);
    const commitment = this.core.commitment(state);
    const player: PlayerRecord = {
      wallet,
      state,
      stateRoot: commitment.root,
      canonicalHash: commitment.stateHash,
      checkpointStatus: "idle",
      checkpointedVersion: 0,
      checkpointedRoot: null,
      checkpointedAt: null,
      checkpointTransactionHash: null,
      lastCheckpointAttemptAt: null,
      checkpointErrorCode: null,
      firstUncheckpointedAt: null,
      checkpointDueAt: null,
      createdAt: now,
      updatedAt: now,
      mintTransactionHash: null,
      mintedAt: null,
    };
    const result = await this.persistence.createPlayer(player);
    return { created: result.created, player: playerStateDto(result.player) };
  }

  async getState(rawWallet: unknown) {
    return playerStateDto(await this.requirePlayer(normalizeWallet(rawWallet)));
  }

  async getSummary(rawWallet: unknown) {
    const player = await this.requirePlayer(normalizeWallet(rawWallet));
    return playerSummaryDto(player, this.isVerified(player));
  }

  async getProof(rawWallet: unknown, category: ProofKind, key?: string) {
    const player = await this.requirePlayer(normalizeWallet(rawWallet));
    if (!player.state.scrollTokenId) throw conflict("scroll_required", "A Scroll is required for proofs");
    if (category !== "state" && !key) throw badRequest("proof_key_required", "key is required for this proof category");
    const proof = this.core.proof(player.state, category, key ?? "state");
    return {
      wallet: player.wallet,
      scrollTokenId: player.state.scrollTokenId,
      schemaVersion: player.state.schemaVersion,
      stateVersion: player.state.version,
      category,
      key: key ?? "state",
      value: proof.value,
      leaf: proof.leaf,
      siblings: proof.proof,
      canonicalHash: proof.canonicalHash,
      stateRoot: proof.root,
      checkpointVersion: player.checkpointedVersion,
      checkpointStateRoot: player.checkpointedRoot ?? ZERO_ROOT,
      verified: this.isVerified(player) && proof.root === player.checkpointedRoot,
    };
  }

  async mutate(rawWallet: unknown, mutationId: string, expectedVersion: number, command: ServerGameCommand) {
    const wallet = normalizeWallet(rawWallet);
    const duplicate = await this.persistence.getIdempotentResult(wallet, mutationId);
    if (duplicate) return playerStateDto(duplicate);
    const current = await this.requirePlayer(wallet);
    if (!current.state.scrollTokenId) throw conflict("scroll_required", "A Scroll is required for canonical progression");
    if (current.state.version !== expectedVersion) {
      throw conflict("stale_version", "Mutation is based on stale state", {
        currentVersion: current.state.version,
        currentState: playerStateDto(current),
      });
    }
    const applied = await this.rules.apply(structuredClone(current.state), command, wallet);
    const now = this.clock.now();
    const nextState = { ...applied.state, wallet, version: current.state.version + 1, updatedAt: now };
    const commitment = this.core.commitment(nextState);
    const firstDirty = current.firstUncheckpointedAt ?? now;
    const dueAt = Math.min(now + this.config.checkpointAfterSeconds, firstDirty + this.config.maxUncheckpointedSeconds);
    const next: PlayerRecord = {
      ...current,
      state: nextState,
      stateRoot: commitment.root,
      canonicalHash: commitment.stateHash,
      checkpointStatus: "pending",
      checkpointErrorCode: null,
      firstUncheckpointedAt: firstDirty,
      checkpointDueAt: dueAt,
      updatedAt: now,
    };
    await this.snapshots.putImmutable(wallet, nextState.version, commitment.root, commitment.canonicalJson);
    const evidenceId =
      command.kind === "claim_match_result" ? command.matchResultId : command.kind === "submit_offline_run" ? command.runId : null;
    const amendment: Amendment = {
      wallet,
      commandId: mutationId,
      version: nextState.version,
      commandType: command.kind,
      evidenceId,
      previousRoot: current.stateRoot,
      nextRoot: commitment.root,
      acceptedAt: now,
    };
    let saved: PlayerRecord;
    try {
      saved = await this.persistence.applyCommand(current.state.version, next, amendment, now + 7 * 24 * 3600);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "stale_version") {
        const latest = await this.persistence.getPlayer(wallet);
        if (latest) throw conflict("stale_version", "Mutation is based on stale state", {
          currentVersion: latest.state.version,
          currentState: playerStateDto(latest),
        });
      }
      throw error;
    }
    const isMatch = command.kind === "claim_match_result";
    const immediate =
      (applied.majorMilestone && this.config.checkpointOnMajorAchievement) ||
      (isMatch && this.config.checkpointOnMatchResult);
    if (immediate) {
      await this.queue.enqueue(wallet, saved.state.version, isMatch ? "match" : "milestone");
      await this.persistence.markQueued(wallet, saved.state.version);
      saved.checkpointStatus = "queued";
    }
    return playerStateDto(saved);
  }

  async requestMint(rawWallet: unknown) {
    const wallet = normalizeWallet(rawWallet);
    const player = await this.requirePlayer(wallet);
    if (player.state.scrollTokenId) throw conflict("scroll_already_owned", "Wallet already owns a Scroll");
    const [total, onChainTreasury] = await Promise.all([this.chain.getMintPrice(), this.chain.getTreasury()]);
    if (getAddress(onChainTreasury) !== getAddress(this.config.upkeepAddress)) {
      throw unavailable("mint_configuration_drift", "Configured upkeep treasury does not match the Scroll contract");
    }
    if (total <= 0n || total % 2n !== 0n) throw new Error("Configured mint price must be positive and even");
    const allowance = await this.chain.getAllowance(wallet);
    const transaction = (to: string, data: string) => ({
      chainId: this.config.chainId,
      from: wallet,
      to: getAddress(to).toLowerCase(),
      data,
      value: "0x0" as const,
    });
    return {
      intentId: randomUUID(),
      wallet,
      chainId: this.config.chainId,
      scrollContract: getAddress(this.config.scrollContractAddress).toLowerCase(),
      robinToken: getAddress(this.config.robinTokenAddress).toLowerCase(),
      upkeepTreasury: getAddress(onChainTreasury).toLowerCase(),
      burnAddress: "0x000000000000000000000000000000000000dEaD" as const,
      totalPriceBaseUnits: total.toString(),
      upkeepAmountBaseUnits: (total / 2n).toString(),
      burnedAmountBaseUnits: (total / 2n).toString(),
      tokenSymbol: "$ROBIN" as const,
      tokenDecimals: this.config.robinTokenDecimals,
      execution: "wallet" as const,
      approvalTransaction:
        allowance >= total ? null : transaction(this.config.robinTokenAddress, erc20.encodeFunctionData("approve", [this.config.scrollContractAddress, total])),
      mintTransaction: transaction(this.config.scrollContractAddress, scroll.encodeFunctionData("mint")),
      expiresAt: new Date((this.clock.now() + 300) * 1000).toISOString(),
    };
  }

  async confirmMint(rawWallet: unknown, intentId: string, rawTransactionHash: unknown) {
    const wallet = normalizeWallet(rawWallet);
    const transactionHash = normalizeHash(rawTransactionHash);
    const receipt = await this.chain.getReceipt(transactionHash);
    if (receipt.status === "pending" || receipt.status === "not_found" || receipt.confirmations < this.config.confirmationsRequired) {
      return {
        intentId,
        wallet,
        transactionHash,
        status: "pending" as const,
        confirmations: receipt.confirmations,
        requiredConfirmations: this.config.confirmationsRequired,
        scroll: null,
        errorCode: null,
      };
    }
    if (receipt.status !== "success") {
      return {
        intentId,
        wallet,
        transactionHash,
        status: "failed" as const,
        confirmations: receipt.confirmations,
        requiredConfirmations: this.config.confirmationsRequired,
        scroll: null,
        errorCode: "mint_reverted",
      };
    }
    const verified = this.paymentVerifier.verify(receipt, wallet);
    let player = await this.requirePlayer(wallet);
    if (!player.state.scrollTokenId) {
      const now = this.clock.now();
      const state = { ...player.state, scrollTokenId: verified.tokenId, version: player.state.version + 1, updatedAt: now };
      const commitment = this.core.commitment(state);
      player = {
        ...player,
        state,
        stateRoot: commitment.root,
        canonicalHash: commitment.stateHash,
        checkpointStatus: "pending",
        firstUncheckpointedAt: now,
        checkpointDueAt: now,
        updatedAt: now,
        mintTransactionHash: transactionHash,
        mintedAt: now,
      };
      await this.snapshots.putImmutable(wallet, state.version, commitment.root, commitment.canonicalJson);
      player = await this.persistence.attachScroll(player, transactionHash);
      await this.queue.enqueue(wallet, state.version, "milestone");
      await this.persistence.markQueued(wallet, state.version);
      player.checkpointStatus = "queued";
    } else if (player.state.scrollTokenId !== verified.tokenId || player.mintTransactionHash !== transactionHash) {
      throw conflict("mint_confirmation_conflict", "Mint confirmation conflicts with the attached Scroll");
    }
    return {
      intentId,
      wallet,
      transactionHash,
      status: "confirmed" as const,
      confirmations: receipt.confirmations,
      requiredConfirmations: this.config.confirmationsRequired,
      scroll: this.scrollDto(player),
      errorCode: null,
    };
  }

  async getScroll(rawWallet: unknown) {
    const player = await this.requirePlayer(normalizeWallet(rawWallet));
    return player.state.scrollTokenId ? this.scrollDto(player) : null;
  }

  async flush(rawWallet: unknown, requestId: string = randomUUID()) {
    const player = await this.requirePlayer(normalizeWallet(rawWallet));
    if (!player.state.scrollTokenId) throw conflict("scroll_required", "A Scroll is required for checkpoints");
    const accepted = player.state.version > player.checkpointedVersion && !["queued", "submitting", "submitted"].includes(player.checkpointStatus);
    if (accepted) {
      await this.queue.enqueue(player.wallet, player.state.version, "manual");
      await this.persistence.markQueued(player.wallet, player.state.version);
      player.checkpointStatus = "queued";
    }
    return { requestId, wallet: player.wallet, accepted, checkpoint: checkpointDto(player) };
  }

  async metadata(tokenId: string) {
    if (!/^(0|[1-9]\d*)$/.test(tokenId)) throw badRequest("invalid_token_id", "tokenId must be an unsigned decimal integer");
    const player = await this.persistence.getPlayerByTokenId(tokenId);
    if (!player) throw notFound("scroll_not_found", "Scroll was not found");
    const isVerified = this.isVerified(player);
    const summary = playerSummaryDto(player, isVerified);
    return {
      name: `Sherwood Scroll #${tokenId}`,
      description: "Soulbound record-keeping Scroll for Sherwood, the game (on robinhood chain).",
      external_url: `${this.config.metadataBaseUrl}/scrolls/${tokenId}/metadata`,
      attributes: [
        ...(isVerified ? [{ trait_type: "Level", value: summary.level }] : []),
        { trait_type: "State Version", value: isVerified ? summary.stateVersion : summary.checkpoint.version },
        { trait_type: "Checkpoint Verified", value: isVerified ? "Yes" : "Pending" },
      ],
      properties: {
        owner: summary.wallet,
        verified: isVerified,
        stateRoot: isVerified ? summary.stateRoot : summary.checkpoint.stateRoot,
        checkpoint: summary.checkpoint,
      },
    };
  }

  private async requirePlayer(wallet: string): Promise<PlayerRecord> {
    const player = await this.persistence.getPlayer(wallet);
    if (!player) throw notFound("player_not_found", "Player is not registered");
    return player;
  }

  private isVerified(player: PlayerRecord): boolean {
    return (
      player.state.version === player.checkpointedVersion &&
      player.stateRoot === player.checkpointedRoot &&
      player.checkpointStatus === "confirmed"
    );
  }

  private scrollDto(player: PlayerRecord) {
    const tokenId = player.state.scrollTokenId;
    if (!tokenId || !player.mintTransactionHash || player.mintedAt === null) throw new Error("Incomplete Scroll record");
    return {
      tokenId,
      owner: player.wallet,
      contractAddress: getAddress(this.config.scrollContractAddress).toLowerCase(),
      chainId: this.config.chainId,
      tokenURI: `${this.config.metadataBaseUrl}/scrolls/${tokenId}/metadata`,
      mintedAt: new Date(player.mintedAt * 1000).toISOString(),
      mintTransactionHash: player.mintTransactionHash,
      checkpoint: checkpointDto(player),
    };
  }
}
