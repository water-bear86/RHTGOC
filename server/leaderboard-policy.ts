import { createHash } from "node:crypto"
import type { LeaderboardKind } from "./leaderboard-store"
import { rankAndPaginate, type RankableEntry, type RankingFilters } from "./leaderboard-ranking"

/**
 * Pure reference implementation of the leaderboard privacy and moderation
 * policy encoded in
 * supabase/migrations/20260905174500_leaderboard_privacy_moderation.sql.
 *
 * Semantics (identical in SQL and here):
 * - Public output is projected through an explicit field allowlist. Account
 *   ids, emails, platform identifiers, verification ids, score breakdowns,
 *   and suspicion flags never leave the trust boundary.
 * - A block between the viewer and an entry's player MASKS the entry's
 *   identity in place. It never removes the row, so totals, ranks, tie flags,
 *   positions, and pagination are byte-identical for every viewer: neither
 *   side of a block (nor anyone else) can detect it from counts or errors.
 * - Moderator `identity_hidden` masks the identity for EVERY viewer with the
 *   exact same label as block masking, so the two causes are outwardly
 *   indistinguishable. Moderator `entry_hidden` removes the row for EVERY
 *   viewer uniformly (including its owner and anonymous readers).
 * - Deleted / missing accounts (playerId null) never match a block pair,
 *   never match the viewer's self row, and keep their season pseudonym.
 */

/** The one label used for both block masking and moderator identity-hiding. */
export const MASKED_PLAYER_NAME = "Hooded Outlaw"

/** Every field allowed in a public leaderboard entry payload. */
export const PUBLIC_LEADERBOARD_ENTRY_FIELDS = [
  "id",
  "playerName",
  "characterId",
  "score",
  "grade",
  "missionSeconds",
  "delivered",
  "verified",
  "createdAt",
  "partySize",
  "missionSlug",
  "rescues",
  "precision",
  "generosity",
  "cleanEscape",
  "identityMasked",
  "rank",
  "isTied",
  "position",
] as const

export type PublicLeaderboardEntryField = (typeof PUBLIC_LEADERBOARD_ENTRY_FIELDS)[number]

/**
 * Restricted identifiers that must never appear in public payloads or logs,
 * in either casing convention. Used by tests and the log sanitizer.
 */
export const RESTRICTED_LEADERBOARD_FIELDS = [
  "playerId",
  "player_id",
  "authUserId",
  "auth_user_id",
  "userId",
  "user_id",
  "email",
  "walletAddress",
  "wallet_address",
  "verificationId",
  "verification_id",
  "scoreBreakdown",
  "score_breakdown",
  "suspicious",
  "friendCode",
  "friend_code",
  "ipAddress",
  "ip_address",
  "platformId",
  "platform_id",
] as const

export const MODERATION_ACTIONS = ["hide-entry", "restore-entry", "hide-identity", "restore-identity", "annotate"] as const
export type ModerationAction = (typeof MODERATION_ACTIONS)[number]

export const MODERATION_REASON_CODES = ["offensive-name", "harassment", "impersonation", "cheating-review", "legal-removal", "other"] as const
export type ModerationReasonCode = (typeof MODERATION_REASON_CODES)[number]

export function isModerationAction(value: string): value is ModerationAction {
  return (MODERATION_ACTIONS as readonly string[]).includes(value)
}

export function isModerationReasonCode(value: string): value is ModerationReasonCode {
  return (MODERATION_REASON_CODES as readonly string[]).includes(value)
}

export interface ModerationFlags {
  identityHidden: boolean
  entryHidden: boolean
}

/** An entry as ranked, before viewer projection. */
export interface PolicyEntry extends Omit<RankableEntry, "playerId"> {
  playerName: string
  /** May be null: `player_id` is `on delete set null` for deleted accounts. */
  playerId?: string | null
  identityHidden?: boolean
  entryHidden?: boolean
}

export interface ViewerContext {
  /** Authenticated viewer's account id, or null for anonymous reads. */
  viewerId: string | null
  /** Undirected block pairs; use `blockPairKey` to build keys. */
  blockedPairs: ReadonlySet<string>
}

export function blockPairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`
}

/** True when the viewer and this entry's player block each other in either direction. */
export function isBlockedForViewer(context: ViewerContext, playerId: string | null | undefined): boolean {
  if (!context.viewerId || !playerId) return false
  if (context.viewerId === playerId) return false
  return context.blockedPairs.has(blockPairKey(context.viewerId, playerId))
}

export type EntryVisibility = "visible" | "masked" | "omitted"

/**
 * Visibility of one entry for one viewer. `omitted` (moderator entry-hide) is
 * viewer-independent; `masked` merges block masking (viewer-dependent) with
 * moderator identity-hiding (viewer-independent) into one indistinguishable
 * outcome.
 */
export function resolveEntryVisibility(entry: PolicyEntry, context: ViewerContext): EntryVisibility {
  if (entry.entryHidden === true) return "omitted"
  if (entry.identityHidden === true) return "masked"
  if (isBlockedForViewer(context, entry.playerId ?? null)) return "masked"
  return "visible"
}

export interface PublicLeaderboardEntry {
  id: string
  playerName: string
  characterId?: string
  score: number
  grade?: string
  missionSeconds: number
  delivered: number
  verified?: boolean
  createdAt?: string
  partySize?: number
  missionSlug?: string
  rescues?: number
  precision?: number
  generosity?: number
  cleanEscape?: boolean
  identityMasked: boolean
  rank: number
  isTied: boolean
  position: number
}

/**
 * Projects an arbitrary record onto the public allowlist. Unknown and
 * restricted fields are dropped; nothing outside
 * PUBLIC_LEADERBOARD_ENTRY_FIELDS can pass through.
 */
export function projectPublicEntry(raw: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = {}
  for (const field of PUBLIC_LEADERBOARD_ENTRY_FIELDS) {
    if (raw[field] !== undefined) projected[field] = raw[field]
  }
  return projected
}

export interface PolicyBoardPage {
  entries: PublicLeaderboardEntry[]
  pagination: { total: number; limit: number; offset: number; hasNext: boolean }
  self: PublicLeaderboardEntry | null
}

/**
 * Full read pipeline mirror: uniform moderation removal -> deterministic
 * ranking (shared with leaderboard-ranking.ts) -> per-viewer identity
 * projection. Masking happens strictly AFTER ranking and pagination, so the
 * numeric frame of the board is identical for every viewer.
 */
export function readBoardForViewer(
  entries: PolicyEntry[],
  kind: LeaderboardKind,
  context: ViewerContext,
  options: { limit?: number; offset?: number; filters?: RankingFilters } = {},
): PolicyBoardPage {
  const visibleToAll = entries.filter((entry) => entry.entryHidden !== true)
  const page = rankAndPaginate(visibleToAll, kind, {
    limit: options.limit,
    offset: options.offset,
    filters: options.filters,
    viewerPlayerId: context.viewerId ?? undefined,
  })
  const project = (ranked: { entry: PolicyEntry; rank: number; isTied: boolean; position: number }): PublicLeaderboardEntry => {
    const masked = resolveEntryVisibility(ranked.entry, context) === "masked"
    return projectPublicEntry({
      ...ranked.entry,
      playerName: masked ? MASKED_PLAYER_NAME : ranked.entry.playerName,
      identityMasked: masked,
      rank: ranked.rank,
      isTied: ranked.isTied,
      position: ranked.position,
    }) as unknown as PublicLeaderboardEntry
  }
  return {
    entries: page.entries.map((ranked) => project(ranked as { entry: PolicyEntry; rank: number; isTied: boolean; position: number })),
    pagination: page.pagination,
    self: page.self ? project(page.self as { entry: PolicyEntry; rank: number; isTied: boolean; position: number }) : null,
  }
}

const LOG_CONTEXT_ALLOWLIST = new Set([
  "traceId",
  "entryId",
  "missionId",
  "seasonSlug",
  "kind",
  "action",
  "reasonCode",
  "changed",
  "changedEntries",
  "target",
  "playerRefHash",
  "attempts",
  "reason",
  "message",
  "count",
])

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * Structured-log guard: only allowlisted keys survive, and free-text values
 * (reason/message) have embedded UUIDs redacted so an account id can never
 * ride a database error message into the logs. Entry ids are public (they
 * appear in API payloads); account uuids are not, so `playerRefHash` is the
 * only permitted account reference.
 */
export function sanitizeLeaderboardLogContext(context: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(context)) {
    if (!LOG_CONTEXT_ALLOWLIST.has(key)) continue
    if ((key === "reason" || key === "message") && typeof value === "string") {
      safe[key] = value.replace(UUID_PATTERN, "[uuid]")
      continue
    }
    safe[key] = value
  }
  return safe
}

/** Irreversible short reference for an account id, safe for audit logs. */
export function playerRefHash(playerId: string): string {
  return createHash("sha256").update(`leaderboard-mod:${playerId}`).digest("hex").slice(0, 12)
}
