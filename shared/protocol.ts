import { z } from "zod"
import type { SheriffRotation } from "./sheriff-rotation"
import protocolVersion from "./protocol-version.json"
import type { SherwoodSeasonSnapshot } from "./sherwood-season"

export const PROTOCOL_VERSION = protocolVersion.version
export const MAX_ROOM_PLAYERS = 4
export const RECONNECT_GRACE_MS = 30_000

export const CharacterIdSchema = z.enum(["robin", "marian", "little-john", "much"])
export type CharacterId = z.infer<typeof CharacterIdSchema>
export const LoadoutIdSchema = z.enum(["balanced", "bandage", "smoke"])
export type LoadoutId = z.infer<typeof LoadoutIdSchema>
export const ContributionTypeSchema = z.enum(["supplies", "intelligence", "snare-kit", "safe-house"])
export type ContributionType = z.infer<typeof ContributionTypeSchema>

const DisplayNameSchema = z.string().trim().min(1).max(20).regex(/^[a-zA-Z0-9 _-]+$/)
const RoomCodeSchema = z.string().trim().length(6).regex(/^[A-Z2-9]+$/)

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_room"),
    version: z.literal(PROTOCOL_VERSION),
    displayName: DisplayNameSchema,
    characterId: CharacterIdSchema,
    accessToken: z.string().min(20).max(4_096).optional(),
  }),
  z.object({
    type: z.literal("join_room"),
    version: z.literal(PROTOCOL_VERSION),
    roomCode: RoomCodeSchema,
    displayName: DisplayNameSchema,
    characterId: CharacterIdSchema,
    reconnectToken: z.string().uuid().optional(),
    accessToken: z.string().min(20).max(4_096).optional(),
  }),
  z.object({ type: z.literal("set_ready"), ready: z.boolean() }),
  z.object({ type: z.literal("select_character"), characterId: CharacterIdSchema }),
  z.object({ type: z.literal("select_mission"), missionSlug: z.string().regex(/^[a-z0-9-]{1,60}$/) }),
  z.object({ type: z.literal("select_rotation"), rotationId: z.string().regex(/^sheriff-[a-z0-9-]{8,80}$/) }),
  z.object({ type: z.literal("select_loadout"), loadoutId: LoadoutIdSchema }),
  z.object({ type: z.literal("return_to_hub") }),
  z.object({ type: z.literal("accept_rescue"), offerId: z.string().uuid() }),
  z.object({ type: z.literal("abandon_rescue"), offerId: z.string().uuid() }),
  z.object({ type: z.literal("deposit_contribution"), contributionType: ContributionTypeSchema }),
  z.object({ type: z.literal("toggle_contribution"), contributionId: z.string().uuid() }),
  z.object({ type: z.literal("revoke_contribution"), contributionId: z.string().uuid() }),
  z.object({
    type: z.literal("input"),
    sequence: z.number().int().nonnegative(),
    move: z.object({ x: z.number().min(-1).max(1), z: z.number().min(-1).max(1) }),
  }),
  z.object({
    type: z.literal("action"),
    action: z.enum(["interact", "shoot", "signature", "revive", "transfer_loot"]),
    targetPlayerId: z.string().uuid().optional(),
  }),
  z.object({ type: z.literal("world_ping"), kind: z.enum(["danger", "target", "route", "loot", "regroup"]) }),
  z.object({ type: z.literal("redistribution_vote"), choice: z.enum(["granary", "infirmary", "watchtower"]) }),
  z.object({
    type: z.literal("moderation"),
    action: z.enum(["report", "remove", "block"]),
    targetPlayerId: z.string().uuid(),
    reason: z.enum(["harassment", "griefing", "unsafe-name", "cheating"]).optional(),
  }),
  z.object({ type: z.literal("ping"), clientTime: z.number().finite() }),
  z.object({
    type: z.literal("client_metrics"),
    inputBacklog: z.number().int().min(0).max(2_000),
    snapshotGapMs: z.number().int().min(0).max(60_000),
  }),
])

export type ClientMessage = z.infer<typeof ClientMessageSchema>

export interface RoomPlayer {
  id: string
  displayName: string
  characterId: CharacterId
  loadoutId: LoadoutId
  ready: boolean
  connected: boolean
  health: number
  arrows: number
  loot: number
  downedFor: number
  signatureCooldown: number
  protectionScore: number
  crowdControl: number
  heavyCarryPeak: number
  trapHits: number
  sabotageCount: number
  position: { x: number; z: number }
  lastInputSequence: number
}

export interface MissionGuard {
  id: number
  position: { x: number; z: number }
  stunnedFor: number
}

export interface MissionEvent {
  sequence: number
  tick: number
  type: "mission_started" | "phase_changed" | "route_selected" | "cart_robbed" | "loot_delivered" | "wagon_intercepted" | "lock_breached" | "captives_freed" | "captive_extracted" | "alarm_triggered" | "alarm_sabotaged" | "disguise_acquired" | "cache_looted" | "intel_found" | "ledger_stolen" | "extraction_reached" | "contribution_consumed" | "reinforcement_arrived" | "guard_stunned" | "crowd_controlled" | "ally_protected" | "heavy_carry" | "trap_placed" | "trap_triggered" | "reinforcement_sabotaged" | "player_hit" | "player_downed" | "player_revived" | "player_captured" | "loot_transferred" | "ping_sent" | "signature_used" | "mission_succeeded" | "mission_failed" | "vote_cast" | "vote_resolved"
  playerId?: string
  value?: number
  detail?: string
}

export type PingKind = "danger" | "target" | "route" | "loot" | "regroup"

export interface WorldPing {
  id: number
  kind: PingKind
  playerId: string
  position: { x: number; z: number }
  expiresAtTick: number
}

export interface MissionTrap {
  id: number
  ownerId: string
  position: { x: number; z: number }
  expiresAtTick: number
}

export type MissionKind = "tax-cart" | "prison-wagon" | "storehouse"

export interface MissionCaptive {
  id: number
  status: "locked" | "following" | "extracted"
  position: { x: number; z: number }
  rewarded: boolean
}

export interface MissionAlarm {
  id: string
  status: "active" | "sabotaged" | "triggered"
  position: { x: number; z: number }
}

export interface MissionLootCache {
  id: string
  kind: "coin" | "intel" | "ledger"
  status: "secured" | "looted"
  position: { x: number; z: number }
  value: number
}

export interface MissionPreparation {
  id: string
  type: ContributionType
  contributorLabel: string
  status: "active" | "consumed"
  position: { x: number; z: number }
}

export interface MissionSnapshot {
  missionId: string
  missionVersion: string
  contentHash: string
  missionKind: MissionKind
  seed: number
  status: "active" | "succeeded" | "failed"
  phase: "scout" | "ambush" | "robbery" | "pursuit" | "escape" | "extraction"
  entryRoute: "forest" | "river" | null
  escapeRoute: "forest" | "river" | null
  cycle: number
  elapsedSeconds: number
  parSeconds: number
  heat: number
  cartCoin: number
  delivered: number
  target: number
  supportScore: number
  guards: MissionGuard[]
  pings: WorldPing[]
  latestEvent: MissionEvent | null
  result: MissionResult | null
  vote: RedistributionVote | null
  village: VillageState
  modifiers: Array<{ id: "armored-escort" | "scarce-quivers" | "double-tithe" | "watchful-sheriff"; label: string; effect: string }>
  sheriffPlan: "patrol" | "pursuit" | "reinforcement"
  optionalObjectives: Array<{ id: string; label: string; completed: boolean; failed: boolean }>
  traps: MissionTrap[]
  reinforcementDelaySeconds: number
  signalSabotaged: boolean
  cartPosition: { x: number; z: number }
  wagonMoving: boolean
  captives: MissionCaptive[]
  lockProgress: number
  lockTarget: number
  failureReason: "captured" | "timeout" | "wagon-escaped" | "alarm-lockdown" | null
  alarms: MissionAlarm[]
  lootCaches: MissionLootCache[]
  alarmLevel: number
  disguisePlayerId: string | null
  intelFound: boolean
  ledgerStolen: boolean
  reinforcementWave: number
  rotationId: string | null
  rotationModifierIds: string[]
  rotationObjectiveIds: string[]
  rescueOfferId: string | null
  rescueSourceMissionId: string | null
  preparations: MissionPreparation[]
}

export type VoteChoice = "granary" | "infirmary" | "watchtower"

export interface MissionResult {
  score: number
  grade: "S" | "A" | "B" | "C"
  breakdown: {
    speed: number
    stealth: number
    precision: number
    survival: number
    rescues: number
    generosity: number
  }
  thresholds: { S: 9000; A: 7500; B: 6000; C: 0 }
  communityCoin: number
  personalRenown: number
}

export interface RedistributionVote {
  deadlineTick: number
  counts: Record<VoteChoice, number>
  votes: Record<string, VoteChoice>
  resolved: boolean
  winner: VoteChoice | null
  allocatedCoin: number
}

export interface VillageState {
  granary: number
  infirmary: number
  watchtower: number
}

export interface LastMissionResult extends Pick<MissionResult, "score" | "grade"> {
  status: "succeeded" | "failed"
  rescuedCaptives: number
  totalCaptives: number
}

export interface RescueOffer {
  id: string
  sourceMissionId: string
  sourceMissionSlug: string
  rescueMissionSlug: "prison-wagon"
  context: "captured-outlaws" | "lost-captives" | "lost-supplies"
  targetCount: number
  status: "active" | "accepted" | "completed" | "expired" | "abandoned" | "failed"
  createdAt: number
  expiresAt: number
  acceptedAt: number | null
  resolvedAt: number | null
  attempts: number
  rewardSettled: boolean
  recoveredValue: number
}

export interface BandContribution {
  id: string
  type: ContributionType
  contributorPlayerId: string
  contributorLabel: string
  createdAt: number
  expiresAt: number
  status: "available" | "locked" | "consumed" | "refunded" | "expired" | "revoked"
  missionId: string | null
  resolvedAt: number | null
}

export type ServerMessage =
  | { type: "welcome"; version: typeof PROTOCOL_VERSION; playerId: string; reconnectToken: string; roomCode: string }
  | { type: "room_state"; roomCode: string; phase: "lobby" | "mission"; missionSlug: string; selectedRotationId: string | null; rotationsPaused: boolean; rotations: SheriffRotation[]; upcomingRotations: SheriffRotation[]; rescueOffer: RescueOffer | null; contributions: BandContribution[]; selectedContributionIds: string[]; season: SherwoodSeasonSnapshot | null; players: RoomPlayer[]; village: VillageState; lastResult: LastMissionResult | null }
  | { type: "snapshot"; tick: number; players: Array<Pick<RoomPlayer, "id" | "position" | "lastInputSequence" | "health" | "arrows" | "loot" | "downedFor" | "signatureCooldown" | "protectionScore" | "crowdControl" | "heavyCarryPeak" | "trapHits" | "sabotageCount">>; mission: MissionSnapshot }
  | { type: "pong"; clientTime: number; serverTime: number }
  | { type: "error"; code: "INVALID_MESSAGE" | "VERSION_MISMATCH" | "ROOM_NOT_FOUND" | "ROOM_FULL" | "ROLE_FULL" | "MISSION_STARTED" | "NOT_JOINED" | "FORBIDDEN"; message: string }

export function parseClientMessage(value: unknown): ClientMessage | null {
  const result = ClientMessageSchema.safeParse(value)
  return result.success ? result.data : null
}
