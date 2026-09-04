import type { LeaderboardKind } from "./leaderboard-store"

/**
 * Pure reference implementation of the canonical ranking contract in
 * docs/design/leaderboard-contracts.md. The SQL in
 * supabase/migrations/20260904015500_enhance_leaderboard_rankings.sql encodes
 * the exact same sort-key tuples; leaderboard-ranking.test.ts pins the
 * semantics (deterministic order, ties, rank skipping, pagination stability,
 * filter combinations) against this module, and
 * enhanced-leaderboard-contract.test.ts pins the SQL to the same keys.
 */

export interface RankableEntry {
  id: string
  playerId?: string
  score: number
  missionSeconds: number
  delivered: number
  rescues: number
  precision: number
  cleanEscape: boolean
  characterId?: string
  partySize?: number
  missionSlug?: string
  bandId?: string | null
}

export interface RankedEntry<T extends RankableEntry = RankableEntry> {
  entry: T
  rank: number
  isTied: boolean
  position: number
}

export interface RankingFilters {
  characterId?: string
  partySize?: number
  missionSlug?: string
  bandId?: string
  playerIds?: string[]
}

export interface RankedPage<T extends RankableEntry = RankableEntry> {
  entries: RankedEntry<T>[]
  pagination: { total: number; limit: number; offset: number; hasNext: boolean }
  self: RankedEntry<T> | null
}

/**
 * Per-board sort key tuple. Lower tuples sort first; the SQL uses the same
 * three keys (sort_a, sort_b, sort_c) followed by the id tie-break. Two
 * entries are tied exactly when all three keys are equal.
 */
export function sortKeys(kind: LeaderboardKind, entry: RankableEntry): [number, number, number] {
  switch (kind) {
    case "master-outlaws":
      return [-entry.score, entry.missionSeconds, 0]
    case "peoples-champions":
      return [-entry.delivered, -entry.score, 0]
    case "clean-escapes":
      return [-entry.delivered, -entry.score, entry.missionSeconds]
    case "rescuers":
      return [-entry.rescues, -entry.score, 0]
    case "swift-arrows":
      return [entry.missionSeconds, -entry.score, -entry.precision]
  }
}

export function compareEntries(kind: LeaderboardKind, a: RankableEntry, b: RankableEntry): number {
  const ka = sortKeys(kind, a)
  const kb = sortKeys(kind, b)
  for (let index = 0; index < 3; index += 1) {
    if (ka[index] !== kb[index]) return ka[index] - kb[index]
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function applyFilters<T extends RankableEntry>(entries: T[], kind: LeaderboardKind, filters: RankingFilters = {}): T[] {
  const included = filters.playerIds ? new Set(filters.playerIds) : null
  return entries.filter((entry) => {
    if (kind === "clean-escapes" && !entry.cleanEscape) return false
    if (filters.characterId && entry.characterId !== filters.characterId) return false
    if (filters.partySize !== undefined && entry.partySize !== filters.partySize) return false
    if (filters.missionSlug && entry.missionSlug !== filters.missionSlug) return false
    if (filters.bandId && entry.bandId !== filters.bandId) return false
    if (included && (!entry.playerId || !included.has(entry.playerId))) return false
    return true
  })
}

/**
 * Deterministically orders entries and assigns competition ranks (ties share
 * a rank; the following distinct entry skips past the tied group, i.e.
 * 1, 1, 3). `position` is the absolute 1-based row number used for offset
 * pagination, unique even among tied entries thanks to the id tie-break.
 */
export function rankEntries<T extends RankableEntry>(entries: T[], kind: LeaderboardKind): RankedEntry<T>[] {
  const sorted = [...entries].sort((a, b) => compareEntries(kind, a, b))
  const ranked: RankedEntry<T>[] = []
  for (let index = 0; index < sorted.length; index += 1) {
    const previous = index > 0 ? sorted[index - 1] : null
    const tiedWithPrevious = previous !== null && keysEqual(kind, previous, sorted[index])
    const rank = tiedWithPrevious ? ranked[index - 1].rank : index + 1
    ranked.push({ entry: sorted[index], rank, isTied: false, position: index + 1 })
  }
  for (let index = 0; index < ranked.length; index += 1) {
    const prevTied = index > 0 && ranked[index - 1].rank === ranked[index].rank
    const nextTied = index < ranked.length - 1 && ranked[index + 1].rank === ranked[index].rank
    ranked[index].isTied = prevTied || nextTied
  }
  return ranked
}

function keysEqual(kind: LeaderboardKind, a: RankableEntry, b: RankableEntry): boolean {
  const ka = sortKeys(kind, a)
  const kb = sortKeys(kind, b)
  return ka[0] === kb[0] && ka[1] === kb[1] && ka[2] === kb[2]
}

/**
 * Offset pagination over the full ranked ordering, plus the viewer's best
 * ranked entry regardless of page (the "nearby rank" affordance). Mirrors the
 * read_leaderboard_ranked response shape.
 */
export function rankAndPaginate<T extends RankableEntry>(
  entries: T[],
  kind: LeaderboardKind,
  options: { limit?: number; offset?: number; viewerPlayerId?: string; filters?: RankingFilters } = {},
): RankedPage<T> {
  const limit = options.limit ?? 50
  const offset = options.offset ?? 0
  const ranked = rankEntries(applyFilters(entries, kind, options.filters ?? {}), kind)
  const page = ranked.slice(offset, offset + limit)
  const self = options.viewerPlayerId
    ? ranked.find((row) => row.entry.playerId === options.viewerPlayerId) ?? null
    : null
  return {
    entries: page,
    pagination: { total: ranked.length, limit, offset, hasNext: offset + limit < ranked.length },
    self,
  }
}
