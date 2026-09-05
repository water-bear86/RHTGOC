import type { LeaderboardRankedEntry, LeaderboardPagination } from "./ranked-leaderboard-store"

export interface CachedLeaderboardPage {
  entries: LeaderboardRankedEntry[]
  pagination: LeaderboardPagination
  cachedAt: number
}

export interface CacheKeyInput {
  kind?: string
  seasonSlug?: string
  characterId?: string | null
  partySize?: number | null
  missionSlug?: string | null
  bandId?: string | null
  playerIds?: string[] | null
  limit?: number
  offset?: number
}

/**
 * A page is cacheable only when it is viewer-independent: no friend scope, no
 * band scope, and no per-viewer `self` row baked in. Viewer-scoped reads go
 * straight to the database where authorization is enforced per request;
 * caching them could leak one viewer's page to another.
 */
export function cacheable(filters: CacheKeyInput): boolean {
  if (filters.bandId) return false
  if (filters.playerIds && filters.playerIds.length > 0) return false
  return true
}

/**
 * Small in-memory TTL cache for global leaderboard pages. Correctness under
 * invalidation:
 * - Current-season pages expire within `ttlMs`, so a new verified entry is
 *   visible everywhere within one TTL; ordering within a page is always a
 *   consistent database snapshot (never merged across reads).
 * - Lifecycle transitions (activate/close/recover/finalize) call
 *   `invalidateAll`, so rollover is visible immediately.
 * - Finalized seasons are immutable by trigger, so serving them from cache is
 *   always correct; TTL only costs an occasional re-read.
 */
export class LeaderboardCache {
  private readonly pages = new Map<string, CachedLeaderboardPage>()

  constructor(
    private readonly ttlMs: number = 15_000,
    private readonly maxEntries: number = 200,
  ) {}

  get(filters: CacheKeyInput): CachedLeaderboardPage | null {
    const key = cacheKey(filters)
    const page = this.pages.get(key)
    if (!page) return null
    if (Date.now() - page.cachedAt > this.ttlMs) {
      this.pages.delete(key)
      return null
    }
    return page
  }

  set(filters: CacheKeyInput, page: Omit<CachedLeaderboardPage, "cachedAt">): void {
    if (!cacheable(filters)) return
    if (this.pages.size >= this.maxEntries) this.evictOldest()
    this.pages.set(cacheKey(filters), { ...page, cachedAt: Date.now() })
  }

  invalidateSeason(seasonSlug: string): void {
    const marker = `:season:${encodeURIComponent(seasonSlug)}:`
    for (const key of this.pages.keys()) {
      if (key.includes(marker)) this.pages.delete(key)
    }
  }

  invalidateAll(): void {
    this.pages.clear()
  }

  get size(): number {
    return this.pages.size
  }

  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestAt = Infinity
    for (const [key, page] of this.pages) {
      if (page.cachedAt < oldestAt) {
        oldestAt = page.cachedAt
        oldestKey = key
      }
    }
    if (oldestKey) this.pages.delete(oldestKey)
  }
}

function cacheKey(filters: CacheKeyInput): string {
  return [
    "kind", encodeURIComponent(filters.kind ?? "master-outlaws"),
    "season", encodeURIComponent(filters.seasonSlug ?? "season-zero"),
    "char", encodeURIComponent(filters.characterId ?? ""),
    "party", filters.partySize ?? "",
    "mission", encodeURIComponent(filters.missionSlug ?? ""),
    "limit", filters.limit ?? 50,
    "offset", filters.offset ?? 0,
  ].join(":")
}
