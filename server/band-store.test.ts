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
  const persistedBand = {
    id: "8c820e61-d711-4c0e-9020-789ea98d315a",
    name: "Oak Hearts",
    bannerId: "oak",
    actorUserId: "b9fd2fb4-2114-4e4f-aa40-619a0af652a3",
    camp: { hearth: 1, workbench: 1, stores: 0 },
    village: { granary: 1, infirmary: 0, watchtower: 0 },
    progressionVersion: 2,
    missionCount: 1,
    memberCount: 1,
    members: [{ userId: "b9fd2fb4-2114-4e4f-aa40-619a0af652a3", membershipRole: "leader", heroRole: "robin" }],
  }

  it("creates a privacy-safe preset-banner band through the atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "8c820e61-d711-4c0e-9020-789ea98d315a", error: null })
    const store = new SupabaseBandStore({ rpc } as RpcClient)
    await expect(store.createBand("Oak Hearts", "oak", "b9fd2fb4-2114-4e4f-aa40-619a0af652a3")).resolves.toBe("8c820e61-d711-4c0e-9020-789ea98d315a")
    expect(rpc).toHaveBeenCalledWith("create_merry_band", expect.objectContaining({ p_name: "Oak Hearts", p_banner_id: "oak" }))
  })

  it("restores one active band with its camp, village, role, and history projection", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: persistedBand, error: null })
    const store = new SupabaseBandStore({ rpc } as RpcClient)
    await expect(store.ensureBand("b9fd2fb4-2114-4e4f-aa40-619a0af652a3", "Oakheart", "robin")).resolves.toEqual({
      state: { id: persistedBand.id, name: "Oak Hearts", bannerId: "oak", camp: persistedBand.camp, progressionVersion: 2, missionCount: 1, memberCount: 1 },
      village: persistedBand.village,
      actorUserId: persistedBand.actorUserId,
      members: persistedBand.members,
    })
    expect(rpc).toHaveBeenCalledWith("ensure_merry_band", { p_creator_user_id: persistedBand.actorUserId, p_display_name: "Oakheart", p_hero_role: "robin" })
  })

  it("treats duplicate mission grants as an idempotent no-op", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { recorded: true, progressed: true, band: persistedBand }, error: null })
      .mockResolvedValueOnce({ data: { recorded: false, progressed: false, band: persistedBand }, error: null })
    const store = new SupabaseBandStore({ rpc } as RpcClient)
    const mission = {
      bandId: "5bf9abcf-cd1f-47fb-ad88-2a9dbf747005",
      actorUserId: persistedBand.actorUserId,
      missionId: "9bb62df5-040f-41d0-9ebc-340917262bf8",
      missionSlug: "peoples-purse",
      seed: 1937,
      status: "succeeded" as const,
      result,
      allocationChoice: "granary" as const,
      allocationCoin: 660,
    }
    await expect(store.recordMission(mission)).resolves.toMatchObject({ recorded: true, progressed: true })
    await expect(store.recordMission(mission)).resolves.toMatchObject({ recorded: false, progressed: false })
  })

  it("routes membership, identity, and hero-role mutations through server-only RPCs", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: persistedBand, error: null })
    const store = new SupabaseBandStore({ rpc } as RpcClient)
    const memberId = "5f50e927-f18b-4a4e-a061-d39f87dd8374"
    await store.addMember(persistedBand.id, persistedBand.actorUserId, memberId, "marian")
    await store.updateIdentity(persistedBand.id, persistedBand.actorUserId, "Green Bough", "stag")
    await store.setHeroRole(persistedBand.id, persistedBand.actorUserId, "much")
    await store.removeMember(persistedBand.id, persistedBand.actorUserId, memberId)
    expect(rpc).toHaveBeenNthCalledWith(1, "add_merry_band_member", { p_band_id: persistedBand.id, p_actor_user_id: persistedBand.actorUserId, p_member_user_id: memberId, p_hero_role: "marian" })
    expect(rpc).toHaveBeenNthCalledWith(2, "update_merry_band_identity", { p_band_id: persistedBand.id, p_actor_user_id: persistedBand.actorUserId, p_name: "Green Bough", p_banner_id: "stag" })
    expect(rpc).toHaveBeenNthCalledWith(3, "set_merry_band_hero_role", { p_band_id: persistedBand.id, p_user_id: persistedBand.actorUserId, p_hero_role: "much" })
    expect(rpc).toHaveBeenNthCalledWith(4, "remove_merry_band_member", { p_band_id: persistedBand.id, p_actor_user_id: persistedBand.actorUserId, p_member_user_id: memberId })
  })

  it("surfaces database failures without retrying a reward", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: "network" } })
    const store = new SupabaseBandStore({ rpc } as RpcClient)
    await expect(store.recordMission({
      bandId: "5bf9abcf-cd1f-47fb-ad88-2a9dbf747005",
      actorUserId: persistedBand.actorUserId,
      missionId: "9bb62df5-040f-41d0-9ebc-340917262bf8",
      missionSlug: "peoples-purse",
      seed: 1937,
      status: "succeeded",
      result,
      allocationChoice: "granary",
      allocationCoin: 660,
    })).rejects.toThrow("BAND_REWARD_FAILED")
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
