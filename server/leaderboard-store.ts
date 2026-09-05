import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import type { MissionResult } from "../shared/protocol"
import type { CharacterId } from "../shared/protocol"
import type { RpcClient } from "./band-store"

export type LeaderboardKind = "master-outlaws" | "peoples-champions" | "clean-escapes" | "rescuers" | "swift-arrows"

export const LEADERBOARD_KINDS: readonly LeaderboardKind[] = ["master-outlaws", "peoples-champions", "clean-escapes", "rescuers", "swift-arrows"]

export interface LeaderboardEntry {
  id: string
  playerName: string
  characterId: CharacterId
  score: number
  grade: "S" | "A" | "B" | "C"
  missionSeconds: number
  delivered: number
  verified: boolean
  createdAt: string
  partySize?: number
  missionSlug?: string
  rescues?: number
  precision?: number
  generosity?: number
  cleanEscape?: boolean
}

export interface LeaderboardFilters {
  kind?: LeaderboardKind
  seasonSlug?: string
  characterId?: CharacterId
  partySize?: number
  missionSlug?: string
  bandId?: string
  playerIds?: string[]
}

export interface VerifiedRun {
  missionId: string
  playerId: string
  authUserId: string
  bandId?: string
  characterId: CharacterId
  partySize: number
  missionSeconds: number
  delivered: number
  rescues: number
  damageTaken: number
  missionVersion: string
  missionContentHash: string
  missionSlug: string
  seasonSlug: string
  missionStartedAt: number
  cleanEscape: boolean
  rotationId?: string | null
  rotationModifierIds?: string[]
  rescueOfferId?: string | null
  result: MissionResult
}

export interface LeaderboardReviewResult {
  status: "approved" | "rejected"
  entryId: string | null
}

export interface LeaderboardFinalizationResult {
  seasonsFinalized: number
  snapshotsCreated: number
}

export interface SeasonActivationResult {
  seasonId: string
  lifecycleState: "open" | "closing" | "finalized"
  activated: boolean
}

export interface SeasonCloseResult {
  seasonId: string
  lifecycleState: "open" | "closing" | "finalized"
  closedAt: string | null
  finalizeAfter: string | null
  changed: boolean
}

export interface SeasonRecoveryResult {
  seasonsRecovered: number
  snapshotsCreated: number
  blocked: Array<{ seasonId: string; slug: string; reason: string }>
}

export function terminalLeaderboardFailure(error: unknown): string | null {
  const message = error instanceof Error ? error.message : ""
  for (const code of ["MISSION_OUTSIDE_SEASON", "SEASON_FINALIZED", "VERIFICATION_CONFLICT", "VERIFICATION_REJECTED", "INVALID_VERIFICATION_IDENTITY"]) {
    if (message.includes(code)) return code.toLowerCase()
  }
  if (/violates (check|foreign key|not-null) constraint|invalid input syntax/i.test(message)) return "database_constraint"
  return null
}

export function verificationId(missionId: string, playerId: string): string {
  const bytes = createHash("sha256").update(`${missionId}:${playerId}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

const RANKED_ADJECTIVES = ["Oak", "Green", "Swift", "Merry", "Quiet", "Bold", "Wild", "True"] as const
const RANKED_NOUNS = ["Fox", "Hart", "Hare", "Badger", "Wren", "Hood", "Bow", "Briar"] as const

export function rankedPlayerName(seasonSlug: string, authUserId: string): string {
  const digest = createHash("sha256").update(`${seasonSlug}:${authUserId}`).digest()
  return `${RANKED_ADJECTIVES[digest[0] % RANKED_ADJECTIVES.length]} ${RANKED_NOUNS[digest[1] % RANKED_NOUNS.length]} ${digest.subarray(2, 4).toString("hex").toUpperCase()}`
}

export class SupabaseLeaderboardStore {
  constructor(private readonly client: RpcClient) {}

  async recordVerifiedRun(run: VerifiedRun): Promise<string | null> {
    const { data, error } = await this.client.rpc("record_verified_leaderboard_entry", {
      p_season_slug: run.seasonSlug,
      p_verification_id: verificationId(run.missionId, run.playerId),
      p_mission_slug: run.missionSlug,
      p_mission_started_at: new Date(run.missionStartedAt).toISOString(),
      p_band_id: run.bandId ?? null,
      p_player_id: run.authUserId,
      p_player_name: rankedPlayerName(run.seasonSlug, run.authUserId),
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
      p_clean_escape: run.cleanEscape,
      p_score_breakdown: {
        ...run.result.breakdown,
        missionVersion: run.missionVersion,
        missionContentHash: run.missionContentHash,
        rotationId: run.rotationId ?? null,
        rotationModifierIds: run.rotationModifierIds ?? [],
        rescueOfferId: run.rescueOfferId ?? null,
      },
    })
    if (error) throw new Error(`VERIFIED_SCORE_FAILED: ${error.message}`)
    return typeof data === "string" ? data : null
  }

  async reviewQuarantine(quarantineId: string, reviewerUserId: string, decision: LeaderboardReviewResult["status"]): Promise<LeaderboardReviewResult> {
    const { data, error } = await this.client.rpc("review_leaderboard_quarantine", {
      p_quarantine_id: quarantineId,
      p_reviewer_id: reviewerUserId,
      p_decision: decision,
    })
    if (error) throw new Error(`LEADERBOARD_REVIEW_FAILED: ${error.message}`)
    if (!data || typeof data !== "object") throw new Error("LEADERBOARD_REVIEW_FAILED: invalid result")
    const value = data as Record<string, unknown>
    if ((value.status !== "approved" && value.status !== "rejected") || (value.entryId !== null && typeof value.entryId !== "string")) throw new Error("LEADERBOARD_REVIEW_FAILED: invalid result")
    return { status: value.status, entryId: value.entryId as string | null }
  }

  async finalizeDueSeasons(): Promise<LeaderboardFinalizationResult> {
    const { data, error } = await this.client.rpc("finalize_due_leaderboard_seasons", {})
    if (error) throw new Error(`LEADERBOARD_FINALIZATION_FAILED: ${error.message}`)
    if (!data || typeof data !== "object") throw new Error("LEADERBOARD_FINALIZATION_FAILED: invalid result")
    const value = data as Record<string, unknown>
    if (!Number.isSafeInteger(value.seasonsFinalized) || !Number.isSafeInteger(value.snapshotsCreated)) throw new Error("LEADERBOARD_FINALIZATION_FAILED: invalid result")
    return { seasonsFinalized: value.seasonsFinalized as number, snapshotsCreated: value.snapshotsCreated as number }
  }

  /** Opens the next season. Idempotent on slug; refuses to reopen a finalized season. */
  async activateSeason(input: { slug: string; name: string; startsAt: number; endsAt: number }): Promise<SeasonActivationResult> {
    const { data, error } = await this.client.rpc("activate_leaderboard_season", {
      p_slug: input.slug,
      p_name: input.name,
      p_starts_at: new Date(input.startsAt).toISOString(),
      p_ends_at: new Date(input.endsAt).toISOString(),
    })
    if (error) throw new Error(`SEASON_ACTIVATE_FAILED: ${error.message}`)
    const value = asRecord(data, "SEASON_ACTIVATE_FAILED")
    if (typeof value.season_id !== "string" || !isLifecycleState(value.lifecycle_state) || typeof value.activated !== "boolean") {
      throw new Error("SEASON_ACTIVATE_FAILED: invalid result")
    }
    return { seasonId: value.season_id, lifecycleState: value.lifecycle_state, activated: value.activated }
  }

  /** Moves an open season to 'closing' with a bounded drain window. Idempotent. */
  async closeSeason(seasonId: string, drainMinutes = 30): Promise<SeasonCloseResult> {
    const { data, error } = await this.client.rpc("close_leaderboard_season", {
      p_season_id: seasonId,
      p_drain_minutes: drainMinutes,
    })
    if (error) throw new Error(`SEASON_CLOSE_FAILED: ${error.message}`)
    const value = asRecord(data, "SEASON_CLOSE_FAILED")
    if (typeof value.season_id !== "string" || !isLifecycleState(value.lifecycle_state) || typeof value.changed !== "boolean") {
      throw new Error("SEASON_CLOSE_FAILED: invalid result")
    }
    return {
      seasonId: value.season_id,
      lifecycleState: value.lifecycle_state,
      closedAt: typeof value.closed_at === "string" ? value.closed_at : null,
      finalizeAfter: typeof value.finalize_after === "string" ? value.finalize_after : null,
      changed: value.changed,
    }
  }

  /** Retries snapshot + finalize for stuck 'closing' seasons; reports what remains blocked and why. */
  async recoverSeasonDrain(): Promise<SeasonRecoveryResult> {
    const { data, error } = await this.client.rpc("recover_leaderboard_season_drain", {})
    if (error) throw new Error(`SEASON_RECOVER_FAILED: ${error.message}`)
    const value = asRecord(data, "SEASON_RECOVER_FAILED")
    if (!Number.isSafeInteger(value.seasons_recovered) || !Number.isSafeInteger(value.snapshots_created)) {
      throw new Error("SEASON_RECOVER_FAILED: invalid result")
    }
    const blocked = Array.isArray(value.blocked) ? value.blocked.flatMap((row: unknown) => {
      if (!row || typeof row !== "object") return []
      const r = row as Record<string, unknown>
      if (typeof r.season_id !== "string" || typeof r.reason !== "string") return []
      return [{ seasonId: r.season_id, slug: typeof r.slug === "string" ? r.slug : "", reason: r.reason }]
    }) : []
    return { seasonsRecovered: value.seasons_recovered as number, snapshotsCreated: value.snapshots_created as number, blocked }
  }

  async moderateEntry(input: { entryId: string; action: string; reasonCode: string; actor: string; note?: string }): Promise<{ entryId: string; action: string; changed: boolean }> {
    const { data, error } = await this.client.rpc("moderate_leaderboard_entry", {
      p_entry_id: input.entryId,
      p_action: input.action,
      p_reason_code: input.reasonCode,
      p_actor: input.actor,
      p_note: input.note ?? null,
    })
    if (error) throw new Error(`LEADERBOARD_MODERATION_FAILED: ${error.message}`)
    const value = asRecord(data, "LEADERBOARD_MODERATION_FAILED")
    if (typeof value.entry_id !== "string" || typeof value.action !== "string" || typeof value.changed !== "boolean") {
      throw new Error("LEADERBOARD_MODERATION_FAILED: invalid result")
    }
    return { entryId: value.entry_id, action: value.action, changed: value.changed }
  }

  async moderatePlayer(input: { playerId: string; action: string; reasonCode: string; actor: string; note?: string }): Promise<{ playerRef: string; action: string; changedEntries: number }> {
    const { data, error } = await this.client.rpc("moderate_leaderboard_player", {
      p_player_id: input.playerId,
      p_action: input.action,
      p_reason_code: input.reasonCode,
      p_actor: input.actor,
      p_note: input.note ?? null,
    })
    if (error) throw new Error(`LEADERBOARD_MODERATION_FAILED: ${error.message}`)
    const value = asRecord(data, "LEADERBOARD_MODERATION_FAILED")
    if (typeof value.player_ref !== "string" || typeof value.action !== "string" || !Number.isSafeInteger(value.changed_entries)) {
      throw new Error("LEADERBOARD_MODERATION_FAILED: invalid result")
    }
    return { playerRef: value.player_ref, action: value.action, changedEntries: value.changed_entries as number }
  }
}

function asRecord(data: unknown, context: string): Record<string, unknown> {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error(`${context}: invalid result`)
  return data as Record<string, unknown>
}

function isLifecycleState(value: unknown): value is "open" | "closing" | "finalized" {
  return value === "open" || value === "closing" || value === "finalized"
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
