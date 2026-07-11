import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import type { MissionResult } from "../shared/protocol"
import type { CharacterId } from "../shared/protocol"
import type { RpcClient } from "./band-store"

export interface VerifiedRun {
  missionId: string
  playerId: string
  authUserId?: string
  bandId?: string
  playerName: string
  characterId: CharacterId
  partySize: number
  missionSeconds: number
  delivered: number
  rescues: number
  damageTaken: number
  missionVersion: string
  missionContentHash: string
  missionSlug: string
  result: MissionResult
}

export function verificationId(missionId: string, playerId: string): string {
  const bytes = createHash("sha256").update(`${missionId}:${playerId}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export class SupabaseLeaderboardStore {
  constructor(private readonly client: RpcClient) {}

  async recordVerifiedRun(run: VerifiedRun): Promise<string | null> {
    const { data, error } = await this.client.rpc("record_verified_leaderboard_entry", {
      p_season_slug: "season-zero",
      p_verification_id: verificationId(run.missionId, run.playerId),
      p_mission_slug: run.missionSlug,
      p_band_id: run.bandId ?? null,
      p_player_id: run.authUserId ?? null,
      p_player_name: run.playerName.replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 20) || "Anonymous Outlaw",
      p_character_id: run.characterId,
      p_party_size: run.partySize,
      p_score: run.result.score,
      p_grade: run.result.grade,
      p_mission_seconds: Math.max(1, Math.round(run.missionSeconds)),
      p_delivered: run.delivered,
      p_rescues: run.rescues,
      p_damage_taken: run.damageTaken,
      p_precision: run.result.breakdown.precision,
      p_generosity: run.result.breakdown.generosity,
      p_score_breakdown: {
        ...run.result.breakdown,
        missionVersion: run.missionVersion,
        missionContentHash: run.missionContentHash,
      },
    })
    if (error) throw new Error(`VERIFIED_SCORE_FAILED: ${error.message}`)
    return typeof data === "string" ? data : null
  }
}

export function createLeaderboardStoreFromEnv(): SupabaseLeaderboardStore | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) return null
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return new SupabaseLeaderboardStore(client as unknown as RpcClient)
}
