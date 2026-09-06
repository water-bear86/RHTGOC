import { conflict } from "../errors.js";
import type {
  Amendment,
  AuthChallenge,
  PlayerRecord,
  StoredSession,
  TransactionRecord,
} from "../domain.js";
import type {
  AuthPersistence,
  CheckpointQueue,
  PlayerPersistence,
  ReconciliationQueue,
  SnapshotStore,
} from "../ports.js";

const clone = <T>(value: T): T => structuredClone(value);

export class MemoryPersistence implements PlayerPersistence, AuthPersistence {
  readonly players = new Map<string, PlayerRecord>();
  readonly idempotency = new Map<string, PlayerRecord>();
  readonly amendments: Amendment[] = [];
  readonly challenges = new Map<string, AuthChallenge>();
  readonly sessions = new Map<string, StoredSession>();
  readonly transactions = new Map<string, TransactionRecord>();
  readonly checkpointClaims = new Map<string, number>();
  readonly claimedEvidence = new Set<string>();

  async createPlayer(player: PlayerRecord): Promise<{ player: PlayerRecord; created: boolean }> {
    const previous = this.players.get(player.wallet);
    if (previous) return { player: clone(previous), created: false };
    this.players.set(player.wallet, clone(player));
    return { player: clone(player), created: true };
  }

  async getPlayer(wallet: string): Promise<PlayerRecord | null> {
    const player = this.players.get(wallet);
    return player ? clone(player) : null;
  }

  async getPlayerByTokenId(tokenId: string): Promise<PlayerRecord | null> {
    const player = [...this.players.values()].find((candidate) => candidate.state.scrollTokenId === tokenId);
    return player ? clone(player) : null;
  }

  async getIdempotentResult(wallet: string, commandId: string): Promise<PlayerRecord | null> {
    const result = this.idempotency.get(`${wallet}:${commandId}`);
    return result ? clone(result) : null;
  }

  async applyCommand(
    previousVersion: number,
    player: PlayerRecord,
    amendment: Amendment,
    _idempotencyTtl: number,
  ): Promise<PlayerRecord> {
    const current = this.players.get(player.wallet);
    if (!current || current.state.version !== previousVersion) {
      throw conflict("stale_version", "State was updated by another command", {
        currentVersion: current?.state.version ?? null,
      });
    }
    const idemKey = `${player.wallet}:${amendment.commandId}`;
    const duplicate = this.idempotency.get(idemKey);
    if (duplicate) return clone(duplicate);
    if (amendment.evidenceId) {
      const evidenceKey = `${amendment.commandType}:${amendment.evidenceId}`;
      if (this.claimedEvidence.has(evidenceKey)) throw conflict("evidence_already_claimed", "Server evidence was already claimed");
      this.claimedEvidence.add(evidenceKey);
    }
    this.players.set(player.wallet, clone(player));
    this.idempotency.set(idemKey, clone(player));
    this.amendments.push(clone(amendment));
    return clone(player);
  }

  async attachScroll(next: PlayerRecord, _transactionHash: `0x${string}`): Promise<PlayerRecord> {
    const player = this.players.get(next.wallet);
    if (!player) throw new Error("player_not_found");
    if (player.state.scrollTokenId && player.state.scrollTokenId !== next.state.scrollTokenId) {
      throw conflict("scroll_already_attached", "Player already has a different Scroll");
    }
    this.players.set(next.wallet, clone(next));
    return clone(next);
  }

  async markQueued(wallet: string, version: number): Promise<void> {
    const player = this.players.get(wallet);
    if (player && player.state.version === version && player.checkpointStatus !== "submitted") {
      player.checkpointStatus = "queued";
    }
  }

  async markSubmitted(wallet: string, version: number, _transactionHash: string): Promise<void> {
    const player = this.players.get(wallet);
    if (player && player.state.version === version) {
      player.checkpointStatus = "submitted";
      player.checkpointTransactionHash = _transactionHash as `0x${string}`;
    }
  }

  async markConfirmed(
    wallet: string,
    version: number,
    root: `0x${string}`,
    _transactionHash: string,
    checkpointedAt: number,
  ): Promise<void> {
    const player = this.players.get(wallet);
    if (!player) return;
    player.checkpointedVersion = version;
    player.checkpointedRoot = root;
    player.checkpointedAt = checkpointedAt;
    player.checkpointTransactionHash = _transactionHash as `0x${string}`;
    player.checkpointStatus = player.state.version === version ? "confirmed" : "pending";
    if (player.state.version === version) {
      player.firstUncheckpointedAt = null;
      player.checkpointDueAt = null;
    }
  }

  async markCheckpointFailure(wallet: string, version: number, retryable: boolean, _reason: string): Promise<void> {
    const player = this.players.get(wallet);
    if (player && player.state.version === version) {
      player.checkpointStatus = retryable ? "retrying" : "failed";
      player.checkpointErrorCode = _reason;
    }
  }

  async listCheckpointDue(now: number, maxAgeCutoff: number, limit: number): Promise<PlayerRecord[]> {
    return [...this.players.values()]
      .filter(
        (player) =>
          player.state.version > player.checkpointedVersion &&
          ["pending", "retrying", "failed"].includes(player.checkpointStatus) &&
          ((player.checkpointDueAt !== null && player.checkpointDueAt <= now) ||
            (player.firstUncheckpointedAt !== null && player.firstUncheckpointedAt <= maxAgeCutoff)),
      )
      .slice(0, limit)
      .map(clone);
  }

  async putTransaction(transaction: TransactionRecord): Promise<boolean> {
    if (this.transactions.has(transaction.transactionHash)) return false;
    this.transactions.set(transaction.transactionHash, clone(transaction));
    return true;
  }

  async claimCheckpoint(wallet: string, version: number, now: number, leaseSeconds: number): Promise<boolean> {
    const key = `${wallet}:${version}`;
    const expiresAt = this.checkpointClaims.get(key) ?? 0;
    if (expiresAt >= now) return false;
    this.checkpointClaims.set(key, now + leaseSeconds);
    return true;
  }

  async getTransaction(transactionHash: string): Promise<TransactionRecord | null> {
    const transaction = this.transactions.get(transactionHash);
    return transaction ? clone(transaction) : null;
  }

  async updateTransaction(transaction: TransactionRecord): Promise<void> {
    this.transactions.set(transaction.transactionHash, clone(transaction));
  }

  async putChallenge(challenge: AuthChallenge): Promise<void> {
    this.challenges.set(`${challenge.wallet}:${challenge.nonce}`, clone(challenge));
  }

  async consumeChallenge(wallet: string, nonce: string, now: number): Promise<AuthChallenge | null> {
    const key = `${wallet}:${nonce}`;
    const challenge = this.challenges.get(key);
    if (!challenge || challenge.expiresAt < now) return null;
    this.challenges.delete(key);
    return clone(challenge);
  }

  async putSession(session: StoredSession): Promise<void> {
    this.sessions.set(`${session.wallet}:${session.tokenHash}`, clone(session));
  }

  async getSession(wallet: string, tokenHash: string, now: number): Promise<StoredSession | null> {
    const session = this.sessions.get(`${wallet}:${tokenHash}`);
    return session && session.expiresAt >= now ? clone(session) : null;
  }
}

export class MemorySnapshotStore implements SnapshotStore {
  readonly snapshots = new Map<string, string>();

  async putImmutable(wallet: string, version: number, root: `0x${string}`, canonicalJson: string): Promise<string> {
    const key = `players/${wallet}/v${version}/${root}.json`;
    const existing = this.snapshots.get(key);
    if (existing !== undefined && existing !== canonicalJson) throw new Error("immutable_snapshot_collision");
    this.snapshots.set(key, canonicalJson);
    return key;
  }
}

export class MemoryCheckpointQueue implements CheckpointQueue {
  readonly messages: Array<{ wallet: string; version: number; reason: string }> = [];
  async enqueue(wallet: string, version: number, reason: "debounce" | "milestone" | "match" | "manual" | "max_age") {
    this.messages.push({ wallet, version, reason });
  }
}

export class MemoryReconciliationQueue implements ReconciliationQueue {
  readonly messages: Array<{ transactionHash: `0x${string}`; delaySeconds: number }> = [];
  async enqueue(transactionHash: `0x${string}`, delaySeconds: number) {
    this.messages.push({ transactionHash, delaySeconds });
  }
}
