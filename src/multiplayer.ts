import { PROTOCOL_VERSION, type CharacterId, type RoomPlayer, type ServerMessage } from "../shared/protocol"
import type { Vec2 } from "./simulation"

export interface MultiplayerEvents {
  onWelcome?: (playerId: string, roomCode: string) => void
  onRoomState?: (roomCode: string, phase: "lobby" | "mission", players: RoomPlayer[]) => void
  onSnapshot?: (tick: number, players: Array<Pick<RoomPlayer, "id" | "position" | "lastInputSequence">>) => void
  onError?: (message: string) => void
  onConnection?: (connected: boolean) => void
}

export class MultiplayerClient {
  private socket: WebSocket | null = null
  private sequence = 0
  private lastInputAt = 0
  private pendingAction: (() => void) | null = null
  playerId: string | null = null
  roomCode: string | null = null

  constructor(private readonly events: MultiplayerEvents) {}

  createRoom(displayName: string, characterId: CharacterId): void {
    this.connect(() => this.send({ type: "create_room", version: PROTOCOL_VERSION, displayName, characterId }))
  }

  joinRoom(roomCode: string, displayName: string, characterId: CharacterId): void {
    const normalizedCode = roomCode.trim().toUpperCase()
    const reconnectToken = localStorage.getItem(`sherwood:reconnect:${normalizedCode}`) ?? undefined
    this.connect(() => this.send({ type: "join_room", version: PROTOCOL_VERSION, roomCode: normalizedCode, displayName, characterId, reconnectToken }))
  }

  setReady(ready: boolean): void {
    this.send({ type: "set_ready", ready })
  }

  selectCharacter(characterId: CharacterId): void {
    this.send({ type: "select_character", characterId })
  }

  sendInput(move: Vec2): void {
    const now = performance.now()
    if (now - this.lastInputAt < 50) return
    this.lastInputAt = now
    this.sequence += 1
    this.send({ type: "input", sequence: this.sequence, move })
  }

  close(): void {
    this.socket?.close()
    this.socket = null
    this.playerId = null
    this.roomCode = null
  }

  private connect(action: () => void): void {
    this.close()
    this.pendingAction = action
    const configured = import.meta.env.VITE_ROOM_SERVER_URL
    const protocol = location.protocol === "https:" ? "wss:" : "ws:"
    const url = configured || (import.meta.env.DEV
      ? `${protocol}//${location.hostname}:8787/rooms`
      : `${protocol}//${location.host}/rooms`)
    this.socket = new WebSocket(url)
    this.socket.addEventListener("open", () => {
      this.events.onConnection?.(true)
      this.pendingAction?.()
      this.pendingAction = null
    })
    this.socket.addEventListener("close", () => this.events.onConnection?.(false))
    this.socket.addEventListener("error", () => this.events.onError?.("Unable to reach the Merry Band server"))
    this.socket.addEventListener("message", (event) => this.handleMessage(JSON.parse(String(event.data)) as ServerMessage))
  }

  private handleMessage(message: ServerMessage): void {
    if (message.type === "welcome") {
      this.playerId = message.playerId
      this.roomCode = message.roomCode
      localStorage.setItem(`sherwood:reconnect:${message.roomCode}`, message.reconnectToken)
      this.events.onWelcome?.(message.playerId, message.roomCode)
    }
    if (message.type === "room_state") this.events.onRoomState?.(message.roomCode, message.phase, message.players)
    if (message.type === "snapshot") this.events.onSnapshot?.(message.tick, message.players)
    if (message.type === "error") this.events.onError?.(message.message)
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }
}
