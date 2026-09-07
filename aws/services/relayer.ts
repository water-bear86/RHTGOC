import type { ChainClient, Clock, PlayerPersistence, ReconciliationQueue } from "./ports.js";
import type { TransactionRecord } from "./domain.js";
import { audit } from "./audit.js";

export class CheckpointRelayer {
  constructor(
    private readonly persistence: PlayerPersistence,
    private readonly chain: ChainClient,
    private readonly reconciliation: ReconciliationQueue,
    private readonly clock: Clock,
  ) {}

  async process(message: { wallet: string; version: number }): Promise<"submitted" | "superseded" | "duplicate"> {
    const player = await this.persistence.getPlayer(message.wallet);
    if (!player?.state.scrollTokenId || player.state.version <= player.checkpointedVersion) return "superseded";
    // Always coalesce to the newest committed state instead of sending one transaction per amendment.
    const version = player.state.version;
    const claimed = await this.persistence.claimCheckpoint(player.wallet, version, this.clock.now(), 180);
    if (!claimed) return "duplicate";
    try {
      const submission = await this.chain.submitCheckpoint(player.state.scrollTokenId, version, player.stateRoot);
      const now = this.clock.now();
      const transaction: TransactionRecord = {
        wallet: player.wallet,
        version,
        stateRoot: player.stateRoot,
        tokenId: player.state.scrollTokenId,
        transactionHash: submission.hash,
        replacementFor: null,
        status: "submitted",
        attempt: 1,
        submittedAt: now,
        updatedAt: now,
        chainNonce: submission.chainNonce,
      };
      await this.persistence.putTransaction(transaction);
      await this.persistence.markSubmitted(player.wallet, version, submission.hash);
      await this.reconciliation.enqueue(submission.hash, 15);
      audit({ event: "checkpoint_submitted", wallet: player.wallet, resourceId: submission.hash, outcome: "accepted", version });
      return "submitted";
    } catch (error) {
      await this.persistence.markCheckpointFailure(player.wallet, version, true, "submission_failed");
      throw error;
    }
  }
}

export interface ReconcilerConfig {
  confirmationsRequired: number;
  maxReplacementAttempts: number;
  replacementAfterSeconds: number;
}

export class CheckpointReconciler {
  constructor(
    private readonly persistence: PlayerPersistence,
    private readonly chain: ChainClient,
    private readonly queue: ReconciliationQueue,
    private readonly clock: Clock,
    private readonly config: ReconcilerConfig,
  ) {}

  async process(transactionHash: `0x${string}`): Promise<"confirmed" | "pending" | "replaced" | "failed" | "missing"> {
    const transaction = await this.persistence.getTransaction(transactionHash);
    if (!transaction) return "missing";
    if (transaction.status === "confirmed") return "confirmed";
    const receipt = await this.chain.getReceipt(transactionHash);
    if (receipt.status === "success" && receipt.confirmations >= this.config.confirmationsRequired) {
      const checkpointedAt = await this.matchingCheckpointTimestamp(transaction);
      if (checkpointedAt === null) {
        await this.fail(transaction, "checkpoint_root_mismatch");
        return "failed";
      }
      transaction.status = "confirmed";
      transaction.updatedAt = this.clock.now();
      await this.persistence.updateTransaction(transaction);
      await this.persistence.markConfirmed(
        transaction.wallet,
        transaction.version,
        transaction.stateRoot,
        transaction.transactionHash,
        checkpointedAt,
      );
      return "confirmed";
    }
    const checkpointedAt = await this.matchingCheckpointTimestamp(transaction);
    if (checkpointedAt !== null) {
      transaction.status = "confirmed";
      transaction.updatedAt = this.clock.now();
      await this.persistence.updateTransaction(transaction);
      await this.persistence.markConfirmed(
        transaction.wallet,
        transaction.version,
        transaction.stateRoot,
        transaction.transactionHash,
        checkpointedAt,
      );
      return "confirmed";
    }
    const oldEnough = this.clock.now() - transaction.submittedAt >= this.config.replacementAfterSeconds;
    if ((receipt.status === "reverted" || receipt.status === "not_found" || oldEnough) && transaction.attempt < this.config.maxReplacementAttempts) {
      const replacement = await this.chain.replaceCheckpoint(transaction);
      const next: TransactionRecord = {
        ...transaction,
        transactionHash: replacement.hash,
        replacementFor: transaction.transactionHash,
        attempt: transaction.attempt + 1,
        submittedAt: this.clock.now(),
        updatedAt: this.clock.now(),
        chainNonce: replacement.chainNonce,
      };
      transaction.status = "failed";
      transaction.updatedAt = this.clock.now();
      await this.persistence.updateTransaction(transaction);
      await this.persistence.putTransaction(next);
      await this.persistence.markSubmitted(next.wallet, next.version, next.transactionHash);
      await this.queue.enqueue(next.transactionHash, 15);
      return "replaced";
    }
    if (receipt.status === "reverted" && transaction.attempt >= this.config.maxReplacementAttempts) {
      await this.fail(transaction, "checkpoint_reverted");
      return "failed";
    }
    await this.queue.enqueue(transactionHash, 15);
    return "pending";
  }

  private async matchingCheckpointTimestamp(transaction: TransactionRecord): Promise<number | null> {
    try {
      const checkpoint = await this.chain.getCheckpoint(transaction.tokenId);
      return checkpoint.version === transaction.version && checkpoint.stateRoot === transaction.stateRoot
        ? checkpoint.timestamp
        : null;
    } catch {
      return null;
    }
  }

  private async fail(transaction: TransactionRecord, reason: string): Promise<void> {
    transaction.status = "failed";
    transaction.updatedAt = this.clock.now();
    await this.persistence.updateTransaction(transaction);
    await this.persistence.markCheckpointFailure(transaction.wallet, transaction.version, false, reason);
  }
}

export class CheckpointSweep {
  constructor(
    private readonly persistence: PlayerPersistence,
    private readonly queue: { enqueue(wallet: string, version: number, reason: "max_age" | "debounce"): Promise<void> },
    private readonly clock: Clock,
    private readonly maxUncheckpointedSeconds: number,
  ) {}

  async run(limit = 100): Promise<number> {
    const now = this.clock.now();
    const due = await this.persistence.listCheckpointDue(now, now - this.maxUncheckpointedSeconds, limit);
    for (const player of due) {
      const reason = player.firstUncheckpointedAt !== null && player.firstUncheckpointedAt <= now - this.maxUncheckpointedSeconds ? "max_age" : "debounce";
      await this.queue.enqueue(player.wallet, player.state.version, reason);
      await this.persistence.markQueued(player.wallet, player.state.version);
    }
    return due.length;
  }
}
