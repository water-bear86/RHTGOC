export type EvmAddress = `0x${string}`;
export type Hex32 = `0x${string}`;
export type Uint256Input = string | number | bigint;
export type TimestampInput = string | number | null;

export interface PlayerStateInput {
  readonly wallet: string;
  readonly scrollTokenId: Uint256Input;
  readonly schemaVersion: number;
  readonly stateVersion: number;
  readonly level: number;
  readonly experience: number;
  readonly achievements: readonly string[];
  readonly fineries: readonly string[];
  readonly equipment: Readonly<Record<string, string>>;
  readonly unlocks: readonly string[];
  readonly stats: Readonly<Record<string, number>>;
  readonly createdAt?: TimestampInput;
  readonly updatedAt?: TimestampInput;
  readonly lastSavedAt?: TimestampInput;
  readonly lastCheckpointAt?: TimestampInput;
}

export interface CanonicalPlayerState {
  readonly wallet: EvmAddress;
  readonly scrollTokenId: string;
  readonly schemaVersion: number;
  readonly stateVersion: number;
  readonly level: number;
  readonly experience: number;
  readonly achievements: readonly string[];
  readonly fineries: readonly string[];
  readonly equipment: Readonly<Record<string, string>>;
  readonly unlocks: readonly string[];
  readonly stats: Readonly<Record<string, number>>;
}

export type ProofCategory =
  | "state"
  | "achievement"
  | "finery"
  | "equipment"
  | "unlock";

export type ProofSubject =
  | { readonly category: "state" }
  | { readonly category: "achievement"; readonly id: string }
  | { readonly category: "finery"; readonly id: string }
  | {
      readonly category: "equipment";
      readonly slot: string;
      readonly itemId: string;
    }
  | { readonly category: "unlock"; readonly id: string };

export interface CommitmentLeaf {
  readonly subject: ProofSubject;
  readonly hash: Hex32;
}

export interface StateCommitment {
  readonly canonicalState: CanonicalPlayerState;
  readonly canonicalJson: string;
  readonly stateHash: Hex32;
  readonly stateRoot: Hex32;
  readonly leaves: readonly CommitmentLeaf[];
}

export interface StateMerkleProofBase {
  readonly wallet: EvmAddress;
  readonly scrollTokenId: string;
  readonly stateVersion: number;
  readonly stateRoot: Hex32;
  readonly subject: ProofSubject;
  readonly leaf: Hex32;
  readonly siblings: readonly Hex32[];
}

export interface CanonicalStateMerkleProof extends StateMerkleProofBase {
  readonly subject: Extract<ProofSubject, { category: "state" }>;
  readonly stateHash: Hex32;
}

export interface CategoryMerkleProof extends StateMerkleProofBase {
  readonly subject: Exclude<ProofSubject, { category: "state" }>;
}

export type StateMerkleProof = CanonicalStateMerkleProof | CategoryMerkleProof;

export type SchemaSuccess<T> = {
  readonly success: true;
  readonly data: T;
};

export type SchemaFailure = {
  readonly success: false;
  readonly error: StateValidationError;
};

export interface RuntimeSchema<T> {
  parse(value: unknown): T;
  safeParse(value: unknown): SchemaSuccess<T> | SchemaFailure;
}

export class StateValidationError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "StateValidationError";
    this.path = path;
  }
}
