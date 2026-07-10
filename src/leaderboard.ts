import type { CharacterId, MasteryResult } from "./simulation"
import { getSupabase } from "./supabase"

export interface LeaderboardEntry {
  id: string
  playerName: string
  characterId: CharacterId
  score: number
  grade: MasteryResult["grade"]
  missionSeconds: number
  delivered: number
  verified: boolean
  createdAt: string
}

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

export async function loadLeaderboard(): Promise<{ entries: LeaderboardEntry[]; global: boolean }> {
  const supabase = getSupabase()
  if (!supabase) return { entries: localEntries().sort((a, b) => b.score - a.score), global: false }
  try {
    const { data, error } = await supabase
      .from("leaderboard_entries")
      .select("id, player_name, character_id, score, grade, mission_seconds, delivered, verified, created_at")
      .eq("verified", true)
      .order("score", { ascending: false })
      .order("mission_seconds", { ascending: true })
      .limit(50)
    if (error) throw error
    const entries: LeaderboardEntry[] = data.map((entry) => ({
      id: entry.id,
      playerName: entry.player_name,
      characterId: entry.character_id as CharacterId,
      score: entry.score,
      grade: entry.grade as MasteryResult["grade"],
      missionSeconds: entry.mission_seconds,
      delivered: entry.delivered,
      verified: entry.verified,
      createdAt: entry.created_at,
    }))
    return { entries, global: true }
  } catch {
    return { entries: localEntries().sort((a, b) => b.score - a.score), global: false }
  }
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
