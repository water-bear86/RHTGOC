import { createAppKit } from "@reown/appkit"
import { EthersAdapter } from "@reown/appkit-adapter-ethers"
import { robinhood, robinhoodTestnet } from "@reown/appkit/networks"
import type { Session } from "@supabase/supabase-js"
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

export const robinhoodNetwork = import.meta.env.VITE_ROBINHOOD_CHAIN === "mainnet" ? robinhood : robinhoodTestnet

function configuredAppKit(): ReturnType<typeof createAppKit> {
  if (appKit) return appKit
  const projectId = import.meta.env.VITE_REOWN_PROJECT_ID
  if (!projectId) throw new Error("Robinhood Wallet sign-in is not configured")
  appKit = createAppKit({
    adapters: [new EthersAdapter()],
    networks: [robinhoodNetwork],
    defaultNetwork: robinhoodNetwork,
    projectId,
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
    const timeout = window.setTimeout(() => {
      unsubscribe()
      reject(new Error("Wallet connection timed out"))
    }, 120_000)
    const unsubscribe = modal.subscribeAccount(({ address, isConnected }) => {
      const provider = modal.getWalletProvider()
      if (!isConnected || !address || !isEthereumWalletProvider(provider)) return
      window.clearTimeout(timeout)
      unsubscribe()
      resolve({ address, provider })
    }, "eip155")
    void modal.open({ view: "Connect" }).catch((error: unknown) => {
      window.clearTimeout(timeout)
      unsubscribe()
      reject(error instanceof Error ? error : new Error("Wallet connection failed"))
    })
  })
}

export async function connectedRobinhoodWallet(): Promise<ConnectedWallet> {
  return connectedProvider(configuredAppKit())
}

export function shortWalletAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export async function signInWithRobinhoodWallet(): Promise<Session> {
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
