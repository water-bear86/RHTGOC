import { describe, expect, it, vi } from "vitest"
import type { RpcClient } from "./band-store"
import { isLeaderboardKind, SupabaseRankedLeaderboardStore } from "./ranked-leaderboard-store"

function mockClient(payload: unknown): RpcClient {
  return { rpc: vi.fn().mockResolvedValue({ data: payload, error: null }) } as RpcClient
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "a",
    player_name: "Oak Fox 11AA",
    character_id: "robin",
    score: 9000,
    grade: "S",
    mission_seconds: 120,
    delivered: 500,
    verified: true,
    created_at: "2026-07-11T00:00:00.000Z",
    party_size: 2,
    mission_slug: "peoples-purse",
    rescues: 3,
    precision: 88,
    generosity: 70,
    clean_escape: true,
    rank: 1,
    is_tied: false,
    position: 1,
    ...overrides,
  }
}

describe("ranked leaderboard store", () => {
  it("recognizes exactly the five board kinds", () => {
    for (const kind of ["master-outlaws", "peoples-champions", "clean-escapes", "rescuers", "swift-arrows"]) {
      expect(isLeaderboardKind(kind)).toBe(true)
    }
    expect(isLeaderboardKind("bounty-hunters")).toBe(false)
    expect(isLeaderboardKind("")).toBe(false)
  })

  it("maps a paginated ranked response with ties and the viewer's own rank", async () => {
    const payload = {
      entries: [
        row(),
        row({ id: "b", player_name: "Green Hart 22BB", character_id: "marian", mission_seconds: 120, rank: 1, is_tied: true, position: 2 }),
        row({ id: "c", player_name: "Swift Wren 33CC", score: 8500, grade: "A", rank: 3, is_tied: false, position: 3 }),
      ],
      pagination: { total: 120, limit: 3, offset: 0, has_next: true },
      self: row({ id: "z", player_name: "Quiet Badger 44DD", score: 7000, grade: "B", rank: 41, is_tied: false, position: 44 }),
    }
    const store = new SupabaseRankedLeaderboardStore(mockClient(payload))
    const out = await store.readRanked({ kind: "master-outlaws", limit: 3, offset: 0 })
    expect(out.entries).toHaveLength(3)
    expect(out.entries[0]).toMatchObject({ id: "a", rank: 1, isTied: false, position: 1 })
    expect(out.entries[1]).toMatchObject({ id: "b", rank: 1, isTied: true, position: 2 })
    expect(out.entries[2]).toMatchObject({ id: "c", rank: 3, isTied: false, position: 3 })
    expect(out.pagination).toEqual({ total: 120, limit: 3, offset: 0, hasNext: true })
    expect(out.self).toMatchObject({ id: "z", rank: 41, position: 44 })
  })

  it("returns a null self row when the viewer is unranked or anonymous", async () => {
    const payload = { entries: [], pagination: { total: 0, limit: 50, offset: 0, has_next: false }, self: null }
    const store = new SupabaseRankedLeaderboardStore(mockClient(payload))
    const out = await store.readRanked({ kind: "rescuers" })
    expect(out.entries).toEqual([])
    expect(out.self).toBeNull()
    expect(out.pagination.hasNext).toBe(false)
  })

  it("drops malformed rows instead of surfacing partial entries", async () => {
    const payload = {
      entries: [row(), { id: "bad" }, null, 7],
      pagination: { total: 1, limit: 50, offset: 0, has_next: false },
      self: null,
    }
    const store = new SupabaseRankedLeaderboardStore(mockClient(payload))
    const out = await store.readRanked({ kind: "master-outlaws" })
    expect(out.entries).toHaveLength(1)
    expect(out.entries[0].id).toBe("a")
  })

  it("rejects an errored or invalid response shape", async () => {
    const errored = new SupabaseRankedLeaderboardStore({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }) } as RpcClient)
    await expect(errored.readRanked({ kind: "master-outlaws" })).rejects.toThrow(/RANKED_LEADERBOARD_READ_FAILED/)
    const arrayShaped = new SupabaseRankedLeaderboardStore(mockClient([]))
    await expect(arrayShaped.readRanked({ kind: "master-outlaws" })).rejects.toThrow(/RANKED_LEADERBOARD_READ_FAILED/)
  })

  it("calls the ranked RPC with every filter and pagination parameter", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { entries: [], pagination: { total: 0, limit: 10, offset: 5, has_next: false }, self: null },
      error: null,
    })
    const store = new SupabaseRankedLeaderboardStore({ rpc } as RpcClient)
    await store.readRanked({
      kind: "clean-escapes",
      seasonSlug: "season-zero",
      characterId: "robin",
      partySize: 2,
      missionSlug: "peoples-purse",
      bandId: "band-123",
      playerIds: ["p1", "p2"],
      limit: 10,
      offset: 5,
    })
    expect(rpc).toHaveBeenCalledWith("read_leaderboard_ranked", {
      p_kind: "clean-escapes",
      p_season_slug: "season-zero",
      p_character_id: "robin",
      p_party_size: 2,
      p_mission_slug: "peoples-purse",
      p_band_id: "band-123",
      p_player_ids: ["p1", "p2"],
      p_limit: 10,
      p_offset: 5,
    })
  })

  it("defaults to the master-outlaws board on season-zero with a 50-row page", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { entries: [], pagination: { total: 0, limit: 50, offset: 0, has_next: false }, self: null },
      error: null,
    })
    const store = new SupabaseRankedLeaderboardStore({ rpc } as RpcClient)
    await store.readRanked({})
    expect(rpc).toHaveBeenCalledWith("read_leaderboard_ranked", expect.objectContaining({
      p_kind: "master-outlaws",
      p_season_slug: "season-zero",
      p_limit: 50,
      p_offset: 0,
      p_character_id: null,
      p_band_id: null,
      p_player_ids: null,
    }))
  })

  it("maps season status rows and drops rows with unknown lifecycle states", async () => {
    const payload = [
      { id: "s1", slug: "season-one", name: "Season One", lifecycle_state: "open", starts_at: "2026-07-01T00:00:00.000Z", ends_at: "2026-09-30T00:00:00.000Z", closed_at: null, finalize_after: null, finalized_at: null, entry_count: 42 },
      { id: "s0", slug: "season-zero", name: "Season Zero", lifecycle_state: "finalized", starts_at: "2026-04-01T00:00:00.000Z", ends_at: "2026-06-30T00:00:00.000Z", closed_at: "2026-06-30T00:00:00.000Z", finalize_after: "2026-06-30T00:30:00.000Z", finalized_at: "2026-06-30T01:00:00.000Z", entry_count: 900 },
      { id: "sX", slug: "season-x", name: "Broken", lifecycle_state: "paused", starts_at: "", ends_at: "", closed_at: null, finalize_after: null, finalized_at: null, entry_count: 0 },
    ]
    const store = new SupabaseRankedLeaderboardStore(mockClient(payload))
    const out = await store.getSeasonStatus()
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({
      id: "s1", slug: "season-one", name: "Season One", lifecycleState: "open",
      startsAt: "2026-07-01T00:00:00.000Z", endsAt: "2026-09-30T00:00:00.000Z",
      closedAt: null, finalizeAfter: null, finalizedAt: null, entryCount: 42,
    })
    expect(out[1]).toMatchObject({ slug: "season-zero", lifecycleState: "finalized", finalizedAt: "2026-06-30T01:00:00.000Z", entryCount: 900 })
  })

  it("rejects a non-array season status response", async () => {
    const store = new SupabaseRankedLeaderboardStore(mockClient({ nope: true }))
    await expect(store.getSeasonStatus("season-one")).rejects.toThrow(/SEASON_STATUS_FAILED/)
  })
})
