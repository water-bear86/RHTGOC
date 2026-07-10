import type { CharacterId, MasteryResult } from "./simulation"

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
  try {
    const response = await fetch("/api/leaderboard", { headers: { Accept: "application/json" } })
    if (!response.ok) throw new Error(`Leaderboard returned ${response.status}`)
    const payload = await response.json() as { entries: LeaderboardEntry[] }
    return { entries: payload.entries, global: true }
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

  try {
    const response = await fetch("/api/leaderboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(localEntry),
    })
    if (!response.ok) throw new Error(`Leaderboard returned ${response.status}`)
    return await response.json() as LeaderboardEntry
  } catch {
    const entries = [localEntry, ...localEntries()].sort((a, b) => b.score - a.score)
    saveLocal(entries)
    return localEntry
  }
}
