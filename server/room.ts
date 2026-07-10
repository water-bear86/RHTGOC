import { randomUUID } from "node:crypto"
import { WebSocket } from "ws"
import { MAX_ROOM_PLAYERS, RECONNECT_GRACE_MS, type CharacterId, type RoomPlayer, type ServerMessage } from "../shared/protocol"

interface ConnectedPlayer extends RoomPlayer {
  reconnectToken: string
  socket: WebSocket | null
  disconnectedAt: number | null
  input: { x: number; z: number }
}

const spawnPoints = [
  { x: -8, z: 7 },
  { x: -9.5, z: 7 },
  { x: -8, z: 8.5 },
  { x: -9.5, z: 8.5 },
]

export class Room {
  readonly code: string
  readonly players = new Map<string, ConnectedPlayer>()
  phase: "lobby" | "mission" = "lobby"
  tick = 0

  constructor(code: string) {
    this.code = code
  }

  addPlayer(socket: WebSocket, displayName: string, characterId: CharacterId): ConnectedPlayer {
    this.pruneDisconnected(Date.now())
    if (this.phase !== "lobby") throw new Error("MISSION_STARTED")
    if (this.players.size >= MAX_ROOM_PLAYERS) throw new Error("ROOM_FULL")
    const position = spawnPoints[this.players.size]
    const player: ConnectedPlayer = {
      id: randomUUID(),
      reconnectToken: randomUUID(),
      displayName,
      characterId,
      ready: false,
      connected: true,
      position: { ...position },
      lastInputSequence: 0,
      socket,
      disconnectedAt: null,
      input: { x: 0, z: 0 },
    }
    this.players.set(player.id, player)
    return player
  }

  reconnect(socket: WebSocket, token: string, now = Date.now()): ConnectedPlayer | null {
    const player = [...this.players.values()].find((candidate) => candidate.reconnectToken === token)
    if (!player || player.disconnectedAt === null || now - player.disconnectedAt > RECONNECT_GRACE_MS) return null
    player.socket = socket
    player.connected = true
    player.disconnectedAt = null
    return player
  }

  disconnect(playerId: string, now = Date.now()): void {
    const player = this.players.get(playerId)
    if (!player) return
    player.socket = null
    player.connected = false
    player.disconnectedAt = now
    player.input = { x: 0, z: 0 }
    this.broadcastRoomState()
  }

  pruneDisconnected(now: number): void {
    for (const [id, player] of this.players) {
      if (player.disconnectedAt !== null && now - player.disconnectedAt > RECONNECT_GRACE_MS) this.players.delete(id)
    }
  }

  setReady(playerId: string, ready: boolean): void {
    const player = this.players.get(playerId)
    if (!player || this.phase !== "lobby") return
    player.ready = ready
    const connected = [...this.players.values()].filter((candidate) => candidate.connected)
    if (connected.length >= 2 && connected.every((candidate) => candidate.ready)) this.phase = "mission"
    this.broadcastRoomState()
  }

  selectCharacter(playerId: string, characterId: CharacterId): void {
    const player = this.players.get(playerId)
    if (!player || this.phase !== "lobby") return
    player.characterId = characterId
    player.ready = false
    this.broadcastRoomState()
  }

  setInput(playerId: string, sequence: number, move: { x: number; z: number }): void {
    const player = this.players.get(playerId)
    if (!player || this.phase !== "mission" || sequence <= player.lastInputSequence) return
    const length = Math.hypot(move.x, move.z)
    player.input = length > 1 ? { x: move.x / length, z: move.z / length } : move
    player.lastInputSequence = sequence
  }

  update(dt: number): void {
    this.pruneDisconnected(Date.now())
    if (this.phase !== "mission") return
    this.tick += 1
    for (const player of this.players.values()) {
      if (!player.connected) continue
      const speed = player.characterId === "marian" ? 6.75 : 6.2
      player.position.x = Math.max(-22, Math.min(22, player.position.x + player.input.x * speed * dt))
      player.position.z = Math.max(-22, Math.min(22, player.position.z + player.input.z * speed * dt))
    }
  }

  publicPlayer(player: ConnectedPlayer): RoomPlayer {
    return {
      id: player.id,
      displayName: player.displayName,
      characterId: player.characterId,
      ready: player.ready,
      connected: player.connected,
      position: player.position,
      lastInputSequence: player.lastInputSequence,
    }
  }

  broadcastRoomState(): void {
    this.broadcast({ type: "room_state", roomCode: this.code, phase: this.phase, players: [...this.players.values()].map((player) => this.publicPlayer(player)) })
  }

  broadcastSnapshot(): void {
    if (this.phase !== "mission") return
    this.broadcast({
      type: "snapshot",
      tick: this.tick,
      players: [...this.players.values()].map(({ id, position, lastInputSequence }) => ({ id, position, lastInputSequence })),
    })
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message)
    for (const player of this.players.values()) {
      if (player.socket?.readyState === WebSocket.OPEN) player.socket.send(payload)
    }
  }
}
