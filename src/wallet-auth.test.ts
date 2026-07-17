import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  createAppKit: vi.fn(),
  getSupabase: vi.fn(),
}))

vi.mock("@reown/appkit", () => ({ createAppKit: mocks.createAppKit }))
vi.mock("./sherwood-ethers-adapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sherwood-ethers-adapter")>()
  return { ...actual, SherwoodEthersAdapter: class {} }
})
vi.mock("./supabase", () => ({ getSupabase: mocks.getSupabase }))

interface FakeProvider {
  request: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
}

interface AccountState {
  address?: string
  isConnected: boolean
}

type AppKitEvent =
  | { event: "SELECT_WALLET"; properties: Record<string, unknown> }
  | { event: "CONNECT_SUCCESS"; properties: Record<string, unknown> }
  | { event: "CONNECT_ERROR"; properties: { message: string } }
  | { event: "USER_REJECTED"; properties: { message: string } }
  | { event: "MODAL_CLOSE"; properties: { connected: boolean } }

function fakeProvider(): FakeProvider {
  return {
    request: vi.fn(async ({ method }: { method: string }) => method === "eth_chainId" ? "0xb626" : undefined),
    on: vi.fn(),
    removeListener: vi.fn(),
  }
}

function fakeModal() {
  let provider: FakeProvider | null = null
  let address: string | undefined
  let connected = false
  let chainId: string | number | undefined = 46630
  const accountListeners = new Set<(state: AccountState) => void>()
  const eventListeners = new Set<(state: { data: AppKitEvent }) => void>()
  const unsubscribeAccount = vi.fn()
  const unsubscribeEvents = vi.fn()

  return {
    getChainId: vi.fn(() => chainId),
    getWalletProvider: vi.fn(() => provider),
    getAddress: vi.fn(() => address),
    getIsConnectedState: vi.fn(() => connected),
    subscribeAccount: vi.fn((listener: (state: AccountState) => void) => {
      accountListeners.add(listener)
      return () => {
        unsubscribeAccount()
        accountListeners.delete(listener)
      }
    }),
    subscribeEvents: vi.fn((listener: (state: { data: AppKitEvent }) => void) => {
      eventListeners.add(listener)
      return () => {
        unsubscribeEvents()
        eventListeners.delete(listener)
      }
    }),
    open: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    switchNetwork: vi.fn(async (network: { id: string | number }) => {
      chainId = network.id
    }),
    resetWcConnection: vi.fn(),
    connect(nextAddress: string, nextProvider: FakeProvider) {
      provider = nextProvider
      address = nextAddress
      connected = true
      for (const listener of accountListeners) listener({ address, isConnected: true })
    },
    emit(event: AppKitEvent) {
      for (const listener of eventListeners) listener({ data: event })
    },
    setExisting(nextAddress: string, nextProvider: FakeProvider) {
      provider = nextProvider
      address = nextAddress
      connected = true
    },
    setChainId(nextChainId: string | number | undefined) {
      chainId = nextChainId
    },
    unsubscribeAccount,
    unsubscribeEvents,
  }
}

async function loadWalletAuth() {
  vi.resetModules()
  return import("./wallet-auth")
}

beforeEach(() => {
  vi.stubEnv("VITE_REOWN_PROJECT_ID", "test-project")
  vi.stubEnv("VITE_ROBINHOOD_CHAIN", "testnet")
  vi.stubGlobal("location", { origin: "https://rhtgoc.site" })
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
  })
  mocks.createAppKit.mockReset()
  mocks.getSupabase.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("Robinhood wallet connection", () => {
  it("replaces a stale testnet CAIP state with Robinhood mainnet before opening the connector", async () => {
    vi.stubEnv("VITE_ROBINHOOD_CHAIN", "mainnet")
    const modal = fakeModal()
    const provider = fakeProvider()
    provider.request.mockImplementation(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return "0x1237"
      throw new Error(`Unexpected wallet method: ${method}`)
    })
    modal.setChainId("46630")
    mocks.createAppKit.mockReturnValue(modal)
    const { connectedRobinhoodWallet, robinhoodNetwork } = await loadWalletAuth()

    const pending = connectedRobinhoodWallet()

    expect(robinhoodNetwork.id).toBe(4663)
    expect(modal.switchNetwork).toHaveBeenCalledWith(
      expect.objectContaining({ id: 4663, name: "Robinhood Chain" }),
      { throwOnFailure: true },
    )
    await vi.waitFor(() => expect(modal.open).toHaveBeenCalledTimes(1))
    expect(modal.switchNetwork.mock.invocationCallOrder[0]).toBeLessThan(modal.open.mock.invocationCallOrder[0]!)

    modal.connect("0x0101010101010101010101010101010101010101", provider)
    await expect(pending).resolves.toEqual({
      address: "0x0101010101010101010101010101010101010101",
      provider,
    })
  })

  it("does not open the connector when restoring Robinhood mainnet fails", async () => {
    vi.stubEnv("VITE_ROBINHOOD_CHAIN", "mainnet")
    const modal = fakeModal()
    modal.setChainId(46630)
    modal.switchNetwork.mockRejectedValueOnce(new Error("Network switch was declined"))
    mocks.createAppKit.mockReturnValue(modal)
    const { connectedRobinhoodWallet } = await loadWalletAuth()

    await expect(connectedRobinhoodWallet()).rejects.toThrow("Network switch was declined")
    expect(modal.open).not.toHaveBeenCalled()
  })

  it("shares one AppKit connection across concurrent callers", async () => {
    const modal = fakeModal()
    const provider = fakeProvider()
    mocks.createAppKit.mockReturnValue(modal)
    const { connectedRobinhoodWallet } = await loadWalletAuth()

    const first = connectedRobinhoodWallet()
    const second = connectedRobinhoodWallet()

    expect(modal.open).toHaveBeenCalledTimes(1)
    expect(modal.switchNetwork).not.toHaveBeenCalled()
    modal.connect("0x1111111111111111111111111111111111111111", provider)
    modal.emit({ event: "CONNECT_SUCCESS", properties: {} })

    await expect(first).resolves.toEqual({ address: "0x1111111111111111111111111111111111111111", provider })
    await expect(second).resolves.toEqual({ address: "0x1111111111111111111111111111111111111111", provider })
    expect(modal.subscribeAccount).toHaveBeenCalledTimes(1)
    expect(modal.subscribeEvents).toHaveBeenCalledTimes(1)
    expect(modal.unsubscribeAccount).toHaveBeenCalledTimes(1)
    expect(modal.unsubscribeEvents).toHaveBeenCalledTimes(1)
    expect(mocks.createAppKit).toHaveBeenCalledWith(expect.objectContaining({
      enableEIP6963: true,
      enableWalletConnect: true,
      enableInjected: false,
      enableCoinbase: false,
    }))
  })

  it("accepts authoritative account state when CONNECT_SUCCESS telemetry is missed", async () => {
    const modal = fakeModal()
    const provider = fakeProvider()
    mocks.createAppKit.mockReturnValue(modal)
    const { connectedRobinhoodWallet } = await loadWalletAuth()

    const connected = connectedRobinhoodWallet()
    modal.emit({ event: "SELECT_WALLET", properties: {} })
    modal.connect("0x1010101010101010101010101010101010101010", provider)
    modal.emit({ event: "MODAL_CLOSE", properties: { connected: true } })

    await expect(connected).resolves.toEqual({
      address: "0x1010101010101010101010101010101010101010",
      provider,
    })
  })

  it("rechecks account state after subscribing to close the initialization race", async () => {
    const modal = fakeModal()
    const provider = fakeProvider()
    modal.setExisting("0x2020202020202020202020202020202020202020", provider)
    modal.getIsConnectedState.mockReturnValueOnce(false).mockReturnValue(true)
    mocks.createAppKit.mockReturnValue(modal)
    const { connectedRobinhoodWallet } = await loadWalletAuth()

    await expect(connectedRobinhoodWallet()).resolves.toEqual({
      address: "0x2020202020202020202020202020202020202020",
      provider,
    })
    expect(modal.open).not.toHaveBeenCalled()
    expect(modal.unsubscribeAccount).toHaveBeenCalledTimes(1)
    expect(modal.unsubscribeEvents).toHaveBeenCalledTimes(1)
  })

  it("does not mistake WalletConnect's pre-account modal close for cancellation", async () => {
    const modal = fakeModal()
    const provider = fakeProvider()
    mocks.createAppKit.mockReturnValue(modal)
    const { connectedRobinhoodWallet } = await loadWalletAuth()

    const connected = connectedRobinhoodWallet()
    modal.emit({ event: "CONNECT_SUCCESS", properties: {} })
    modal.emit({ event: "MODAL_CLOSE", properties: { connected: false } })
    modal.connect("0x1212121212121212121212121212121212121212", provider)

    await expect(connected).resolves.toEqual({ address: "0x1212121212121212121212121212121212121212", provider })
    expect(modal.resetWcConnection).not.toHaveBeenCalled()
  })

  it("cleans up a cancelled attempt and allows a fresh retry", async () => {
    const modal = fakeModal()
    const provider = fakeProvider()
    mocks.createAppKit.mockReturnValue(modal)
    const { connectedRobinhoodWallet } = await loadWalletAuth()

    const cancelled = connectedRobinhoodWallet()
    modal.emit({ event: "MODAL_CLOSE", properties: { connected: false } })

    await expect(cancelled).rejects.toThrow("Wallet connection cancelled")
    expect(modal.resetWcConnection).toHaveBeenCalledTimes(1)
    expect(modal.unsubscribeAccount).toHaveBeenCalledTimes(1)
    expect(modal.unsubscribeEvents).toHaveBeenCalledTimes(1)

    const retry = connectedRobinhoodWallet()
    expect(modal.open).toHaveBeenCalledTimes(2)
    modal.connect("0x2222222222222222222222222222222222222222", provider)
    modal.emit({ event: "CONNECT_SUCCESS", properties: {} })

    await expect(retry).resolves.toEqual({ address: "0x2222222222222222222222222222222222222222", provider })
  })

  it("times out a selected wallet request and allows a fresh retry", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("window", { setTimeout, clearTimeout })
    const modal = fakeModal()
    const provider = fakeProvider()
    mocks.createAppKit.mockReturnValue(modal)
    const { connectedRobinhoodWallet } = await loadWalletAuth()

    const pending = connectedRobinhoodWallet()
    modal.emit({ event: "SELECT_WALLET", properties: {} })
    modal.emit({ event: "MODAL_CLOSE", properties: { connected: false } })
    const timedOut = expect(pending).rejects.toThrow("Wallet connection timed out")
    await vi.advanceTimersByTimeAsync(120_000)

    await timedOut
    expect(modal.resetWcConnection).toHaveBeenCalledTimes(1)
    expect(modal.unsubscribeAccount).toHaveBeenCalledTimes(1)
    expect(modal.unsubscribeEvents).toHaveBeenCalledTimes(1)

    const retry = connectedRobinhoodWallet()
    expect(retry).not.toBe(pending)
    expect(modal.open).toHaveBeenCalledTimes(2)
    modal.connect("0x2121212121212121212121212121212121212121", provider)
    await expect(retry).resolves.toEqual({
      address: "0x2121212121212121212121212121212121212121",
      provider,
    })
  })

  it("gives a late wallet selection a full timeout window", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("window", { setTimeout, clearTimeout })
    const modal = fakeModal()
    const provider = fakeProvider()
    mocks.createAppKit.mockReturnValue(modal)
    const { connectedRobinhoodWallet } = await loadWalletAuth()

    const pending = connectedRobinhoodWallet()
    await vi.advanceTimersByTimeAsync(119_000)
    modal.emit({ event: "SELECT_WALLET", properties: {} })
    await vi.advanceTimersByTimeAsync(1_000)

    expect(modal.resetWcConnection).not.toHaveBeenCalled()
    modal.connect("0x3131313131313131313131313131313131313131", provider)
    await expect(pending).resolves.toEqual({
      address: "0x3131313131313131313131313131313131313131",
      provider,
    })
  })

  it("surfaces the connector error and clears the pending attempt", async () => {
    const modal = fakeModal()
    mocks.createAppKit.mockReturnValue(modal)
    const { connectedRobinhoodWallet } = await loadWalletAuth()

    const failed = connectedRobinhoodWallet()
    modal.emit({ event: "CONNECT_ERROR", properties: { message: "Unsupported Robinhood network" } })

    await expect(failed).rejects.toThrow("Unsupported Robinhood network")
    expect(modal.resetWcConnection).toHaveBeenCalledTimes(1)
    expect(modal.close).toHaveBeenCalledTimes(1)
  })

  it("switches a restored wallet to the configured Robinhood network before returning it", async () => {
    const modal = fakeModal()
    const provider = fakeProvider()
    let chainId = "0x1"
    provider.request.mockImplementation(async ({ method }: { method: string }) => {
      if (method === "eth_chainId") return chainId
      if (method === "wallet_switchEthereumChain") {
        chainId = "0xb626"
        return null
      }
      throw new Error(`Unexpected wallet method: ${method}`)
    })
    modal.setExisting("0x2323232323232323232323232323232323232323", provider)
    mocks.createAppKit.mockReturnValue(modal)
    const { connectedRobinhoodWallet } = await loadWalletAuth()

    await expect(connectedRobinhoodWallet()).resolves.toEqual({
      address: "0x2323232323232323232323232323232323232323",
      provider,
    })
    expect(provider.request).toHaveBeenNthCalledWith(1, { method: "eth_chainId" })
    expect(provider.request).toHaveBeenNthCalledWith(2, {
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xb626" }],
    })
  })
})

describe("Robinhood wallet sign-in", () => {
  it("issues one signature request for concurrent sign-in callers without requiring CONNECT_SUCCESS telemetry", async () => {
    const modal = fakeModal()
    const provider = fakeProvider()
    const session = { access_token: "session-token" }
    provider.request.mockImplementation(async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts") return ["0x3333333333333333333333333333333333333333"]
      if (method === "eth_chainId") return "0xb626"
      if (method === "personal_sign") return "0xsigned"
      throw new Error(`Unexpected wallet method: ${method}`)
    })
    mocks.createAppKit.mockReturnValue(modal)
    const signInWithWeb3 = vi.fn(async ({ wallet }) => {
      await wallet.request({ method: "eth_requestAccounts" })
      await wallet.request({ method: "eth_chainId" })
      await wallet.request({ method: "personal_sign", params: ["0xmessage"] })
      return { data: { session }, error: null }
    })
    mocks.getSupabase.mockReturnValue({ auth: { signInWithWeb3 } })
    const { signInWithRobinhoodWallet } = await loadWalletAuth()

    const first = signInWithRobinhoodWallet()
    const second = signInWithRobinhoodWallet()

    modal.connect("0x3333333333333333333333333333333333333333", provider)

    await expect(first).resolves.toBe(session)
    await expect(second).resolves.toBe(session)
    expect(signInWithWeb3).toHaveBeenCalledTimes(1)
    expect(provider.request).toHaveBeenCalledTimes(4)
    expect(provider.request).toHaveBeenNthCalledWith(1, { method: "eth_chainId" })
    expect(provider.request).toHaveBeenNthCalledWith(2, { method: "eth_requestAccounts" })
    expect(provider.request).toHaveBeenNthCalledWith(3, { method: "eth_chainId" })
    expect(provider.request).toHaveBeenCalledWith({ method: "personal_sign", params: ["0xmessage"] })
  })

  it("clears a rejected signature so the next sign-in can succeed", async () => {
    const modal = fakeModal()
    const provider = fakeProvider()
    const session = { access_token: "retry-session" }
    modal.setExisting("0x4444444444444444444444444444444444444444", provider)
    mocks.createAppKit.mockReturnValue(modal)
    const signInWithWeb3 = vi.fn()
      .mockRejectedValueOnce(new Error("Signature rejected"))
      .mockResolvedValueOnce({ data: { session }, error: null })
    mocks.getSupabase.mockReturnValue({ auth: { signInWithWeb3 } })
    const { signInWithRobinhoodWallet } = await loadWalletAuth()

    await expect(signInWithRobinhoodWallet()).rejects.toThrow("Signature rejected")
    await expect(signInWithRobinhoodWallet()).resolves.toBe(session)
    expect(signInWithWeb3).toHaveBeenCalledTimes(2)
  })
})
