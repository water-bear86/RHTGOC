import { createServer } from "node:http"
import { randomInt, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { WebSocket, WebSocketServer } from "ws"
import { PROTOCOL_VERSION, parseClientMessage, type ServerMessage } from "../shared/protocol"
import { Room } from "./room"
import { createBandStoreFromEnv } from "./band-store"
import { createLeaderboardStoreFromEnv } from "./leaderboard-store"
import { structuredLog, Telemetry } from "./telemetry"

const port = Number(process.env.PORT ?? 8787)
const rooms = new Map<string, Room>()
const bandStore = createBandStoreFromEnv()
const leaderboardStore = createLeaderboardStoreFromEnv()
const telemetry = new Telemetry()
const observedRoomPhases = new Map<string, string>()
const observedMissionStatus = new Map<string, string>()
const roomTraces = new Map<string, string>()
let activeConnections = 0
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

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

const httpServer = createServer(async (request, response) => {
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
    }))
    return
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ error: "Method not allowed" }))
    return
  }
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname
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
        const room = message.type === "create_room" ? new Room(roomCode()) : rooms.get(message.roomCode)
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
    if (message.type === "set_ready") joinedRoom.setReady(playerId, message.ready)
    if (message.type === "set_ready" && message.ready) telemetry.increment("players_ready_total")
    if (message.type === "select_character" && !joinedRoom.selectCharacter(playerId, message.characterId)) {
      send(socket, { type: "error", code: "ROLE_FULL", message: "That role is full — choose the other outlaw" })
      joinedRoom.broadcastRoomState()
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
    }
    const status = room.mission?.status
    if (status && observedMissionStatus.get(code) !== status) {
      observedMissionStatus.set(code, status)
      if (status !== "active") {
        telemetry.increment(`mission_${status}_total`)
        structuredLog("mission_finished", { traceId: roomTraces.get(code) ?? null, status, partySize: room.players.size })
      }
    }
  }
  telemetry.gauge("active_rooms", rooms.size)
  telemetry.gauge("active_players", activePlayers)
}, 50)

setInterval(() => {
  for (const room of rooms.values()) room.broadcastSnapshot()
}, 100)

httpServer.listen(port, "0.0.0.0", () => {
  structuredLog("server_started", {
    port,
    protocolVersion: PROTOCOL_VERSION,
    bandPersistence: bandStore !== null,
    verifiedLeaderboardWrites: leaderboardStore !== null,
  })
})
