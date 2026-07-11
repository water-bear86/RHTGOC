import { randomUUID } from "node:crypto"
import { WebSocket } from "ws"
import { MAX_ROOM_PLAYERS, RECONNECT_GRACE_MS, type CharacterId, type RoomPlayer, type ServerMessage } from "../shared/protocol"
import { Mission } from "./mission"

interface ConnectedPlayer extends RoomPlayer {
  reconnectToken: string
  socket: WebSocket | null
  disconnectedAt: number | null
  input: { x: number; z: number }
  spawnIndex: number
  arrows: number
  loot: number
  lastInputAt: number
  bowCooldown: number
  signatureCooldown: number
  invulnerableFor: number
  veilFor: number
  downedFor: number
  captured: boolean
  rescueCount: number
  transferCount: number
  lastPingTick: number
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
  mission: Mission | null = null

  constructor(code: string) {
    this.code = code
  }

  addPlayer(socket: WebSocket, displayName: string, characterId: CharacterId): ConnectedPlayer {
    this.pruneDisconnected(Date.now())
    if (this.phase !== "lobby") throw new Error("MISSION_STARTED")
    if (this.players.size >= MAX_ROOM_PLAYERS) throw new Error("ROOM_FULL")
    if (!this.characterAvailable(characterId)) throw new Error("ROLE_FULL")
    const occupiedSpawns = new Set([...this.players.values()].map((player) => player.spawnIndex))
    const spawnIndex = spawnPoints.findIndex((_, index) => !occupiedSpawns.has(index))
    const position = spawnPoints[spawnIndex]
    const player: ConnectedPlayer = {
      id: randomUUID(),
      reconnectToken: randomUUID(),
      displayName,
      characterId,
      ready: false,
      connected: true,
      health: 3,
      arrows: characterId === "robin" ? 6 : 4,
      loot: 0,
      position: { ...position },
      lastInputSequence: 0,
      socket,
      disconnectedAt: null,
      input: { x: 0, z: 0 },
      spawnIndex,
      lastInputAt: 0,
      bowCooldown: 0,
      signatureCooldown: 0,
      invulnerableFor: 0,
      veilFor: 0,
      downedFor: 0,
      captured: false,
      rescueCount: 0,
      transferCount: 0,
      lastPingTick: -20,
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
    if (connected.length >= 2 && connected.every((candidate) => candidate.ready)) {
      this.phase = "mission"
      this.mission ??= new Mission(this.code, this.players)
    }
    this.broadcastRoomState()
  }

  selectCharacter(playerId: string, characterId: CharacterId): boolean {
    const player = this.players.get(playerId)
    if (!player || this.phase !== "lobby") return false
    if (!this.characterAvailable(characterId, playerId)) return false
    player.characterId = characterId
    player.arrows = characterId === "robin" ? 6 : 4
    player.ready = false
    this.broadcastRoomState()
    return true
  }

  setInput(playerId: string, sequence: number, move: { x: number; z: number }): void {
    this.mission?.setInput(playerId, sequence, move)
  }

  action(playerId: string, action: "interact" | "shoot" | "signature" | "revive" | "transfer_loot", targetPlayerId?: string): void {
    this.mission?.action(playerId, action, targetPlayerId)
  }

  ping(playerId: string, kind: "danger" | "target" | "route" | "loot" | "regroup"): void {
    this.mission?.ping(playerId, kind)
  }

  update(dt: number): void {
    this.pruneDisconnected(Date.now())
    if (!this.mission) return
    this.mission.update(dt)
    this.tick = this.mission.tick
  }

  publicPlayer(player: ConnectedPlayer): RoomPlayer {
    return {
      id: player.id,
      displayName: player.displayName,
      characterId: player.characterId,
      ready: player.ready,
      connected: player.connected,
      health: player.health,
      arrows: player.arrows,
      loot: player.loot,
      downedFor: player.downedFor,
      position: player.position,
      lastInputSequence: player.lastInputSequence,
    }
  }

  private characterAvailable(characterId: CharacterId, excludingPlayerId?: string): boolean {
    const selected = [...this.players.values()].filter((player) => player.id !== excludingPlayerId && player.characterId === characterId)
    return selected.length < 2
  }

  broadcastRoomState(): void {
    this.broadcast({ type: "room_state", roomCode: this.code, phase: this.phase, players: [...this.players.values()].map((player) => this.publicPlayer(player)) })
  }

  broadcastSnapshot(): void {
    if (!this.mission) return
    this.broadcast({
      type: "snapshot",
      tick: this.tick,
      players: [...this.players.values()].map(({ id, position, lastInputSequence, health, arrows, loot, downedFor }) => ({ id, position, lastInputSequence, health, arrows, loot, downedFor })),
      mission: this.mission.snapshot(),
    })
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message)
    for (const player of this.players.values()) {
      if (player.socket?.readyState === WebSocket.OPEN) player.socket.send(payload)
    }
  }
}
