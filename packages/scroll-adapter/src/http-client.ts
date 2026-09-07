import { AuthenticationRequiredError, ScrollAdapterError } from "./errors.js"
import type { EvmAddress, ScrollAdapterConfig, WalletTypedDataRequest } from "./types.js"

interface ChallengeResponse {
  readonly challengeId: string
  readonly typedData: WalletTypedDataRequest
  readonly expiresAt: string
}

interface SessionResponse {
  readonly accessToken: string
  readonly expiresAt: string
}

interface ErrorResponse {
  readonly code?: unknown
  readonly message?: unknown
  readonly currentVersion?: unknown
}

interface SessionState {
  readonly accessToken: string
  readonly expiresAtMs: number
  readonly wallet: EvmAddress
}

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/

function assertChallengeBinding(
  challenge: ChallengeResponse,
  wallet: EvmAddress,
  expectedChainId: number,
): void {
  const expiresAtMs = Date.parse(challenge.expiresAt)
  const typedWallet = challenge.typedData.message.wallet
  const typedNonce = challenge.typedData.message.nonce
  const typedChainId = challenge.typedData.domain.chainId
  let chainMatches = false
  try {
    chainMatches = BigInt(typedChainId as string | number | bigint) === BigInt(expectedChainId)
  } catch {
    chainMatches = false
  }
  if (
    challenge.typedData.primaryType !== "ScrollSession"
    || typeof typedWallet !== "string"
    || normalizeWallet(typedWallet) !== wallet
    || typedNonce !== challenge.challengeId
    || !chainMatches
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs <= Date.now()
  ) {
    throw new ScrollAdapterError("Scroll authentication challenge is not bound to this wallet and chain", "INVALID_CHALLENGE")
  }
}

export function normalizeWallet(wallet: string): EvmAddress {
  if (!ADDRESS_PATTERN.test(wallet)) throw new ScrollAdapterError("Invalid EVM wallet address", "INVALID_WALLET", 400)
  return wallet.toLowerCase() as EvmAddress
}

export class ScrollApiClient {
  private readonly fetchImplementation: typeof globalThis.fetch
  private session: SessionState | null = null
  private sessionPending: Readonly<{ wallet: EvmAddress; promise: Promise<SessionState> }> | null = null

  constructor(private readonly config: ScrollAdapterConfig) {
    this.fetchImplementation = config.fetch ?? globalThis.fetch
    if (typeof this.fetchImplementation !== "function") throw new Error("A Fetch API implementation is required")
  }

  clearSession(): void {
    this.session = null
    this.sessionPending = null
  }

  private endpoint(path: string): string {
    return `${this.config.apiBaseUrl.replace(/\/$/, "")}${path}`
  }

  private async json<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => null) as (T & ErrorResponse) | null
    if (!response.ok || body === null) {
      const code = typeof body?.code === "string" ? body.code : `HTTP_${response.status}`
      const message = typeof body?.message === "string" ? body.message : "Scroll service request failed"
      throw new ScrollAdapterError(message, code, response.status, body)
    }
    return body
  }

  private async createSession(wallet: EvmAddress): Promise<SessionState> {
    const provider = this.config.walletProvider
    if (!provider) throw new AuthenticationRequiredError()
    const actualChainId = await provider.request<string>({ method: "eth_chainId" })
    if (BigInt(actualChainId) !== BigInt(this.config.chainId)) {
      throw new ScrollAdapterError("The connected wallet is on the wrong chain", "WRONG_CHAIN", 400)
    }
    const challenge = await this.json<ChallengeResponse>(await this.fetchImplementation(this.endpoint("/auth/challenge"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, chainId: this.config.chainId }),
    }))
    assertChallengeBinding(challenge, wallet, this.config.chainId)
    const signature = await provider.request<string>({
      method: "eth_signTypedData_v4",
      params: [wallet, JSON.stringify(challenge.typedData)],
    })
    if (!/^0x[0-9a-fA-F]+$/.test(signature)) throw new ScrollAdapterError("Wallet returned an invalid signature", "INVALID_SIGNATURE")
    const session = await this.json<SessionResponse>(await this.fetchImplementation(this.endpoint("/auth/session"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ wallet, challengeId: challenge.challengeId, signature }),
    }))
    const expiresAtMs = Date.parse(session.expiresAt)
    if (!session.accessToken || !Number.isFinite(expiresAtMs)) throw new ScrollAdapterError("Scroll service returned an invalid session", "INVALID_SESSION")
    return { accessToken: session.accessToken, expiresAtMs, wallet }
  }

  private authenticate(wallet: EvmAddress): Promise<SessionState> {
    if (
      this.session
      && this.session.wallet === wallet
      && this.session.expiresAtMs - Date.now() > 30_000
    ) return Promise.resolve(this.session)
    if (this.sessionPending) {
      if (this.sessionPending.wallet === wallet) return this.sessionPending.promise
      return this.sessionPending.promise.then(
        () => this.authenticate(wallet),
        () => this.authenticate(wallet),
      )
    }
    const pending = this.createSession(wallet)
    const pendingEntry = { wallet, promise: pending }
    this.sessionPending = pendingEntry
    void pending.then(
      (session) => {
        if (this.sessionPending === pendingEntry) {
          this.session = session
          this.sessionPending = null
        }
      },
      () => {
        if (this.sessionPending === pendingEntry) this.sessionPending = null
      },
    )
    return pending
  }

  async request<T>(
    path: string,
    options: Readonly<{ method?: string; body?: unknown; wallet?: EvmAddress; authenticated?: boolean }> = {},
  ): Promise<T> {
    const authenticated = options.authenticated === true
    if (authenticated && !options.wallet) throw new AuthenticationRequiredError()
    const session = authenticated && options.wallet ? await this.authenticate(options.wallet) : null
    const headers: Record<string, string> = { accept: "application/json" }
    if (options.body !== undefined) headers["content-type"] = "application/json"
    if (session) headers.authorization = `Bearer ${session.accessToken}`
    const requestInit: RequestInit = {
      method: options.method ?? "GET",
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }
    let response = await this.fetchImplementation(this.endpoint(path), requestInit)
    if (authenticated && response.status === 401 && options.wallet) {
      this.clearSession()
      const refreshed = await this.authenticate(options.wallet)
      headers.authorization = `Bearer ${refreshed.accessToken}`
      response = await this.fetchImplementation(this.endpoint(path), requestInit)
    }
    return await this.json<T>(response)
  }
}
