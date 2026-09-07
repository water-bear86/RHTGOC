import {
  createStateCommitment,
  verifyProof,
  type PlayerStateInput,
  type ProofSubject,
  type StateMerkleProof,
} from "@robinhood-game/scroll-state-core"
import { ScrollAdapterError, StateUnavailableError } from "./errors.js"
import { ScrollApiClient, normalizeWallet } from "./http-client.js"
import { applyOptimisticMutation, isSafelyRebasable } from "./optimistic.js"
import { defaultScrollStorage } from "./storage.js"
import {
  type CheckpointFlushResult,
  type CurrentProof,
  type EvmAddress,
  type MintConfirmation,
  type MintIntent,
  type PlayerState,
  type PlayerSummary,
  type ProgressMutation,
  type ProofSelector,
  type QueuedProgress,
  type ScrollAdapter,
  type ScrollAdapterConfig,
  type ScrollAdapterStorage,
  type ScrollRecord,
  type TransactionHash,
} from "./types.js"

interface PersistedMutation {
  readonly mutationId: string
  readonly wallet: EvmAddress
  expectedVersion: number
  readonly mutation: ProgressMutation
  readonly queuedAt: string
  attempts: number
  status: QueuedProgress["status"]
}

interface StateMutationResponse {
  readonly state: PlayerState
}

function queueKey(wallet: EvmAddress): string {
  return `scroll:mutations:${wallet}`
}

function stateKey(wallet: EvmAddress): string {
  return `scroll:state:${wallet}`
}

function encodeSelector(selector: ProofSelector | undefined): string {
  const resolved = selector ?? { category: "state" as const, key: "canonical" }
  const query = new URLSearchParams({ category: resolved.category })
  if (resolved.key) query.set("key", resolved.key)
  return query.toString()
}

function canonicalInput(state: PlayerState): PlayerStateInput {
  const equipment = Object.fromEntries(
    Object.entries(state.equipment).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  )
  return {
    wallet: state.wallet,
    scrollTokenId: state.scrollTokenId ?? "0",
    schemaVersion: state.schemaVersion,
    stateVersion: state.stateVersion,
    level: state.level,
    experience: state.experience,
    achievements: state.achievements,
    fineries: state.fineries,
    equipment,
    unlocks: state.unlocks,
    stats: state.stats,
    updatedAt: state.updatedAt,
  }
}

function proofSubject(proof: CurrentProof): ProofSubject {
  switch (proof.category) {
    case "state": return { category: "state" }
    case "achievement": return { category: "achievement", id: proof.key }
    case "finery": return { category: "finery", id: proof.key }
    case "unlock": return { category: "unlock", id: proof.key }
    case "equipment": return { category: "equipment", slot: proof.key, itemId: proof.value }
  }
}

function stateCoreProof(proof: CurrentProof): StateMerkleProof {
  const common = {
    wallet: proof.wallet,
    scrollTokenId: proof.scrollTokenId,
    stateVersion: proof.stateVersion,
    stateRoot: proof.stateRoot,
    leaf: proof.leaf,
    siblings: proof.siblings,
  }
  return proof.category === "state"
    ? { ...common, subject: { category: "state" }, stateHash: proof.canonicalHash }
    : { ...common, subject: proofSubject(proof) as Exclude<ProofSubject, { category: "state" }> }
}

function retryDelay(attempt: number, config: ScrollAdapterConfig["retry"]): number {
  const base = config?.baseDelayMs ?? 250
  const maximum = config?.maximumDelayMs ?? 10_000
  const exponential = Math.min(maximum, base * 2 ** Math.max(0, attempt - 1))
  return Math.round(exponential * (0.75 + Math.random() * 0.5))
}

function parsePersistedQueue(value: string | null, wallet: EvmAddress): PersistedMutation[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PersistedMutation => Boolean(
      item && typeof item === "object"
      && (item as PersistedMutation).wallet === wallet
      && typeof (item as PersistedMutation).mutationId === "string"
      && Number.isSafeInteger((item as PersistedMutation).expectedVersion),
    ))
  } catch {
    return []
  }
}

function mutationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID()
  const bytes = new Uint8Array(16)
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new ScrollAdapterError("Secure randomness is required to queue progress", "SECURE_RANDOM_UNAVAILABLE")
  }
  globalThis.crypto.getRandomValues(bytes)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

class DefaultScrollAdapter implements ScrollAdapter {
  private readonly api: ScrollApiClient
  private readonly storage: ScrollAdapterStorage
  private readonly stateByWallet = new Map<EvmAddress, PlayerState>()
  private readonly queueByWallet = new Map<EvmAddress, PersistedMutation[]>()
  private readonly hydratedWallets = new Set<EvmAddress>()
  private readonly syncByWallet = new Map<EvmAddress, Promise<void>>()
  private readonly mintIntents = new Map<EvmAddress, MintIntent>()

  readonly guest: boolean

  constructor(private readonly config: ScrollAdapterConfig) {
    if (!Number.isSafeInteger(config.chainId) || config.chainId <= 0) throw new Error("chainId must be a positive integer")
    this.api = new ScrollApiClient(config)
    this.storage = config.storage ?? defaultScrollStorage()
    this.guest = config.walletProvider === undefined
  }

  private async hydrate(wallet: EvmAddress): Promise<void> {
    if (this.hydratedWallets.has(wallet)) return
    const [queueValue, stateValue] = await Promise.all([this.storage.get(queueKey(wallet)), this.storage.get(stateKey(wallet))])
    this.queueByWallet.set(wallet, parsePersistedQueue(queueValue, wallet))
    if (stateValue) {
      try {
        const state = JSON.parse(stateValue) as PlayerState
        if (state.wallet === wallet) this.stateByWallet.set(wallet, state)
      } catch {
        // A corrupt local cache is disposable; the signed server state wins.
      }
    }
    this.hydratedWallets.add(wallet)
  }

  private persist(wallet: EvmAddress): void {
    const queue = this.queueByWallet.get(wallet) ?? []
    const state = this.stateByWallet.get(wallet)
    void Promise.all([
      queue.length === 0 ? this.storage.remove(queueKey(wallet)) : this.storage.set(queueKey(wallet), JSON.stringify(queue)),
      state ? this.storage.set(stateKey(wallet), JSON.stringify(state)) : this.storage.remove(stateKey(wallet)),
    ]).catch(() => undefined)
  }

  private scheduleSync(wallet: EvmAddress): void {
    if (this.guest || this.syncByWallet.has(wallet)) return
    const pending = this.syncWallet(wallet)
    this.syncByWallet.set(wallet, pending)
    void pending.finally(() => {
      if (this.syncByWallet.get(wallet) === pending) this.syncByWallet.delete(wallet)
    }).catch(() => undefined)
  }

  private async syncWallet(wallet: EvmAddress): Promise<void> {
    const maximumAttempts = this.config.retry?.maximumAttempts ?? 5
    const queue = this.queueByWallet.get(wallet) ?? []
    while (queue.length > 0) {
      const current = queue[0]
      if (!current) return
      current.status = "syncing"
      this.persist(wallet)
      try {
        const response = await this.api.request<StateMutationResponse>(`/players/${wallet}/state`, {
          method: "POST",
          wallet,
          authenticated: true,
          body: { mutationId: current.mutationId, expectedVersion: current.expectedVersion, mutation: current.mutation },
        })
        queue.shift()
        const projected = queue.reduce((state, item) => applyOptimisticMutation(state, item.mutation), response.state)
        this.stateByWallet.set(wallet, projected)
        this.config.onCheckpointStatus?.(response.state.checkpoint)
        this.persist(wallet)
      } catch (error) {
        current.attempts += 1
        if (error instanceof ScrollAdapterError && error.status === 409) {
          const details = error.details as { readonly currentState?: PlayerState } | null
          const serverState = details?.currentState
          current.status = "conflict"
          if (serverState) {
            this.stateByWallet.set(wallet, serverState)
            this.config.onConflict?.(serverState, {
              mutationId: current.mutationId,
              wallet,
              expectedVersion: current.expectedVersion,
              localState: applyOptimisticMutation(serverState, current.mutation),
              status: current.status,
            })
            if (isSafelyRebasable(current.mutation)) {
              current.expectedVersion = serverState.stateVersion
              current.status = "queued"
              this.persist(wallet)
              continue
            }
          }
          this.persist(wallet)
          return
        }
        if (error instanceof ScrollAdapterError && error.status !== undefined && error.status >= 400 && error.status < 500) {
          current.status = "rejected"
          this.persist(wallet)
          return
        }
        current.status = "queued"
        this.persist(wallet)
        if (current.attempts >= maximumAttempts) return
        await new Promise((resolve) => setTimeout(resolve, retryDelay(current.attempts, this.config.retry)))
      }
    }
  }

  async getPlayerState(inputWallet: EvmAddress): Promise<PlayerState> {
    const wallet = normalizeWallet(inputWallet)
    await this.hydrate(wallet)
    let response: PlayerState
    try {
      response = await this.api.request<PlayerState>(`/players/${wallet}/state`, { wallet, authenticated: true })
    } catch (error) {
      const cached = this.stateByWallet.get(wallet)
      const fatalClientError = error instanceof ScrollAdapterError
        && error.status !== undefined
        && error.status >= 400
        && error.status < 500
      if (!cached || fatalClientError) throw error
      this.scheduleSync(wallet)
      return cached
    }
    const queued = this.queueByWallet.get(wallet) ?? []
    const projected = queued.reduce((state, item) => applyOptimisticMutation(state, item.mutation), response)
    this.stateByWallet.set(wallet, projected)
    this.persist(wallet)
    this.scheduleSync(wallet)
    return projected
  }

  saveProgress(inputWallet: EvmAddress, mutation: ProgressMutation): QueuedProgress {
    const wallet = normalizeWallet(inputWallet)
    const state = this.stateByWallet.get(wallet)
    if (!state) throw new StateUnavailableError()
    const id = mutationId()
    const projected = applyOptimisticMutation(state, mutation)
    const item: PersistedMutation = {
      mutationId: id,
      wallet,
      expectedVersion: state.stateVersion,
      mutation,
      queuedAt: new Date().toISOString(),
      attempts: 0,
      status: "queued",
    }
    const queue = this.queueByWallet.get(wallet) ?? []
    queue.push(item)
    this.queueByWallet.set(wallet, queue)
    this.stateByWallet.set(wallet, projected)
    this.persist(wallet)
    const result: QueuedProgress = {
      mutationId: id,
      wallet,
      expectedVersion: item.expectedVersion,
      localState: projected,
      status: "queued",
    }
    this.scheduleSync(wallet)
    return result
  }

  async getScroll(inputWallet: EvmAddress): Promise<ScrollRecord | null> {
    const wallet = normalizeWallet(inputWallet)
    return await this.api.request<ScrollRecord | null>(`/players/${wallet}/scroll`)
  }

  async getCurrentProof(inputWallet: EvmAddress, selector?: ProofSelector): Promise<CurrentProof> {
    const wallet = normalizeWallet(inputWallet)
    return await this.api.request<CurrentProof>(`/players/${wallet}/proof?${encodeSelector(selector)}`)
  }

  async verifyPlayerState(inputWallet: EvmAddress, state: PlayerState, proof: CurrentProof): Promise<boolean> {
    const wallet = normalizeWallet(inputWallet)
    if (state.wallet !== wallet || proof.wallet !== wallet || proof.stateRoot !== state.stateRoot) return false
    if (proof.checkpointStateRoot !== proof.stateRoot || proof.checkpointVersion !== proof.stateVersion) return false
    const commitment = createStateCommitment(canonicalInput(state))
    if (commitment.stateHash !== state.canonicalHash || commitment.stateRoot !== state.stateRoot) return false
    return verifyProof(stateCoreProof(proof), proof.stateRoot)
  }

  async requestMint(inputWallet: EvmAddress): Promise<MintIntent> {
    const wallet = normalizeWallet(inputWallet)
    const intent = await this.api.request<MintIntent>(`/players/${wallet}/mint-intent`, {
      method: "POST",
      wallet,
      authenticated: true,
      body: {},
    })
    this.mintIntents.set(wallet, intent)
    return intent
  }

  async confirmMint(inputWallet: EvmAddress, transactionHash: TransactionHash): Promise<MintConfirmation> {
    const wallet = normalizeWallet(inputWallet)
    return await this.api.request<MintConfirmation>(`/players/${wallet}/mint-confirmation`, {
      method: "POST",
      wallet,
      authenticated: true,
      body: { intentId: this.mintIntents.get(wallet)?.intentId, transactionHash },
    })
  }

  async flushCheckpoint(inputWallet: EvmAddress): Promise<CheckpointFlushResult> {
    const wallet = normalizeWallet(inputWallet)
    const result = await this.api.request<CheckpointFlushResult>("/checkpoints/flush", {
      method: "POST",
      wallet,
      authenticated: true,
      body: { wallet },
    })
    this.config.onCheckpointStatus?.(result.checkpoint)
    return result
  }

  async getPlayerSummary(inputWallet: EvmAddress): Promise<PlayerSummary> {
    const wallet = normalizeWallet(inputWallet)
    return await this.api.request<PlayerSummary>(`/players/${wallet}/summary`)
  }

  async reconnect(inputWallet: EvmAddress): Promise<PlayerState> {
    this.api.clearSession()
    return await this.getPlayerState(inputWallet)
  }

  async disconnect(): Promise<void> {
    this.api.clearSession()
  }
}

export function createScrollAdapter(config: ScrollAdapterConfig): ScrollAdapter {
  return new DefaultScrollAdapter(config)
}
