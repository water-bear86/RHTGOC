import { describe, expect, it } from "vitest"
import { cacheable, LeaderboardCache } from "./leaderboard-cache"
import type { LeaderboardPagination, LeaderboardRankedEntry } from "./ranked-leaderboard-store"

function page(total = 0): { entries: LeaderboardRankedEntry[]; pagination: LeaderboardPagination } {
  return { entries: [], pagination: { total, limit: 50, offset: 0, hasNext: false } }
}

describe("leaderboard cache", () => {
  it("returns null on a cache miss", () => {
    const cache = new LeaderboardCache()
    expect(cache.get({ kind: "master-outlaws", seasonSlug: "season-zero" })).toBeNull()
  })

  it("returns a cached page within TTL", () => {
    const cache = new LeaderboardCache(15_000)
    cache.set({ kind: "master-outlaws", seasonSlug: "season-zero", limit: 50, offset: 0 }, page(7))
    const hit = cache.get({ kind: "master-outlaws", seasonSlug: "season-zero", limit: 50, offset: 0 })
    expect(hit).not.toBeNull()
    expect(hit!.pagination.total).toBe(7)
  })

  it("expires pages past TTL", async () => {
    const cache = new LeaderboardCache(1)
    cache.set({ kind: "master-outlaws", seasonSlug: "season-zero", limit: 50, offset: 0 }, page())
    expect(cache.size).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 5))
    expect(cache.get({ kind: "master-outlaws", seasonSlug: "season-zero", limit: 50, offset: 0 })).toBeNull()
  })

  it("never caches viewer-scoped reads (band or friends)", () => {
    const cache = new LeaderboardCache()
    expect(cacheable({ kind: "master-outlaws", bandId: "band-1" })).toBe(false)
    expect(cacheable({ kind: "master-outlaws", playerIds: ["p1"] })).toBe(false)
    expect(cacheable({ kind: "master-outlaws", playerIds: [] })).toBe(true)
    expect(cacheable({ kind: "master-outlaws" })).toBe(true)
    cache.set({ kind: "master-outlaws", seasonSlug: "season-zero", bandId: "band-1" }, page())
    cache.set({ kind: "master-outlaws", seasonSlug: "season-zero", playerIds: ["p1"] }, page())
    expect(cache.size).toBe(0)
  })

  it("invalidates all pages for a season", () => {
    const cache = new LeaderboardCache()
    cache.set({ kind: "master-outlaws", seasonSlug: "season-zero", limit: 50, offset: 0 }, page())
    cache.set({ kind: "peoples-champions", seasonSlug: "season-zero", limit: 50, offset: 0 }, page())
    cache.set({ kind: "master-outlaws", seasonSlug: "season-one", limit: 50, offset: 0 }, page())
    cache.invalidateSeason("season-zero")
    expect(cache.size).toBe(1)
    expect(cache.get({ kind: "master-outlaws", seasonSlug: "season-one", limit: 50, offset: 0 })).not.toBeNull()
  })

  it("does not cross-invalidate seasons sharing a prefix", () => {
    const cache = new LeaderboardCache()
    cache.set({ kind: "master-outlaws", seasonSlug: "season-one", limit: 50, offset: 0 }, page())
    cache.set({ kind: "master-outlaws", seasonSlug: "season-one-redux", limit: 50, offset: 0 }, page())
    cache.invalidateSeason("season-one")
    expect(cache.size).toBe(1)
    expect(cache.get({ kind: "master-outlaws", seasonSlug: "season-one-redux", limit: 50, offset: 0 })).not.toBeNull()
  })

  it("invalidates everything on rollover", () => {
    const cache = new LeaderboardCache()
    cache.set({ kind: "master-outlaws", seasonSlug: "season-zero", limit: 50, offset: 0 }, page())
    cache.set({ kind: "master-outlaws", seasonSlug: "season-one", limit: 50, offset: 0 }, page())
    cache.invalidateAll()
    expect(cache.size).toBe(0)
  })

  it("evicts oldest when max entries exceeded", () => {
    const cache = new LeaderboardCache(15_000, 3)
    for (const slug of ["s1", "s2", "s3", "s4"]) {
      cache.set({ kind: "master-outlaws", seasonSlug: slug, limit: 50, offset: 0 }, page())
    }
    expect(cache.size).toBe(3)
  })

  it("keys different filters separately", () => {
    const cache = new LeaderboardCache()
    cache.set({ kind: "master-outlaws", seasonSlug: "season-zero", characterId: "robin", limit: 50, offset: 0 }, page())
    cache.set({ kind: "master-outlaws", seasonSlug: "season-zero", characterId: "marian", limit: 50, offset: 0 }, page())
    cache.set({ kind: "master-outlaws", seasonSlug: "season-zero", characterId: "robin", limit: 50, offset: 50 }, page())
    cache.set({ kind: "swift-arrows", seasonSlug: "season-zero", missionSlug: "peoples-purse", partySize: 2, limit: 50, offset: 0 }, page())
    expect(cache.size).toBe(4)
  })
})
