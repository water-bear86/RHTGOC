import { z } from "zod"

export const PROTOCOL_VERSION = 1 as const
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
  z.object({ type: z.literal("ping"), clientTime: z.number().finite() }),
])

export type ClientMessage = z.infer<typeof ClientMessageSchema>

export interface RoomPlayer {
  id: string
  displayName: string
  characterId: CharacterId
  ready: boolean
  connected: boolean
  position: { x: number; z: number }
  lastInputSequence: number
}

export type ServerMessage =
  | { type: "welcome"; version: typeof PROTOCOL_VERSION; playerId: string; reconnectToken: string; roomCode: string }
  | { type: "room_state"; roomCode: string; phase: "lobby" | "mission"; players: RoomPlayer[] }
  | { type: "snapshot"; tick: number; players: Array<Pick<RoomPlayer, "id" | "position" | "lastInputSequence">> }
  | { type: "pong"; clientTime: number; serverTime: number }
  | { type: "error"; code: "INVALID_MESSAGE" | "VERSION_MISMATCH" | "ROOM_NOT_FOUND" | "ROOM_FULL" | "MISSION_STARTED" | "NOT_JOINED"; message: string }

export function parseClientMessage(value: unknown): ClientMessage | null {
  const result = ClientMessageSchema.safeParse(value)
  return result.success ? result.data : null
}
