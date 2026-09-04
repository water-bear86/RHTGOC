import { describe, expect, it } from "vitest"
import {
  VANITY_CATALOG,
  VANITY_ITEM_IDS,
  isVanityItemId,
  validVanityEquipment,
  vanityCatalogItem,
  vanityItemPriceAmount,
} from "./vanity-catalog"

describe("Sherwood Finery catalog", () => {
  it("keeps deterministic, unique shared item ids across client and server", () => {
    expect(VANITY_ITEM_IDS).toEqual(["fox-plume", "sherwood-fireflies", "kings-ransom-trail"])
    expect(new Set(VANITY_CATALOG.map((item) => item.id)).size).toBe(VANITY_CATALOG.length)
    for (const item of VANITY_CATALOG) {
      expect(item.id).toBe(VANITY_ITEM_IDS.find((id) => id === item.id))
      expect(isVanityItemId(item.id)).toBe(true)
    }
    expect(isVanityItemId("treasure-cloak")).toBe(false)
  })

  it("keeps each catalog item in its own cosmetic slot", () => {
    const slots = VANITY_CATALOG.map((item) => item.slot)
    expect(new Set(slots).size).toBe(slots.length)
    expect(vanityCatalogItem("fox-plume")?.slot).toBe("accent")
    expect(vanityCatalogItem("sherwood-fireflies")?.slot).toBe("motes")
    expect(vanityCatalogItem("kings-ransom-trail")?.slot).toBe("trail")
    expect(vanityCatalogItem("missing")).toBeNull()
  })

  it("derives server prices as exact multipliers of the base token amount", () => {
    expect(vanityItemPriceAmount(1_000_000n, "fox-plume")).toBe(500_000n)
    expect(vanityItemPriceAmount(1_000_000n, "sherwood-fireflies")).toBe(1_000_000n)
    expect(vanityItemPriceAmount(1_000_000n, "kings-ransom-trail")).toBe(1_500_000n)
  })

  it("floors fractional base-unit prices without inventing decimals", () => {
    expect(vanityItemPriceAmount(999_999n, "fox-plume")).toBe(499_999n)
    expect(vanityItemPriceAmount(1n, "kings-ransom-trail")).toBe(1n)
  })

  it("rejects invalid equipment sets server-side", () => {
    expect(validVanityEquipment([])).toBe(true)
    expect(validVanityEquipment(["fox-plume", "sherwood-fireflies", "kings-ransom-trail"])).toBe(true)
    expect(validVanityEquipment(["fox-plume", "sherwood-fireflies"])).toBe(true)
    expect(validVanityEquipment(["unknown"])).toBe(false)
    expect(validVanityEquipment(["fox-plume", "fox-plume"])).toBe(false)
  })
})
