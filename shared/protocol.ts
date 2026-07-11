import { z } from "zod"

export const PROTOCOL_VERSION = 3 as const
export const MAX_ROOM_PLAYERS = 4
export const RECONNECT_GRACE_MS = 30_000

export const CharacterIdSchema = z.enum(["robin", "marian"])
export type CharacterId = z.infer<typeof CharacterIdSchema>

const DisplayNameSchema = z.string().trim().min(1).max(20).regex(/^[a-zA-Z0-9 _-]+$/)
const RoomCodeSchema = z.string().trim().length(6).regex(/^[A-Z2-9]+$/)

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create_room"),
    version: z.literal(PROTOCOL_VERSION),
    displayName: DisplayNameSchema,
    characterId: CharacterIdSchema,
  }),
  z.object({
    type: z.literal("join_room"),
    version: z.literal(PROTOCOL_VERSION),
    roomCode: RoomCodeSchema,
    displayName: DisplayNameSchema,
    characterId: CharacterIdSchema,
    reconnectToken: z.string().uuid().optional(),
  }),
  z.object({ type: z.literal("set_ready"), ready: z.boolean() }),
  z.object({ type: z.literal("select_character"), characterId: CharacterIdSchema }),
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
])

export type ClientMessage = z.infer<typeof ClientMessageSchema>

export interface RoomPlayer {
  id: string
  displayName: string
  characterId: CharacterId
  ready: boolean
  connected: boolean
  health: number
  arrows: number
  loot: number
  downedFor: number
  signatureCooldown: number
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
  type: "mission_started" | "phase_changed" | "route_selected" | "cart_robbed" | "loot_delivered" | "guard_stunned" | "player_hit" | "player_downed" | "player_revived" | "player_captured" | "loot_transferred" | "ping_sent" | "signature_used" | "mission_succeeded" | "mission_failed" | "vote_cast" | "vote_resolved"
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

export interface MissionSnapshot {
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
  optionalObjectives: Array<{ id: "no-captures" | "share-the-wealth" | "two-roads"; label: string; completed: boolean; failed: boolean }>
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

export type ServerMessage =
  | { type: "welcome"; version: typeof PROTOCOL_VERSION; playerId: string; reconnectToken: string; roomCode: string }
  | { type: "room_state"; roomCode: string; phase: "lobby" | "mission"; players: RoomPlayer[] }
  | { type: "snapshot"; tick: number; players: Array<Pick<RoomPlayer, "id" | "position" | "lastInputSequence" | "health" | "arrows" | "loot" | "downedFor" | "signatureCooldown">>; mission: MissionSnapshot }
  | { type: "pong"; clientTime: number; serverTime: number }
  | { type: "error"; code: "INVALID_MESSAGE" | "VERSION_MISMATCH" | "ROOM_NOT_FOUND" | "ROOM_FULL" | "ROLE_FULL" | "MISSION_STARTED" | "NOT_JOINED" | "FORBIDDEN"; message: string }

export function parseClientMessage(value: unknown): ClientMessage | null {
  const result = ClientMessageSchema.safeParse(value)
  return result.success ? result.data : null
}
