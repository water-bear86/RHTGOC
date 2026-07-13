import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { formatUnits, getAddress, Interface, isAddress, JsonRpcProvider, parseUnits, type TransactionReceipt, type TransactionResponse } from "ethers"
import type { Database } from "../src/database.types"

const TRANSFER_INTERFACE = new Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"])
export const REFERENCE_PRICE_USD = 6

export interface TokenPaymentConfig {
  chainId: number
  chainName: string
  tokenContract: string
  treasuryAddress: string
  amountBaseUnits: string
  amountDisplay: string
  tokenSymbol: string
  tokenDecimals: number
  passDays: number
  confirmations: number
}

export interface TokenAccess {
  entitled: boolean
  expiresAt: string | null
}

export function tokenAccessGateEnabled(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "on"
}

export function walletAddressFromIdentities(value: unknown): string | null {
  const identities = Array.isArray(value) ? value : []
  const web3Identity = identities.find((identity): identity is Record<string, unknown> => Boolean(identity && typeof identity === "object" && (identity as Record<string, unknown>).provider === "web3"))
  const identityData = web3Identity?.identity_data && typeof web3Identity.identity_data === "object" ? web3Identity.identity_data as Record<string, unknown> : {}
  const candidate = [web3Identity?.provider_id, identityData.address].find((address) => typeof address === "string" && isAddress(address))
  return typeof candidate === "string" ? getAddress(candidate) : null
}

export function verifyTokenTransfer(
  transaction: Pick<TransactionResponse, "from" | "to">,
  receipt: Pick<TransactionReceipt, "status" | "logs">,
  walletAddress: string,
  payment: TokenPaymentConfig,
): bigint {
  if (receipt.status !== 1) throw new Error("TOKEN_PAYMENT_FAILED")
  if (!transaction.to || getAddress(transaction.to) !== payment.tokenContract) throw new Error("TOKEN_PAYMENT_WRONG_CONTRACT")
  if (getAddress(transaction.from) !== getAddress(walletAddress)) throw new Error("TOKEN_PAYMENT_WRONG_SENDER")

  let paid = 0n
  for (const log of receipt.logs) {
    if (getAddress(log.address) !== payment.tokenContract) continue
    try {
      const parsed = TRANSFER_INTERFACE.parseLog({ topics: [...log.topics], data: log.data })
      if (!parsed || parsed.name !== "Transfer") continue
      const from = getAddress(String(parsed.args[0]))
      const to = getAddress(String(parsed.args[1]))
      if (from === getAddress(walletAddress) && to === payment.treasuryAddress) paid += BigInt(parsed.args[2].toString())
    } catch {
      // Ignore non-Transfer logs emitted by the token contract.
    }
  }
  if (paid < BigInt(payment.amountBaseUnits)) throw new Error("TOKEN_PAYMENT_UNDERPAID")
  return paid
}

export function verifyTokenChain(actualChainId: bigint, expectedChainId: number): void {
  if (actualChainId !== BigInt(expectedChainId)) throw new Error("TOKEN_PAYMENT_WRONG_CHAIN")
}

export function verifyTokenConfirmations(latestBlock: number, receiptBlock: number, required: number): void {
  if (latestBlock - receiptBlock + 1 < required) throw new Error(`TOKEN_PAYMENT_NEEDS_${required}_CONFIRMATIONS`)
}

export class TokenAccessService {
  constructor(
    private readonly database: SupabaseClient<Database>,
    private readonly provider: JsonRpcProvider,
    readonly payment: TokenPaymentConfig,
  ) {}

  async access(userId: string): Promise<TokenAccess> {
    const { data, error } = await this.database.from("player_token_access").select("access_expires_at").eq("user_id", userId).maybeSingle()
    if (error) throw new Error(`TOKEN_ACCESS_LOOKUP_FAILED:${error.message}`)
    const expiresAt = data?.access_expires_at ?? null
    return { expiresAt, entitled: expiresAt !== null && Date.parse(expiresAt) > Date.now() }
  }

  async claim(userId: string, walletAddress: string, transactionHash: string): Promise<TokenAccess> {
    if (!/^0x[0-9a-f]{64}$/i.test(transactionHash)) throw new Error("TOKEN_PAYMENT_INVALID_HASH")
    const [network, transaction, receipt, latestBlock] = await Promise.all([
      this.provider.getNetwork(),
      this.provider.getTransaction(transactionHash),
      this.provider.getTransactionReceipt(transactionHash),
      this.provider.getBlockNumber(),
    ])
    verifyTokenChain(network.chainId, this.payment.chainId)
    if (!transaction || !receipt) throw new Error("TOKEN_PAYMENT_NOT_CONFIRMED")
    verifyTokenConfirmations(latestBlock, receipt.blockNumber, this.payment.confirmations)
    const paidAmount = verifyTokenTransfer(transaction, receipt, walletAddress, this.payment)
    const block = await this.provider.getBlock(receipt.blockNumber)
    if (!block) throw new Error("TOKEN_PAYMENT_BLOCK_UNAVAILABLE")
    const paidAt = new Date(block.timestamp * 1_000).toISOString()
    const { data, error } = await this.database.rpc("record_token_access_payment", {
      p_user_id: userId,
      p_tx_hash: transactionHash.toLowerCase(),
      p_wallet_address: getAddress(walletAddress),
      p_chain_id: this.payment.chainId,
      p_token_contract: this.payment.tokenContract,
      p_treasury_address: this.payment.treasuryAddress,
      p_amount_base_units: paidAmount.toString(),
      p_paid_at: paidAt,
      p_pass_days: this.payment.passDays,
    })
    if (error) {
      const replay = error.message.includes("TOKEN_PAYMENT_REPLAY") || error.code === "23505"
      throw new Error(replay ? "TOKEN_PAYMENT_ALREADY_CLAIMED" : `TOKEN_PAYMENT_WRITE_FAILED:${error.message}`)
    }
    if (typeof data !== "string") throw new Error("TOKEN_PAYMENT_WRITE_RETURNED_INVALID_EXPIRY")
    return { entitled: Date.parse(data) > Date.now(), expiresAt: data }
  }
}

function integerSetting(value: string | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  const result = value === undefined || value === "" ? fallback : Number(value)
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  return result
}

export function createTokenAccessServiceFromEnv(): TokenAccessService | null {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY
  const rpcUrl = process.env.ROBINHOOD_RPC_URL
  const tokenContract = process.env.TOKEN_CONTRACT_ADDRESS
  const treasuryAddress = process.env.TOKEN_TREASURY_ADDRESS
  const amount = process.env.TOKEN_ACCESS_AMOUNT
  const tokenSymbol = process.env.TOKEN_SYMBOL?.trim()
  if (!supabaseUrl || !supabaseSecretKey || !rpcUrl || !tokenContract || !treasuryAddress || !amount || !tokenSymbol) return null
  if (!isAddress(tokenContract) || !isAddress(treasuryAddress)) throw new Error("Token contract and treasury must be valid EVM addresses")
  if (!/^[A-Za-z0-9._-]{1,16}$/.test(tokenSymbol)) throw new Error("TOKEN_SYMBOL must contain 1-16 safe display characters")

  const mainnet = process.env.ROBINHOOD_CHAIN === "mainnet"
  const chainId = mainnet ? 4663 : 46630
  const tokenDecimals = integerSetting(process.env.TOKEN_DECIMALS, 18, 0, 36, "TOKEN_DECIMALS")
  const passDays = integerSetting(process.env.TOKEN_ACCESS_DAYS, 30, 1, 365, "TOKEN_ACCESS_DAYS")
  const confirmations = integerSetting(process.env.TOKEN_PAYMENT_CONFIRMATIONS, 2, 1, 100, "TOKEN_PAYMENT_CONFIRMATIONS")
  const amountBaseUnits = parseUnits(amount, tokenDecimals)
  if (amountBaseUnits <= 0n) throw new Error("TOKEN_ACCESS_AMOUNT must be positive")
  const payment: TokenPaymentConfig = {
    chainId,
    chainName: mainnet ? "Robinhood Chain" : "Robinhood Chain Testnet",
    tokenContract: getAddress(tokenContract),
    treasuryAddress: getAddress(treasuryAddress),
    amountBaseUnits: amountBaseUnits.toString(),
    amountDisplay: formatUnits(amountBaseUnits, tokenDecimals),
    tokenSymbol,
    tokenDecimals,
    passDays,
    confirmations,
  }
  const database = createClient<Database>(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return new TokenAccessService(database, new JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true }), payment)
}
