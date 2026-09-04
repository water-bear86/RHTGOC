import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { formatUnits, getAddress, JsonRpcProvider } from "ethers"
import type { Database } from "../src/database.types"
import {
  VANITY_CATALOG,
  isVanityItemId,
  validVanityEquipment,
  vanityItemPriceAmount,
  type VanityItemId,
} from "../shared/vanity-catalog"
import {
  resolveTokenPaymentEnvironment,
  verifyTokenChain,
  verifyTokenConfirmations,
  verifyTokenTransfer,
  type TokenPaymentConfig,
} from "./token-access-service"

export interface VanityItemOffer {
  id: VanityItemId
  slot: string
  name: string
  description: string
  colors: { primary: string; secondary: string }
  priceMultiplierDisplay: string
  /** Server-authoritative price; null until the token payment env is set. */
  amountBaseUnits: string | null
  amountDisplay: string | null
}

export interface VanityStatePayload {
  authenticated: boolean
  paymentConfigured: boolean
  payment: {
    chainId: number
    chainName: string
    tokenContract: string
    treasuryAddress: string
    tokenSymbol: string
    tokenDecimals: number
    baseAmountDisplay: string
  } | null
  items: VanityItemOffer[]
  ownedItemIds: string[]
  equippedItemIds: string[]
}

export interface VanityPurchaseResult {
  newlyGranted: boolean
  state: VanityStatePayload
}

function multiplierDisplay(itemId: VanityItemId): string {
  const item = VANITY_CATALOG.find((candidate) => candidate.id === itemId)
  if (!item) return ""
  return `${item.priceNumerator}/${item.priceDenominator}`
}

/**
 * A per-item payment contract identical to the base token pass except for its
 * amount: the shared catalog's price multiplier applied to the base amount.
 */
export function vanityItemPaymentConfig(
  basePayment: TokenPaymentConfig,
  itemId: VanityItemId,
): TokenPaymentConfig {
  const amount = vanityItemPriceAmount(BigInt(basePayment.amountBaseUnits), itemId)
  if (amount <= 0n) throw new Error("VANITY_ITEM_PRICE_NOT_POSITIVE")
  return {
    ...basePayment,
    amountBaseUnits: amount.toString(),
    amountDisplay: formatUnits(amount, basePayment.tokenDecimals),
  }
}

export class VanityService {
  constructor(
    private readonly database: SupabaseClient<Database>,
    private readonly provider: JsonRpcProvider | null,
    private readonly basePayment: TokenPaymentConfig | null,
  ) {}

  items(): VanityItemOffer[] {
    const tokenDecimals = this.basePayment?.tokenDecimals ?? 0
    return VANITY_CATALOG.map((item) => {
      const amount = this.basePayment
        ? vanityItemPriceAmount(BigInt(this.basePayment.amountBaseUnits), item.id)
        : null
      return {
        id: item.id,
        slot: item.slot,
        name: item.name,
        description: item.description,
        colors: item.colors,
        priceMultiplierDisplay: multiplierDisplay(item.id),
        amountBaseUnits: amount === null ? null : amount.toString(),
        amountDisplay: amount === null ? null : formatUnits(amount, tokenDecimals),
      }
    })
  }

  private paymentEnvelope(): VanityStatePayload["payment"] {
    const payment = this.basePayment
    if (!payment) return null
    return {
      chainId: payment.chainId,
      chainName: payment.chainName,
      tokenContract: payment.tokenContract,
      treasuryAddress: payment.treasuryAddress,
      tokenSymbol: payment.tokenSymbol,
      tokenDecimals: payment.tokenDecimals,
      baseAmountDisplay: payment.amountDisplay,
    }
  }

  private async ownedIds(userId: string): Promise<string[]> {
    const { data, error } = await this.database
      .from("player_vanity_owned")
      .select("item_id")
      .eq("user_id", userId)
    if (error) throw new Error(`VANITY_OWNED_LOOKUP_FAILED:${error.message}`)
    return data.map((row) => row.item_id)
  }

  private async equippedIds(userId: string): Promise<string[]> {
    const { data, error } = await this.database
      .from("player_vanity_state")
      .select("equipped_item_ids")
      .eq("user_id", userId)
      .maybeSingle()
    if (error) throw new Error(`VANITY_STATE_LOOKUP_FAILED:${error.message}`)
    return data?.equipped_item_ids ?? []
  }

  async state(userId: string | null): Promise<VanityStatePayload> {
    const [ownedItemIds, equippedItemIds] = userId
      ? await Promise.all([this.ownedIds(userId), this.equippedIds(userId)])
      : [[], []]
    return {
      authenticated: userId !== null,
      paymentConfigured: this.basePayment !== null,
      payment: this.paymentEnvelope(),
      items: this.items(),
      ownedItemIds,
      equippedItemIds,
    }
  }

  async purchase(
    userId: string,
    walletAddress: string,
    itemId: string,
    transactionHash: string,
  ): Promise<VanityPurchaseResult> {
    if (!isVanityItemId(itemId)) throw new Error("VANITY_ITEM_UNKNOWN")
    const basePayment = this.basePayment
    if (!basePayment || !this.provider) throw new Error("VANITY_PAYMENT_NOT_CONFIGURED")
    if (!/^0x[0-9a-f]{64}$/i.test(transactionHash)) throw new Error("TOKEN_PAYMENT_INVALID_HASH")
    const itemPayment = vanityItemPaymentConfig(basePayment, itemId)
    const [network, transaction, receipt, latestBlock] = await Promise.all([
      this.provider.getNetwork(),
      this.provider.getTransaction(transactionHash),
      this.provider.getTransactionReceipt(transactionHash),
      this.provider.getBlockNumber(),
    ])
    verifyTokenChain(network.chainId, itemPayment.chainId)
    if (!transaction || !receipt) throw new Error("TOKEN_PAYMENT_NOT_CONFIRMED")
    verifyTokenConfirmations(latestBlock, receipt.blockNumber, itemPayment.confirmations)
    const paidAmount = verifyTokenTransfer(transaction, receipt, walletAddress, itemPayment)
    const block = await this.provider.getBlock(receipt.blockNumber)
    if (!block) throw new Error("TOKEN_PAYMENT_BLOCK_UNAVAILABLE")
    const paidAt = new Date(block.timestamp * 1_000).toISOString()
    const { data, error } = await this.database.rpc("record_vanity_purchase", {
      p_user_id: userId,
      p_item_id: itemId,
      p_tx_hash: transactionHash.toLowerCase(),
      p_wallet_address: getAddress(walletAddress),
      p_chain_id: itemPayment.chainId,
      p_token_contract: itemPayment.tokenContract,
      p_treasury_address: itemPayment.treasuryAddress,
      p_amount_base_units: paidAmount.toString(),
      p_paid_at: paidAt,
    })
    if (error) {
      const replay = error.message.includes("VANITY_PAYMENT_REPLAY") || error.code === "23505"
      throw new Error(replay ? "VANITY_PAYMENT_ALREADY_CLAIMED" : `VANITY_PAYMENT_WRITE_FAILED:${error.message}`)
    }
    return { newlyGranted: data === true, state: await this.state(userId) }
  }

  async equip(userId: string, itemIds: readonly string[]): Promise<VanityStatePayload> {
    if (!validVanityEquipment(itemIds)) throw new Error("VANITY_EQUIP_INVALID")
    const { data, error } = await this.database.rpc("set_vanity_equipped", {
      p_user_id: userId,
      p_item_ids: [...itemIds],
    })
    if (error) {
      const notOwned = error.message.includes("VANITY_ITEM_NOT_OWNED")
      throw new Error(notOwned ? "VANITY_ITEM_NOT_OWNED" : `VANITY_EQUIP_WRITE_FAILED:${error.message}`)
    }
    return { ...(await this.state(userId)), equippedItemIds: data ?? [...itemIds] }
  }
}

export function createVanityServiceFromEnv(): VanityService | null {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY
  if (!supabaseUrl || !supabaseSecretKey) return null
  const resolvedToken = resolveTokenPaymentEnvironment()
  const database = createClient<Database>(supabaseUrl, supabaseSecretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const basePayment = resolvedToken?.payment ?? null
  const provider = resolvedToken
    ? new JsonRpcProvider(resolvedToken.rpcUrl, resolvedToken.payment.chainId, { staticNetwork: true })
    : null
  return new VanityService(database, provider, basePayment)
}
