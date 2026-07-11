import { PROTOCOL_VERSION, type CharacterId, type LastMissionResult, type LoadoutId, type MissionSnapshot, type PingKind, type RescueOffer, type RoomPlayer, type ServerMessage, type VillageState, type VoteChoice } from "../shared/protocol"
import type { Vec2 } from "./simulation"
import type { SheriffRotation } from "../shared/sheriff-rotation"

export interface MultiplayerEvents {
  onWelcome?: (playerId: string, roomCode: string) => void
  onRoomState?: (roomCode: string, phase: "lobby" | "mission", players: RoomPlayer[], missionSlug: string, village: VillageState, lastResult: LastMissionResult | null, selectedRotationId: string | null, rotationsPaused: boolean, rotations: SheriffRotation[], upcomingRotations: SheriffRotation[], rescueOffer: RescueOffer | null) => void
  onSnapshot?: (tick: number, players: Array<Pick<RoomPlayer, "id" | "position" | "lastInputSequence" | "health" | "arrows" | "loot" | "downedFor" | "signatureCooldown" | "protectionScore" | "crowdControl" | "heavyCarryPeak" | "trapHits" | "sabotageCount">>, mission: MissionSnapshot) => void
  onError?: (message: string) => void
  onConnection?: (connected: boolean) => void
}

export class MultiplayerClient {
  private socket: WebSocket | null = null
  private sequence = 0
  private lastInputAt = 0
  private pendingAction: (() => void) | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private reconnectSession: { roomCode: string; displayName: string; characterId: CharacterId } | null = null
  private heartbeatTimer: number | null = null
  private intentionallyClosed = false
  private connectionId = 0
  private lastSnapshotAt = 0
  private lastMetricsAt = 0
  private pendingIdentity: { displayName: string; characterId: CharacterId } | null = null
  playerId: string | null = null
  roomCode: string | null = null

  constructor(private readonly events: MultiplayerEvents) {}

  createRoom(displayName: string, characterId: CharacterId): void {
    this.reconnectSession = null
    this.pendingIdentity = { displayName, characterId }
    this.connect(() => this.send({ type: "create_room", version: PROTOCOL_VERSION, displayName, characterId }))
  }

  joinRoom(roomCode: string, displayName: string, characterId: CharacterId): void {
    const normalizedCode = roomCode.trim().toUpperCase()
    this.reconnectSession = { roomCode: normalizedCode, displayName, characterId }
    this.pendingIdentity = { displayName, characterId }
    const reconnectToken = localStorage.getItem(`sherwood:reconnect:${normalizedCode}`) ?? undefined
    this.connect(() => this.send({ type: "join_room", version: PROTOCOL_VERSION, roomCode: normalizedCode, displayName, characterId, reconnectToken }))
  }

  setReady(ready: boolean): void {
    this.send({ type: "set_ready", ready })
  }

  selectCharacter(characterId: CharacterId): void {
    if (this.reconnectSession) this.reconnectSession.characterId = characterId
    this.send({ type: "select_character", characterId })
  }

  selectMission(missionSlug: string): void {
    this.send({ type: "select_mission", missionSlug })
  }

  selectRotation(rotationId: string): void {
    this.send({ type: "select_rotation", rotationId })
  }

  selectLoadout(loadoutId: LoadoutId): void {
    this.send({ type: "select_loadout", loadoutId })
  }

  returnToHub(): void {
    this.send({ type: "return_to_hub" })
  }

  acceptRescue(offerId: string): void {
    this.send({ type: "accept_rescue", offerId })
  }

  abandonRescue(offerId: string): void {
    this.send({ type: "abandon_rescue", offerId })
  }

  sendInput(move: Vec2): void {
    const now = performance.now()
    if (now - this.lastInputAt < 50) return
    this.lastInputAt = now
    this.sequence += 1
    const length = Math.hypot(move.x, move.z)
    const normalized = length > 1 ? { x: move.x / length, z: move.z / length } : move
    this.send({ type: "input", sequence: this.sequence, move: normalized })
  }

  sendAction(action: "interact" | "shoot" | "signature" | "revive" | "transfer_loot", targetPlayerId?: string): void {
    this.send({ type: "action", action, targetPlayerId })
  }

  sendPing(kind: PingKind): void {
    this.send({ type: "world_ping", kind })
  }

  vote(choice: VoteChoice): void {
    this.send({ type: "redistribution_vote", choice })
  }

  moderate(action: "report" | "remove" | "block", targetPlayerId: string, reason?: "harassment" | "griefing" | "unsafe-name" | "cheating"): void {
    this.send({ type: "moderation", action, targetPlayerId, reason })
  }

  close(): void {
    this.intentionallyClosed = true
    this.connectionId += 1
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer)
    this.socket?.close()
    this.socket = null
    this.reconnectSession = null
    this.playerId = null
    this.roomCode = null
  }

  private connect(action: () => void): void {
    const connectionId = ++this.connectionId
    this.intentionallyClosed = true
    this.socket?.close()
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer)
    this.intentionallyClosed = false
    this.pendingAction = action
    const configured = import.meta.env.VITE_ROOM_SERVER_URL
    const protocol = location.protocol === "https:" ? "wss:" : "ws:"
    const url = configured || (import.meta.env.DEV
      ? `${protocol}//${location.hostname}:8787/rooms`
      : `${protocol}//${location.host}/rooms`)
    this.socket = new WebSocket(url)
    this.socket.addEventListener("open", () => {
      this.reconnectAttempt = 0
      this.events.onConnection?.(true)
      this.pendingAction?.()
      this.pendingAction = null
      this.heartbeatTimer = window.setInterval(() => this.send({ type: "ping", clientTime: Date.now() }), 5_000)
    })
    this.socket.addEventListener("close", () => {
      if (connectionId !== this.connectionId) return
      if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
      this.events.onConnection?.(false)
      if (!this.intentionallyClosed && this.reconnectSession) this.scheduleReconnect()
    })
    this.socket.addEventListener("error", () => this.events.onError?.("Unable to reach the Merry Band server"))
    this.socket.addEventListener("message", (event) => this.handleMessage(JSON.parse(String(event.data)) as ServerMessage))
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === "welcome") {
      this.playerId = message.playerId
      this.roomCode = message.roomCode
      if (!this.reconnectSession) {
        this.reconnectSession = {
          roomCode: message.roomCode,
          displayName: this.pendingIdentity?.displayName ?? localStorage.getItem("sherwood-rebellion:player-name") ?? "Greenhood",
          characterId: this.pendingIdentity?.characterId ?? "robin",
        }
      }
      localStorage.setItem(`sherwood:reconnect:${message.roomCode}`, message.reconnectToken)
      this.events.onWelcome?.(message.playerId, message.roomCode)
    }
    if (message.type === "room_state") this.events.onRoomState?.(message.roomCode, message.phase, message.players, message.missionSlug, message.village, message.lastResult, message.selectedRotationId, message.rotationsPaused, message.rotations, message.upcomingRotations, message.rescueOffer)
    if (message.type === "snapshot") {
      const now = performance.now()
      if (this.playerId && now - this.lastMetricsAt >= 10_000) {
        const localPlayer = message.players.find((player) => player.id === this.playerId)
        const snapshotGapMs = this.lastSnapshotAt === 0 ? 0 : Math.min(60_000, Math.round(now - this.lastSnapshotAt))
        const inputBacklog = Math.min(2_000, Math.max(0, this.sequence - (localPlayer?.lastInputSequence ?? this.sequence)))
        this.send({ type: "client_metrics", inputBacklog, snapshotGapMs })
        this.lastMetricsAt = now
      }
      this.lastSnapshotAt = now
      this.events.onSnapshot?.(message.tick, message.players, message.mission)
    }
    if (message.type === "error") this.events.onError?.(message.message)
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private scheduleReconnect(): void {
    if (!this.reconnectSession || this.reconnectTimer !== null) return
    const delay = Math.min(5_000, 500 * 2 ** this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      const session = this.reconnectSession
      if (!session) return
      const reconnectToken = localStorage.getItem(`sherwood:reconnect:${session.roomCode}`) ?? undefined
      this.connect(() => this.send({
        type: "join_room",
        version: PROTOCOL_VERSION,
        roomCode: session.roomCode,
        displayName: session.displayName,
        characterId: session.characterId,
        reconnectToken,
      }))
    }, delay)
  }
}
