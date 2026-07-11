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
})
