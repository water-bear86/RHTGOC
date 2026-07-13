import type { CharacterId, MasteryResult } from "./simulation"
import { getSupabase } from "./supabase"

export interface LeaderboardEntry {
  id: string
  playerId?: string
  playerName: string
  characterId: CharacterId
  score: number
  grade: MasteryResult["grade"]
  missionSeconds: number
  delivered: number
  verified: boolean
  createdAt: string
  partySize?: number
  missionSlug?: string
  bandId?: string | null
  rescues?: number
  precision?: number
  generosity?: number
  cleanEscape?: boolean
  verificationId?: string | null
  missionVersion?: string
  missionContentHash?: string
  missionStartedAt?: string
  suspicious?: boolean
}

export type LeaderboardKind = "master-outlaws" | "peoples-champions" | "clean-escapes" | "rescuers" | "swift-arrows"

export interface LeaderboardFilters {
  kind?: LeaderboardKind
  seasonSlug?: string
  characterId?: CharacterId
  partySize?: number
  missionSlug?: string
  bandId?: string
  playerIds?: string[]
  excludedPlayerIds?: string[]
}

export interface LeaderboardSeason { slug: string; name: string }

const STORAGE_KEY = "sherwood-rebellion:leaderboard:v1"

const exampleEntries: LeaderboardEntry[] = [
  { id: "seed-1", playerName: "Oakheart", characterId: "marian", score: 8240, grade: "S", missionSeconds: 92, delivered: 360, verified: false, createdAt: "2026-07-10T00:00:00.000Z" },
  { id: "seed-2", playerName: "Greenmantle", characterId: "robin", score: 7710, grade: "A", missionSeconds: 118, delivered: 360, verified: false, createdAt: "2026-07-10T00:00:00.000Z" },
  { id: "seed-3", playerName: "Foxglove", characterId: "marian", score: 6980, grade: "B", missionSeconds: 147, delivered: 360, verified: false, createdAt: "2026-07-10T00:00:00.000Z" },
]

function localEntries(): LeaderboardEntry[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) as LeaderboardEntry[] : exampleEntries
  } catch {
    return exampleEntries
  }
}

function saveLocal(entries: LeaderboardEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 50)))
}

function mapLeaderboardRow(entry: Record<string, unknown>): LeaderboardEntry | null {
  if (
    typeof entry.id !== "string"
    || typeof entry.player_name !== "string"
    || typeof entry.character_id !== "string"
    || typeof entry.score !== "number"
    || typeof entry.grade !== "string"
    || typeof entry.mission_seconds !== "number"
    || typeof entry.delivered !== "number"
  ) return null
  return {
    id: entry.id,
    playerId: typeof entry.player_id === "string" ? entry.player_id : undefined,
    playerName: entry.player_name,
    characterId: entry.character_id as CharacterId,
    score: entry.score,
    grade: entry.grade as MasteryResult["grade"],
    missionSeconds: entry.mission_seconds,
    delivered: entry.delivered,
    verified: entry.verified === true,
    createdAt: typeof entry.created_at === "string" ? entry.created_at : "",
    partySize: typeof entry.party_size === "number" ? entry.party_size : undefined,
    missionSlug: typeof entry.mission_slug === "string" ? entry.mission_slug : undefined,
    bandId: typeof entry.band_id === "string" ? entry.band_id : null,
    rescues: typeof entry.rescues === "number" ? entry.rescues : undefined,
    precision: typeof entry.precision === "number" ? entry.precision : undefined,
    generosity: typeof entry.generosity === "number" ? entry.generosity : undefined,
    cleanEscape: entry.clean_escape === true,
    verificationId: typeof entry.verification_id === "string" ? entry.verification_id : null,
    missionVersion: typeof entry.mission_version === "string" ? entry.mission_version : undefined,
    missionContentHash: typeof entry.mission_content_hash === "string" ? entry.mission_content_hash : undefined,
    missionStartedAt: typeof entry.mission_started_at === "string" ? entry.mission_started_at : undefined,
    suspicious: entry.suspicious === true,
  }
}

export function filterAndSortLeaderboardEntries(entries: LeaderboardEntry[], filters: LeaderboardFilters = {}): LeaderboardEntry[] {
  const excluded = new Set(filters.excludedPlayerIds ?? [])
  const included = filters.playerIds ? new Set(filters.playerIds) : null
  return sortEntries(entries.filter((entry) => {
    if (entry.playerId && excluded.has(entry.playerId)) return false
    if (included && (!entry.playerId || !included.has(entry.playerId))) return false
    if (filters.characterId && entry.characterId !== filters.characterId) return false
    if (filters.partySize && entry.partySize !== filters.partySize) return false
    if (filters.missionSlug && entry.missionSlug !== filters.missionSlug) return false
    if (filters.bandId && entry.bandId !== filters.bandId) return false
    if ((filters.kind ?? "master-outlaws") === "clean-escapes" && !entry.cleanEscape) return false
    return true
  }), filters.kind ?? "master-outlaws")
}

export async function loadLeaderboard(filters: LeaderboardFilters = {}): Promise<{ entries: LeaderboardEntry[]; global: boolean }> {
  const supabase = getSupabase()
  const kind = filters.kind ?? "master-outlaws"
  if (filters.playerIds && filters.playerIds.length === 0) return { entries: [], global: true }
  if (!supabase) return { entries: sortEntries(localEntries(), kind), global: false }
  try {
    const { data, error } = await supabase.rpc("read_leaderboard", {
      p_kind: kind,
      p_season_slug: filters.seasonSlug ?? "season-zero",
      ...(filters.characterId ? { p_character_id: filters.characterId } : {}),
      ...(filters.partySize ? { p_party_size: filters.partySize } : {}),
      ...(filters.missionSlug ? { p_mission_slug: filters.missionSlug } : {}),
      ...(filters.bandId ? { p_band_id: filters.bandId } : {}),
      ...(filters.playerIds ? { p_player_ids: filters.playerIds } : {}),
    })
    if (error || !Array.isArray(data)) throw error ?? new Error("INVALID_LEADERBOARD_RESPONSE")
    const entries = data.flatMap((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return []
      const mapped = mapLeaderboardRow(entry as unknown as Record<string, unknown>)
      return mapped ? [mapped] : []
    })
    return { entries: filterAndSortLeaderboardEntries(entries, {
      kind,
      characterId: filters.characterId,
      partySize: filters.partySize,
      missionSlug: filters.missionSlug,
    }).slice(0, 50), global: true }
  } catch {
    return { entries: sortEntries(localEntries(), kind), global: false }
  }
}

export async function loadLeaderboardSeasons(): Promise<LeaderboardSeason[]> {
  const supabase = getSupabase()
  if (!supabase) return [{ slug: "season-zero", name: "Season Zero" }]
  try {
    const { data, error } = await supabase.from("leaderboard_seasons").select("slug,name").eq("is_public", true).order("starts_at", { ascending: false })
    if (error) throw error
    const seasons = (data ?? []).flatMap((row) => typeof row.slug === "string" && typeof row.name === "string" ? [{ slug: row.slug, name: row.name }] : [])
    return seasons.length > 0 ? seasons : [{ slug: "season-zero", name: "Season Zero" }]
  } catch {
    return [{ slug: "season-zero", name: "Season Zero" }]
  }
}

function sortEntries(entries: LeaderboardEntry[], kind: LeaderboardKind): LeaderboardEntry[] {
  return [...entries].sort((a, b) => {
    if (kind === "peoples-champions") return b.delivered - a.delivered || b.score - a.score || a.id.localeCompare(b.id)
    if (kind === "clean-escapes") return b.delivered - a.delivered || b.score - a.score || a.missionSeconds - b.missionSeconds || a.id.localeCompare(b.id)
    if (kind === "rescuers") return (b.rescues ?? 0) - (a.rescues ?? 0) || b.score - a.score || a.id.localeCompare(b.id)
    if (kind === "swift-arrows") return a.missionSeconds - b.missionSeconds || b.score - a.score || (b.precision ?? 0) - (a.precision ?? 0) || a.id.localeCompare(b.id)
    return b.score - a.score || a.missionSeconds - b.missionSeconds || a.id.localeCompare(b.id)
  })
}

export async function submitLeaderboardEntry(input: {
  playerName: string
  characterId: CharacterId
  result: MasteryResult
  missionSeconds: number
  delivered: number
}): Promise<LeaderboardEntry> {
  const playerName = input.playerName.replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 20) || "Anonymous Outlaw"
  const localEntry: LeaderboardEntry = {
    id: crypto.randomUUID(),
    playerName,
    characterId: input.characterId,
    score: input.result.score,
    grade: input.result.grade,
    missionSeconds: Math.round(input.missionSeconds),
    delivered: input.delivered,
    verified: false,
    createdAt: new Date().toISOString(),
  }

  // Clients never write ranked results directly. The authoritative mission
  // server will submit verified scores with server-only credentials.
  const entries = [localEntry, ...localEntries()].sort((a, b) => b.score - a.score)
  saveLocal(entries)
  return localEntry
}

export function subscribeToLeaderboard(onChange: () => void): () => void {
  const supabase = getSupabase()
  if (!supabase) return () => undefined
  const interval = window.setInterval(onChange, 15_000)
  return () => window.clearInterval(interval)
}
