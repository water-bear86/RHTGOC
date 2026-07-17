import { EthersAdapter } from "@reown/appkit-adapter-ethers"

type ConnectParameters = Parameters<EthersAdapter["connect"]>[0]
type ConnectResult = Awaited<ReturnType<EthersAdapter["connect"]>>
type AdapterConnector = EthersAdapter["connectors"][number]
type AdapterProvider = NonNullable<EthersAdapter["connectors"][number]["provider"]>
type CaipNetwork = ReturnType<EthersAdapter["getCaipNetworks"]>[number]
type NetworkMetadata = Pick<CaipNetwork, "id" | "name" | "nativeCurrency" | "rpcUrls" | "blockExplorers">

interface ProviderRequest {
  method: string
  params?: unknown
}

type WalletRequest = <T = unknown>(args: ProviderRequest) => Promise<T>

export interface Eip1193RequestProvider {
  request<T = unknown>(args: ProviderRequest): Promise<T>
}

interface NetworkFailure {
  error: unknown
  network: NetworkMetadata
}

interface NetworkSwitchState {
  getNetworks: () => NetworkMetadata[]
  lastFailure: NetworkFailure | null
}

interface ProviderGuard extends NetworkSwitchState {
  provider: AdapterProvider
}

const providerGuards = new WeakMap<object, ProviderGuard>()
const providerReplacingConnectorIds = new Set(["injected", "coinbasewallet", "baseaccount", "safe"])

function normalizedChainId(value: unknown): bigint | null {
  try {
    if (typeof value === "bigint") return value >= 0n ? value : null
    if (typeof value === "number") return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null
    if (typeof value !== "string" || value.trim() === "") return null
    const normalized = BigInt(value.trim())
    return normalized >= 0n ? normalized : null
  } catch {
    return null
  }
}

function sameChainId(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizedChainId(left)
  const normalizedRight = normalizedChainId(right)
  return normalizedLeft !== null && normalizedRight !== null && normalizedLeft === normalizedRight
}

function requestedChainId(args: ProviderRequest): unknown {
  if (!Array.isArray(args.params)) return null
  const target = args.params[0]
  if (!target || typeof target !== "object" || !("chainId" in target)) return null
  return target.chainId
}

function providerErrorCodes(
  error: unknown,
  seen = new Set<object>(),
  codes = new Set<number>(),
): Set<number> {
  if (!error || typeof error !== "object" || seen.has(error)) return codes
  seen.add(error)
  if ("code" in error) {
    const code = Number(error.code)
    if (Number.isInteger(code)) codes.add(code)
  }
  for (const key of ["cause", "data", "originalError"]) {
    if (!(key in error)) continue
    providerErrorCodes(error[key as keyof typeof error], seen, codes)
  }
  return codes
}

function hasProviderErrorCode(error: unknown, expected: number): boolean {
  return providerErrorCodes(error).has(expected)
}

function providerErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return error.message.trim()
  }
  return null
}

function addNetworkParameters(network: NetworkMetadata): Record<string, unknown> {
  const explorerUrl = network.blockExplorers?.default?.url
  return {
    chainId: `0x${BigInt(network.id).toString(16)}`,
    chainName: network.name,
    nativeCurrency: network.nativeCurrency,
    rpcUrls: [...network.rpcUrls.default.http],
    ...(explorerUrl ? { blockExplorerUrls: [explorerUrl] } : {}),
  }
}

function friendlyNetworkError(failure: NetworkFailure): Error {
  const { error, network } = failure
  const codes = providerErrorCodes(error)
  const fallback = providerErrorMessage(error)
  const message = (() => {
    if (codes.has(4001)) return `Network switch to ${network.name} was declined in the wallet.`
    if (codes.has(-32002)) return "A wallet request is already open. Finish or cancel it in the wallet, then try again."
    if (codes.has(4200) || codes.has(-32601) || codes.has(-32004)) {
      return `This wallet cannot switch networks automatically. Add and select ${network.name}, then try again.`
    }
    if (codes.has(4900) || codes.has(4901)) return "The wallet disconnected. Reconnect it, then try again."
    if (codes.has(-32602)) return `The wallet rejected the ${network.name} network settings.`
    return fallback ? `Could not switch to ${network.name}: ${fallback}` : `Could not switch to ${network.name}.`
  })()
  return new Error(message, { cause: error })
}

async function switchNetwork(
  originalRequest: WalletRequest,
  args: ProviderRequest,
  state: NetworkSwitchState,
): Promise<unknown> {
  const targetChainId = requestedChainId(args)
  const network = state.getNetworks().find((candidate) => sameChainId(candidate.id, targetChainId))
  if (!network) return originalRequest(args)

  try {
    const currentChainId = await originalRequest({ method: "eth_chainId" })
    if (sameChainId(currentChainId, targetChainId)) return null

    try {
      return await originalRequest(args)
    } catch (error) {
      if (!hasProviderErrorCode(error, 4902)) throw error
    }

    await originalRequest({
      method: "wallet_addEthereumChain",
      params: [addNetworkParameters(network)],
    })

    const addedChainId = await originalRequest({ method: "eth_chainId" })
    if (sameChainId(addedChainId, targetChainId)) return null
    return await originalRequest(args)
  } catch (error) {
    state.lastFailure = { error, network }
    throw error
  }
}

export async function ensureEip1193Network(
  provider: Eip1193RequestProvider,
  network: NetworkMetadata,
): Promise<void> {
  const state: NetworkSwitchState = {
    getNetworks: () => [network],
    lastFailure: null,
  }
  try {
    await switchNetwork(
      provider.request.bind(provider) as WalletRequest,
      {
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${BigInt(network.id).toString(16)}` }],
      },
      state,
    )
  } catch (error) {
    if (state.lastFailure) throw friendlyNetworkError(state.lastFailure)
    throw error
  }
}

function guardedProvider(provider: AdapterProvider, getNetworks: () => NetworkMetadata[]): ProviderGuard {
  const existing = providerGuards.get(provider as object)
  if (existing) {
    existing.getNetworks = getNetworks
    return existing
  }

  const originalRequest = provider.request.bind(provider) as unknown as WalletRequest
  const guard: ProviderGuard = {
    provider,
    getNetworks,
    lastFailure: null,
  }
  const proxy = new Proxy(provider, {
    get(target, property) {
      if (property === "request") {
        return (args: ProviderRequest): Promise<unknown> => {
          if (args.method !== "wallet_switchEthereumChain") return originalRequest(args)
          return switchNetwork(originalRequest, args, guard)
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
  guard.provider = proxy
  providerGuards.set(provider as object, guard)
  providerGuards.set(proxy as object, guard)
  return guard
}

export class SherwoodEthersAdapter extends EthersAdapter {
  protected override addConnector(...connectors: AdapterConnector[]): void {
    const stableConnectors = connectors.filter(
      (connector) => !providerReplacingConnectorIds.has(connector.id.toLowerCase()),
    )
    if (stableConnectors.length > 0) super.addConnector(...stableConnectors)
  }

  override async connect(params: ConnectParameters): Promise<ConnectResult> {
    const connector = this.connectors.find((candidate) => candidate.id.toLowerCase() === params.id.toLowerCase())
    const guard = connector?.provider
      ? guardedProvider(connector.provider, () => this.getCaipNetworks())
      : null

    if (connector && guard) {
      guard.lastFailure = null
      connector.provider = guard.provider
    }

    try {
      return await super.connect(params)
    } catch (error) {
      if (guard?.lastFailure) throw friendlyNetworkError(guard.lastFailure)
      throw error
    }
  }
}
