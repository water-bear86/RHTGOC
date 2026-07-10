import { createServer } from "node:http"
import { randomInt } from "node:crypto"
import { WebSocket, WebSocketServer } from "ws"
import { PROTOCOL_VERSION, parseClientMessage, type ServerMessage } from "../shared/protocol"
import { Room } from "./room"

const port = Number(process.env.PORT ?? 8787)
const rooms = new Map<string, Room>()
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

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ ok: true, rooms: rooms.size, protocolVersion: PROTOCOL_VERSION }))
    return
  }
  response.writeHead(404, { "Content-Type": "application/json" })
  response.end(JSON.stringify({ error: "Not found" }))
})

const sockets = new WebSocketServer({ server: httpServer, path: "/rooms" })
sockets.on("connection", (socket) => {
  let joinedRoom: Room | null = null
  let playerId: string | null = null

  socket.on("message", (raw) => {
    let value: unknown
    try {
      value = JSON.parse(raw.toString())
    } catch {
      send(socket, { type: "error", code: "INVALID_MESSAGE", message: "Message must be valid JSON" })
      return
    }
    const message = parseClientMessage(value)
    if (!message) {
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
        const reconnected = message.type === "join_room" && message.reconnectToken
          ? room.reconnect(socket, message.reconnectToken)
          : null
        const player = reconnected ?? room.addPlayer(socket, message.displayName, message.characterId)
        joinedRoom = room
        playerId = player.id
        send(socket, { type: "welcome", version: PROTOCOL_VERSION, playerId: player.id, reconnectToken: player.reconnectToken, roomCode: room.code })
        room.broadcastRoomState()
      } catch (error) {
        const code = error instanceof Error && error.message === "ROOM_FULL" ? "ROOM_FULL" : "MISSION_STARTED"
        send(socket, { type: "error", code, message: code === "ROOM_FULL" ? "This Merry Band is full" : "This mission has already begun" })
      }
      return
    }

    if (!joinedRoom || !playerId) {
      send(socket, { type: "error", code: "NOT_JOINED", message: "Join a room before sending mission actions" })
      return
    }
    if (message.type === "set_ready") joinedRoom.setReady(playerId, message.ready)
    if (message.type === "select_character") joinedRoom.selectCharacter(playerId, message.characterId)
    if (message.type === "input") joinedRoom.setInput(playerId, message.sequence, message.move)
    if (message.type === "ping") send(socket, { type: "pong", clientTime: message.clientTime, serverTime: Date.now() })
  })

  socket.on("close", () => {
    if (joinedRoom && playerId) joinedRoom.disconnect(playerId)
  })
})

setInterval(() => {
  for (const [code, room] of rooms) {
    room.update(1 / 20)
    if (room.players.size === 0) rooms.delete(code)
  }
}, 50)

setInterval(() => {
  for (const room of rooms.values()) room.broadcastSnapshot()
}, 100)

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Sherwood room server listening on http://0.0.0.0:${port}`)
})
