import { createClient } from "@supabase/supabase-js"
import type { RpcClient } from "./band-store"
import { LEADERBOARD_KINDS, type LeaderboardEntry, type LeaderboardFilters, type LeaderboardKind } from "./leaderboard-store"

export interface LeaderboardPagination {
  total: number
  limit: number
  offset: number
  hasNext: boolean
}

export interface LeaderboardRankedEntry extends LeaderboardEntry {
  rank: number
  isTied: boolean
  position: number
}

export interface LeaderboardRankedResult {
  entries: LeaderboardRankedEntry[]
  pagination: LeaderboardPagination
  self: LeaderboardRankedEntry | null
}

export interface RankedReadOptions extends LeaderboardFilters {
  limit?: number
  offset?: number
}

export interface LeaderboardSeasonStatus {
  id: string
  slug: string
  name: string
  lifecycleState: "open" | "closing" | "finalized"
  startsAt: string
  endsAt: string
  closedAt: string | null
  finalizeAfter: string | null
  finalizedAt: string | null
  entryCount: number
}

export function isLeaderboardKind(value: string): value is LeaderboardKind {
  return (LEADERBOARD_KINDS as readonly string[]).includes(value)
}

export class SupabaseRankedLeaderboardStore {
  constructor(private readonly client: RpcClient) {}

  async readRanked(filters: RankedReadOptions): Promise<LeaderboardRankedResult> {
    const limit = filters.limit ?? 50
    const offset = filters.offset ?? 0

    const { data, error } = await this.client.rpc("read_leaderboard_ranked", {
      p_kind: filters.kind ?? "master-outlaws",
      p_season_slug: filters.seasonSlug ?? "season-zero",
      p_character_id: filters.characterId ?? null,
      p_party_size: filters.partySize ?? null,
      p_mission_slug: filters.missionSlug ?? null,
      p_band_id: filters.bandId ?? null,
      p_player_ids: filters.playerIds ?? null,
      p_limit: limit,
      p_offset: offset,
    })

    if (error || !data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`RANKED_LEADERBOARD_READ_FAILED: ${error?.message ?? "invalid response"}`)
    }

    const value = data as Record<string, unknown>
    const rawEntries = Array.isArray(value.entries) ? value.entries : []
    const rawPagination = (value.pagination && typeof value.pagination === "object" ? value.pagination : {}) as Record<string, unknown>

    const entries = rawEntries.flatMap((row: unknown) => {
      const mapped = mapRankedRow(row)
      return mapped ? [mapped] : []
    })

    return {
      entries,
      pagination: {
        total: typeof rawPagination.total === "number" ? rawPagination.total : 0,
        limit: typeof rawPagination.limit === "number" ? rawPagination.limit : limit,
        offset: typeof rawPagination.offset === "number" ? rawPagination.offset : offset,
        hasNext: rawPagination.has_next === true,
      },
      self: mapRankedRow(value.self),
    }
  }

  async getSeasonStatus(seasonSlug?: string): Promise<LeaderboardSeasonStatus[]> {
    const { data, error } = await this.client.rpc("get_leaderboard_season_status", {
      p_season_slug: seasonSlug ?? null,
    })
    if (error || !Array.isArray(data)) {
      throw new Error(`SEASON_STATUS_FAILED: ${error?.message ?? "invalid response"}`)
    }
    return data.flatMap((row: unknown) => {
      if (!row || typeof row !== "object") return []
      const r = row as Record<string, unknown>
      if (typeof r.id !== "string" || typeof r.slug !== "string") return []
      if (r.lifecycle_state !== "open" && r.lifecycle_state !== "closing" && r.lifecycle_state !== "finalized") return []
      return [{
        id: r.id,
        slug: r.slug,
        name: typeof r.name === "string" ? r.name : "",
        lifecycleState: r.lifecycle_state,
        startsAt: typeof r.starts_at === "string" ? r.starts_at : "",
        endsAt: typeof r.ends_at === "string" ? r.ends_at : "",
        closedAt: typeof r.closed_at === "string" ? r.closed_at : null,
        finalizeAfter: typeof r.finalize_after === "string" ? r.finalize_after : null,
        finalizedAt: typeof r.finalized_at === "string" ? r.finalized_at : null,
        entryCount: typeof r.entry_count === "number" ? r.entry_count : 0,
      }]
    })
  }
}

function mapRankedRow(row: unknown): LeaderboardRankedEntry | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null
  const entry = row as Record<string, unknown>
  if (
    typeof entry.id !== "string" ||
    typeof entry.player_name !== "string" ||
    typeof entry.character_id !== "string" ||
    typeof entry.score !== "number" ||
    typeof entry.grade !== "string" ||
    typeof entry.mission_seconds !== "number" ||
    typeof entry.delivered !== "number" ||
    typeof entry.rank !== "number" ||
    typeof entry.position !== "number"
  ) return null
  return {
    id: entry.id,
    playerName: entry.player_name,
    characterId: entry.character_id as LeaderboardRankedEntry["characterId"],
    score: entry.score,
    grade: entry.grade as LeaderboardRankedEntry["grade"],
    missionSeconds: entry.mission_seconds,
    delivered: entry.delivered,
    verified: entry.verified === true,
    createdAt: typeof entry.created_at === "string" ? entry.created_at : "",
    partySize: typeof entry.party_size === "number" ? entry.party_size : undefined,
    missionSlug: typeof entry.mission_slug === "string" ? entry.mission_slug : undefined,
    rescues: typeof entry.rescues === "number" ? entry.rescues : undefined,
    precision: typeof entry.precision === "number" ? entry.precision : undefined,
    generosity: typeof entry.generosity === "number" ? entry.generosity : undefined,
    cleanEscape: entry.clean_escape === true,
    rank: entry.rank,
    isTied: entry.is_tied === true,
    position: entry.position,
  }
}

export function createRankedLeaderboardStoreFromEnv(): SupabaseRankedLeaderboardStore | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) return null
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return new SupabaseRankedLeaderboardStore(client as unknown as RpcClient)
}
