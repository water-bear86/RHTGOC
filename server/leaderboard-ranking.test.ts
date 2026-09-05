import { describe, expect, it } from "vitest"
import type { LeaderboardKind } from "./leaderboard-store"
import { applyFilters, compareEntries, rankAndPaginate, rankEntries, type RankableEntry } from "./leaderboard-ranking"

let counter = 0
function entry(overrides: Partial<RankableEntry> = {}): RankableEntry {
  counter += 1
  return {
    id: `e${String(counter).padStart(4, "0")}`,
    playerId: `p${counter}`,
    score: 5000,
    missionSeconds: 300,
    delivered: 100,
    rescues: 0,
    precision: 50,
    cleanEscape: false,
    characterId: "robin",
    partySize: 1,
    missionSlug: "peoples-purse",
    bandId: null,
    ...overrides,
  }
}

const ALL_KINDS: LeaderboardKind[] = ["master-outlaws", "peoples-champions", "clean-escapes", "rescuers", "swift-arrows"]

describe("board orderings (deterministic, per contract)", () => {
  it("master-outlaws: score desc, then mission_seconds asc, then id asc", () => {
    const a = entry({ id: "a", score: 9000, missionSeconds: 200 })
    const b = entry({ id: "b", score: 9000, missionSeconds: 100 })
    const c = entry({ id: "c", score: 9500, missionSeconds: 400 })
    const d = entry({ id: "d", score: 9000, missionSeconds: 100 })
    const ranked = rankEntries([a, b, c, d], "master-outlaws")
    expect(ranked.map((r) => r.entry.id)).toEqual(["c", "b", "d", "a"])
  })

  it("peoples-champions: delivered desc, then score desc, then id asc", () => {
    const a = entry({ id: "a", delivered: 500, score: 7000 })
    const b = entry({ id: "b", delivered: 800, score: 5000 })
    const c = entry({ id: "c", delivered: 500, score: 9000 })
    const ranked = rankEntries([a, b, c], "peoples-champions")
    expect(ranked.map((r) => r.entry.id)).toEqual(["b", "c", "a"])
  })

  it("clean-escapes: delivered desc, score desc, mission_seconds asc, id asc — clean runs only", () => {
    const a = entry({ id: "a", cleanEscape: true, delivered: 300, score: 8000, missionSeconds: 200 })
    const b = entry({ id: "b", cleanEscape: true, delivered: 300, score: 8000, missionSeconds: 150 })
    const dirty = entry({ id: "dirty", cleanEscape: false, delivered: 900, score: 9999 })
    const ranked = rankEntries(applyFilters([a, b, dirty], "clean-escapes"), "clean-escapes")
    expect(ranked.map((r) => r.entry.id)).toEqual(["b", "a"])
  })

  it("rescuers: rescues desc, then score desc, then id asc", () => {
    const a = entry({ id: "a", rescues: 2, score: 6000 })
    const b = entry({ id: "b", rescues: 5, score: 1000 })
    const c = entry({ id: "c", rescues: 2, score: 8000 })
    const ranked = rankEntries([a, b, c], "rescuers")
    expect(ranked.map((r) => r.entry.id)).toEqual(["b", "c", "a"])
  })

  it("swift-arrows: mission_seconds asc, score desc, precision desc, id asc", () => {
    const a = entry({ id: "a", missionSeconds: 100, score: 5000, precision: 80 })
    const b = entry({ id: "b", missionSeconds: 90, score: 2000, precision: 10 })
    const c = entry({ id: "c", missionSeconds: 100, score: 5000, precision: 95 })
    const d = entry({ id: "d", missionSeconds: 100, score: 7000, precision: 10 })
    const ranked = rankEntries([a, b, c, d], "swift-arrows")
    expect(ranked.map((r) => r.entry.id)).toEqual(["b", "d", "c", "a"])
  })

  it("every board's comparator is total and antisymmetric on the id tie-break", () => {
    const x = entry({ id: "x" })
    const y = entry({ id: "y" })
    for (const kind of ALL_KINDS) {
      expect(compareEntries(kind, x, y)).toBeLessThan(0)
      expect(compareEntries(kind, y, x)).toBeGreaterThan(0)
      expect(compareEntries(kind, x, { ...x })).toBe(0)
    }
  })

  it("ordering is insensitive to input permutation", () => {
    const entries = [
      entry({ id: "a", score: 9000, missionSeconds: 100 }),
      entry({ id: "b", score: 9000, missionSeconds: 100 }),
      entry({ id: "c", score: 8000, missionSeconds: 50 }),
      entry({ id: "d", score: 9500, missionSeconds: 900 }),
    ]
    const forward = rankEntries(entries, "master-outlaws").map((r) => r.entry.id)
    const backward = rankEntries([...entries].reverse(), "master-outlaws").map((r) => r.entry.id)
    expect(backward).toEqual(forward)
  })
})

describe("ties and competition ranking", () => {
  it("tied entries share a rank and the next distinct entry skips past the group", () => {
    const ranked = rankEntries([
      entry({ id: "a", score: 9000, missionSeconds: 100 }),
      entry({ id: "b", score: 9000, missionSeconds: 100 }),
      entry({ id: "c", score: 9000, missionSeconds: 100 }),
      entry({ id: "d", score: 8000, missionSeconds: 100 }),
    ], "master-outlaws")
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 1, 4])
    expect(ranked.map((r) => r.isTied)).toEqual([true, true, true, false])
    expect(ranked.map((r) => r.position)).toEqual([1, 2, 3, 4])
  })

  it("a tie on the primary key alone is broken by the secondary key, not reported as a tie", () => {
    const ranked = rankEntries([
      entry({ id: "a", score: 9000, missionSeconds: 200 }),
      entry({ id: "b", score: 9000, missionSeconds: 100 }),
    ], "master-outlaws")
    expect(ranked.map((r) => r.entry.id)).toEqual(["b", "a"])
    expect(ranked.map((r) => r.rank)).toEqual([1, 2])
    expect(ranked.every((r) => !r.isTied)).toBe(true)
  })

  it("swift-arrows ties require all three keys equal", () => {
    const ranked = rankEntries([
      entry({ id: "a", missionSeconds: 100, score: 5000, precision: 90 }),
      entry({ id: "b", missionSeconds: 100, score: 5000, precision: 90 }),
      entry({ id: "c", missionSeconds: 100, score: 5000, precision: 80 }),
    ], "swift-arrows")
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3])
    expect(ranked.map((r) => r.isTied)).toEqual([true, true, false])
  })
})

describe("filters and combinations", () => {
  const pool = [
    entry({ id: "a", playerId: "p-a", characterId: "robin", partySize: 1, missionSlug: "peoples-purse", bandId: "band-1", score: 9000 }),
    entry({ id: "b", playerId: "p-b", characterId: "marian", partySize: 2, missionSlug: "peoples-purse", bandId: "band-1", score: 8000 }),
    entry({ id: "c", playerId: "p-c", characterId: "robin", partySize: 2, missionSlug: "silver-arrow", bandId: null, score: 7000 }),
    entry({ id: "d", playerId: "p-d", characterId: "much", partySize: 2, missionSlug: "peoples-purse", bandId: "band-2", score: 6000, cleanEscape: true }),
  ]

  it("filters by character", () => {
    expect(applyFilters(pool, "master-outlaws", { characterId: "robin" }).map((e) => e.id)).toEqual(["a", "c"])
  })

  it("filters by party size", () => {
    expect(applyFilters(pool, "master-outlaws", { partySize: 2 }).map((e) => e.id)).toEqual(["b", "c", "d"])
  })

  it("filters by mission", () => {
    expect(applyFilters(pool, "master-outlaws", { missionSlug: "silver-arrow" }).map((e) => e.id)).toEqual(["c"])
  })

  it("filters by band scope", () => {
    expect(applyFilters(pool, "master-outlaws", { bandId: "band-1" }).map((e) => e.id)).toEqual(["a", "b"])
  })

  it("filters by friends scope (player ids)", () => {
    expect(applyFilters(pool, "master-outlaws", { playerIds: ["p-b", "p-d"] }).map((e) => e.id)).toEqual(["b", "d"])
  })

  it("combines character + party + mission filters", () => {
    const filtered = applyFilters(pool, "master-outlaws", { characterId: "marian", partySize: 2, missionSlug: "peoples-purse" })
    expect(filtered.map((e) => e.id)).toEqual(["b"])
  })

  it("combines the clean-escape board scope with other filters", () => {
    const filtered = applyFilters(pool, "clean-escapes", { partySize: 2, missionSlug: "peoples-purse" })
    expect(filtered.map((e) => e.id)).toEqual(["d"])
  })

  it("combined filters that match nothing produce an empty board, not an error", () => {
    const page = rankAndPaginate(pool, "master-outlaws", { filters: { characterId: "little-john", partySize: 4 } })
    expect(page.entries).toEqual([])
    expect(page.pagination).toEqual({ total: 0, limit: 50, offset: 0, hasNext: false })
    expect(page.self).toBeNull()
  })
})

describe("pagination", () => {
  const pool = Array.from({ length: 25 }, (_, index) =>
    entry({ id: `id-${String(index).padStart(2, "0")}`, playerId: `player-${index}`, score: 9000 - index * 100 }))

  it("pages are stable, contiguous, and non-overlapping across offsets", () => {
    const first = rankAndPaginate(pool, "master-outlaws", { limit: 10, offset: 0 })
    const second = rankAndPaginate(pool, "master-outlaws", { limit: 10, offset: 10 })
    const third = rankAndPaginate(pool, "master-outlaws", { limit: 10, offset: 20 })
    const ids = [...first.entries, ...second.entries, ...third.entries].map((r) => r.entry.id)
    expect(new Set(ids).size).toBe(25)
    expect(first.pagination).toEqual({ total: 25, limit: 10, offset: 0, hasNext: true })
    expect(second.pagination.hasNext).toBe(true)
    expect(third.entries).toHaveLength(5)
    expect(third.pagination.hasNext).toBe(false)
    expect(third.entries[4].position).toBe(25)
  })

  it("positions stay unique and sequential even when every entry is tied", () => {
    const tied = Array.from({ length: 6 }, (_, index) => entry({ id: `t-${index}`, score: 9000, missionSeconds: 100 }))
    const first = rankAndPaginate(tied, "master-outlaws", { limit: 3, offset: 0 })
    const second = rankAndPaginate(tied, "master-outlaws", { limit: 3, offset: 3 })
    expect(first.entries.map((r) => r.position)).toEqual([1, 2, 3])
    expect(second.entries.map((r) => r.position)).toEqual([4, 5, 6])
    expect([...first.entries, ...second.entries].every((r) => r.rank === 1 && r.isTied)).toBe(true)
    const ids = [...first.entries, ...second.entries].map((r) => r.entry.id)
    expect(new Set(ids).size).toBe(6)
  })

  it("an offset beyond the total yields an empty page with correct metadata", () => {
    const page = rankAndPaginate(pool, "master-outlaws", { limit: 10, offset: 100 })
    expect(page.entries).toEqual([])
    expect(page.pagination).toEqual({ total: 25, limit: 10, offset: 100, hasNext: false })
  })

  it("empty input yields an empty first page", () => {
    const page = rankAndPaginate([], "rescuers", { limit: 50, offset: 0 })
    expect(page.entries).toEqual([])
    expect(page.pagination).toEqual({ total: 0, limit: 50, offset: 0, hasNext: false })
  })
})

describe("viewer's nearby rank (self)", () => {
  it("returns the viewer's ranked row even when it is outside the requested page", () => {
    const pool = Array.from({ length: 30 }, (_, index) =>
      entry({ id: `id-${String(index).padStart(2, "0")}`, playerId: `player-${index}`, score: 9000 - index * 100 }))
    const page = rankAndPaginate(pool, "master-outlaws", { limit: 10, offset: 0, viewerPlayerId: "player-25" })
    expect(page.entries.some((r) => r.entry.playerId === "player-25")).toBe(false)
    expect(page.self).not.toBeNull()
    expect(page.self!.rank).toBe(26)
    expect(page.self!.position).toBe(26)
  })

  it("returns null self for a viewer with no entry on the filtered board", () => {
    const pool = [entry({ playerId: "someone-else" })]
    const page = rankAndPaginate(pool, "master-outlaws", { viewerPlayerId: "viewer-without-entry" })
    expect(page.self).toBeNull()
  })

  it("self respects active filters", () => {
    const pool = [
      entry({ id: "a", playerId: "viewer", characterId: "robin", score: 9000 }),
      entry({ id: "b", playerId: "viewer", characterId: "marian", score: 8000 }),
      entry({ id: "c", playerId: "rival", characterId: "marian", score: 9500 }),
    ]
    const page = rankAndPaginate(pool, "master-outlaws", { viewerPlayerId: "viewer", filters: { characterId: "marian" } })
    expect(page.self).not.toBeNull()
    expect(page.self!.entry.id).toBe("b")
    expect(page.self!.rank).toBe(2)
  })
})
