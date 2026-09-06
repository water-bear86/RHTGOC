export type CheckpointStatus =
  | "idle"
  | "pending"
  | "queued"
  | "submitting"
  | "submitted"
  | "retrying"
  | "confirmed"
  | "failed";

export interface CanonicalGameState {
  wallet: string;
  scrollTokenId: string | null;
  schemaVersion: number;
  version: number;
  level: number;
  experience: number;
  achievements: string[];
  fineries: string[];
  equipment: { primary: string | null; secondary: string | null; [slot: string]: string | null };
  unlocks: string[];
  stats: { captures: number; rescues: number; matches: number };
  updatedAt: number;
  [key: string]: unknown;
}

export type ServerGameCommand =
  | {
      kind: "claim_match_result";
      matchResultId: string;
    }
  | {
      kind: "select_equipment";
      itemIds: string[];
    }
  | {
      kind: "submit_offline_run";
      runId: string;
      buildId: string;
      rulesVersion: string;
      seed: string;
      inputJournal: Array<{
        sequence: number;
        tick: number;
        action: string;
        payload: Record<string, unknown>;
      }>;
    };

export interface StateCommandEnvelope {
  commandId: string;
  expectedVersion: number;
  command: ServerGameCommand;
}

export interface Commitment {
  canonicalJson: string;
  stateHash: `0x${string}`;
  root: `0x${string}`;
  leaves: Record<string, `0x${string}`>;
}

export interface PlayerRecord {
  wallet: string;
  state: CanonicalGameState;
  stateRoot: `0x${string}`;
  checkpointStatus: CheckpointStatus;
  checkpointedVersion: number;
  checkpointedRoot: `0x${string}` | null;
  checkpointedAt: number | null;
  checkpointTransactionHash: `0x${string}` | null;
  lastCheckpointAttemptAt: number | null;
  checkpointErrorCode: string | null;
  canonicalHash: `0x${string}`;
  firstUncheckpointedAt: number | null;
  checkpointDueAt: number | null;
  createdAt: number;
  updatedAt: number;
  mintTransactionHash: `0x${string}` | null;
  mintedAt: number | null;
}

export interface Amendment {
  wallet: string;
  commandId: string;
  version: number;
  commandType: ServerGameCommand["kind"];
  evidenceId: string | null;
  previousRoot: `0x${string}`;
  nextRoot: `0x${string}`;
  acceptedAt: number;
}

export interface AuthChallenge {
  wallet: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
  requestId: string;
}

export interface StoredSession {
  wallet: string;
  tokenHash: string;
  expiresAt: number;
  createdAt: number;
}

export interface TransactionRecord {
  wallet: string;
  version: number;
  stateRoot: `0x${string}`;
  tokenId: string;
  transactionHash: `0x${string}`;
  replacementFor: `0x${string}` | null;
  status: "submitted" | "confirmed" | "failed";
  attempt: number;
  submittedAt: number;
  updatedAt: number;
  chainNonce: number;
}

export interface RulesResult {
  state: CanonicalGameState;
  majorMilestone: boolean;
}
