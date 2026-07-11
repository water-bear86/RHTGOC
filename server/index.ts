import { createServer } from "node:http"
import { randomInt, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { WebSocket, WebSocketServer } from "ws"
import { PROTOCOL_VERSION, parseClientMessage, type ServerMessage } from "../shared/protocol"
import { Room, type RescueOfferTransition } from "./room"
import { createBandStoreFromEnv } from "./band-store"
import { createLeaderboardStoreFromEnv } from "./leaderboard-store"
import { structuredLog, Telemetry } from "./telemetry"
import { getMissionDefinition } from "../shared/mission-catalog"
import type { SheriffRotation } from "../shared/sheriff-rotation"
import { SheriffRotationService } from "./rotation-service"
import { createRescueOfferStoreFromEnv } from "./rescue-offer-store"

const port = Number(process.env.PORT ?? 8787)
const rooms = new Map<string, Room>()
const bandStore = createBandStoreFromEnv()
const leaderboardStore = createLeaderboardStoreFromEnv()
const rescueOfferStore = createRescueOfferStoreFromEnv()
const telemetry = new Telemetry()
const rotationService = new SheriffRotationService()
const opsAdminSecret = process.env.OPS_ADMIN_SECRET
const defaultMission = getMissionDefinition()
const observedRoomPhases = new Map<string, string>()
const observedMissionStatus = new Map<string, string>()
const roomTraces = new Map<string, string>()
let activeConnections = 0
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const pendingRescueTransitions = new Map<string, { transition: RescueOfferTransition; attempts: number; nextAttemptAt: number }>()
let rescuePersistenceFlushing = false

function roomCode(): string {
  let code = ""
  do {
    code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("")
  } while (rooms.has(code))
  return code
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
}

function json(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
  response.end(JSON.stringify(value))
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > 65_536) throw new Error("BODY_TOO_LARGE")
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown
}

function operatorAuthorized(request: import("node:http").IncomingMessage): boolean {
  return Boolean(opsAdminSecret && request.headers.authorization === `Bearer ${opsAdminSecret}`)
}

function enqueueRescueTransition(transition: RescueOfferTransition): void {
  if (!rescueOfferStore) return
  const key = `${transition.offer.id}:${transition.sequence}`
  pendingRescueTransitions.set(key, { transition, attempts: 0, nextAttemptAt: Date.now() })
  telemetry.gauge("rescue_persistence_queue", pendingRescueTransitions.size)
}

async function flushRescueTransitions(now = Date.now()): Promise<void> {
  if (!rescueOfferStore || rescuePersistenceFlushing) return
  rescuePersistenceFlushing = true
  try {
    for (const [key, pending] of pendingRescueTransitions) {
      if (pending.nextAttemptAt > now) continue
      try {
        await rescueOfferStore.recordTransition(pending.transition)
        pendingRescueTransitions.delete(key)
        telemetry.increment("rescue_persistence_success_total")
      } catch (error) {
        pending.attempts += 1
        pending.nextAttemptAt = now + Math.min(60_000, 1_000 * 2 ** Math.min(6, pending.attempts))
        telemetry.increment("rescue_persistence_retry_total")
        structuredLog("rescue_persistence_retry", {
          offerId: pending.transition.offer.id,
          sequence: pending.transition.sequence,
          attempts: pending.attempts,
          reason: error instanceof Error ? error.message : "unknown",
        }, "error")
      }
    }
  } finally {
    rescuePersistenceFlushing = false
    telemetry.gauge("rescue_persistence_queue", pendingRescueTransitions.size)
  }
}

const httpServer = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname
  if (pathname === "/rotations" && request.method === "GET") {
    json(response, 200, rotationService.window())
    return
  }
  if (pathname.startsWith("/admin/rotations/") && request.method === "POST") {
    if (!opsAdminSecret) {
      json(response, 503, { error: "Operator controls are not configured" })
      return
    }
    if (!operatorAuthorized(request)) {
      telemetry.increment("rotation_admin_unauthorized_total")
      json(response, 401, { error: "Unauthorized" })
      return
    }
    try {
      if (pathname === "/admin/rotations/pause") {
        const body = await readJsonBody(request) as { until?: unknown }
        rotationService.pause(Number(body.until))
        telemetry.increment("rotation_admin_pause_total")
      } else if (pathname === "/admin/rotations/replace") {
        const body = await readJsonBody(request) as { rotations?: unknown }
        if (!Array.isArray(body.rotations)) throw new Error("ROTATIONS_REQUIRED")
        rotationService.replace(body.rotations as SheriffRotation[])
        telemetry.increment("rotation_admin_replace_total")
      } else if (pathname === "/admin/rotations/rollback") {
        rotationService.rollback()
        telemetry.increment("rotation_admin_rollback_total")
      } else {
        json(response, 404, { error: "Unknown rotation operation" })
        return
      }
      structuredLog("rotation_admin_changed", { operation: pathname.split("/").at(-1) ?? "unknown" })
      json(response, 200, rotationService.window())
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : "Invalid rotation operation" })
    }
    return
  }
  if (request.url === "/metrics") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    response.end(JSON.stringify(telemetry.snapshot()))
    return
  }
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify({
      ok: true,
      rooms: rooms.size,
      protocolVersion: PROTOCOL_VERSION,
      bandPersistence: bandStore !== null,
      verifiedLeaderboardWrites: leaderboardStore !== null,
      rescueOfferPersistence: rescueOfferStore !== null,
      missionId: defaultMission.id,
      missionVersion: defaultMission.missionVersion,
      missionContentHash: defaultMission.contentHash,
      rotations: rotationService.window(),
    }))
    return
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ error: "Method not allowed" }))
    return
  }
  const requested = pathname === "/" ? "index.html" : normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "")
  const filePath = join(process.cwd(), "dist", requested)
  try {
    const body = await readFile(filePath)
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    })
    if (request.method === "HEAD") response.end()
    else response.end(body)
  } catch {
    try {
      const body = await readFile(join(process.cwd(), "dist", "index.html"))
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" })
      response.end(body)
    } catch {
      response.writeHead(404, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: "Not found" }))
    }
  }
})

const sockets = new WebSocketServer({ server: httpServer, path: "/rooms" })
sockets.on("connection", (socket) => {
  telemetry.increment("connections_total")
  activeConnections += 1
  telemetry.gauge("active_connections", activeConnections)
  let joinedRoom: Room | null = null
  let playerId: string | null = null
  let lastClientMetricsAt = 0

  socket.on("message", (raw) => {
    let value: unknown
    try {
      value = JSON.parse(raw.toString())
    } catch {
      telemetry.increment("protocol_invalid_json_total")
      send(socket, { type: "error", code: "INVALID_MESSAGE", message: "Message must be valid JSON" })
      return
    }
    const message = parseClientMessage(value)
    if (!message) {
      telemetry.increment("protocol_invalid_message_total")
      send(socket, { type: "error", code: "INVALID_MESSAGE", message: "Message failed protocol validation" })
      return
    }

    if (message.type === "create_room" || message.type === "join_room") {
      try {
        const room = message.type === "create_room" ? new Room(roomCode(), (now) => rotationService.window(now)) : rooms.get(message.roomCode)
        if (!room) {
          send(socket, { type: "error", code: "ROOM_NOT_FOUND", message: "Merry Band room not found" })
          return
        }
        if (message.type === "create_room") rooms.set(room.code, room)
        if (message.type === "join_room" && message.reconnectToken) telemetry.increment("reconnect_attempts_total")
        const reconnected = message.type === "join_room" && message.reconnectToken
          ? room.reconnect(socket, message.reconnectToken)
          : null
        const player = reconnected ?? room.addPlayer(socket, message.displayName, message.characterId)
        telemetry.increment(reconnected ? "reconnect_success_total" : message.type === "create_room" ? "rooms_created_total" : "room_joins_total")
        if (message.type === "create_room") {
          const traceId = randomUUID()
          roomTraces.set(room.code, traceId)
          structuredLog("room_created", { traceId })
        }
        joinedRoom = room
        playerId = player.id
        send(socket, { type: "welcome", version: PROTOCOL_VERSION, playerId: player.id, reconnectToken: player.reconnectToken, roomCode: room.code })
        room.broadcastRoomState()
      } catch (error) {
        const reason = error instanceof Error ? error.message : "MISSION_STARTED"
        const code = reason === "ROOM_FULL" ? "ROOM_FULL" : reason === "ROLE_FULL" ? "ROLE_FULL" : "MISSION_STARTED"
        const message = code === "ROOM_FULL"
          ? "This Merry Band is full"
          : code === "ROLE_FULL"
            ? "That role is full — choose the other outlaw"
            : "This mission has already begun"
        send(socket, { type: "error", code, message })
      }
      return
    }

    if (!joinedRoom || !playerId) {
      send(socket, { type: "error", code: "NOT_JOINED", message: "Join a room before sending mission actions" })
      return
    }
    if (message.type === "set_ready" && !joinedRoom.setReady(playerId, message.ready) && message.ready) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "That daily target expired or requires a different party size" })
    }
    if (message.type === "set_ready" && message.ready) telemetry.increment("players_ready_total")
    if (message.type === "select_character" && !joinedRoom.selectCharacter(playerId, message.characterId)) {
      send(socket, { type: "error", code: "ROLE_FULL", message: "That role is full — choose the other outlaw" })
      joinedRoom.broadcastRoomState()
    }
    if (message.type === "select_mission" && !joinedRoom.selectMission(playerId, message.missionSlug)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "Only the band leader can choose an available mission" })
    }
    if (message.type === "select_rotation" && !joinedRoom.selectRotation(playerId, message.rotationId)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "That Sheriff target is expired, paused, or unavailable" })
    }
    if (message.type === "select_loadout" && !joinedRoom.selectLoadout(playerId, message.loadoutId)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "Field kits can only change at the campfire" })
    }
    if (message.type === "return_to_hub" && !joinedRoom.returnToHub(playerId)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "Resolve the village vote before the leader returns the band to camp" })
    }
    if (message.type === "accept_rescue" && !joinedRoom.acceptRescue(playerId, message.offerId)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "That rescue offer expired, was already handled, or requires the band leader" })
    }
    if (message.type === "abandon_rescue" && !joinedRoom.abandonRescue(playerId, message.offerId)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "That rescue offer cannot be abandoned" })
    }
    if (message.type === "input") joinedRoom.setInput(playerId, message.sequence, message.move)
    if (message.type === "action") {
      joinedRoom.action(playerId, message.action, message.targetPlayerId)
      telemetry.increment(`action_${message.action}_total`)
    }
    if (message.type === "world_ping") joinedRoom.ping(playerId, message.kind)
    if (message.type === "world_ping") telemetry.increment("world_pings_total")
    if (message.type === "redistribution_vote") {
      joinedRoom.vote(playerId, message.choice)
      telemetry.increment("redistribution_votes_total")
    }
    if (message.type === "select_mission") telemetry.increment("hub_mission_selections_total")
    if (message.type === "select_rotation") telemetry.increment("rotation_selections_total")
    if (message.type === "select_loadout") telemetry.increment(`hub_loadout_${message.loadoutId}_total`)
    if (message.type === "return_to_hub") telemetry.increment("hub_returns_total")
    if (message.type === "accept_rescue") telemetry.increment("rescue_offer_accept_attempts_total")
    if (message.type === "abandon_rescue") telemetry.increment("rescue_offer_abandon_attempts_total")
    if (message.type === "moderation" && !joinedRoom.moderate(playerId, message.targetPlayerId, message.action, message.reason)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "That moderation action is not allowed" })
    }
    if (message.type === "moderation") telemetry.increment(`moderation_${message.action}_total`)
    if (message.type === "client_metrics" && Date.now() - lastClientMetricsAt >= 5_000) {
      lastClientMetricsAt = Date.now()
      telemetry.increment("client_metrics_reports_total")
      telemetry.increment(`input_backlog_${message.inputBacklog <= 2 ? "healthy" : message.inputBacklog <= 10 ? "degraded" : "desynced"}_total`)
      telemetry.increment(`snapshot_gap_${message.snapshotGapMs <= 250 ? "healthy" : message.snapshotGapMs <= 1_000 ? "degraded" : "desynced"}_total`)
    }
    if (message.type === "ping") send(socket, { type: "pong", clientTime: message.clientTime, serverTime: Date.now() })
  })

  socket.on("close", () => {
    activeConnections = Math.max(0, activeConnections - 1)
    telemetry.gauge("active_connections", activeConnections)
    telemetry.increment("disconnects_total")
    if (joinedRoom && playerId) joinedRoom.disconnect(playerId)
  })
})

setInterval(() => {
  let activePlayers = 0
  for (const [code, room] of rooms) {
    room.update(1 / 20)
    for (const transition of room.drainRescueOfferEvents()) {
      enqueueRescueTransition(transition)
      telemetry.increment(`rescue_offer_${transition.offer.status}_total`)
      structuredLog("rescue_offer_transition", {
        traceId: roomTraces.get(code) ?? null,
        offerId: transition.offer.id,
        status: transition.offer.status,
        context: transition.offer.context,
        targetCount: transition.offer.targetCount,
        attempts: transition.offer.attempts,
      })
    }
    const verifiedRuns = leaderboardStore?.recordVerifiedRun ? room.claimVerifiedRuns() : null
    if (verifiedRuns) {
      void Promise.all(verifiedRuns.map((run) => leaderboardStore!.recordVerifiedRun(run)))
        .then(() => {
          room.finishLeaderboardPersistence(true)
          telemetry.increment("leaderboard_persistence_success_total", verifiedRuns.length)
        })
        .catch((error) => {
          room.finishLeaderboardPersistence(false)
          telemetry.increment("leaderboard_persistence_failure_total")
          structuredLog("leaderboard_persistence_failed", {
            traceId: roomTraces.get(code) ?? null,
            reason: error instanceof Error ? error.message : "unknown",
          }, "error")
        })
    }
    if (room.players.size === 0) {
      rooms.delete(code)
      observedRoomPhases.delete(code)
      observedMissionStatus.delete(code)
      const traceId = roomTraces.get(code) ?? null
      roomTraces.delete(code)
      structuredLog("room_expired", { traceId })
      continue
    }
    activePlayers += [...room.players.values()].filter((player) => player.connected).length
    const phase = room.mission?.phase
    if (phase && observedRoomPhases.get(code) !== phase) {
      observedRoomPhases.set(code, phase)
      telemetry.increment(`mission_phase_${phase}_total`)
      structuredLog("mission_phase_changed", { traceId: roomTraces.get(code) ?? null, phase, partySize: room.players.size })
      if (phase === "scout" && room.mission?.rotationId) {
        telemetry.increment("rotation_starts_total")
        if (room.rotationAttemptCount > 1) telemetry.increment("rotation_repeat_attempts_total")
        telemetry.increment(`rotation_party_${room.players.size}_starts_total`)
        for (const modifier of room.mission.rotationModifierIds) telemetry.increment(`rotation_modifier_${modifier}_starts_total`)
        for (const player of room.players.values()) telemetry.increment(`rotation_role_${player.characterId}_starts_total`)
      }
    }
    const status = room.mission?.status
    if (status && observedMissionStatus.get(code) !== status) {
      observedMissionStatus.set(code, status)
      if (status !== "active") {
        telemetry.increment(`mission_${status}_total`)
        if (room.mission?.rotationId) telemetry.increment(`rotation_${status}_total`)
        structuredLog("mission_finished", { traceId: roomTraces.get(code) ?? null, status, partySize: room.players.size })
      }
    }
  }
  telemetry.gauge("active_rooms", rooms.size)
  telemetry.gauge("active_players", activePlayers)
}, 50)

setInterval(() => void flushRescueTransitions(), 1_000)

setInterval(() => {
  for (const room of rooms.values()) room.broadcastSnapshot()
}, 100)

httpServer.listen(port, "0.0.0.0", () => {
  structuredLog("server_started", {
    port,
    protocolVersion: PROTOCOL_VERSION,
    bandPersistence: bandStore !== null,
    verifiedLeaderboardWrites: leaderboardStore !== null,
    rescueOfferPersistence: rescueOfferStore !== null,
    missionId: defaultMission.id,
    missionVersion: defaultMission.missionVersion,
    missionContentHash: defaultMission.contentHash,
  })
})
