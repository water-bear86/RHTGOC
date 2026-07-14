import { PROTOCOL_VERSION, type BandContribution, type CharacterId, type ContributionType, type LastMissionResult, type LoadoutId, type MerryBandState, type MissionSnapshot, type PingKind, type PublicHubPlayer, type RescueOffer, type RoomPlayer, type ServerMessage, type VillageState, type VoteChoice } from "../shared/protocol"
import type { Vec2 } from "./simulation"
import type { SheriffRotation } from "../shared/sheriff-rotation"
import type { SherwoodSeasonSnapshot } from "../shared/sherwood-season"
import { getSupabase } from "./supabase"
import { getProductAnalyticsConsent } from "./analytics-consent"
import type { ClientDiagnostic } from "./client-diagnostics"
import { CLIENT_BUILD_ID, refreshForBuildMismatch } from "./release"
import type { RoomExperimentAssignment } from "../shared/experiments"

export interface MultiplayerEvents {
  onWelcome?: (playerId: string, roomCode: string) => void
  onRoomState?: (roomCode: string, phase: "lobby" | "mission", players: RoomPlayer[], missionSlug: string, village: VillageState, lastResult: LastMissionResult | null, selectedRotationId: string | null, rotationsPaused: boolean, rotations: SheriffRotation[], upcomingRotations: SheriffRotation[], rescueOffer: RescueOffer | null, contributions: BandContribution[], selectedContributionIds: string[], season: SherwoodSeasonSnapshot | null, band: MerryBandState | null) => void
  onSnapshot?: (tick: number, players: Array<Pick<RoomPlayer, "id" | "position" | "lastInputSequence" | "health" | "arrows" | "loot" | "downedFor" | "signatureCooldown" | "protectionScore" | "crowdControl" | "heavyCarryPeak" | "trapHits" | "sabotageCount">>, mission: MissionSnapshot) => void
  onError?: (message: string) => void
  onConnection?: (connected: boolean) => void
  onHubWelcome?: (instanceId: string, participantId: string, capacity: number) => void
  onHubState?: (players: PublicHubPlayer[]) => void
  onExperiments?: (assignments: RoomExperimentAssignment[]) => void
}

export class MultiplayerClient {
  private socket: WebSocket | null = null
  private sequence = 0
  private lastInputAt = 0
  private pendingAction: (() => void) | null = null
  private reconnectTimer: number | null = null
  private reconnectAttempt = 0
  private reconnectSession: { roomCode: string; displayName: string; characterId: CharacterId } | null = null
  private hubSession: { displayName: string; characterId: CharacterId } | null = null
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
    this.hubSession = null
    this.reconnectSession = null
    this.pendingIdentity = { displayName, characterId }
    void this.getAccessToken().then((accessToken) => this.connect(() => this.send({ type: "create_room", ...this.handshake(), displayName, characterId, accessToken })))
  }

  joinRoom(roomCode: string, displayName: string, characterId: CharacterId): void {
    this.hubSession = null
    const normalizedCode = roomCode.trim().toUpperCase()
    this.reconnectSession = { roomCode: normalizedCode, displayName, characterId }
    this.pendingIdentity = { displayName, characterId }
    const reconnectToken = localStorage.getItem(`sherwood:reconnect:${normalizedCode}`) ?? undefined
    void this.getAccessToken().then((accessToken) => this.connect(() => this.send({ type: "join_room", ...this.handshake(), roomCode: normalizedCode, displayName, characterId, reconnectToken, accessToken })))
  }

  joinPublicHub(displayName: string, characterId: CharacterId): void {
    this.reconnectSession = null
    this.hubSession = { displayName, characterId }
    this.pendingIdentity = { displayName, characterId }
    void this.getAccessToken().then((accessToken) => {
      if (!accessToken) {
        this.events.onError?.("Sign in before entering the public camp")
        return
      }
      this.connect(() => this.send({ type: "join_public_hub", ...this.handshake(), displayName, characterId, accessToken }))
    })
  }

  setHubIntent(looking: boolean, targetPreference: PublicHubPlayer["targetPreference"], desiredPartySize: 2 | 3 | 4): void { this.send({ type: "hub_intent", looking, targetPreference, desiredPartySize }) }
  sendHubMove(move: Vec2): void {
    const now = performance.now()
    if (now - this.lastInputAt < 50) return
    this.lastInputAt = now
    this.sequence += 1
    this.send({ type: "hub_move", sequence: this.sequence, move })
  }
  sendHubEmote(kind: "wave" | "cheer" | "bow"): void { this.send({ type: "hub_emote", kind }) }
  sendHubPing(kind: "regroup" | "target"): void { this.send({ type: "hub_ping", kind }) }
  formHubBand(): void { this.send({ type: "hub_form_band" }) }
  reportHubPlayer(targetParticipantId: string, reason: "harassment" | "griefing" | "unsafe-name" | "cheating"): void { this.send({ type: "hub_report", targetParticipantId, reason }) }
  blockHubPlayer(targetParticipantId: string): void { this.send({ type: "hub_block", targetParticipantId }) }
  leavePublicHub(): void { this.send({ type: "hub_leave" }); this.hubSession = null }

  setReady(ready: boolean, expected?: { missionSlug: string; characterId: CharacterId }): void {
    this.send({
      type: "set_ready",
      ready,
      ...(ready && expected ? { expectedMissionSlug: expected.missionSlug, expectedCharacterId: expected.characterId } : {}),
    })
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

  depositContribution(type: ContributionType): void {
    this.send({ type: "deposit_contribution", contributionType: type })
  }

  toggleContribution(contributionId: string): void {
    this.send({ type: "toggle_contribution", contributionId })
  }

  revokeContribution(contributionId: string): void {
    this.send({ type: "revoke_contribution", contributionId })
  }

  offerBandMembership(targetPlayerId: string): void {
    this.send({ type: "offer_band_membership", targetPlayerId })
  }

  respondBandMembership(accept: boolean): void {
    this.send({ type: "respond_band_membership", accept })
  }

  updateBandIdentity(name: string, bannerId: MerryBandState["bannerId"]): void {
    this.send({ type: "update_band_identity", name, bannerId })
  }

  removeBandMember(targetPlayerId: string): void {
    this.send({ type: "remove_band_member", targetPlayerId })
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

  sendDiagnostic(diagnostic: ClientDiagnostic): void {
    if (!getProductAnalyticsConsent()) return
    this.send(diagnostic)
  }

  setProductAnalyticsConsent(consented: boolean): void {
    this.send({ type: "set_product_analytics", consented })
  }

  close(): void {
    this.intentionallyClosed = true
    this.connectionId += 1
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer)
    this.socket?.close()
    this.socket = null
    this.reconnectSession = null
    this.hubSession = null
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
      if (!this.intentionallyClosed && (this.reconnectSession || this.hubSession)) this.scheduleReconnect()
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
    if (message.type === "room_state") {
      this.events.onExperiments?.(message.experiments)
      this.events.onRoomState?.(message.roomCode, message.phase, message.players, message.missionSlug, message.village, message.lastResult, message.selectedRotationId, message.rotationsPaused, message.rotations, message.upcomingRotations, message.rescueOffer, message.contributions, message.selectedContributionIds, message.season, message.band)
    }
    if (message.type === "hub_welcome") this.events.onHubWelcome?.(message.instanceId, message.participantId, message.capacity)
    if (message.type === "hub_state") this.events.onHubState?.(message.players)
    if (message.type === "hub_band_ready" && this.pendingIdentity) {
      const identity = this.pendingIdentity
      this.hubSession = null
      this.reconnectSession = { roomCode: message.roomCode, ...identity }
      window.setTimeout(() => void this.getAccessToken().then((accessToken) => this.send({ type: "join_room", ...this.handshake(), roomCode: message.roomCode, displayName: identity.displayName, characterId: identity.characterId, accessToken })), message.leader ? 0 : 120)
    }
    if (message.type === "snapshot") {
      this.events.onExperiments?.(message.experiments)
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
    if (message.type === "error") {
      if (message.code === "VERSION_MISMATCH" && message.buildId && refreshForBuildMismatch(message.buildId)) return
      this.events.onError?.(message.message)
    }
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message))
  }

  private scheduleReconnect(): void {
    if ((!this.reconnectSession && !this.hubSession) || this.reconnectTimer !== null) return
    const delay = Math.min(5_000, 500 * 2 ** this.reconnectAttempt)
    this.reconnectAttempt += 1
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      const session = this.reconnectSession
      const hub = this.hubSession
      if (hub) {
        void this.getAccessToken().then((accessToken) => {
          if (accessToken) this.connect(() => this.send({ type: "join_public_hub", ...this.handshake(), displayName: hub.displayName, characterId: hub.characterId, accessToken }))
        })
        return
      }
      if (!session) return
      const reconnectToken = localStorage.getItem(`sherwood:reconnect:${session.roomCode}`) ?? undefined
      void this.getAccessToken().then((accessToken) => this.connect(() => this.send({
          type: "join_room",
          ...this.handshake(),
          roomCode: session.roomCode,
          displayName: session.displayName,
          characterId: session.characterId,
          reconnectToken,
          accessToken,
        })))
    }, delay)
  }

  private async getAccessToken(): Promise<string | undefined> {
    const supabase = getSupabase()
    if (!supabase) return undefined
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token
  }

  private handshake(): { version: typeof PROTOCOL_VERSION; buildId: string; productAnalytics: boolean } {
    return { version: PROTOCOL_VERSION, buildId: CLIENT_BUILD_ID, productAnalytics: getProductAnalyticsConsent() }
  }
}
