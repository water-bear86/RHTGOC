import { describe, expect, it } from "vitest"
import type { RpcClient } from "./band-store"
import { SupabaseLeaderboardStore } from "./leaderboard-store"
import { SupabaseRankedLeaderboardStore } from "./ranked-leaderboard-store"
import { rankAndPaginate, type RankableEntry } from "./leaderboard-ranking"

type RpcResult = Awaited<ReturnType<RpcClient["rpc"]>>

interface FakeSeason {
  id: string
  slug: string
  name: string
  startsAt: string
  endsAt: string
  lifecycleState: "open" | "closing" | "finalized"
  closedAt: string | null
  finalizeAfter: string | null
  finalizedAt: string | null
}

interface FakeEntry extends RankableEntry {
  verificationId: string
  playerName: string
  grade: string
  createdAt: string
  generosity: number
  verified: boolean
}

/**
 * In-memory stand-in for the lifecycle + ranked-read RPCs with the same
 * semantics as supabase/migrations/20260904015500_enhance_leaderboard_rankings.sql
 * and the finalize/snapshot rules from 20260711094523: advisory-locked
 * transitions, bounded drain windows, pending-quarantine gates, append-only
 * snapshots, and SEASON_FINALIZED with exact-replay idempotency.
 */
class FakeLeaderboardBackend implements RpcClient {
  now: number
  private seasonSequence = 0
  private entrySequence = 0
  readonly seasons = new Map<string, FakeSeason>()
  readonly entries = new Map<string, FakeEntry[]>()
  readonly snapshots = new Map<string, Record<string, FakeEntry[]>>()
  readonly pendingQuarantines = new Set<string>()

  constructor(startAt = Date.parse("2026-09-01T00:00:00.000Z")) {
    this.now = startAt
  }

  advance(ms: number): void {
    this.now += ms
  }

  recordEntry(seasonSlug: string, entry: Omit<FakeEntry, "verificationId" | "playerName" | "grade" | "createdAt" | "generosity" | "verified"> & { verificationId?: string }): string {
    const season = [...this.seasons.values()].find((row) => row.slug === seasonSlug)
    if (!season) throw new Error("SEASON_NOT_FOUND")
    const verificationId = entry.verificationId ?? `verify-${entry.id}`
    const rows = this.entries.get(season.id) ?? []
    const existing = rows.find((row) => row.verificationId === verificationId)
    if (existing) return existing.id
    if (season.lifecycleState === "finalized") throw new Error("SEASON_FINALIZED")
    this.entrySequence += 1
    rows.push({
      ...entry,
      verificationId,
      playerName: `Outlaw ${this.entrySequence}`,
      grade: "A",
      createdAt: new Date(this.now).toISOString(),
      generosity: 50,
      verified: true,
    })
    this.entries.set(season.id, rows)
    return entry.id
  }

  async rpc(name: string, params: Record<string, unknown>): Promise<RpcResult> {
    try {
      return { data: this.dispatch(name, params), error: null }
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : "unknown" } }
    }
  }

  private dispatch(name: string, params: Record<string, unknown>): unknown {
    switch (name) {
      case "activate_leaderboard_season": return this.activate(params)
      case "close_leaderboard_season": return this.close(params)
      case "recover_leaderboard_season_drain": return this.recover()
      case "read_leaderboard_ranked": return this.readRanked(params)
      case "get_leaderboard_season_status": return this.status(params)
      default: throw new Error(`UNEXPECTED_RPC: ${name}`)
    }
  }

  private activate(params: Record<string, unknown>): unknown {
    const slug = String(params.p_slug)
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) throw new Error("INVALID_LEADERBOARD_SEASON")
    const existing = [...this.seasons.values()].find((row) => row.slug === slug)
    if (existing) {
      if (existing.lifecycleState === "finalized") throw new Error("FINALIZED_SEASON_IMMUTABLE")
      return { season_id: existing.id, lifecycle_state: existing.lifecycleState, activated: false }
    }
    this.seasonSequence += 1
    const season: FakeSeason = {
      id: `season-id-${this.seasonSequence}`,
      slug,
      name: String(params.p_name),
      startsAt: String(params.p_starts_at),
      endsAt: String(params.p_ends_at),
      lifecycleState: "open",
      closedAt: null,
      finalizeAfter: null,
      finalizedAt: null,
    }
    this.seasons.set(season.id, season)
    return { season_id: season.id, lifecycle_state: "open", activated: true }
  }

  private close(params: Record<string, unknown>): unknown {
    const season = this.seasons.get(String(params.p_season_id))
    if (!season) throw new Error("LEADERBOARD_SEASON_NOT_FOUND")
    const drainMinutes = Number(params.p_drain_minutes)
    if (!Number.isInteger(drainMinutes) || drainMinutes < 1 || drainMinutes > 1440) throw new Error("INVALID_LEADERBOARD_DRAIN")
    if (season.lifecycleState === "finalized") throw new Error("FINALIZED_SEASON_IMMUTABLE")
    if (season.lifecycleState === "closing") {
      return { season_id: season.id, lifecycle_state: "closing", closed_at: season.closedAt, finalize_after: season.finalizeAfter, changed: false }
    }
    season.lifecycleState = "closing"
    season.closedAt = new Date(this.now).toISOString()
    season.finalizeAfter = new Date(this.now + drainMinutes * 60_000).toISOString()
    return { season_id: season.id, lifecycle_state: "closing", closed_at: season.closedAt, finalize_after: season.finalizeAfter, changed: true }
  }

  private recover(): unknown {
    let seasonsRecovered = 0
    let snapshotsCreated = 0
    const blocked: Array<Record<string, string>> = []
    for (const season of [...this.seasons.values()].filter((row) => row.lifecycleState === "closing")) {
      if (season.finalizeAfter !== null && Date.parse(season.finalizeAfter) > this.now) {
        blocked.push({ season_id: season.id, slug: season.slug, reason: "SEASON_DRAIN_WINDOW_OPEN" })
        continue
      }
      if (this.pendingQuarantines.has(season.id)) {
        blocked.push({ season_id: season.id, slug: season.slug, reason: "PENDING_QUARANTINE_REVIEWS" })
        continue
      }
      const boards: Record<string, FakeEntry[]> = {}
      for (const board of ["master-outlaws", "peoples-champions", "clean-escapes", "rescuers", "swift-arrows"]) {
        boards[board] = structuredClone(this.entries.get(season.id) ?? [])
        snapshotsCreated += 1
      }
      this.snapshots.set(season.id, boards)
      season.lifecycleState = "finalized"
      season.finalizedAt = new Date(this.now).toISOString()
      seasonsRecovered += 1
    }
    return { seasons_recovered: seasonsRecovered, snapshots_created: snapshotsCreated, blocked }
  }

  private readRanked(params: Record<string, unknown>): unknown {
    const slug = String(params.p_season_slug)
    const season = [...this.seasons.values()].find((row) => row.slug === slug)
    if (!season) return { entries: [], pagination: { total: 0, limit: params.p_limit, offset: params.p_offset, has_next: false }, self: null }
    const kind = params.p_kind as "master-outlaws"
    const rows = this.entries.get(season.id) ?? []
    const page = rankAndPaginate(rows, kind, {
      limit: Number(params.p_limit),
      offset: Number(params.p_offset),
      filters: {
        characterId: params.p_character_id === null ? undefined : String(params.p_character_id),
        partySize: params.p_party_size === null ? undefined : Number(params.p_party_size),
        missionSlug: params.p_mission_slug === null ? undefined : String(params.p_mission_slug),
      },
    })
    const serialize = (ranked: (typeof page.entries)[number]): Record<string, unknown> => {
      const row = ranked.entry as FakeEntry
      return {
        id: row.id,
        player_name: row.playerName,
        character_id: row.characterId,
        score: row.score,
        grade: row.grade,
        mission_seconds: row.missionSeconds,
        delivered: row.delivered,
        verified: row.verified,
        created_at: row.createdAt,
        party_size: row.partySize,
        mission_slug: row.missionSlug,
        rescues: row.rescues,
        precision: row.precision,
        generosity: row.generosity,
        clean_escape: row.cleanEscape,
        rank: ranked.rank,
        is_tied: ranked.isTied,
        position: ranked.position,
      }
    }
    return {
      entries: page.entries.map(serialize),
      pagination: { total: page.pagination.total, limit: page.pagination.limit, offset: page.pagination.offset, has_next: page.pagination.hasNext },
      self: null,
    }
  }

  private status(params: Record<string, unknown>): unknown {
    const slugFilter = params.p_season_slug === null ? null : String(params.p_season_slug)
    return [...this.seasons.values()]
      .filter((season) => slugFilter === null || season.slug === slugFilter)
      .map((season) => ({
        id: season.id,
        slug: season.slug,
        name: season.name,
        lifecycle_state: season.lifecycleState,
        starts_at: season.startsAt,
        ends_at: season.endsAt,
        closed_at: season.closedAt,
        finalize_after: season.finalizeAfter,
        finalized_at: season.finalizedAt,
        entry_count: (this.entries.get(season.id) ?? []).length,
      }))
  }
}

const MINUTE = 60_000

function makeStores(): { backend: FakeLeaderboardBackend; lifecycle: SupabaseLeaderboardStore; ranked: SupabaseRankedLeaderboardStore } {
  const backend = new FakeLeaderboardBackend()
  return { backend, lifecycle: new SupabaseLeaderboardStore(backend), ranked: new SupabaseRankedLeaderboardStore(backend) }
}

async function openSeason(lifecycle: SupabaseLeaderboardStore, backend: FakeLeaderboardBackend, slug: string): Promise<string> {
  const result = await lifecycle.activateSeason({ slug, name: `Season ${slug}`, startsAt: backend.now, endsAt: backend.now + 90 * 24 * 60 * MINUTE })
  return result.seasonId
}

describe("season rollover lifecycle", () => {
  it("activation is idempotent and reports whether it changed anything", async () => {
    const { backend, lifecycle } = makeStores()
    const first = await lifecycle.activateSeason({ slug: "season-one", name: "Season One", startsAt: backend.now, endsAt: backend.now + MINUTE })
    const second = await lifecycle.activateSeason({ slug: "season-one", name: "Season One", startsAt: backend.now, endsAt: backend.now + MINUTE })
    expect(first).toMatchObject({ activated: true, lifecycleState: "open" })
    expect(second).toMatchObject({ activated: false, seasonId: first.seasonId })
  })

  it("closing is idempotent and preserves the original drain window", async () => {
    const { backend, lifecycle } = makeStores()
    const seasonId = await openSeason(lifecycle, backend, "season-one")
    const first = await lifecycle.closeSeason(seasonId, 30)
    backend.advance(10 * MINUTE)
    const second = await lifecycle.closeSeason(seasonId, 120)
    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(second.closedAt).toBe(first.closedAt)
    expect(second.finalizeAfter).toBe(first.finalizeAfter)
  })

  it("recovery respects the drain window, then finalizes exactly once", async () => {
    const { backend, lifecycle } = makeStores()
    const seasonId = await openSeason(lifecycle, backend, "season-one")
    backend.recordEntry("season-one", { id: "run-1", playerId: "p1", score: 9000, missionSeconds: 100, delivered: 100, rescues: 0, precision: 80, cleanEscape: false, characterId: "robin", partySize: 1, missionSlug: "peoples-purse" })
    await lifecycle.closeSeason(seasonId, 30)

    const early = await lifecycle.recoverSeasonDrain()
    expect(early.seasonsRecovered).toBe(0)
    expect(early.blocked).toEqual([{ seasonId, slug: "season-one", reason: "SEASON_DRAIN_WINDOW_OPEN" }])

    backend.advance(31 * MINUTE)
    const due = await lifecycle.recoverSeasonDrain()
    expect(due.seasonsRecovered).toBe(1)
    expect(due.snapshotsCreated).toBe(5)
    expect(due.blocked).toEqual([])

    const again = await lifecycle.recoverSeasonDrain()
    expect(again).toEqual({ seasonsRecovered: 0, snapshotsCreated: 0, blocked: [] })
    expect(backend.snapshots.get(seasonId)).toBeDefined()
  })

  it("recovery reports pending quarantine reviews instead of finalizing past them", async () => {
    const { backend, lifecycle } = makeStores()
    const seasonId = await openSeason(lifecycle, backend, "season-one")
    await lifecycle.closeSeason(seasonId, 30)
    backend.advance(31 * MINUTE)
    backend.pendingQuarantines.add(seasonId)

    const gated = await lifecycle.recoverSeasonDrain()
    expect(gated.seasonsRecovered).toBe(0)
    expect(gated.blocked).toEqual([{ seasonId, slug: "season-one", reason: "PENDING_QUARANTINE_REVIEWS" }])

    backend.pendingQuarantines.delete(seasonId)
    const cleared = await lifecycle.recoverSeasonDrain()
    expect(cleared.seasonsRecovered).toBe(1)
  })

  it("a finalized season cannot be reopened or closed again", async () => {
    const { backend, lifecycle } = makeStores()
    const seasonId = await openSeason(lifecycle, backend, "season-one")
    await lifecycle.closeSeason(seasonId, 30)
    backend.advance(31 * MINUTE)
    await lifecycle.recoverSeasonDrain()

    await expect(lifecycle.activateSeason({ slug: "season-one", name: "Season One", startsAt: backend.now, endsAt: backend.now + MINUTE }))
      .rejects.toThrow(/FINALIZED_SEASON_IMMUTABLE/)
    await expect(lifecycle.closeSeason(seasonId, 30)).rejects.toThrow(/FINALIZED_SEASON_IMMUTABLE/)
  })

  it("late events land during the drain window; post-finalization writes fail; exact replays stay idempotent", async () => {
    const { backend, lifecycle } = makeStores()
    const seasonId = await openSeason(lifecycle, backend, "season-one")
    backend.recordEntry("season-one", { id: "run-1", playerId: "p1", score: 9000, missionSeconds: 100, delivered: 100, rescues: 0, precision: 80, cleanEscape: false, characterId: "robin", partySize: 1, missionSlug: "peoples-purse" })
    await lifecycle.closeSeason(seasonId, 30)

    // In-flight run finishing inside the drain window still records.
    backend.advance(5 * MINUTE)
    expect(backend.recordEntry("season-one", { id: "run-late", playerId: "p2", score: 9500, missionSeconds: 90, delivered: 200, rescues: 1, precision: 90, cleanEscape: true, characterId: "marian", partySize: 1, missionSlug: "peoples-purse" })).toBe("run-late")

    backend.advance(26 * MINUTE)
    await lifecycle.recoverSeasonDrain()

    // New entries are rejected after finalization; replays return the original id.
    expect(() => backend.recordEntry("season-one", { id: "run-too-late", playerId: "p3", score: 100, missionSeconds: 500, delivered: 1, rescues: 0, precision: 10, cleanEscape: false, characterId: "much", partySize: 1, missionSlug: "peoples-purse" })).toThrow(/SEASON_FINALIZED/)
    expect(backend.recordEntry("season-one", { id: "run-late", verificationId: "verify-run-late", playerId: "p2", score: 9500, missionSeconds: 90, delivered: 200, rescues: 1, precision: 90, cleanEscape: true, characterId: "marian", partySize: 1, missionSlug: "peoples-purse" })).toBe("run-late")
  })

  it("closed-season responses remain unchanged after new current-season results", async () => {
    const { backend, lifecycle, ranked } = makeStores()
    const seasonId = await openSeason(lifecycle, backend, "season-one")
    for (let index = 0; index < 8; index += 1) {
      backend.recordEntry("season-one", { id: `run-${index}`, playerId: `p${index}`, score: 9000 - index * 250, missionSeconds: 100 + index, delivered: 50 * index, rescues: index % 3, precision: 60 + index, cleanEscape: index % 2 === 0, characterId: "robin", partySize: 1, missionSlug: "peoples-purse" })
    }
    await lifecycle.closeSeason(seasonId, 30)
    backend.advance(31 * MINUTE)
    await lifecycle.recoverSeasonDrain()

    const frozenBefore = await ranked.readRanked({ kind: "master-outlaws", seasonSlug: "season-one", limit: 50, offset: 0 })
    const cleanBefore = await ranked.readRanked({ kind: "clean-escapes", seasonSlug: "season-one", limit: 50, offset: 0 })

    // Roll over: successor season activates and receives new results.
    await openSeason(lifecycle, backend, "season-two")
    for (let index = 0; index < 5; index += 1) {
      backend.recordEntry("season-two", { id: `new-run-${index}`, playerId: `p${index}`, score: 9999 - index, missionSeconds: 80 + index, delivered: 500, rescues: 2, precision: 95, cleanEscape: true, characterId: "marian", partySize: 2, missionSlug: "silver-arrow" })
    }

    const frozenAfter = await ranked.readRanked({ kind: "master-outlaws", seasonSlug: "season-one", limit: 50, offset: 0 })
    const cleanAfter = await ranked.readRanked({ kind: "clean-escapes", seasonSlug: "season-one", limit: 50, offset: 0 })
    expect(JSON.stringify(frozenAfter)).toBe(JSON.stringify(frozenBefore))
    expect(JSON.stringify(cleanAfter)).toBe(JSON.stringify(cleanBefore))

    // And the successor ranks independently.
    const successor = await ranked.readRanked({ kind: "master-outlaws", seasonSlug: "season-two", limit: 50, offset: 0 })
    expect(successor.pagination.total).toBe(5)
    expect(successor.entries[0].id).toBe("new-run-0")

    const status = await ranked.getSeasonStatus()
    expect(status.find((row) => row.slug === "season-one")?.lifecycleState).toBe("finalized")
    expect(status.find((row) => row.slug === "season-two")?.lifecycleState).toBe("open")
  })

  it("surfaces backend errors as typed failures", async () => {
    const failing = new SupabaseLeaderboardStore({ rpc: async () => ({ data: null, error: { message: "boom" } }) } as RpcClient)
    await expect(failing.activateSeason({ slug: "s", name: "S", startsAt: 0, endsAt: 1 })).rejects.toThrow(/SEASON_ACTIVATE_FAILED/)
    await expect(failing.closeSeason("id", 30)).rejects.toThrow(/SEASON_CLOSE_FAILED/)
    await expect(failing.recoverSeasonDrain()).rejects.toThrow(/SEASON_RECOVER_FAILED/)
  })
})
