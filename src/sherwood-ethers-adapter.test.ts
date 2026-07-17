import { robinhoodTestnet } from "@reown/appkit/networks"
import { describe, expect, it, vi } from "vitest"
import { SherwoodEthersAdapter } from "./sherwood-ethers-adapter"

type CaipNetwork = ReturnType<SherwoodEthersAdapter["getCaipNetworks"]>[number]
type AdapterConnector = SherwoodEthersAdapter["connectors"][number]
type ConnectorType = SherwoodEthersAdapter["connectors"][number]["type"]

interface TestConnector {
  id: string
  type: ConnectorType
}

const announcedConnector: TestConnector = {
  id: "fake-wallet",
  type: "ANNOUNCED",
}

const testNetwork = {
  ...robinhoodTestnet,
  chainNamespace: "eip155",
  caipNetworkId: `eip155:${robinhoodTestnet.id}`,
} as CaipNetwork

class TestableSherwoodEthersAdapter extends SherwoodEthersAdapter {
  addTestConnectors(...connectors: AdapterConnector[]): void {
    this.addConnector(...connectors)
  }
}

interface FakeProvider {
  request: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  removeListener: ReturnType<typeof vi.fn>
  emit: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

function providerWith(
  request: (args: { method: string; params?: unknown }) => unknown | Promise<unknown>,
): FakeProvider {
  return {
    request: vi.fn(request),
    on: vi.fn(),
    removeListener: vi.fn(),
    emit: vi.fn(),
    connect: vi.fn().mockResolvedValue(""),
    disconnect: vi.fn().mockResolvedValue(undefined),
  }
}

function adapterWith(
  provider: FakeProvider,
  connector: TestConnector = announcedConnector,
): SherwoodEthersAdapter {
  const adapter = new SherwoodEthersAdapter()
  adapter.getCaipNetworks = () => [testNetwork]
  adapter.connectors.push({
    id: connector.id,
    type: connector.type,
    name: "Fake Wallet",
    provider,
    chain: "eip155",
    chains: [],
  })
  return adapter
}

async function connect(
  adapter: SherwoodEthersAdapter,
  connector: TestConnector = announcedConnector,
) {
  return adapter.connect({
    id: connector.id,
    type: connector.type,
    chainId: testNetwork.id,
  })
}

describe("SherwoodEthersAdapter", () => {
  it("does not emit Reown connectors that replace the guarded provider during connection", () => {
    const provider = providerWith(() => null)
    const adapter = new TestableSherwoodEthersAdapter()
    const emittedConnectors: string[][] = []
    adapter.on("connectors", (connectors) => emittedConnectors.push(connectors.map(({ id }) => id)))

    adapter.addTestConnectors(
      {
        id: "baseAccount",
        type: "EXTERNAL",
        name: "Base Account",
        provider,
        chain: "eip155",
        chains: [],
      },
      {
        id: "fake-wallet",
        type: "ANNOUNCED",
        name: "Fake Wallet",
        provider,
        chain: "eip155",
        chains: [],
      },
    )

    expect(adapter.connectors.map(({ id }) => id)).toEqual(["fake-wallet"])
    expect(emittedConnectors).toEqual([["fake-wallet"]])
  })

  it("normalizes a hexadecimal wallet chain ID and skips a redundant switch", async () => {
    const provider = providerWith(({ method }) => {
      if (method === "eth_requestAccounts") return ["0x1111111111111111111111111111111111111111"]
      if (method === "eth_chainId") return "0xb626"
      throw new Error(`Unexpected wallet method: ${method}`)
    })

    await expect(connect(adapterWith(provider))).resolves.toMatchObject({ chainId: 46630 })
    expect(provider.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "wallet_switchEthereumChain" }))
  })

  it("guards the WalletConnect provider path", async () => {
    const connector: TestConnector = {
      id: "walletConnect",
      type: "WALLET_CONNECT",
    }
    const provider = providerWith(({ method }) => {
      if (method === "eth_requestAccounts") return ["0x1515151515151515151515151515151515151515"]
      if (method === "eth_chainId") return "0xb626"
      throw new Error(`Unexpected wallet method: ${method}`)
    })

    await expect(connect(adapterWith(provider, connector), connector)).resolves.toMatchObject({ chainId: 46630 })
    expect(provider.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "wallet_switchEthereumChain" }))
  })

  it("switches once when the wallet is on a different known chain", async () => {
    let chainId = "0x1"
    const provider = providerWith(({ method }) => {
      if (method === "eth_requestAccounts") return ["0x2222222222222222222222222222222222222222"]
      if (method === "eth_chainId") return chainId
      if (method === "wallet_switchEthereumChain") {
        chainId = "0xb626"
        return null
      }
      throw new Error(`Unexpected wallet method: ${method}`)
    })

    await expect(connect(adapterWith(provider))).resolves.toMatchObject({ chainId: 46630 })
    expect(provider.request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xb626" }],
    })
  })

  it("adds an unknown chain, verifies it, then switches when necessary", async () => {
    let chainId = "0x1"
    let switchAttempts = 0
    const provider = providerWith(({ method }) => {
      if (method === "eth_requestAccounts") return ["0x3333333333333333333333333333333333333333"]
      if (method === "eth_chainId") return chainId
      if (method === "wallet_switchEthereumChain") {
        switchAttempts += 1
        if (switchAttempts === 1) {
          throw Object.assign(new Error("Internal provider error"), {
            code: -32603,
            data: { originalError: { code: 4902, message: "Unknown chain" } },
          })
        }
        chainId = "0xb626"
        return null
      }
      if (method === "wallet_addEthereumChain") return null
      throw new Error(`Unexpected wallet method: ${method}`)
    })

    await expect(connect(adapterWith(provider))).resolves.toMatchObject({ chainId: 46630 })
    expect(provider.request).toHaveBeenCalledWith({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: "0xb626",
        chainName: "Robinhood Chain Testnet",
        nativeCurrency: testNetwork.nativeCurrency,
        rpcUrls: ["https://rpc.testnet.chain.robinhood.com"],
        blockExplorerUrls: ["https://explorer.testnet.chain.robinhood.com"],
      }],
    })
    expect(switchAttempts).toBe(2)
  })

  it.each([
    [4001, false, "declined in the wallet"],
    [-32002, true, "wallet request is already open"],
    [4200, false, "cannot switch networks automatically"],
  ])("preserves an actionable message for provider error %s", async (code, nested, message) => {
    const provider = providerWith(({ method }) => {
      if (method === "eth_requestAccounts") return ["0x4444444444444444444444444444444444444444"]
      if (method === "eth_chainId") return "0x1"
      if (method === "wallet_switchEthereumChain") {
        const providerError = Object.assign(new Error("Provider failure"), { code })
        throw nested
          ? Object.assign(new Error("Internal provider error"), { code: -32603, data: { originalError: providerError } })
          : providerError
      }
      throw new Error(`Unexpected wallet method: ${method}`)
    })

    await expect(connect(adapterWith(provider))).rejects.toThrow(message)
    expect(provider.request).not.toHaveBeenCalledWith(expect.objectContaining({ method: "wallet_addEthereumChain" }))
  })
})
