/**
 * Shared catalog for the Sherwood Finery vanity shop.
 *
 * Everything here is cosmetic metadata plus the deterministic price ratios
 * that both the server (authoritative amounts) and the client (browsing and
 * previews) agree on. No wallet, chain, or contract specifics live here: the
 * server derives amounts from the configured base token payment and keeps
 * TOKEN_CONTRACT_ADDRESS / TOKEN_TREASURY_ADDRESS environment-driven.
 */

export const VANITY_ITEM_IDS = ["fox-plume", "sherwood-fireflies", "kings-ransom-trail"] as const
export type VanityItemId = (typeof VANITY_ITEM_IDS)[number]

export const VANITY_SLOTS = ["accent", "motes", "trail"] as const
export type VanitySlot = (typeof VANITY_SLOTS)[number]

export interface VanityCatalogItem {
  id: VanityItemId
  /** Equip slot; at most one owned item may be equipped per slot. */
  slot: VanitySlot
  name: string
  description: string
  /**
   * Price relative to the configured base token payment amount. Kept as an
   * exact rational so base-unit pricing never rounds through a float.
   */
  priceNumerator: number
  priceDenominator: number
  /** Display swatch colors (also used by the procedural visuals). */
  colors: { primary: string; secondary: string }
}

export const VANITY_CATALOG: readonly VanityCatalogItem[] = Object.freeze([
  {
    id: "fox-plume",
    slot: "accent",
    name: "Fox Plume",
    description: "A russet plume for hood or cap — the clever fox's mark.",
    priceNumerator: 1,
    priceDenominator: 2,
    colors: { primary: "#cf7a2e", secondary: "#8f4a1e" },
  },
  {
    id: "sherwood-fireflies",
    slot: "motes",
    name: "Sherwood Fireflies",
    description: "Green-gold motes that orbit the wearer like living torchlight.",
    priceNumerator: 1,
    priceDenominator: 1,
    colors: { primary: "#ecd357", secondary: "#8fce5a" },
  },
  {
    id: "kings-ransom-trail",
    slot: "trail",
    name: "King's Ransom Trail",
    description: "A faint gold wake lingers behind you, as if the forest hoards coin.",
    priceNumerator: 3,
    priceDenominator: 2,
    colors: { primary: "#e2af43", secondary: "#f4d98c" },
  },
])

const itemById: ReadonlyMap<VanityItemId, VanityCatalogItem> = new Map(VANITY_CATALOG.map((item) => [item.id, item]))

export function isVanityItemId(value: string): value is VanityItemId {
  return (itemById as ReadonlyMap<string, VanityCatalogItem>).has(value)
}

export function vanityCatalogItem(itemId: string): VanityCatalogItem | null {
  return (itemById as ReadonlyMap<string, VanityCatalogItem>).get(itemId) ?? null
}

/**
 * Scales the configured base payment amount into an item's exact price in base
 * units (floor division so base-unit integers never truncate below a valid
 * ERC-20 amount). The server alone turns this into real amounts; callers that
 * display prices use the server-computed amount.
 */
export function vanityItemPriceAmount(baseAmountBaseUnits: bigint, itemId: VanityItemId): bigint {
  const item = vanityCatalogItem(itemId)
  if (!item) throw new Error(`UNKNOWN_VANITY_ITEM:${itemId}`)
  if (baseAmountBaseUnits < 0n) throw new Error("VANITY_BASE_AMOUNT_NEGATIVE")
  if (item.priceNumerator <= 0 || item.priceDenominator <= 0) throw new Error(`INVALID_VANITY_PRICE:${itemId}`)
  return baseAmountBaseUnits * BigInt(item.priceNumerator) / BigInt(item.priceDenominator)
}

/**
 * Server-side guard: an equipment request must reference known items, must not
 * repeat an item, and must not equip two items into the same cosmetic slot.
 */
export function validVanityEquipment(itemIds: readonly string[]): itemIds is readonly VanityItemId[] {
  const slots = new Set<VanitySlot>()
  for (const itemId of itemIds) {
    const item = vanityCatalogItem(itemId)
    if (!item || slots.has(item.slot)) return false
    slots.add(item.slot)
  }
  return true
}
