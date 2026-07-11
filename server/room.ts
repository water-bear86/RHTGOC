import { randomUUID } from "node:crypto"
import { WebSocket } from "ws"
import { MAX_ROOM_PLAYERS, RECONNECT_GRACE_MS, type CharacterId, type LastMissionResult, type LoadoutId, type RoomPlayer, type ServerMessage, type VillageState } from "../shared/protocol"
import { Mission } from "./mission"
import { getMissionDefinition } from "../shared/mission-catalog"

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
  totalTransferred: number
  protectionScore: number
  crowdControl: number
  heavyCarryPeak: number
  trapHits: number
  sabotageCount: number
}

function maxArrows(characterId: CharacterId): number {
  return characterId === "robin" ? 6 : characterId === "little-john" ? 3 : 4
}

const spawnPoints = getMissionDefinition().spawns.players

export class Room {
  readonly code: string
  readonly players = new Map<string, ConnectedPlayer>()
  phase: "lobby" | "mission" = "lobby"
  tick = 0
  mission: Mission | null = null
  missionSlug = "peoples-purse"
  village: VillageState = { granary: 0, infirmary: 0, watchtower: 0 }
  lastResult: LastMissionResult | null = null
  readonly moderationEvents: Array<{ at: number; actorId: string; targetId: string; action: "report" | "remove" | "block"; reason?: string }> = []
  private readonly bannedReconnectTokens = new Set<string>()
  private missionId = randomUUID()
  private leaderboardPersistence: "idle" | "pending" | "done" = "idle"

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
      loadoutId: "balanced",
      ready: false,
      connected: true,
      health: 3,
      arrows: maxArrows(characterId),
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
      totalTransferred: 0,
      protectionScore: 0,
      crowdControl: 0,
      heavyCarryPeak: 0,
      trapHits: 0,
      sabotageCount: 0,
    }
    this.players.set(player.id, player)
    return player
  }

  reconnect(socket: WebSocket, token: string, now = Date.now()): ConnectedPlayer | null {
    if (this.bannedReconnectTokens.has(token)) return null
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
      const definition = getMissionDefinition(this.missionSlug)
      for (const player of this.players.values()) player.position = { ...definition.spawns.players[player.spawnIndex] }
      this.mission ??= new Mission(this.code, this.players, definition)
      this.mission.village = { ...this.village }
    }
    this.broadcastRoomState()
  }

  selectCharacter(playerId: string, characterId: CharacterId): boolean {
    const player = this.players.get(playerId)
    if (!player || this.phase !== "lobby") return false
    if (!this.characterAvailable(characterId, playerId)) return false
    player.characterId = characterId
    player.arrows = maxArrows(characterId)
    player.ready = false
    this.broadcastRoomState()
    return true
  }

  selectMission(playerId: string, missionSlug: string): boolean {
    if (this.phase !== "lobby" || this.moderatorId() !== playerId) return false
    try { getMissionDefinition(missionSlug) } catch { return false }
    this.missionSlug = missionSlug
    for (const player of this.players.values()) player.ready = false
    this.broadcastRoomState()
    return true
  }

  selectLoadout(playerId: string, loadoutId: LoadoutId): boolean {
    const player = this.players.get(playerId)
    if (!player || this.phase !== "lobby") return false
    player.loadoutId = loadoutId
    player.ready = false
    this.broadcastRoomState()
    return true
  }

  returnToHub(playerId: string): boolean {
    if (!this.mission || this.moderatorId() !== playerId || this.mission.status === "active" || (this.mission.status === "succeeded" && !this.mission.vote?.resolved)) return false
    if (this.mission.status === "succeeded") this.village = { ...this.mission.village }
    this.lastResult = this.mission.result ? {
      score: this.mission.result.score,
      grade: this.mission.result.grade,
      status: this.mission.status,
      rescuedCaptives: this.mission.captives.filter((captive) => captive.rewarded).length,
      totalCaptives: this.mission.captives.length,
    } : null
    this.phase = "lobby"
    this.mission = null
    this.missionId = randomUUID()
    this.leaderboardPersistence = "idle"
    for (const player of this.players.values()) this.resetPlayerForHub(player)
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

  vote(playerId: string, choice: "granary" | "infirmary" | "watchtower"): void {
    this.mission?.castVote(playerId, choice)
  }

  moderate(
    actorId: string,
    targetId: string,
    action: "report" | "remove" | "block",
    reason?: "harassment" | "griefing" | "unsafe-name" | "cheating",
    now = Date.now(),
  ): boolean {
    const actor = this.players.get(actorId)
    const target = this.players.get(targetId)
    if (!actor?.connected || !target || actorId === targetId) return false
    if (action === "report" && !reason) return false
    if (action !== "report" && this.moderatorId() !== actorId) return false
    this.moderationEvents.push({ at: now, actorId, targetId, action, reason })
    if (action === "report") return true
    if (action === "block") this.bannedReconnectTokens.add(target.reconnectToken)
    target.socket?.close(4003, action === "block" ? "Blocked from this band" : "Removed from this band")
    this.players.delete(targetId)
    this.broadcastRoomState()
    return true
  }

  claimVerifiedRuns(): Array<{
    missionId: string
    playerId: string
    playerName: string
    characterId: CharacterId
    partySize: number
    missionSeconds: number
    delivered: number
    rescues: number
    damageTaken: number
    missionVersion: string
    missionContentHash: string
    missionSlug: string
    result: NonNullable<Mission["result"]>
  }> | null {
    if (!this.mission?.result || this.mission.status !== "succeeded" || this.leaderboardPersistence !== "idle") return null
    this.leaderboardPersistence = "pending"
    return [...this.players.values()].map((player) => ({
      missionId: this.missionId,
      playerId: player.id,
      playerName: player.displayName,
      characterId: player.characterId,
      partySize: this.players.size,
      missionSeconds: this.mission!.elapsedSeconds,
      delivered: this.mission!.delivered,
      rescues: player.rescueCount,
      damageTaken: this.mission!.damageTaken,
      missionVersion: this.mission!.definition.missionVersion,
      missionContentHash: this.mission!.definition.contentHash,
      missionSlug: this.mission!.definition.slug,
      result: this.mission!.result!,
    }))
  }

  finishLeaderboardPersistence(success: boolean): void {
    this.leaderboardPersistence = success ? "done" : "idle"
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
      loadoutId: player.loadoutId,
      ready: player.ready,
      connected: player.connected,
      health: player.health,
      arrows: player.arrows,
      loot: player.loot,
      downedFor: player.downedFor,
      signatureCooldown: player.signatureCooldown,
      protectionScore: player.protectionScore,
      crowdControl: player.crowdControl,
      heavyCarryPeak: player.heavyCarryPeak,
      trapHits: player.trapHits,
      sabotageCount: player.sabotageCount,
      position: player.position,
      lastInputSequence: player.lastInputSequence,
    }
  }

  private characterAvailable(characterId: CharacterId, excludingPlayerId?: string): boolean {
    const selected = [...this.players.values()].filter((player) => player.id !== excludingPlayerId && player.characterId === characterId)
    return selected.length < 2
  }

  private moderatorId(): string | null {
    return [...this.players.values()]
      .filter((player) => player.connected)
      .sort((a, b) => a.spawnIndex - b.spawnIndex)[0]?.id ?? null
  }

  broadcastRoomState(): void {
    this.broadcast({
      type: "room_state",
      roomCode: this.code,
      phase: this.phase,
      missionSlug: this.missionSlug,
      players: [...this.players.values()].map((player) => this.publicPlayer(player)),
      village: { ...this.village },
      lastResult: this.lastResult ? { ...this.lastResult } : null,
    })
  }

  broadcastSnapshot(): void {
    if (!this.mission) return
    this.broadcast({
      type: "snapshot",
      tick: this.tick,
      players: [...this.players.values()].map(({ id, position, lastInputSequence, health, arrows, loot, downedFor, signatureCooldown, protectionScore, crowdControl, heavyCarryPeak, trapHits, sabotageCount }) => ({ id, position, lastInputSequence, health, arrows, loot, downedFor, signatureCooldown, protectionScore, crowdControl, heavyCarryPeak, trapHits, sabotageCount })),
      mission: this.mission.snapshot(),
    })
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message)
    for (const player of this.players.values()) {
      if (player.socket?.readyState === WebSocket.OPEN) player.socket.send(payload)
    }
  }

  private resetPlayerForHub(player: ConnectedPlayer): void {
    const spawn = spawnPoints[player.spawnIndex]
    player.ready = false
    player.health = 3
    player.arrows = maxArrows(player.characterId)
    player.loot = 0
    player.position = { ...spawn }
    player.input = { x: 0, z: 0 }
    player.downedFor = 0
    player.captured = false
    player.signatureCooldown = 0
    player.bowCooldown = 0
    player.invulnerableFor = 0
    player.veilFor = 0
    player.rescueCount = 0
    player.transferCount = 0
    player.totalTransferred = 0
    player.protectionScore = 0
    player.crowdControl = 0
    player.heavyCarryPeak = 0
    player.trapHits = 0
    player.sabotageCount = 0
  }
}
