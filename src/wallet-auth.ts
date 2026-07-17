import { createAppKit } from "@reown/appkit"
import { robinhood, robinhoodTestnet } from "@reown/appkit/networks"
import type { Session } from "@supabase/supabase-js"
import { ensureEip1193Network, SherwoodEthersAdapter } from "./sherwood-ethers-adapter"
import { getSupabase } from "./supabase"

export interface EthereumWalletProvider {
  request<T = unknown>(args: { method: string; params?: unknown }): Promise<T>
  on(event: string, listener: (...args: unknown[]) => void): void
  removeListener(event: string, listener: (...args: unknown[]) => void): void
}

export interface ConnectedWallet {
  address: string
  provider: EthereumWalletProvider
}

let appKit: ReturnType<typeof createAppKit> | null = null
let walletConnectionPending: Promise<ConnectedWallet> | null = null
let walletSignInPending: Promise<Session> | null = null

export const robinhoodNetwork = import.meta.env.VITE_ROBINHOOD_CHAIN === "mainnet" ? robinhood : robinhoodTestnet

function configuredAppKit(): ReturnType<typeof createAppKit> {
  if (appKit) return appKit
  const projectId = import.meta.env.VITE_REOWN_PROJECT_ID
  if (!projectId) throw new Error("Robinhood Wallet sign-in is not configured")
  appKit = createAppKit({
    adapters: [new SherwoodEthersAdapter()],
    networks: [robinhoodNetwork],
    defaultNetwork: robinhoodNetwork,
    projectId,
    // The adapter keeps only provider-stable EIP-6963 and WalletConnect connector paths.
    enableEIP6963: true,
    enableWalletConnect: true,
    enableInjected: false,
    enableCoinbase: false,
    metadata: {
      name: "Robin Hood: The Game (On Chain)",
      description: "Enter Sherwood with your Robinhood Wallet",
      url: location.origin,
      icons: [`${location.origin}/favicon.ico`],
    },
    enableNetworkSwitch: true,
    features: { analytics: false, email: false, socials: false, swaps: false, onramp: false },
  })
  return appKit
}

function isEthereumWalletProvider(value: unknown): value is EthereumWalletProvider {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<EthereumWalletProvider>
  return typeof candidate.request === "function" && typeof candidate.on === "function" && typeof candidate.removeListener === "function"
}

async function connectedProvider(modal: ReturnType<typeof createAppKit>): Promise<ConnectedWallet> {
  const existing = modal.getWalletProvider()
  const existingAddress = modal.getAddress("eip155")
  if (modal.getIsConnectedState() && existingAddress && isEthereumWalletProvider(existing)) return { address: existingAddress, provider: existing }
  return await new Promise<ConnectedWallet>((resolve, reject) => {
    let settled = false
    let connectorStarted = false
    let connectionSucceeded = false
    let connectedWallet: ConnectedWallet | null = null
    let unsubscribeAccount: () => void = () => {}
    let unsubscribeEvents: () => void = () => {}

    const cleanup = (): void => {
      window.clearTimeout(timeout)
      unsubscribeAccount()
      unsubscribeEvents()
    }

    const closeModal = (): void => {
      void modal.close().catch(() => undefined)
    }

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      modal.resetWcConnection()
      closeModal()
      reject(error)
    }

    const finishConnection = (): void => {
      if (settled || !connectionSucceeded || !connectedWallet) return
      settled = true
      cleanup()
      const result = connectedWallet
      void modal.close().catch(() => undefined).then(() => resolve(result))
    }

    const timeout = window.setTimeout(() => {
      // Closing AppKit does not cancel an injected provider RPC. Keep the lock until the wallet reports a terminal result.
      if (connectorStarted) return
      fail(new Error("Wallet connection timed out. Finish or cancel any open wallet request, then try again."))
    }, 120_000)

    unsubscribeAccount = modal.subscribeAccount(({ address, isConnected }) => {
      const provider = modal.getWalletProvider()
      if (!isConnected || !address || !isEthereumWalletProvider(provider)) return
      connectorStarted = true
      connectedWallet = { address, provider }
      finishConnection()
    }, "eip155")

    unsubscribeEvents = modal.subscribeEvents(({ data }) => {
      if (data.event === "SELECT_WALLET") {
        connectorStarted = true
        return
      }
      if (data.event === "CONNECT_SUCCESS") {
        connectorStarted = true
        connectionSucceeded = true
        finishConnection()
        return
      }
      if (data.event === "CONNECT_ERROR") {
        fail(new Error(data.properties.message || "Wallet connection failed"))
        return
      }
      if (data.event === "USER_REJECTED") {
        fail(new Error(data.properties.message || "Wallet connection was declined"))
        return
      }
      if (data.event === "MODAL_CLOSE" && !data.properties.connected && !connectorStarted && !connectionSucceeded && !connectedWallet) {
        queueMicrotask(() => {
          if (!connectorStarted && !connectionSucceeded && !connectedWallet) fail(new Error("Wallet connection cancelled"))
        })
      }
    })

    void modal.open({ view: "Connect" }).catch((error: unknown) => {
      fail(error instanceof Error ? error : new Error("Wallet connection failed"))
    })
  })
}

async function connectedProviderOnConfiguredNetwork(): Promise<ConnectedWallet> {
  const connected = await connectedProvider(configuredAppKit())
  await ensureEip1193Network(connected.provider, robinhoodNetwork)
  return connected
}

export function connectedRobinhoodWallet(): Promise<ConnectedWallet> {
  if (walletConnectionPending) return walletConnectionPending
  const pending = connectedProviderOnConfiguredNetwork()
  walletConnectionPending = pending
  void pending.then(
    () => {
      if (walletConnectionPending === pending) walletConnectionPending = null
    },
    () => {
      if (walletConnectionPending === pending) walletConnectionPending = null
    },
  )
  return pending
}

export function shortWalletAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

async function createWalletSession(): Promise<Session> {
  const supabase = getSupabase()
  if (!supabase) throw new Error("Sherwood identity is not configured")
  const connected = await connectedRobinhoodWallet()
  const { data, error } = await supabase.auth.signInWithWeb3({
    chain: "ethereum",
    statement: "Sign in to Robin Hood: The Game (On Chain). This request does not authorize a transaction.",
    wallet: {
      address: connected.address,
      request: (args) => connected.provider.request(args),
      on: (event, listener) => connected.provider.on(event, listener as (...args: unknown[]) => void),
      removeListener: (event, listener) => connected.provider.removeListener(event, listener as (...args: unknown[]) => void),
    },
  })
  if (error) throw error
  if (!data.session) throw new Error("Wallet signature did not create a session")
  return data.session
}

export function signInWithRobinhoodWallet(): Promise<Session> {
  if (walletSignInPending) return walletSignInPending
  const pending = createWalletSession()
  walletSignInPending = pending
  void pending.then(
    () => {
      if (walletSignInPending === pending) walletSignInPending = null
    },
    () => {
      if (walletSignInPending === pending) walletSignInPending = null
    },
  )
  return pending
}

export async function disconnectRobinhoodWallet(): Promise<void> {
  const supabase = getSupabase()
  if (supabase) {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }
  if (appKit?.getIsConnectedState()) await appKit.disconnect("eip155")
}

export async function currentWalletSession(): Promise<Session | null> {
  const supabase = getSupabase()
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

export function walletAddress(session: Session): string | null {
  const identity = session.user.identities?.find((candidate) => candidate.provider === "web3")
  const address = identity?.identity_data?.address
  return typeof address === "string" ? address : null
}
