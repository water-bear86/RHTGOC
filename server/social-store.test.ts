import { describe, expect, it, vi } from "vitest"
import type { RpcClient } from "./band-store"
import { SupabaseSocialStore } from "./social-store"

describe("recent-player persistence", () => {
  it("submits one authoritative mission identity and verified user set", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const store = new SupabaseSocialStore({ rpc } as RpcClient)
    await expect(store.recordRecentPlayers("66778899-aabb-4cdd-8eef-001122334455", ["778899aa-bbcc-4dee-8ff0-112233445566", "8899aabb-ccdd-4eff-8011-223344556677"])).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith("record_recent_band_players", { p_mission_id: "66778899-aabb-4cdd-8eef-001122334455", p_user_ids: ["778899aa-bbcc-4dee-8ff0-112233445566", "8899aabb-ccdd-4eff-8011-223344556677"] })
  })

  it("loads accepted friend ids for capacity-aware hub placement", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ["778899aa-bbcc-4dee-8ff0-112233445566"], error: null })
    const store = new SupabaseSocialStore({ rpc } as RpcClient)
    await expect(store.getAcceptedFriendIds("66778899-aabb-4cdd-8eef-001122334455")).resolves.toEqual(["778899aa-bbcc-4dee-8ff0-112233445566"])
  })
  it("persists a verified in-hub block without accepting client user ids", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const store = new SupabaseSocialStore({ rpc } as RpcClient)
    await expect(store.recordHubBlock("66778899-aabb-4cdd-8eef-001122334455", "778899aa-bbcc-4dee-8ff0-112233445566")).resolves.toBe(true)
  })

  it("loads both directions of persistent hub blocks before placement", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ["778899aa-bbcc-4dee-8ff0-112233445566"], error: null })
    const store = new SupabaseSocialStore({ rpc } as RpcClient)
    await expect(store.getHubBlockedIds("66778899-aabb-4cdd-8eef-001122334455")).resolves.toEqual(["778899aa-bbcc-4dee-8ff0-112233445566"])
  })

  it("persists fixed-reason reports with verified server identities", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const store = new SupabaseSocialStore({ rpc } as RpcClient)
    await expect(store.recordHubReport("66778899-aabb-4cdd-8eef-001122334455", "778899aa-bbcc-4dee-8ff0-112233445566", "griefing")).resolves.toBe(true)
  })
})
