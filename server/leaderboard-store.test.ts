import { describe, expect, it, vi } from "vitest"
import type { MissionResult } from "../shared/protocol"
import type { RpcClient } from "./band-store"
import { SupabaseLeaderboardStore, verificationId } from "./leaderboard-store"

const result: MissionResult = {
  score: 8100,
  grade: "A",
  breakdown: { speed: 80, stealth: 70, precision: 90, survival: 75, rescues: 50, generosity: 60 },
  thresholds: { S: 9000, A: 7500, B: 6000, C: 0 },
  communityCoin: 660,
  personalRenown: 4050,
}

describe("verified leaderboard store", () => {
  it("derives a stable per-player verification UUID", () => {
    expect(verificationId("mission-1", "player-1")).toBe(verificationId("mission-1", "player-1"))
    expect(verificationId("mission-1", "player-1")).not.toBe(verificationId("mission-1", "player-2"))
    expect(verificationId("mission-1", "player-1")).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("sanitizes identity and submits only the authoritative result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "993a8d20-c073-4f55-87ce-8b7e727b19b0", error: null })
    const store = new SupabaseLeaderboardStore({ rpc } as RpcClient)
    await expect(store.recordVerifiedRun({
      missionId: "mission-1",
      playerId: "player-1",
      playerName: "<Oakheart>",
      characterId: "robin",
      partySize: 2,
      missionSeconds: 900,
      delivered: 660,
      rescues: 2,
      damageTaken: 0,
      missionVersion: "1.0.0",
      missionContentHash: "fnv1a32:ec1c4b0c",
      result,
    })).resolves.toBe("993a8d20-c073-4f55-87ce-8b7e727b19b0")
    expect(rpc).toHaveBeenCalledWith("record_verified_leaderboard_entry", expect.objectContaining({
      p_player_name: "Oakheart",
      p_score: 8100,
      p_precision: 90,
      p_score_breakdown: expect.objectContaining({ missionVersion: "1.0.0", missionContentHash: "fnv1a32:ec1c4b0c" }),
    }))
  })

  it("returns null when the database quarantines a run", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const store = new SupabaseLeaderboardStore({ rpc } as RpcClient)
    await expect(store.recordVerifiedRun({
      missionId: "mission-2",
      playerId: "player-2",
      playerName: "Swift",
      characterId: "marian",
      partySize: 2,
      missionSeconds: 30,
      delivered: 660,
      rescues: 0,
      damageTaken: 0,
      missionVersion: "1.0.0",
      missionContentHash: "fnv1a32:ec1c4b0c",
      result,
    })).resolves.toBeNull()
  })
})
