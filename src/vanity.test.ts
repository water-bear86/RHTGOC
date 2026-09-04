import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("./token-access", () => ({
  sendTokenTransferToTreasury: vi.fn(),
  tokenBackendRequest: vi.fn(),
  tokenBackendJson: vi.fn(),
}))

import * as tokenAccess from "./token-access"
import {
  equipVanityItems,
  loadVanityState,
  purchaseVanityItem,
  vanityDisplayItems,
  vanityPriceLabel,
  type VanityState,
} from "./vanity"

const tokenBackendRequest = vi.mocked(tokenAccess.tokenBackendRequest)
const tokenBackendJson = vi.mocked(tokenAccess.tokenBackendJson)
const sendTokenTransferToTreasury = vi.mocked(tokenAccess.sendTokenTransferToTreasury)

const response = {} as Response

beforeEach(() => {
  vi.clearAllMocks()
})

const signedOutState: VanityState = {
  authenticated: false,
  paymentConfigured: true,
  payment: {
    chainId: 46630,
    chainName: "Robinhood Chain Testnet",
    tokenContract: "0x3333333333333333333333333333333333333333",
    treasuryAddress: "0x2222222222222222222222222222222222222222",
    tokenSymbol: "HOOD",
    tokenDecimals: 6,
    baseAmountDisplay: "6.0",
  },
  items: [
    {
      id: "fox-plume",
      slot: "accent",
      name: "Fox Plume",
      description: "A russet plume.",
      colors: { primary: "#cf7a2e", secondary: "#8f4a1e" },
      priceNumerator: 1,
      priceDenominator: 2,
      priceMultiplierDisplay: "1/2",
      amountBaseUnits: "3000000",
      amountDisplay: "3.0",
    },
    {
      id: "sherwood-fireflies",
      slot: "motes",
      name: "Sherwood Fireflies",
      description: "Green-gold motes.",
      colors: { primary: "#ecd357", secondary: "#8fce5a" },
      priceNumerator: 1,
      priceDenominator: 1,
      priceMultiplierDisplay: "1",
      amountBaseUnits: "6000000",
      amountDisplay: "6.0",
    },
  ],
  ownedItemIds: [],
  equippedItemIds: [],
}

describe("vanity client API", () => {
  it("loads a browsable catalog even when signed out", async () => {
    tokenBackendJson.mockResolvedValueOnce(signedOutState)
    const state = await loadVanityState()
    expect(tokenBackendRequest).toHaveBeenCalledWith("/vanity/state")
    expect(state.items).toHaveLength(2)
    const cards = vanityDisplayItems(state)
    expect(cards.find((card) => card.item.id === "fox-plume")).toMatchObject({ owned: false, equipped: false })
    expect(vanityPriceLabel(cards[0].offer, cards[0].payment)).toBe("3.0 HOOD")
  })

  it("keeps catalog cards visible when the server payload is unavailable", () => {
    const cards = vanityDisplayItems(null)
    expect(cards.map((card) => card.item.name)).toContain("Sherwood Fireflies")
    expect(cards.every((card) => card.offer === null)).toBe(true)
    expect(cards.every((card) => card.owned === false)).toBe(true)
  })

  it("marks owned and equipped items from the server response only", () => {
    const owned = vanityDisplayItems({
      ...signedOutState,
      authenticated: true,
      ownedItemIds: ["fox-plume"],
      equippedItemIds: ["fox-plume"],
    })
    expect(owned.find((card) => card.item.id === "fox-plume")).toMatchObject({ owned: true, equipped: true })
    expect(owned.find((card) => card.item.id === "sherwood-fireflies")).toMatchObject({ owned: false, equipped: false })
  })

  it("purchases through the shared treasury transfer and the verified claim", async () => {
    const ownedState: VanityState = { ...signedOutState, authenticated: true, ownedItemIds: ["fox-plume"], equippedItemIds: [] }
    sendTokenTransferToTreasury.mockResolvedValueOnce(`0x${"ab".repeat(32)}`)
    tokenBackendRequest.mockResolvedValueOnce(response)
    tokenBackendJson.mockResolvedValueOnce(ownedState)
    const next = await purchaseVanityItem("fox-plume", signedOutState)
    expect(sendTokenTransferToTreasury).toHaveBeenCalledWith(expect.objectContaining({
      chainId: 46630,
      tokenContract: "0x3333333333333333333333333333333333333333",
      treasuryAddress: "0x2222222222222222222222222222222222222222",
      amountBaseUnits: "3000000",
      amountDisplay: "3.0",
      tokenSymbol: "HOOD",
    }))
    expect(tokenBackendRequest).toHaveBeenCalledWith("/vanity/purchase", "POST", {
      itemId: "fox-plume",
      transactionHash: `0x${"ab".repeat(32)}`,
    })
    expect(next.ownedItemIds).toContain("fox-plume")
  })

  it("refuses purchases when payments are not configured or the item is unknown", async () => {
    const unconfigured: VanityState = { ...signedOutState, paymentConfigured: false, payment: null, items: signedOutState.items.map((offer) => ({ ...offer, amountBaseUnits: null, amountDisplay: null })) }
    await expect(purchaseVanityItem("fox-plume", unconfigured)).rejects.toThrow("not configured")
    await expect(purchaseVanityItem("gilded-horn", signedOutState)).rejects.toThrow("not part of the catalog")
    expect(sendTokenTransferToTreasury).not.toHaveBeenCalled()
  })

  it("equips items through the server", async () => {
    const next: VanityState = { ...signedOutState, authenticated: true, ownedItemIds: ["fox-plume"], equippedItemIds: ["fox-plume"] }
    tokenBackendRequest.mockResolvedValueOnce(response)
    tokenBackendJson.mockResolvedValueOnce(next)
    const state = await equipVanityItems(["fox-plume"])
    expect(tokenBackendRequest).toHaveBeenCalledWith("/vanity/equip", "POST", { itemIds: ["fox-plume"] })
    expect(state.equippedItemIds).toEqual(["fox-plume"])
  })
})
