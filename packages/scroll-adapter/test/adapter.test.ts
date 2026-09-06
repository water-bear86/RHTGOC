import { describe, expect, it, vi } from "vitest"
import { createStateCommitment, getProof } from "@robinhood-game/scroll-state-core"
import {
  AuthenticationRequiredError,
  CheckpointStatus,
  MemoryScrollStorage,
  createScrollAdapter,
  type CurrentProof,
  type PlayerState,
  type ScrollAdapterConfig,
  type ScrollWalletProvider,
} from "../src/index.js"

const WALLET = "0x1111111111111111111111111111111111111111" as const
const SECOND_WALLET = "0x9999999999999999999999999999999999999999" as const
const ROOT = `0x${"22".repeat(32)}` as const
const HASH = `0x${"33".repeat(32)}` as const

function playerState(version = 1): PlayerState {
  return {
    wallet: WALLET,
    scrollTokenId: "7",
    schemaVersion: 1,
    stateVersion: version,
    level: 3,
    experience: 450,
    achievements: ["first_rescue"],
    fineries: ["greenhood_v2"],
    equipment: { primary: "greenhood_v2", secondary: null },
    unlocks: ["mission:peoples_purse"],
    stats: { captures: 1, rescues: 2, matches: 3 },
    canonicalHash: HASH,
    stateRoot: ROOT,
    updatedAt: "2026-09-05T12:00:00.000Z",
    checkpoint: {
      version,
      stateRoot: ROOT,
      checkpointedAt: "2026-09-05T12:00:00.000Z",
      transactionHash: `0x${"44".repeat(32)}`,
      status: CheckpointStatus.Synced,
      pendingVersion: null,
      dirtySince: null,
      lastAttemptAt: null,
      errorCode: null,
    },
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function authenticatedConfig(fetchImplementation: typeof fetch, storage = new MemoryScrollStorage()): ScrollAdapterConfig {
  return {
    apiBaseUrl: "https://scroll.test",
    chainId: 46630,
    fetch: fetchImplementation,
    storage,
    retry: { maximumAttempts: 1, baseDelayMs: 1, maximumDelayMs: 1 },
    walletProvider: {
      request: vi.fn(async ({ method }: { readonly method: string; readonly params?: unknown }) => {
        if (method === "eth_chainId") return "0xb626"
        if (method === "eth_signTypedData_v4") return `0x${"55".repeat(65)}`
        throw new Error(`Unexpected wallet method ${method}`)
      }) as ScrollWalletProvider["request"],
    },
  }
}

function fetchWithSession(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/auth/challenge")) {
      const wallet = JSON.parse(String(init?.body)).wallet as string
      return json({
        challengeId: "challenge-1",
        expiresAt: "2099-09-05T12:00:00.000Z",
        typedData: {
          domain: { name: "Sherwood, the game (on robinhood chain)", version: "1", chainId: 46630 },
          types: {},
          primaryType: "ScrollSession",
          message: { wallet, nonce: "challenge-1" },
        },
      })
    }
    if (url.endsWith("/auth/session")) return json({ accessToken: "opaque-session", expiresAt: "2099-09-05T12:00:00.000Z" })
    return await handler(url, init)
  }) as typeof fetch
}

describe("scroll adapter", () => {
  it("publishes the checkpoint states used by the UI", () => {
    expect(Object.values(CheckpointStatus)).toEqual([
      "synced", "pending", "submitting", "confirming", "failed", "conflict", "unavailable",
    ])
  })

  it("authenticates once with EIP-712 and fetches canonical state", async () => {
    const fetchImplementation = fetchWithSession((url) => {
      expect(url).toBe(`https://scroll.test/players/${WALLET}/state`)
      return json(playerState())
    })
    const config = authenticatedConfig(fetchImplementation)
    const adapter = createScrollAdapter(config)

    await expect(adapter.getPlayerState(WALLET)).resolves.toEqual(playerState())
    expect(config.walletProvider?.request).toHaveBeenCalledWith({ method: "eth_chainId" })
    expect(config.walletProvider?.request).toHaveBeenCalledWith(expect.objectContaining({ method: "eth_signTypedData_v4" }))
    expect(fetchImplementation).toHaveBeenCalledTimes(3)
  })

  it("rejects a typed-data challenge for another chain before asking the wallet to sign", async () => {
    const fetchImplementation = vi.fn(async () => json({
      challengeId: "challenge-1",
      expiresAt: "2099-09-05T12:00:00.000Z",
      typedData: {
        domain: { name: "Sherwood, the game (on robinhood chain)", version: "1", chainId: 1 },
        types: {},
        primaryType: "ScrollSession",
        message: { wallet: WALLET, nonce: "challenge-1" },
      },
    })) as typeof fetch
    const config = authenticatedConfig(fetchImplementation)
    const adapter = createScrollAdapter(config)

    await expect(adapter.getPlayerState(WALLET)).rejects.toMatchObject({ code: "INVALID_CHALLENGE" })
    expect(config.walletProvider?.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "eth_signTypedData_v4" }))
  })

  it("updates equipment immediately and persists asynchronously", async () => {
    const fetchImplementation = fetchWithSession((url, init) => {
      if (init?.method === "POST" && url.endsWith("/state")) return json({ state: playerState(2) })
      return json(playerState())
    })
    const adapter = createScrollAdapter(authenticatedConfig(fetchImplementation))
    await adapter.getPlayerState(WALLET)

    const queued = adapter.saveProgress(WALLET, { kind: "select_equipment", itemIds: ["ironwood_bow", "buckler"] })

    expect(queued.status).toBe("queued")
    expect(queued.localState.stateVersion).toBe(2)
    expect(queued.localState.equipment).toMatchObject({ primary: "ironwood_bow", secondary: "buckler" })
    expect(queued.localState.checkpoint.status).toBe(CheckpointStatus.Pending)
    await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(4))
    const statePost = vi.mocked(fetchImplementation).mock.calls.at(-1)
    expect(JSON.parse(String(statePost?.[1]?.body))).toMatchObject({
      expectedVersion: 1,
      mutation: { kind: "select_equipment", itemIds: ["ironwood_bow", "buckler"] },
    })
  })

  it("never projects client-authored match rewards", async () => {
    const fetchImplementation = fetchWithSession((_url, init) => init?.method === "POST"
      ? json({ state: playerState(2) })
      : json(playerState()))
    const adapter = createScrollAdapter(authenticatedConfig(fetchImplementation))
    const before = await adapter.getPlayerState(WALLET)
    const queued = adapter.saveProgress(WALLET, { kind: "claim_match_result", matchResultId: "match-result-1" })

    expect(queued.localState.achievements).toEqual(before.achievements)
    expect(queued.localState.fineries).toEqual(before.fineries)
    expect(queued.localState.experience).toBe(before.experience)
    expect(queued.localState.stateVersion).toBe(before.stateVersion + 1)
  })

  it("keeps a failed mutation in durable local storage for later reconnect", async () => {
    const storage = new MemoryScrollStorage()
    const fetchImplementation = fetchWithSession((_url, init) => {
      if (init?.method === "POST") throw new TypeError("offline")
      return json(playerState())
    })
    const adapter = createScrollAdapter(authenticatedConfig(fetchImplementation, storage))
    await adapter.getPlayerState(WALLET)
    const queued = adapter.saveProgress(WALLET, { kind: "claim_match_result", matchResultId: "result-offline" })

    await vi.waitFor(async () => {
      const stored = await storage.get(`scroll:mutations:${WALLET}`)
      expect(stored).toContain(queued.mutationId)
    })
  })

  it("serves the last local projection when AWS is offline", async () => {
    const storage = new MemoryScrollStorage()
    const online = createScrollAdapter(authenticatedConfig(fetchWithSession(() => json(playerState())), storage))
    await online.getPlayerState(WALLET)
    await vi.waitFor(async () => expect(await storage.get(`scroll:state:${WALLET}`)).not.toBeNull())

    const offline = createScrollAdapter(authenticatedConfig(vi.fn(async () => {
      throw new TypeError("network unavailable")
    }) as typeof fetch, storage))

    await expect(offline.getPlayerState(WALLET)).resolves.toEqual(playerState())
  })

  it("retries a transient synchronization failure without blocking the local update", async () => {
    let postCount = 0
    const fetchImplementation = fetchWithSession((_url, init) => {
      if (init?.method !== "POST") return json(playerState())
      postCount += 1
      if (postCount === 1) throw new TypeError("temporary outage")
      return json({ state: playerState(2) })
    })
    const config = {
      ...authenticatedConfig(fetchImplementation),
      retry: { maximumAttempts: 2, baseDelayMs: 1, maximumDelayMs: 1 },
    }
    const adapter = createScrollAdapter(config)
    await adapter.getPlayerState(WALLET)

    expect(adapter.saveProgress(WALLET, { kind: "claim_match_result", matchResultId: "result-retry" }).status).toBe("queued")
    await vi.waitFor(() => expect(postCount).toBe(2))
  })

  it("rebases only equipment selection after a stale version", async () => {
    let postCount = 0
    const canonicalV2 = playerState(2)
    const canonicalV3 = playerState(3)
    const fetchImplementation = fetchWithSession((_url, init) => {
      if (init?.method !== "POST") return json(playerState())
      postCount += 1
      return postCount === 1
        ? json({ code: "STATE_CONFLICT", message: "stale", currentState: canonicalV2 }, 409)
        : json({ state: canonicalV3 })
    })
    const adapter = createScrollAdapter(authenticatedConfig(fetchImplementation))
    await adapter.getPlayerState(WALLET)
    adapter.saveProgress(WALLET, { kind: "select_equipment", itemIds: ["ironwood_bow"] })

    await vi.waitFor(() => expect(postCount).toBe(2))
    const posts = vi.mocked(fetchImplementation).mock.calls.filter(([input, init]) => (
      init?.method === "POST" && String(input).endsWith("/state")
    ))
    expect(JSON.parse(String(posts[1]?.[1]?.body))).toMatchObject({ expectedVersion: 2 })
  })

  it("supports read-only guest summary and proof calls without signing", async () => {
    const proof: CurrentProof = {
      wallet: WALLET,
      scrollTokenId: "7",
      schemaVersion: 1,
      stateVersion: 1,
      category: "state",
      key: "canonical",
      value: HASH,
      leaf: HASH,
      siblings: [],
      canonicalHash: HASH,
      stateRoot: ROOT,
      checkpointVersion: 1,
      checkpointStateRoot: ROOT,
      verified: true,
    }
    const fetchImplementation = vi.fn(async (input: URL | RequestInfo) => String(input).includes("/proof?")
      ? json(proof)
      : json({ ...playerState(), verified: true })) as typeof fetch
    const adapter = createScrollAdapter({ apiBaseUrl: "https://scroll.test", chainId: 46630, fetch: fetchImplementation })

    expect(adapter.guest).toBe(true)
    await expect(adapter.getPlayerSummary(WALLET)).resolves.toMatchObject({ wallet: WALLET, verified: true })
    await expect(adapter.getCurrentProof(WALLET)).resolves.toEqual(proof)
    await expect(adapter.getPlayerState(WALLET)).rejects.toBeInstanceOf(AuthenticationRequiredError)
  })

  it("drops only the in-memory auth session on disconnect and signs again on reconnect", async () => {
    const fetchImplementation = fetchWithSession(() => json(playerState()))
    const adapter = createScrollAdapter(authenticatedConfig(fetchImplementation))
    await adapter.getPlayerState(WALLET)
    await adapter.disconnect()
    await adapter.reconnect(WALLET)

    const challengeCalls = vi.mocked(fetchImplementation).mock.calls.filter(([input]) => String(input).endsWith("/auth/challenge"))
    expect(challengeCalls).toHaveLength(2)
  })

  it("never reuses an authenticated session across wallets", async () => {
    const fetchImplementation = fetchWithSession((url) => json({
      ...playerState(),
      wallet: url.includes(SECOND_WALLET) ? SECOND_WALLET : WALLET,
    }))
    const adapter = createScrollAdapter(authenticatedConfig(fetchImplementation))

    await adapter.getPlayerState(WALLET)
    await adapter.getPlayerState(SECOND_WALLET)

    const challengeCalls = vi.mocked(fetchImplementation).mock.calls.filter(([input]) => String(input).endsWith("/auth/challenge"))
    expect(challengeCalls).toHaveLength(2)
  })

  it("uses the public mint, confirmation, and flush response contracts", async () => {
    const mintIntent = {
      intentId: "mint-1",
      wallet: WALLET,
      chainId: 46630,
      scrollContract: "0x2222222222222222222222222222222222222222",
      robinToken: "0x3333333333333333333333333333333333333333",
      upkeepTreasury: "0x4444444444444444444444444444444444444444",
      burnAddress: "0x000000000000000000000000000000000000dEaD",
      totalPriceBaseUnits: "100",
      upkeepAmountBaseUnits: "50",
      burnedAmountBaseUnits: "50",
      tokenSymbol: "$ROBIN",
      tokenDecimals: 18,
      execution: "wallet",
      approvalTransaction: null,
      mintTransaction: {
        chainId: 46630,
        from: WALLET,
        to: "0x2222222222222222222222222222222222222222",
        data: "0x1234",
        value: "0x0",
      },
      expiresAt: "2099-09-05T12:00:00.000Z",
    } as const
    const fetchImplementation = fetchWithSession((url) => {
      if (url.endsWith("/mint-intent")) return json(mintIntent)
      if (url.endsWith("/mint-confirmation")) return json({
        intentId: "mint-1", wallet: WALLET, transactionHash: `0x${"66".repeat(32)}`,
        status: "pending", confirmations: 1, requiredConfirmations: 12, scroll: null, errorCode: null,
      })
      if (url.endsWith("/checkpoints/flush")) return json({
        requestId: "flush-1", wallet: WALLET, accepted: true, checkpoint: playerState().checkpoint,
      })
      return json(null)
    })
    const adapter = createScrollAdapter(authenticatedConfig(fetchImplementation))
    const transactionHash = `0x${"66".repeat(32)}` as const

    await expect(adapter.requestMint(WALLET)).resolves.toEqual(mintIntent)
    await expect(adapter.confirmMint(WALLET, transactionHash)).resolves.toMatchObject({ intentId: "mint-1", status: "pending" })
    await expect(adapter.flushCheckpoint(WALLET)).resolves.toMatchObject({ requestId: "flush-1", accepted: true })
  })

  it("cryptographically verifies a canonical state proof against the checkpoint root", async () => {
    const base = playerState()
    const commitment = createStateCommitment({
      wallet: base.wallet,
      scrollTokenId: base.scrollTokenId ?? "0",
      schemaVersion: base.schemaVersion,
      stateVersion: base.stateVersion,
      level: base.level,
      experience: base.experience,
      achievements: base.achievements,
      fineries: base.fineries,
      equipment: { primary: "greenhood_v2" },
      unlocks: base.unlocks,
      stats: base.stats,
      updatedAt: base.updatedAt,
    })
    const canonicalProof = getProof(commitment, { category: "state" })
    const state: PlayerState = {
      ...base,
      equipment: { primary: "greenhood_v2", secondary: null },
      canonicalHash: commitment.stateHash,
      stateRoot: commitment.stateRoot,
      checkpoint: { ...base.checkpoint, version: 1, stateRoot: commitment.stateRoot },
    }
    const proof: CurrentProof = {
      wallet: WALLET,
      scrollTokenId: "7",
      schemaVersion: 1,
      stateVersion: 1,
      category: "state",
      key: "canonical",
      value: commitment.stateHash,
      leaf: canonicalProof.leaf,
      siblings: canonicalProof.siblings,
      canonicalHash: commitment.stateHash,
      stateRoot: commitment.stateRoot,
      checkpointVersion: 1,
      checkpointStateRoot: commitment.stateRoot,
      verified: true,
    }
    const adapter = createScrollAdapter({
      apiBaseUrl: "https://scroll.test",
      chainId: 46630,
      fetch: vi.fn(),
    })

    await expect(adapter.verifyPlayerState(WALLET, state, proof)).resolves.toBe(true)
    await expect(adapter.verifyPlayerState(WALLET, state, { ...proof, leaf: HASH })).resolves.toBe(false)
  })
})
