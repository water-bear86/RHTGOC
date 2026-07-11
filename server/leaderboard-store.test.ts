import { describe, expect, it, vi } from "vitest"
import type { MissionResult } from "../shared/protocol"
import type { RpcClient } from "./band-store"
import { rankedPlayerName, SupabaseLeaderboardStore, terminalLeaderboardFailure, verificationId } from "./leaderboard-store"

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

  it("uses season-scoped non-user-authored aliases on public rankings", () => {
    const userId = "b9fd2fb4-2114-4e4f-aa40-619a0af652a3"
    expect(rankedPlayerName("season-zero", userId)).toMatch(/^[A-Za-z]+ [A-Za-z]+ [A-F0-9]{4}$/)
    expect(rankedPlayerName("season-zero", userId)).toBe(rankedPlayerName("season-zero", userId))
    expect(rankedPlayerName("season-one", userId)).not.toBe(rankedPlayerName("season-zero", userId))
  })

  it("dead-letters permanent score failures without classifying transient outages", () => {
    expect(terminalLeaderboardFailure(new Error("VERIFIED_SCORE_FAILED: SEASON_FINALIZED"))).toBe("season_finalized")
    expect(terminalLeaderboardFailure(new Error("VERIFIED_SCORE_FAILED: violates check constraint"))).toBe("database_constraint")
    expect(terminalLeaderboardFailure(new Error("VERIFIED_SCORE_FAILED: fetch failed"))).toBeNull()
  })

  it("sanitizes identity and submits only the authoritative result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "993a8d20-c073-4f55-87ce-8b7e727b19b0", error: null })
    const store = new SupabaseLeaderboardStore({ rpc } as RpcClient)
    await expect(store.recordVerifiedRun({
      missionId: "mission-1",
      playerId: "player-1",
      authUserId: "b9fd2fb4-2114-4e4f-aa40-619a0af652a3",
      bandId: "8c820e61-d711-4c0e-9020-789ea98d315a",
      characterId: "robin",
      partySize: 2,
      missionSeconds: 900,
      delivered: 660,
      rescues: 2,
      damageTaken: 0,
      missionVersion: "1.0.0",
      missionContentHash: "fnv1a32:ec1c4b0c",
      missionSlug: "peoples-purse",
      seasonSlug: "green-bough-ii",
      missionStartedAt: 1_750_000_000_000,
      cleanEscape: true,
      rotationId: "sheriff-2026-07-10-p2-v1",
      rotationModifierIds: ["armored-escort", "scarce-quivers"],
      result,
    })).resolves.toBe("993a8d20-c073-4f55-87ce-8b7e727b19b0")
    expect(rpc).toHaveBeenCalledWith("record_verified_leaderboard_entry", expect.objectContaining({
      p_player_name: rankedPlayerName("green-bough-ii", "b9fd2fb4-2114-4e4f-aa40-619a0af652a3"),
      p_player_id: "b9fd2fb4-2114-4e4f-aa40-619a0af652a3",
      p_band_id: "8c820e61-d711-4c0e-9020-789ea98d315a",
      p_season_slug: "green-bough-ii",
      p_mission_started_at: "2025-06-15T15:06:40.000Z",
      p_score: 8100,
      p_clean_escape: true,
      p_precision: 90,
      p_score_breakdown: expect.objectContaining({ missionVersion: "1.0.0", missionContentHash: "fnv1a32:ec1c4b0c", rotationId: "sheriff-2026-07-10-p2-v1", rotationModifierIds: ["armored-escort", "scarce-quivers"] }),
    }))
  })

  it("returns null when the database quarantines a run", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    const store = new SupabaseLeaderboardStore({ rpc } as RpcClient)
    await expect(store.recordVerifiedRun({
      missionId: "mission-2",
      playerId: "player-2",
      authUserId: "5f50e927-f18b-4a4e-a061-d39f87dd8374",
      characterId: "marian",
      partySize: 2,
      missionSeconds: 30,
      delivered: 660,
      rescues: 0,
      damageTaken: 0,
      missionVersion: "1.0.0",
      missionContentHash: "fnv1a32:ec1c4b0c",
      missionSlug: "peoples-purse",
      seasonSlug: "season-zero",
      missionStartedAt: 1_750_000_000_000,
      cleanEscape: false,
      result,
    })).resolves.toBeNull()
  })

  it("routes an authenticated operator quarantine decision through the service-only RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { status: "approved", entryId: "993a8d20-c073-4f55-87ce-8b7e727b19b0" }, error: null })
    const store = new SupabaseLeaderboardStore({ rpc } as RpcClient)
    await expect(store.reviewQuarantine(
      "6c1a07e3-e521-4be7-a1cb-7b32e734a579",
      "b9fd2fb4-2114-4e4f-aa40-619a0af652a3",
      "approved",
    )).resolves.toEqual({ status: "approved", entryId: "993a8d20-c073-4f55-87ce-8b7e727b19b0" })
    expect(rpc).toHaveBeenCalledWith("review_leaderboard_quarantine", {
      p_quarantine_id: "6c1a07e3-e521-4be7-a1cb-7b32e734a579",
      p_reviewer_id: "b9fd2fb4-2114-4e4f-aa40-619a0af652a3",
      p_decision: "approved",
    })
  })

  it("finalizes only database seasons that have cleared their drain and review gates", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { seasonsFinalized: 1, snapshotsCreated: 5 }, error: null })
    const store = new SupabaseLeaderboardStore({ rpc } as RpcClient)
    await expect(store.finalizeDueSeasons()).resolves.toEqual({ seasonsFinalized: 1, snapshotsCreated: 5 })
    expect(rpc).toHaveBeenCalledWith("finalize_due_leaderboard_seasons", {})
  })
})
