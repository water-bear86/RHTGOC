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

export async function loadLeaderboard(filters: LeaderboardFilters = {}): Promise<{ entries: LeaderboardEntry[]; global: boolean }> {
  const supabase = getSupabase()
  const kind = filters.kind ?? "master-outlaws"
  if (filters.playerIds && filters.playerIds.length === 0) return { entries: [], global: true }
  if (!supabase) return { entries: sortEntries(localEntries(), kind), global: false }
  try {
    const { data: season, error: seasonError } = await supabase
      .from("leaderboard_seasons")
      .select("id")
      .eq("slug", filters.seasonSlug ?? "season-zero")
      .eq("is_public", true)
      .single()
    if (seasonError) throw seasonError
    let query = supabase
      .from("leaderboard_entries")
      .select("id, player_id, player_name, character_id, score, grade, mission_seconds, delivered, verified, created_at, party_size, mission_slug, band_id, rescues, precision, generosity, clean_escape")
      .eq("season_id", season.id)
      .eq("verified", true)
    if (filters.characterId) query = query.eq("character_id", filters.characterId)
    if (filters.partySize) query = query.eq("party_size", filters.partySize)
    if (filters.missionSlug) query = query.eq("mission_slug", filters.missionSlug)
    if (filters.bandId) query = query.eq("band_id", filters.bandId)
    if (filters.playerIds?.length) query = query.in("player_id", filters.playerIds)
    if (kind === "clean-escapes") query = query.eq("clean_escape", true).order("mission_seconds", { ascending: true })
    else if (kind === "peoples-champions") query = query.order("generosity", { ascending: false })
    else if (kind === "rescuers") query = query.order("rescues", { ascending: false })
    else if (kind === "swift-arrows") query = query.order("precision", { ascending: false })
    else query = query.order("score", { ascending: false })
    const { data, error } = await query.order("score", { ascending: false }).limit(50)
    if (error) throw error
    const entries: LeaderboardEntry[] = data.map((entry) => ({
      id: entry.id,
      playerId: entry.player_id ?? undefined,
      playerName: entry.player_name,
      characterId: entry.character_id as CharacterId,
      score: entry.score,
      grade: entry.grade as MasteryResult["grade"],
      missionSeconds: entry.mission_seconds,
      delivered: entry.delivered,
      verified: entry.verified,
      createdAt: entry.created_at,
      partySize: entry.party_size,
      missionSlug: entry.mission_slug,
      bandId: entry.band_id,
      rescues: entry.rescues,
      precision: entry.precision,
      generosity: entry.generosity,
      cleanEscape: entry.clean_escape,
    }))
    const excluded = new Set(filters.excludedPlayerIds ?? [])
    return { entries: entries.filter((entry) => !entry.playerId || !excluded.has(entry.playerId)), global: true }
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
    if (kind === "peoples-champions") return (b.generosity ?? 0) - (a.generosity ?? 0) || b.score - a.score
    if (kind === "clean-escapes") return a.missionSeconds - b.missionSeconds || b.score - a.score
    if (kind === "rescuers") return (b.rescues ?? 0) - (a.rescues ?? 0) || b.score - a.score
    if (kind === "swift-arrows") return (b.precision ?? 0) - (a.precision ?? 0) || a.missionSeconds - b.missionSeconds
    return b.score - a.score
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
  const channel = supabase
    .channel("leaderboard-season-zero")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "leaderboard_entries" }, onChange)
    .subscribe()
  return () => { void supabase.removeChannel(channel) }
}
