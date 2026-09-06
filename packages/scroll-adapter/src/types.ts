/** Public API contracts for Sherwood, the game (on robinhood chain). */

export type EvmAddress = `0x${string}`
export type Hex32 = `0x${string}`
export type TransactionHash = `0x${string}`

export enum CheckpointStatus {
  Synced = "synced",
  Pending = "pending",
  Submitting = "submitting",
  Confirming = "confirming",
  Failed = "failed",
  Conflict = "conflict",
  Unavailable = "unavailable",
}

export type ProofCategory = "state" | "achievement" | "finery" | "equipment" | "unlock"

export interface EquipmentState {
  readonly primary: string | null
  readonly secondary: string | null
  readonly [slot: string]: string | null
}

export interface PlayerStats {
  readonly captures: number
  readonly rescues: number
  readonly matches: number
  readonly [stat: string]: number
}

export interface PlayerCheckpoint {
  readonly version: number
  readonly stateRoot: Hex32
  /** ISO-8601 form of the checkpoint timestamp stored by the contract, or null before the first confirmation. */
  readonly checkpointedAt: string | null
  readonly transactionHash: TransactionHash | null
  readonly status: CheckpointStatus
  readonly pendingVersion: number | null
  readonly dirtySince: string | null
  readonly lastAttemptAt: string | null
  readonly errorCode: string | null
}

export interface PlayerState {
  readonly wallet: EvmAddress
  readonly scrollTokenId: string | null
  readonly schemaVersion: number
  readonly stateVersion: number
  readonly level: number
  readonly experience: number
  readonly achievements: readonly string[]
  readonly fineries: readonly string[]
  readonly equipment: Readonly<EquipmentState>
  readonly unlocks: readonly string[]
  readonly stats: Readonly<PlayerStats>
  /** Keccak-256 of the canonical state document. */
  readonly canonicalHash: Hex32
  /** Merkle root committed by the latest local/server state. */
  readonly stateRoot: Hex32
  /** Operational timestamp. It is deliberately excluded from canonical hashing. */
  readonly updatedAt: string
  readonly checkpoint: Readonly<PlayerCheckpoint>
}

export interface PlayerSummary {
  readonly wallet: EvmAddress
  readonly scrollTokenId: string | null
  readonly schemaVersion: number
  readonly stateVersion: number
  readonly level: number
  readonly achievements: readonly string[]
  readonly fineries: readonly string[]
  readonly equippedItemIds: readonly string[]
  readonly canonicalHash: Hex32
  readonly stateRoot: Hex32
  readonly checkpoint: Readonly<PlayerCheckpoint>
  readonly verified: boolean
}

export interface ProofSelector {
  readonly category: ProofCategory
  /** Omit only for the singleton canonical-state leaf. */
  readonly key?: string
}

export interface CurrentProof {
  readonly wallet: EvmAddress
  readonly scrollTokenId: string
  readonly schemaVersion: number
  readonly stateVersion: number
  readonly category: ProofCategory
  readonly key: string
  readonly value: string
  readonly leaf: Hex32
  readonly siblings: readonly Hex32[]
  readonly canonicalHash: Hex32
  readonly stateRoot: Hex32
  readonly checkpointVersion: number
  readonly checkpointStateRoot: Hex32
  readonly verified: boolean
}

export interface ScrollRecord {
  readonly tokenId: string
  readonly owner: EvmAddress
  readonly contractAddress: EvmAddress
  readonly chainId: number
  readonly tokenURI: string
  readonly mintedAt: string
  readonly mintTransactionHash: TransactionHash
  readonly checkpoint: Readonly<PlayerCheckpoint>
}

export interface EvmTransactionRequest {
  readonly chainId: number
  readonly from: EvmAddress
  readonly to: EvmAddress
  readonly data: `0x${string}`
  readonly value: "0x0"
}

export interface MintIntent {
  readonly intentId: string
  readonly wallet: EvmAddress
  readonly chainId: number
  readonly scrollContract: EvmAddress
  readonly robinToken: EvmAddress
  readonly upkeepTreasury: EvmAddress
  readonly burnAddress: "0x000000000000000000000000000000000000dEaD"
  readonly totalPriceBaseUnits: string
  readonly upkeepAmountBaseUnits: string
  readonly burnedAmountBaseUnits: string
  readonly tokenSymbol: "$ROBIN"
  readonly tokenDecimals: number
  readonly execution: "wallet" | "sponsored"
  /** Present when the Scroll contract still needs ERC-20 allowance. */
  readonly approvalTransaction: Readonly<EvmTransactionRequest> | null
  readonly mintTransaction: Readonly<EvmTransactionRequest>
  readonly expiresAt: string
}

export type MintConfirmationStatus = "pending" | "confirmed" | "failed"

export interface MintConfirmation {
  readonly intentId: string
  readonly wallet: EvmAddress
  readonly transactionHash: TransactionHash
  readonly status: MintConfirmationStatus
  readonly confirmations: number
  readonly requiredConfirmations: number
  readonly scroll: Readonly<ScrollRecord> | null
  readonly errorCode: string | null
}

export interface CheckpointFlushResult {
  readonly requestId: string
  readonly wallet: EvmAddress
  readonly accepted: boolean
  readonly checkpoint: Readonly<PlayerCheckpoint>
}

export interface AuthoritativeMatchClaim {
  readonly kind: "claim_match_result"
  /** Identifies a result issued by the authoritative multiplayer service. */
  readonly matchResultId: string
}

export interface EquipmentSelection {
  readonly kind: "select_equipment"
  readonly itemIds: readonly string[]
}

export interface OfflineRunSubmission {
  readonly kind: "submit_offline_run"
  readonly runId: string
  readonly buildId: string
  readonly rulesVersion: string
  readonly seed: string
  readonly inputJournal: readonly Readonly<{
    readonly sequence: number
    readonly tick: number
    readonly action: string
    readonly payload: Readonly<Record<string, unknown>>
  }>[]
}

/**
 * Client mutations express intent, never grants. There is intentionally no
 * `awardAchievement`, `grantFinery`, or raw state-patch variant.
 */
export type ProgressMutation = AuthoritativeMatchClaim | EquipmentSelection | OfflineRunSubmission

export type MutationSyncStatus = "queued" | "syncing" | "synced" | "rejected" | "conflict"

export interface QueuedProgress {
  readonly mutationId: string
  readonly wallet: EvmAddress
  readonly expectedVersion: number
  readonly localState: Readonly<PlayerState>
  readonly status: MutationSyncStatus
}

export interface WalletTypedDataRequest {
  readonly domain: Readonly<Record<string, unknown>>
  readonly types: Readonly<Record<string, readonly Readonly<Record<string, string>>[]>>
  readonly primaryType: string
  readonly message: Readonly<Record<string, unknown>>
}

export interface ScrollWalletProvider {
  request<T = unknown>(request: { readonly method: string; readonly params?: unknown }): Promise<T>
}

export interface ScrollAdapterStorage {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export interface ScrollAdapterConfig {
  readonly apiBaseUrl: string
  readonly chainId: number
  readonly walletProvider?: ScrollWalletProvider
  readonly fetch?: typeof globalThis.fetch
  readonly storage?: ScrollAdapterStorage
  readonly retry?: Readonly<{
    readonly maximumAttempts?: number
    readonly baseDelayMs?: number
    readonly maximumDelayMs?: number
  }>
  readonly onCheckpointStatus?: (checkpoint: Readonly<PlayerCheckpoint>) => void
  readonly onConflict?: (serverState: Readonly<PlayerState>, queued: Readonly<QueuedProgress>) => void
}

export interface ScrollAdapter {
  getPlayerState(wallet: EvmAddress): Promise<PlayerState>
  saveProgress(wallet: EvmAddress, mutation: ProgressMutation): QueuedProgress
  getScroll(wallet: EvmAddress): Promise<ScrollRecord | null>
  getCurrentProof(wallet: EvmAddress, selector?: ProofSelector): Promise<CurrentProof>
  verifyPlayerState(wallet: EvmAddress, state: PlayerState, proof: CurrentProof): Promise<boolean>
  requestMint(wallet: EvmAddress): Promise<MintIntent>
  confirmMint(wallet: EvmAddress, transactionHash: TransactionHash): Promise<MintConfirmation>
  flushCheckpoint(wallet: EvmAddress): Promise<CheckpointFlushResult>
  getPlayerSummary(wallet: EvmAddress): Promise<PlayerSummary>
  reconnect(wallet: EvmAddress): Promise<PlayerState>
  disconnect(): Promise<void>
  readonly guest: boolean
}

export type GetPlayerState = ScrollAdapter["getPlayerState"]
export type GetPlayerSummary = ScrollAdapter["getPlayerSummary"]
export type GetCurrentProof = ScrollAdapter["getCurrentProof"]
export type GetScroll = ScrollAdapter["getScroll"]
export type RequestMint = ScrollAdapter["requestMint"]
export type ConfirmMint = ScrollAdapter["confirmMint"]
export type FlushCheckpoint = ScrollAdapter["flushCheckpoint"]
