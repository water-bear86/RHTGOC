import { describe, expect, it, vi } from "vitest"
import type { MissionResult } from "../shared/protocol"
import { SupabaseBandStore, type RpcClient } from "./band-store"

const result: MissionResult = {
  score: 8100,
  grade: "A",
  breakdown: { speed: 80, stealth: 70, precision: 90, survival: 75, rescues: 50, generosity: 60 },
  thresholds: { S: 9000, A: 7500, B: 6000, C: 0 },
  communityCoin: 660,
  personalRenown: 4050,
}

describe("SupabaseBandStore", () => {
  it("creates a privacy-safe preset-banner band through the atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "8c820e61-d711-4c0e-9020-789ea98d315a", error: null })
    const store = new SupabaseBandStore({ rpc } as RpcClient)
    await expect(store.createBand("Oak Hearts", "oak", "b9fd2fb4-2114-4e4f-aa40-619a0af652a3")).resolves.toBe("8c820e61-d711-4c0e-9020-789ea98d315a")
    expect(rpc).toHaveBeenCalledWith("create_merry_band", expect.objectContaining({ p_name: "Oak Hearts", p_banner_id: "oak" }))
  })

  it("treats duplicate mission grants as an idempotent no-op", async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null })
    const store = new SupabaseBandStore({ rpc } as RpcClient)
    const mission = {
      bandId: "5bf9abcf-cd1f-47fb-ad88-2a9dbf747005",
      missionId: "9bb62df5-040f-41d0-9ebc-340917262bf8",
      missionSlug: "peoples-purse",
      seed: 1937,
      result,
      allocationChoice: "granary" as const,
      allocationCoin: 660,
    }
    await expect(store.recordMission(mission)).resolves.toBe(true)
    await expect(store.recordMission(mission)).resolves.toBe(false)
  })

  it("surfaces database failures without retrying a reward", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "network" } })
    const store = new SupabaseBandStore({ rpc } as RpcClient)
    await expect(store.recordMission({
      bandId: "5bf9abcf-cd1f-47fb-ad88-2a9dbf747005",
      missionId: "9bb62df5-040f-41d0-9ebc-340917262bf8",
      missionSlug: "peoples-purse",
      seed: 1937,
      result,
      allocationChoice: "granary",
      allocationCoin: 660,
    })).rejects.toThrow("BAND_REWARD_FAILED")
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
