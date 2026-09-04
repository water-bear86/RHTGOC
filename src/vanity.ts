import type { VanityCatalogItem } from "../shared/vanity-catalog"
import { isVanityItemId, VANITY_CATALOG, vanityCatalogItem } from "../shared/vanity-catalog"
import {
  sendTokenTransferToTreasury,
  tokenBackendJson,
  tokenBackendRequest,
} from "./token-access"

/**
 * Client module for the Sherwood Finery vanity shop. Browsing is signed-out
 * friendly; purchases reuse the Robinhood Wallet sign-in and the same ERC-20
 * payment path as the token access pass. Ownership and equipment are always
 * server-authoritative — this module only presents state the server returned.
 */

export interface VanityItemOffer extends VanityCatalogItem {
  priceMultiplierDisplay: string
  amountBaseUnits: string | null
  amountDisplay: string | null
}

export interface VanityPaymentInfo {
  chainId: number
  chainName: string
  tokenContract: string
  treasuryAddress: string
  tokenSymbol: string
  tokenDecimals: number
  baseAmountDisplay: string
}

export interface VanityState {
  authenticated: boolean
  paymentConfigured: boolean
  payment: VanityPaymentInfo | null
  items: VanityItemOffer[]
  ownedItemIds: string[]
  equippedItemIds: string[]
}

export interface VanityDisplayItem {
  item: VanityCatalogItem
  offer: VanityItemOffer | null
  owned: boolean
  equipped: boolean
  payment: VanityPaymentInfo | null
}

export async function loadVanityState(): Promise<VanityState> {
  return tokenBackendJson<VanityState>(await tokenBackendRequest("/vanity/state"), "Sherwood Finery is temporarily unavailable")
}

/** Items for the shop panel: shared catalog ids stay visible even offline. */
export function vanityDisplayItems(state: VanityState | null): VanityDisplayItem[] {
  const owned = new Set(state?.ownedItemIds ?? [])
  const equipped = new Set(state?.equippedItemIds ?? [])
  const offers = new Map(state?.items.map((offer) => [offer.id, offer]) ?? [])
  return VANITY_CATALOG.map((item) => ({
    item,
    offer: offers.get(item.id) ?? null,
    owned: owned.has(item.id),
    equipped: equipped.has(item.id),
    payment: state?.payment ?? null,
  }))
}

export function vanityOfferFor(state: VanityState, itemId: string): VanityItemOffer | null {
  return state.items.find((offer) => offer.id === itemId) ?? null
}

export async function purchaseVanityItem(itemId: string, state: VanityState): Promise<VanityState> {
  if (!isVanityItemId(itemId)) throw new Error("That Finery item is not part of the catalog")
  const offer = vanityOfferFor(state, itemId)
  const payment = state.payment
  if (!offer || !payment) throw new Error("Sherwood Finery purchases are not configured on this server")
  if (offer.amountBaseUnits === null || offer.amountDisplay === null) throw new Error("Sherwood Finery purchases are not configured on this server")
  const catalogItem = vanityCatalogItem(itemId)
  if (!catalogItem) throw new Error("That Finery item is not part of the catalog")
  const transactionHash = await sendTokenTransferToTreasury({
    chainId: payment.chainId,
    chainName: payment.chainName,
    tokenContract: payment.tokenContract,
    treasuryAddress: payment.treasuryAddress,
    amountBaseUnits: offer.amountBaseUnits,
    amountDisplay: offer.amountDisplay,
    tokenSymbol: payment.tokenSymbol,
    passDays: 0,
  })
  return tokenBackendJson<VanityState>(
    await tokenBackendRequest("/vanity/purchase", "POST", { itemId, transactionHash }),
    "Finery purchase could not be verified",
  )
}

export async function equipVanityItems(itemIds: readonly string[]): Promise<VanityState> {
  return tokenBackendJson<VanityState>(
    await tokenBackendRequest("/vanity/equip", "POST", { itemIds: [...itemIds] }),
    "Finery equipment could not be saved",
  )
}

/** Kept pure for tests and menus that need an exact price line. */
export function vanityPriceLabel(offer: VanityItemOffer | null, payment: VanityPaymentInfo | null): string | null {
  if (!offer || !payment) return null
  if (offer.amountDisplay === null) return null
  return `${offer.amountDisplay} ${payment.tokenSymbol}`
}
