import { Interface, type JsonRpcProvider } from "ethers"
import { describe, expect, it, vi } from "vitest"
import type { Database } from "../src/database.types"
import { vanityItemPriceAmount } from "../shared/vanity-catalog"
import {
  VanityService,
  vanityItemPaymentConfig,
  type VanityStatePayload,
} from "./vanity-service"
import type { TokenPaymentConfig } from "./token-access-service"

const wallet = "0x1111111111111111111111111111111111111111"
const treasury = "0x2222222222222222222222222222222222222222"
const token = "0x3333333333333333333333333333333333333333"

const basePayment: TokenPaymentConfig = {
  chainId: 46630,
  chainName: "Robinhood Chain Testnet",
  tokenContract: token,
  treasuryAddress: treasury,
  amountBaseUnits: "6000000",
  amountDisplay: "6.0",
  tokenSymbol: "HOOD",
  tokenDecimals: 6,
  passDays: 30,
  confirmations: 2,
}

interface FakeTableShape {
  owned: Array<{ item_id: string }>
  equipped: { equipped_item_ids: string[] } | null
}

function fakeDatabase(tables: FakeTableShape, rpc: ReturnType<typeof vi.fn>) {
  return {
    from: (table: "player_vanity_owned" | "player_vanity_state") => {
      if (table === "player_vanity_owned") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: tables.owned, error: null }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: tables.equipped, error: null }),
          }),
        }),
      }
    },
    rpc,
  } as unknown as import("@supabase/supabase-js").SupabaseClient<Database>
}

const transferInterface = new Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"])

function transferLog(from = wallet, to = treasury, value = 6_000_000n) {
  const event = transferInterface.encodeEventLog(transferInterface.getEvent("Transfer")!, [from, to, value])
  return { address: token, topics: event.topics, data: event.data }
}

function fakeProvider() {
  return {
    getNetwork: vi.fn().mockResolvedValue({ chainId: 46630n }),
    getTransaction: vi.fn().mockResolvedValue({ from: wallet, to: token }),
    getTransactionReceipt: vi.fn().mockResolvedValue({ status: 1, blockNumber: 100, logs: [transferLog()] }),
    getBlockNumber: vi.fn().mockResolvedValue(102),
    getBlock: vi.fn().mockResolvedValue({ timestamp: 1_700_000_000 }),
  } as unknown as JsonRpcProvider
}

function service(rpc: ReturnType<typeof vi.fn>, overrides: Partial<FakeTableShape> = {}, withPayment = true) {
  const database = fakeDatabase(
    { owned: [], equipped: null, ...overrides },
    rpc,
  )
  return new VanityService(database, withPayment ? fakeProvider() : null, withPayment ? basePayment : null)
}

describe("vanity price derivation", () => {
  it("scales the base pass amount by the shared catalog multiplier", () => {
    const fox = vanityItemPaymentConfig(basePayment, "fox-plume")
    expect(fox.amountBaseUnits).toBe("3000000")
    expect(fox.amountDisplay).toBe("3.0")
    const fireflies = vanityItemPaymentConfig(basePayment, "sherwood-fireflies")
    expect(fireflies.amountBaseUnits).toBe(basePayment.amountBaseUnits)
    const trail = vanityItemPaymentConfig(basePayment, "kings-ransom-trail")
    expect(trail.amountBaseUnits).toBe("9000000")
    expect(trail.tokenContract).toBe(token)
    expect(trail.treasuryAddress).toBe(treasury)
    expect(trail.chainId).toBe(46630)
    expect(trail.confirmations).toBe(2)
  })

  it("matches the pure shared price helper exactly", () => {
    expect(vanityItemPriceAmount(6_000_000n, "fox-plume")).toBe(3_000_000n)
    expect(vanityItemPriceAmount(6_000_000n, "kings-ransom-trail")).toBe(9_000_000n)
  })
})

describe("vanity browse state", () => {
  it("sells a deterministic catalog with server-computed amounts when configured", async () => {
    const rpc = vi.fn()
    const payload = await service(rpc).state(null)
    expect(payload.authenticated).toBe(false)
    expect(payload.paymentConfigured).toBe(true)
    expect(payload.items.map((item) => item.id)).toEqual(["fox-plume", "sherwood-fireflies", "kings-ransom-trail"])
    expect(payload.items.map((item) => item.amountBaseUnits)).toEqual(["3000000", "6000000", "9000000"])
    expect(payload.ownedItemIds).toEqual([])
    expect(payload.equippedItemIds).toEqual([])
  })

  it("still browses without token payment configuration", async () => {
    const rpc = vi.fn()
    const payload = await service(rpc, {}, false).state(null)
    expect(payload.paymentConfigured).toBe(false)
    expect(payload.payment).toBeNull()
    expect(payload.items.every((item) => item.amountBaseUnits === null)).toBe(true)
    expect(payload.items.map((item) => item.name)).toContain("Fox Plume")
  })

  it("returns persisted ownership and equipment for a signed-in player", async () => {
    const rpc = vi.fn()
    const payload = await service(rpc, {
      owned: [{ item_id: "fox-plume" }, { item_id: "sherwood-fireflies" }],
      equipped: { equipped_item_ids: ["fox-plume"] },
    }).state("f47ac10b-58cc-4372-a567-0e02b2c3d479")
    expect(payload.authenticated).toBe(true)
    expect(payload.ownedItemIds).toEqual(["fox-plume", "sherwood-fireflies"])
    expect(payload.equippedItemIds).toEqual(["fox-plume"])
  })
})

describe("vanity purchase", () => {
  it("rejects unknown items before any chain work", async () => {
    const rpc = vi.fn()
    await expect(service(rpc).purchase("f47ac10b-58cc-4372-a567-0e02b2c3d479", wallet, "gilded-horn", `0x${"ab".repeat(32)}`))
      .rejects.toThrow("VANITY_ITEM_UNKNOWN")
    expect(rpc).not.toHaveBeenCalled()
  })

  it("fails closed when token payments are not configured", async () => {
    const rpc = vi.fn()
    await expect(service(rpc, {}, false).purchase("f47ac10b-58cc-4372-a567-0e02b2c3d479", wallet, "fox-plume", `0x${"ab".repeat(32)}`))
      .rejects.toThrow("VANITY_PAYMENT_NOT_CONFIGURED")
    expect(rpc).not.toHaveBeenCalled()
  })

  it("maps replay and constraint violations to a clear already-claimed error", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "VANITY_PAYMENT_REPLAY", code: "P0001" } })
    await expect(service(rpc).purchase("f47ac10b-58cc-4372-a567-0e02b2c3d479", wallet, "fox-plume", `0x${"ab".repeat(32)}`))
      .rejects.toThrow("VANITY_PAYMENT_ALREADY_CLAIMED")
  })

  it("records a verified purchase and returns the refreshed state", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const result = await service(rpc).purchase("f47ac10b-58cc-4372-a567-0e02b2c3d479", wallet, "sherwood-fireflies", `0x${"ab".repeat(32)}`)
    expect(rpc).toHaveBeenCalledWith("record_vanity_purchase", {
      p_user_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      p_item_id: "sherwood-fireflies",
      p_tx_hash: `0x${"ab".repeat(32)}`,
      p_wallet_address: wallet,
      p_chain_id: 46630,
      p_token_contract: token,
      p_treasury_address: treasury,
      p_amount_base_units: "6000000",
      p_paid_at: "2023-11-14T22:13:20.000Z",
    })
    expect(result.newlyGranted).toBe(true)
    expect(result.state.items).toHaveLength(3)
  })
})

describe("vanity equipment", () => {
  it("equips only owned, slot-disjoint items through the server RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ["fox-plume"], error: null })
    const payload = await service(rpc).equip("f47ac10b-58cc-4372-a567-0e02b2c3d479", ["fox-plume"])
    expect(rpc).toHaveBeenCalledWith("set_vanity_equipped", {
      p_user_id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      p_item_ids: ["fox-plume"],
    })
    expect(payload.equippedItemIds).toEqual(["fox-plume"])
  })

  it("rejects duplicate items or overlapping slots client-side before the RPC", async () => {
    const rpc = vi.fn()
    const serviceInstance = service(rpc)
    await expect(serviceInstance.equip("f47ac10b-58cc-4372-a567-0e02b2c3d479", ["fox-plume", "fox-plume"])).rejects.toThrow("VANITY_EQUIP_INVALID")
    await expect(serviceInstance.equip("f47ac10b-58cc-4372-a567-0e02b2c3d479", ["not-an-item"])).rejects.toThrow("VANITY_EQUIP_INVALID")
    expect(rpc).not.toHaveBeenCalled()
  })

  it("surfaces ownership failures from the server RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "VANITY_ITEM_NOT_OWNED", code: "P0001" } })
    await expect(service(rpc).equip("f47ac10b-58cc-4372-a567-0e02b2c3d479", ["fox-plume"])).rejects.toThrow("VANITY_ITEM_NOT_OWNED")
  })

  it("returns a complete payload shape for UI rendering", async () => {
    const payload: VanityStatePayload = await service(vi.fn(), {
      equipped: { equipped_item_ids: ["fox-plume"] },
    }).state("f47ac10b-58cc-4372-a567-0e02b2c3d479")
    expect(payload.payment).toMatchObject({ tokenSymbol: "HOOD", tokenContract: token })
    expect(payload.items[0]).toMatchObject({ slot: "accent", priceMultiplierDisplay: "1/2" })
  })
})
