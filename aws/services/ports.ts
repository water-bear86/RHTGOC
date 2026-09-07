import type {
  Amendment,
  AuthChallenge,
  CanonicalGameState,
  Commitment,
  PlayerRecord,
  RulesResult,
  ServerGameCommand,
  StoredSession,
  TransactionRecord,
} from "./domain.js";

export interface StateCorePort {
  createInitialState(wallet: string): CanonicalGameState;
  commitment(state: CanonicalGameState): Commitment;
  proof(state: CanonicalGameState, kind: ProofKind, id: string): MerkleProof;
}

export type ProofKind = "state" | "achievement" | "finery" | "equipment" | "unlock";

export interface MerkleProof {
  kind: ProofKind;
  id: string;
  leaf: `0x${string}`;
  root: `0x${string}`;
  proof: `0x${string}`[];
  value: string;
  canonicalHash: `0x${string}`;
}

export interface PlayerPersistence {
  createPlayer(player: PlayerRecord): Promise<{ player: PlayerRecord; created: boolean }>;
  getPlayer(wallet: string): Promise<PlayerRecord | null>;
  getPlayerByTokenId(tokenId: string): Promise<PlayerRecord | null>;
  getIdempotentResult(wallet: string, commandId: string): Promise<PlayerRecord | null>;
  applyCommand(
    previousVersion: number,
    player: PlayerRecord,
    amendment: Amendment,
    idempotencyTtl: number,
  ): Promise<PlayerRecord>;
  attachScroll(player: PlayerRecord, transactionHash: `0x${string}`): Promise<PlayerRecord>;
  markQueued(wallet: string, version: number): Promise<void>;
  markSubmitted(wallet: string, version: number, transactionHash: string): Promise<void>;
  markConfirmed(wallet: string, version: number, root: `0x${string}`, transactionHash: string, checkpointedAt: number): Promise<void>;
  markCheckpointFailure(wallet: string, version: number, retryable: boolean, reason: string): Promise<void>;
  listCheckpointDue(now: number, maxAgeCutoff: number, limit: number): Promise<PlayerRecord[]>;
  claimCheckpoint(wallet: string, version: number, now: number, leaseSeconds: number): Promise<boolean>;
  putTransaction(transaction: TransactionRecord): Promise<boolean>;
  getTransaction(transactionHash: string): Promise<TransactionRecord | null>;
  updateTransaction(transaction: TransactionRecord): Promise<void>;
}

export interface AuthPersistence {
  putChallenge(challenge: AuthChallenge): Promise<void>;
  consumeChallenge(wallet: string, nonce: string, now: number): Promise<AuthChallenge | null>;
  putSession(session: StoredSession): Promise<void>;
  getSession(wallet: string, tokenHash: string, now: number): Promise<StoredSession | null>;
}

export interface SnapshotStore {
  putImmutable(wallet: string, version: number, root: `0x${string}`, canonicalJson: string): Promise<string>;
}

export interface CheckpointQueue {
  enqueue(wallet: string, version: number, reason: "debounce" | "milestone" | "match" | "manual" | "max_age"): Promise<void>;
}

export interface ReconciliationQueue {
  enqueue(transactionHash: `0x${string}`, delaySeconds: number): Promise<void>;
}

export interface RelayerSpendLimiter {
  reserve(utcDay: string, amountWei: bigint, maximumWei: bigint): Promise<void>;
}

export interface MatchReceiptVerifier {
  verifyAndResolve(command: ServerGameCommand, wallet: string): Promise<ServerGameCommand>;
}

export interface GameRulesEngine {
  apply(state: CanonicalGameState, command: ServerGameCommand, wallet: string): Promise<RulesResult>;
}

export interface ChainReceipt {
  hash: `0x${string}`;
  status: "pending" | "success" | "reverted" | "not_found";
  confirmations: number;
  blockNumber?: number;
  logs?: readonly { address: string; topics: readonly string[]; data: string }[];
}

export interface ChainClient {
  getScrollTokenId(wallet: string): Promise<string | null>;
  getCheckpoint(tokenId: string): Promise<{ version: number; stateRoot: `0x${string}`; timestamp: number }>;
  verifyCheckpoint(tokenId: string, version: number, root: `0x${string}`): Promise<boolean>;
  submitCheckpoint(tokenId: string, version: number, root: `0x${string}`): Promise<{ hash: `0x${string}`; estimatedCostWei: bigint; chainNonce: number }>;
  replaceCheckpoint(transaction: TransactionRecord): Promise<{ hash: `0x${string}`; estimatedCostWei: bigint; chainNonce: number }>;
  getReceipt(hash: `0x${string}`): Promise<ChainReceipt>;
  getAllowance(wallet: string): Promise<bigint>;
  getMintPrice(): Promise<bigint>;
  getTreasury(): Promise<string>;
}

export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Math.floor(Date.now() / 1000) };
