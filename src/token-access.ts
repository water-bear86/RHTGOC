import { getSupabase } from "./supabase"
import { connectedRobinhoodWallet, type ConnectedWallet } from "./wallet-auth"

const ERC20_TRANSFER_SELECTOR = "a9059cbb"

export interface TokenPaymentConfig {
  chainId: number
  chainName: string
  tokenContract: string
  treasuryAddress: string
  amountBaseUnits: string
  amountDisplay: string
  tokenSymbol: string
  passDays: number
}

export interface AccessState {
  gateEnabled: boolean
  authenticated: boolean
  entitled: boolean
  accessExpiresAt: string | null
  referencePriceUsd: number
  payment: TokenPaymentConfig | null
}

export function roomServerHttpUrl(roomServerUrl: string | undefined, origin: string): string {
  if (!roomServerUrl) return origin
  const url = new URL(roomServerUrl, origin)
  url.protocol = url.protocol === "wss:" ? "https:" : "http:"
  url.pathname = url.pathname.replace(/\/rooms\/?$/, "") || "/"
  url.search = ""
  url.hash = ""
  return url.toString().replace(/\/$/, "")
}

export function encodeErc20Transfer(recipient: string, amountBaseUnits: string): `0x${string}` {
  if (!/^0x[0-9a-f]{40}$/i.test(recipient)) throw new Error("Invalid token treasury address")
  if (!/^[0-9]+$/.test(amountBaseUnits) || BigInt(amountBaseUnits) <= 0n) throw new Error("Invalid token payment amount")
  const addressWord = recipient.slice(2).toLowerCase().padStart(64, "0")
  const amountWord = BigInt(amountBaseUnits).toString(16).padStart(64, "0")
  if (amountWord.length > 64) throw new Error("Token payment amount exceeds uint256")
  return `0x${ERC20_TRANSFER_SELECTOR}${addressWord}${amountWord}`
}

async function waitForReceipt(provider: ConnectedWallet["provider"], transactionHash: string): Promise<{ status?: string }> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const receipt = await provider.request<{ status?: string } | null>({ method: "eth_getTransactionReceipt", params: [transactionHash] })
    if (receipt) return receipt
    await new Promise((resolve) => window.setTimeout(resolve, 1_500))
  }
  throw new Error("Token payment confirmation timed out")
}

async function accessToken(): Promise<string | null> {
  const supabase = getSupabase()
  if (!supabase) return null
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session?.access_token ?? null
}

async function accessRequest(path: string, method = "GET", body?: unknown): Promise<Response> {
  const token = await accessToken()
  const baseUrl = roomServerHttpUrl(import.meta.env.VITE_ROOM_SERVER_URL, location.origin)
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers["Content-Type"] = "application/json"
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function responseJson<T>(response: Response, fallback: string): Promise<T> {
  const value = await response.json().catch(() => null) as ({ error?: unknown } & T) | null
  if (!response.ok || !value) throw new Error(typeof value?.error === "string" ? value.error : fallback)
  return value
}

export async function loadAccessState(): Promise<AccessState> {
  return responseJson<AccessState>(await accessRequest("/access"), "Access status is temporarily unavailable")
}

export async function purchaseTokenPass(payment: TokenPaymentConfig): Promise<AccessState> {
  const connected = await connectedRobinhoodWallet()
  const chainId = await connected.provider.request<string>({ method: "eth_chainId" })
  if (BigInt(chainId) !== BigInt(payment.chainId)) throw new Error(`Switch Robinhood Wallet to ${payment.chainName}`)
  const transactionHash = await connected.provider.request<string>({
    method: "eth_sendTransaction",
    params: [{
      from: connected.address,
      to: payment.tokenContract,
      data: encodeErc20Transfer(payment.treasuryAddress, payment.amountBaseUnits),
    }],
  })
  if (!/^0x[0-9a-f]{64}$/i.test(transactionHash)) throw new Error("Robinhood Wallet returned an invalid transaction hash")
  const receipt = await waitForReceipt(connected.provider, transactionHash)
  if (receipt.status !== "0x1") throw new Error("Token payment did not confirm")
  return responseJson<AccessState>(
    await accessRequest("/access/claim", "POST", { transactionHash }),
    "Token payment could not be verified",
  )
}
