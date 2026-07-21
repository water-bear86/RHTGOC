import { createHash, randomUUID } from "node:crypto"
import { WebSocket } from "ws"
import { MAX_ROOM_PLAYERS, RECONNECT_GRACE_MS, type BandContribution, type CharacterId, type ContributionType, type LastMissionResult, type LoadoutId, type MerryBandState, type PlayerAction, type RescueOffer, type RoomPlayer, type ServerMessage, type VillageState } from "../shared/protocol"
import { normalizeChatText, type ChatErrorCode, type ChatMessage, type ChatReportReason } from "../shared/chat"
import { Mission } from "./mission"
import { getMissionDefinition } from "../shared/mission-catalog"
import { isRotationActive, rotationWindowAt, type SheriffRotationWindow } from "../shared/sheriff-rotation"
import type { SeasonalMissionOutcome, SherwoodSeasonSnapshot } from "../shared/sherwood-season"
import type { CompletedBandMission, PersistentBandRecord } from "./band-store"
import type { VerifiedRun } from "./leaderboard-store"
import type { RoomExperimentAssignment } from "../shared/experiments"

interface ConnectedPlayer extends RoomPlayer {
  authUserId: string | null
  productAnalytics: boolean
  clientBuildId: string
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
  captureFor: number
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

export interface BandMembershipMutation {
  bandId: string
  actorUserId: string
  memberUserId: string
  heroRole: CharacterId
}

export type BandChatSendResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; code: ChatErrorCode; retryAfterMs?: number }

export interface BandChatReport {
  at: number
  reporterPlayerId: string
  reason: ChatReportReason
  message: ChatMessage
}

interface BandChatRateState {
  sentAt: number[]
  lastTextKey: string | null
  lastTextAt: number
}

function maxArrows(characterId: CharacterId): number {
  return characterId === "robin" ? 6 : characterId === "little-john" ? 3 : 4
}

const spawnPoints = getMissionDefinition().spawns.players

function rescueOfferId(sourceMissionId: string): string {
  const bytes = createHash("sha256").update(`sherwood-rescue:${sourceMissionId}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export interface RescueOfferTransition {
  sequence: number
  at: number
  offer: RescueOffer
}

export interface ContributionTransition {
  sequence: number
  at: number
  contribution: BandContribution
}

export class Room {
  readonly code: string
  readonly players = new Map<string, ConnectedPlayer>()
  phase: "lobby" | "mission" = "lobby"
  tick = 0
  mission: Mission | null = null
  missionSlug = "peoples-purse"
  selectedRotationId: string | null = null
  selectedRescueOfferId: string | null = null
  rescueOffer: RescueOffer | null = null
  readonly rescueOfferEvents: RescueOfferTransition[] = []
  readonly contributions = new Map<string, BandContribution>()
  readonly selectedContributionIds = new Set<string>()
  readonly contributionEvents: ContributionTransition[] = []
  rotationAttemptCount = 0
  village: VillageState = { granary: 0, infirmary: 0, watchtower: 0 }
  band: MerryBandState | null = null
  lastResult: LastMissionResult | null = null
  experimentAssignments: RoomExperimentAssignment[] = []
  readonly moderationEvents: Array<{ at: number; actorId: string; targetId: string; action: "report" | "remove" | "block"; reason?: string }> = []
  readonly bandChatHistory: ChatMessage[] = []
  readonly bandChatReports: BandChatReport[] = []
  private readonly bannedReconnectTokens = new Set<string>()
  private readonly bandChatRateByPlayer = new Map<string, BandChatRateState>()
  private bandChatSequence = 0
  private missionId = randomUUID()
  private bandActorUserId: string | null = null
  private readonly bandMemberRoles = new Map<string, "leader" | "member">()
  private readonly pendingBandMembershipOffers = new Set<string>()
  private bandClaimedForMissionId: string | null = null
  private leaderboardClaimedForMissionId: string | null = null
  private missionSeasonSlug: string | null = null
  private missionStartedAt: number | null = null
  private lastRescueOfferSourceMissionId: string | null = null
  private rescueEventSequence = 0
  private contributionEventSequence = 0
  private preparationsResolvedForMissionId: string | null = null
  private seasonOutcomeClaimedForMissionId: string | null = null

  constructor(
    code: string,
    private readonly getRotationWindow: (now: number) => SheriffRotationWindow = rotationWindowAt,
    private readonly getSeasonSnapshot: (now: number) => SherwoodSeasonSnapshot | null = () => null,
    persistentBand: PersistentBandRecord | null = null,
    private readonly assignExperiments: (roomScope: string) => RoomExperimentAssignment[] = () => [],
  ) {
    this.code = code
    if (persistentBand) this.attachPersistentBand(persistentBand)
  }

  attachPersistentBand(record: PersistentBandRecord): boolean {
    if (this.band && this.band.id !== record.state.id) return false
    this.band = { ...record.state, camp: { ...record.state.camp } }
    this.bandActorUserId = record.actorUserId
    this.syncBandMembers(record)
    this.village = { ...record.village }
    return true
  }

  refreshPersistentBand(record: PersistentBandRecord): boolean {
    if (!this.band || this.band.id !== record.state.id) return false
    this.band = { ...record.state, camp: { ...record.state.camp } }
    this.syncBandMembers(record)
    this.village = {
      granary: Math.max(this.village.granary, record.village.granary),
      infirmary: Math.max(this.village.infirmary, record.village.infirmary),
      watchtower: Math.max(this.village.watchtower, record.village.watchtower),
    }
    return true
  }

  addPlayer(socket: WebSocket, displayName: string, characterId: CharacterId, authUserId: string | null = null, roleConfirmed = true, productAnalytics = true, clientBuildId = "dev"): ConnectedPlayer {
    this.pruneDisconnected(Date.now())
    if (this.phase !== "lobby") throw new Error("MISSION_STARTED")
    if (this.players.size >= MAX_ROOM_PLAYERS) throw new Error("ROOM_FULL")
    if (roleConfirmed && !this.characterAvailable(characterId)) throw new Error("ROLE_FULL")
    const occupiedSpawns = new Set([...this.players.values()].map((player) => player.spawnIndex))
    const spawnIndex = spawnPoints.findIndex((_, index) => !occupiedSpawns.has(index))
    const position = spawnPoints[spawnIndex]
    const player: ConnectedPlayer = {
      id: randomUUID(),
      authUserId,
      productAnalytics,
      clientBuildId,
      reconnectToken: randomUUID(),
      displayName,
      characterId,
      roleConfirmed,
      loadoutId: "balanced",
      ready: false,
      connected: true,
      stealth: false,
      bandRole: authUserId ? this.bandMemberRoles.get(authUserId) ?? null : null,
      bandInvitePending: false,
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
      bowAction: null,
      signatureCooldown: 0,
      invulnerableFor: 0,
      veilFor: 0,
      captureFor: 0,
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

  reconnect(socket: WebSocket, token: string, now = Date.now(), authUserId: string | null = null, productAnalytics = true, clientBuildId = "dev"): ConnectedPlayer | null {
    if (this.bannedReconnectTokens.has(token)) return null
    const player = [...this.players.values()].find((candidate) => candidate.reconnectToken === token)
    if (!player || player.disconnectedAt === null || now - player.disconnectedAt > RECONNECT_GRACE_MS || (player.authUserId && player.authUserId !== authUserId)) return null
    player.socket = socket
    player.connected = true
    player.disconnectedAt = null
    player.productAnalytics = productAnalytics
    player.clientBuildId = clientBuildId
    this.mission?.cancelPlayerActions(player.id)
    return player
  }

  hasProductAnalyticsConsent(playerId: string): boolean {
    return this.players.get(playerId)?.productAnalytics === true
  }

  setProductAnalyticsConsent(playerId: string, consented: boolean): void {
    const player = this.players.get(playerId)
    if (player) player.productAnalytics = consented
  }

  clientBuildId(playerId: string): string {
    return this.players.get(playerId)?.clientBuildId ?? "dev"
  }

  analyticsScope(): string {
    return `${this.code}:${this.missionId}`
  }

  disconnect(playerId: string, now = Date.now()): void {
    const player = this.players.get(playerId)
    if (!player) return
    player.socket = null
    player.connected = false
    player.disconnectedAt = now
    player.input = { x: 0, z: 0 }
    this.mission?.cancelPlayerActions(player.id)
    this.broadcastRoomState()
  }

  pruneDisconnected(now: number): void {
    for (const [id, player] of this.players) {
      if (player.disconnectedAt !== null && now - player.disconnectedAt > RECONNECT_GRACE_MS) {
        this.players.delete(id)
        this.bandChatRateByPlayer.delete(id)
      }
    }
  }

  setReady(
    playerId: string,
    ready: boolean,
    now = Date.now(),
    expected?: { missionSlug: string; characterId: CharacterId },
  ): boolean {
    const player = this.players.get(playerId)
    if (!player || this.phase !== "lobby" || (ready && !player.roleConfirmed)) return false
    if (ready && expected && (this.missionSlug !== expected.missionSlug || player.characterId !== expected.characterId)) return false
    player.ready = ready
    const connected = [...this.players.values()].filter((candidate) => candidate.connected)
    if (connected.length >= 2 && connected.every((candidate) => candidate.ready)) {
      const rotation = this.selectedRotationId
        ? this.getRotationWindow(now).current.find((candidate) => candidate.id === this.selectedRotationId) ?? null
        : null
      if (this.selectedRotationId && (!rotation || !isRotationActive(rotation, now) || connected.length !== rotation.partySize)) {
        for (const candidate of connected) candidate.ready = false
        this.selectedRotationId = null
        this.broadcastRoomState(now)
        return false
      }
      const rescueOffer = this.selectedRescueOfferId && this.rescueOffer?.id === this.selectedRescueOfferId ? this.rescueOffer : null
      if (this.selectedRescueOfferId && (!rescueOffer || rescueOffer.status !== "accepted" || now >= rescueOffer.expiresAt)) {
        for (const candidate of connected) candidate.ready = false
        this.selectedRescueOfferId = null
        this.broadcastRoomState(now)
        return false
      }
      this.expireContributions(now)
      const preparations = [...this.selectedContributionIds]
        .map((id) => this.contributions.get(id))
        .filter((contribution): contribution is BandContribution => Boolean(contribution && contribution.status === "available" && now < contribution.expiresAt))
      this.selectedContributionIds.clear()
      for (const contribution of preparations) {
        contribution.status = "locked"
        contribution.missionId = this.missionId
        this.selectedContributionIds.add(contribution.id)
        this.recordContributionTransition(contribution, now)
      }
      this.phase = "mission"
      this.experimentAssignments = this.assignExperiments(this.analyticsScope())
      const season = this.getSeasonSnapshot(now)
      this.missionSeasonSlug = season && (season.phase === "active" || season.phase === "finale") ? season.slug : null
      this.missionStartedAt = now
      const definition = getMissionDefinition(this.missionSlug)
      this.mission ??= new Mission(this.code, this.players, definition, {
        seedToken: `${this.code}:${this.missionId}`,
        rotation,
        rescueOffer: rescueOffer ? { id: rescueOffer.id, sourceMissionId: rescueOffer.sourceMissionId } : null,
        preparations: preparations.map(({ id, type, contributorLabel }) => ({ id, type, contributorLabel })),
      })
      for (const player of this.players.values()) player.position = { ...this.mission.definition.spawns.players[player.spawnIndex] }
      this.mission.village = { ...this.village }
      if (rotation) this.rotationAttemptCount += 1
      if (rescueOffer) {
        rescueOffer.attempts += 1
        this.recordRescueTransition(now)
      }
    }
    this.broadcastRoomState(now)
    return true
  }

  hasConfirmedRole(playerId: string): boolean {
    return this.players.get(playerId)?.roleConfirmed ?? false
  }

  selectCharacter(playerId: string, characterId: CharacterId): boolean {
    const player = this.players.get(playerId)
    if (!player || this.phase !== "lobby") return false
    if (!this.characterAvailable(characterId, playerId)) return false
    player.characterId = characterId
    player.roleConfirmed = true
    player.arrows = maxArrows(characterId)
    player.ready = false
    this.broadcastRoomState()
    return true
  }

  offerBandMembership(actorPlayerId: string, targetPlayerId: string): boolean {
    const actor = this.players.get(actorPlayerId)
    const target = this.players.get(targetPlayerId)
    if (!this.band || !actor?.connected || actor.bandRole !== "leader" || this.moderatorId() !== actorPlayerId || !target?.connected || !target.authUserId || target.bandRole || actorPlayerId === targetPlayerId) return false
    this.pendingBandMembershipOffers.add(targetPlayerId)
    target.bandInvitePending = true
    this.broadcastRoomState()
    return true
  }

  bandMembershipCandidate(playerId: string): BandMembershipMutation | null {
    const player = this.players.get(playerId)
    if (!this.band || !this.bandActorUserId || !player?.authUserId || !this.pendingBandMembershipOffers.has(playerId) || player.bandRole) return null
    return { bandId: this.band.id, actorUserId: this.bandActorUserId, memberUserId: player.authUserId, heroRole: player.characterId }
  }

  declineBandMembership(playerId: string): boolean {
    const player = this.players.get(playerId)
    if (!player || !this.pendingBandMembershipOffers.delete(playerId)) return false
    player.bandInvitePending = false
    this.broadcastRoomState()
    return true
  }

  acceptBandMembership(playerId: string, record: PersistentBandRecord): boolean {
    const player = this.players.get(playerId)
    if (!player || !this.pendingBandMembershipOffers.delete(playerId) || !this.refreshPersistentBand(record)) return false
    player.bandInvitePending = false
    this.broadcastRoomState()
    return true
  }

  bandIdentityActor(playerId: string): { bandId: string; actorUserId: string } | null {
    const player = this.players.get(playerId)
    return this.band && player?.authUserId && player.bandRole === "leader" && this.moderatorId() === playerId
      ? { bandId: this.band.id, actorUserId: player.authUserId }
      : null
  }

  bandRemovalCandidate(actorPlayerId: string, targetPlayerId: string): { bandId: string; actorUserId: string; memberUserId: string } | null {
    const actor = this.players.get(actorPlayerId)
    const target = this.players.get(targetPlayerId)
    return this.band && actor?.authUserId && actor.bandRole === "leader" && this.moderatorId() === actorPlayerId && target?.authUserId && target.bandRole === "member"
      ? { bandId: this.band.id, actorUserId: actor.authUserId, memberUserId: target.authUserId }
      : null
  }

  bandHeroRoleUpdate(playerId: string): { bandId: string; userId: string; heroRole: CharacterId } | null {
    const player = this.players.get(playerId)
    return this.band && player?.authUserId && player.bandRole
      ? { bandId: this.band.id, userId: player.authUserId, heroRole: player.characterId }
      : null
  }

  selectMission(playerId: string, missionSlug: string): boolean {
    if (this.phase !== "lobby" || this.moderatorId() !== playerId) return false
    try { getMissionDefinition(missionSlug) } catch { return false }
    this.missionSlug = missionSlug
    this.selectedRotationId = null
    this.releaseAcceptedRescue(Date.now())
    for (const player of this.players.values()) player.ready = false
    this.broadcastRoomState()
    return true
  }

  selectRotation(playerId: string, rotationId: string, now = Date.now()): boolean {
    if (this.phase !== "lobby" || this.moderatorId() !== playerId) return false
    const window = this.getRotationWindow(now)
    const rotation = window.current.find((candidate) => candidate.id === rotationId)
    if (window.paused || !rotation || !isRotationActive(rotation, now)) return false
    this.selectedRotationId = rotation.id
    this.releaseAcceptedRescue(now)
    this.missionSlug = rotation.missionSlug
    for (const player of this.players.values()) player.ready = false
    this.broadcastRoomState(now)
    return true
  }

  acceptRescue(playerId: string, offerId: string, now = Date.now()): boolean {
    if (this.phase !== "lobby" || this.moderatorId() !== playerId || !this.rescueOffer || this.rescueOffer.id !== offerId) return false
    if (now >= this.rescueOffer.expiresAt) {
      this.expireRescueOffer(now)
      return false
    }
    if (this.rescueOffer.status !== "active") return false
    this.rescueOffer.status = "accepted"
    this.rescueOffer.acceptedAt = now
    this.selectedRescueOfferId = offerId
    this.selectedRotationId = null
    this.missionSlug = this.rescueOffer.rescueMissionSlug
    for (const player of this.players.values()) player.ready = false
    this.recordRescueTransition(now)
    this.broadcastRoomState(now)
    return true
  }

  abandonRescue(playerId: string, offerId: string, now = Date.now()): boolean {
    if (this.phase !== "lobby" || this.moderatorId() !== playerId || !this.rescueOffer || this.rescueOffer.id !== offerId) return false
    if (this.rescueOffer.status !== "active" && this.rescueOffer.status !== "accepted") return false
    this.rescueOffer.status = "abandoned"
    this.rescueOffer.resolvedAt = now
    this.selectedRescueOfferId = null
    this.recordRescueTransition(now)
    this.broadcastRoomState(now)
    return true
  }

  depositContribution(playerId: string, type: ContributionType, now = Date.now()): BandContribution | null {
    const player = this.players.get(playerId)
    if (!player?.connected || this.phase !== "lobby") return null
    const expired = this.expireContributions(now)
    const available = [...this.contributions.values()].filter((contribution) => contribution.status === "available")
    if (available.length >= 6 || available.filter((contribution) => contribution.type === type).length >= 2 || available.filter((contribution) => contribution.contributorPlayerId === playerId).length >= 2) {
      if (expired) this.broadcastRoomState(now)
      return null
    }
    this.pruneContributionHistory()
    const contribution: BandContribution = {
      id: randomUUID(),
      type,
      contributorPlayerId: playerId,
      contributorLabel: player.displayName,
      createdAt: now,
      expiresAt: now + 24 * 60 * 60_000,
      status: "available",
      missionId: null,
      resolvedAt: null,
    }
    this.contributions.set(contribution.id, contribution)
    this.recordContributionTransition(contribution, now)
    this.broadcastRoomState(now)
    return contribution
  }

  toggleContribution(playerId: string, contributionId: string, now = Date.now()): boolean {
    if (this.phase !== "lobby" || this.moderatorId() !== playerId) return false
    const expired = this.expireContributions(now)
    const contribution = this.contributions.get(contributionId)
    if (!contribution || contribution.status !== "available") {
      if (expired) this.broadcastRoomState(now)
      return false
    }
    if (this.selectedContributionIds.has(contributionId)) this.selectedContributionIds.delete(contributionId)
    else {
      if (this.selectedContributionIds.size >= 3) return false
      this.selectedContributionIds.add(contributionId)
    }
    this.broadcastRoomState(now)
    return true
  }

  revokeContribution(playerId: string, contributionId: string, now = Date.now()): boolean {
    if (this.phase !== "lobby") return false
    const expired = this.expireContributions(now)
    const contribution = this.contributions.get(contributionId)
    if (!contribution || contribution.contributorPlayerId !== playerId || contribution.status !== "available") {
      if (expired) this.broadcastRoomState(now)
      return false
    }
    contribution.status = "revoked"
    contribution.resolvedAt = now
    this.selectedContributionIds.delete(contributionId)
    this.recordContributionTransition(contribution, now)
    this.broadcastRoomState(now)
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

  returnToHub(playerId: string, now = Date.now()): boolean {
    if (!this.mission || this.moderatorId() !== playerId || this.mission.status === "active" || (this.mission.status === "succeeded" && !this.mission.vote?.resolved)) return false
    this.resolveMissionContributions(now, false)
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
    this.selectedRotationId = null
    this.selectedRescueOfferId = null
    this.selectedContributionIds.clear()
    this.missionId = randomUUID()
    this.experimentAssignments = []
    this.preparationsResolvedForMissionId = null
    this.seasonOutcomeClaimedForMissionId = null
    for (const player of this.players.values()) this.resetPlayerForHub(player)
    this.broadcastRoomState()
    return true
  }

  setInput(playerId: string, sequence: number, move: { x: number; z: number }): void {
    this.mission?.setInput(playerId, sequence, move)
  }

  action(playerId: string, action: PlayerAction, targetPlayerId?: string): boolean {
    return this.mission?.action(playerId, action, targetPlayerId) ?? false
  }

  ping(playerId: string, kind: "danger" | "target" | "route" | "loot" | "regroup"): void {
    this.mission?.ping(playerId, kind)
  }

  vote(playerId: string, choice: "granary" | "infirmary" | "watchtower"): void {
    this.mission?.castVote(playerId, choice)
  }

  sendBandChat(playerId: string, text: string, now = Date.now()): BandChatSendResult {
    const player = this.players.get(playerId)
    if (!player?.connected) return { ok: false, code: "FORBIDDEN" }
    const normalized = normalizeChatText(text)
    if (normalized === null) return this.rejectBandChat(player, "INVALID_MESSAGE", "Messages must be 1-160 visible characters")

    const rate = this.bandChatRateByPlayer.get(playerId) ?? { sentAt: [], lastTextKey: null, lastTextAt: Number.NEGATIVE_INFINITY }
    const textKey = normalized.toLocaleLowerCase("en-US")
    if (rate.lastTextKey === textKey && now - rate.lastTextAt < 30_000) {
      return this.rejectBandChat(player, "DUPLICATE", "That message was already sent")
    }

    rate.sentAt = rate.sentAt.filter((sentAt) => now - sentAt < 10_000)
    const lastSentAt = rate.sentAt.at(-1)
    if (lastSentAt !== undefined && now - lastSentAt < 1_000) {
      const retryAfterMs = Math.max(1, lastSentAt + 1_000 - now)
      return this.rejectBandChat(player, "RATE_LIMITED", "Slow down before sending another message", retryAfterMs)
    }
    if (rate.sentAt.length >= 5) {
      const retryAfterMs = Math.max(1, rate.sentAt[0] + 10_000 - now)
      return this.rejectBandChat(player, "RATE_LIMITED", "Band chat is moving too quickly", retryAfterMs)
    }

    rate.sentAt.push(now)
    rate.lastTextKey = textKey
    rate.lastTextAt = now
    this.bandChatRateByPlayer.set(playerId, rate)
    const message: ChatMessage = {
      id: randomUUID(),
      channel: "band",
      sequence: ++this.bandChatSequence,
      sentAt: now,
      sender: {
        playerId: player.id,
        displayName: player.displayName,
        characterId: player.characterId,
      },
      text: normalized,
    }
    this.bandChatHistory.push(message)
    if (this.bandChatHistory.length > 50) this.bandChatHistory.splice(0, this.bandChatHistory.length - 50)
    this.broadcast({ type: "chat_message", message })
    return { ok: true, message }
  }

  sendBandChatHistory(playerId: string): boolean {
    const player = this.players.get(playerId)
    if (!player?.connected) return false
    this.sendTo(player, { type: "chat_history", channel: "band", messages: this.bandChatHistory.map((message) => ({ ...message, sender: { ...message.sender } })) })
    return true
  }

  reportBandChat(reporterPlayerId: string, messageId: string, reason: ChatReportReason, now = Date.now()): BandChatReport | null {
    const reporter = this.players.get(reporterPlayerId)
    if (!reporter?.connected) return null
    const message = this.bandChatHistory.find((candidate) => candidate.id === messageId)
    if (!message) {
      this.sendTo(reporter, { type: "chat_error", channel: "band", code: "MESSAGE_NOT_FOUND", message: "That message is no longer available to report" })
      return null
    }
    if (message.sender.playerId === reporterPlayerId) {
      this.sendTo(reporter, { type: "chat_error", channel: "band", code: "FORBIDDEN", message: "You cannot report your own message" })
      return null
    }
    if (this.bandChatReports.some((report) => report.reporterPlayerId === reporterPlayerId && report.message.id === messageId)) {
      this.sendTo(reporter, { type: "chat_error", channel: "band", code: "FORBIDDEN", message: "That message has already been reported" })
      return null
    }
    const report: BandChatReport = {
      at: now,
      reporterPlayerId,
      reason,
      message: { ...message, sender: { ...message.sender } },
    }
    this.bandChatReports.push(report)
    if (this.bandChatReports.length > 200) this.bandChatReports.splice(0, this.bandChatReports.length - 200)
    return report
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
    this.bandChatRateByPlayer.delete(targetId)
    this.broadcastRoomState()
    return true
  }

  claimVerifiedRuns(): VerifiedRun[] | null {
    if (!this.mission?.result || this.mission.status !== "succeeded" || this.leaderboardClaimedForMissionId === this.missionId) return null
    this.leaderboardClaimedForMissionId = this.missionId
    if (!this.missionSeasonSlug || this.missionStartedAt === null) return []
    const seasonSlug = this.missionSeasonSlug
    const missionStartedAt = this.missionStartedAt
    return [...this.players.values()].filter((player) => player.authUserId !== null).map((player) => ({
      missionId: this.missionId,
      playerId: player.id,
      authUserId: player.authUserId!,
      bandId: this.band?.id,
      characterId: player.characterId,
      partySize: this.players.size,
      missionSeconds: this.mission!.elapsedSeconds,
      delivered: this.mission!.delivered,
      rescues: player.rescueCount,
      damageTaken: this.mission!.damageTaken,
      missionVersion: this.mission!.definition.missionVersion,
      missionContentHash: this.mission!.definition.contentHash,
      missionSlug: this.mission!.definition.slug,
      seasonSlug,
      missionStartedAt,
      cleanEscape: this.mission!.isCleanEscape(),
      rotationId: this.mission!.rotationId,
      rotationModifierIds: [...this.mission!.rotationModifierIds],
      rescueOfferId: this.mission!.rescueOfferId,
      result: this.mission!.result!,
    }))
  }

  claimBandMission(): CompletedBandMission | null {
    if (!this.band || !this.mission?.result || this.mission.status === "active" || this.bandClaimedForMissionId === this.missionId) return null
    if (this.mission.status === "succeeded" && !this.mission.vote?.resolved) return null
    this.bandClaimedForMissionId = this.missionId
    return {
      bandId: this.band.id,
      actorUserId: this.bandActorUserId,
      missionId: this.missionId,
      missionSlug: this.mission.definition.slug,
      seed: this.mission.seed,
      status: this.mission.status,
      result: this.mission.result,
      allocationChoice: this.mission.vote?.winner ?? null,
      allocationCoin: this.mission.vote?.allocatedCoin ?? 0,
    }
  }

  authenticatedUserIds(): string[] {
    return [...new Set([...this.players.values()].map((player) => player.authUserId).filter((id): id is string => id !== null))]
  }

  hasRankedMissionInFlight(): boolean {
    return this.phase === "mission"
      && this.missionSeasonSlug !== null
      && this.mission !== null
      && (this.mission.status === "active" || (this.mission.status === "succeeded" && this.leaderboardClaimedForMissionId !== this.missionId))
  }

  claimSeasonOutcome(now = Date.now()): SeasonalMissionOutcome | null {
    if (!this.mission || this.mission.status === "active" || this.seasonOutcomeClaimedForMissionId === this.missionId) return null
    if (this.mission.status === "succeeded" && !this.mission.vote?.resolved) return null
    this.seasonOutcomeClaimedForMissionId = this.missionId
    return {
      eventId: this.missionId,
      occurredAt: now,
      status: this.mission.status,
      project: this.mission.vote?.winner ?? null,
      communityCoin: this.mission.result?.communityCoin ?? 0,
      rescues: [...this.players.values()].reduce((sum, player) => sum + player.rescueCount, 0),
      cleanEscape: this.mission.status === "succeeded" && this.mission.isCleanEscape(),
      tacticalScore: this.mission.result?.score ?? 0,
      rotationId: this.mission.rotationId,
    }
  }

  update(dt: number, now = Date.now()): void {
    this.pruneDisconnected(now)
    this.expireRescueOffer(now)
    const contributionsExpired = this.expireContributions(now)
    if (!this.mission) {
      if (contributionsExpired) this.broadcastRoomState(now)
      return
    }
    this.mission.update(dt)
    this.tick = this.mission.tick
    if (this.mission.status === "failed" && !this.mission.rescueOfferId) this.ensureRescueOffer(now)
    if (this.mission.status !== "active" && this.mission.rescueOfferId) this.resolveRescueOffer(now)
    if (this.mission.status !== "active") this.resolveMissionContributions(now)
  }

  drainRescueOfferEvents(): RescueOfferTransition[] {
    return this.rescueOfferEvents.splice(0, this.rescueOfferEvents.length)
  }

  drainContributionEvents(): ContributionTransition[] {
    return this.contributionEvents.splice(0, this.contributionEvents.length)
  }

  publicPlayer(player: ConnectedPlayer): RoomPlayer {
    return {
      id: player.id,
      displayName: player.displayName,
      characterId: player.characterId,
      roleConfirmed: player.roleConfirmed,
      loadoutId: player.loadoutId,
      ready: player.ready,
      connected: player.connected,
      stealth: player.stealth,
      bandRole: player.bandRole,
      bandInvitePending: player.bandInvitePending,
      arrows: player.arrows,
      loot: player.loot,
      captureFor: player.captureFor,
      bowCooldown: player.bowCooldown,
      signatureCooldown: player.signatureCooldown,
      protectionScore: player.protectionScore,
      crowdControl: player.crowdControl,
      heavyCarryPeak: player.heavyCarryPeak,
      trapHits: player.trapHits,
      sabotageCount: player.sabotageCount,
      position: player.position,
      lastInputSequence: player.lastInputSequence,
      bowAction: player.bowAction ? { ...player.bowAction } : null,
    }
  }

  private characterAvailable(characterId: CharacterId, excludingPlayerId?: string): boolean {
    const selected = [...this.players.values()].filter((player) => player.id !== excludingPlayerId && player.roleConfirmed && player.characterId === characterId)
    return selected.length < 2
  }

  private ensureRescueOffer(now: number): void {
    if (!this.mission || this.lastRescueOfferSourceMissionId === this.missionId) return
    if (this.rescueOffer && (this.rescueOffer.status === "active" || this.rescueOffer.status === "accepted")) return
    const capturedOutlaws = [...this.players.values()].filter((player) => player.captured).length
    const missingCaptives = this.mission.captives.filter((captive) => !captive.rewarded).length
    const context: RescueOffer["context"] = capturedOutlaws > 0
      ? "captured-outlaws"
      : this.mission.missionKind === "prison-wagon" && missingCaptives > 0
        ? "lost-captives"
        : "lost-supplies"
    const targetCount = Math.max(1, context === "captured-outlaws" ? capturedOutlaws : context === "lost-captives" ? missingCaptives : Math.ceil(this.mission.deliveryTarget / Math.max(1, this.mission.definition.rewards.baseCartValue)))
    this.rescueOffer = {
      id: rescueOfferId(this.missionId),
      sourceMissionId: this.missionId,
      sourceMissionSlug: this.mission.definition.slug,
      rescueMissionSlug: "prison-wagon",
      context,
      targetCount,
      status: "active",
      createdAt: now,
      expiresAt: now + 30 * 60_000,
      acceptedAt: null,
      resolvedAt: null,
      attempts: 0,
      rewardSettled: false,
      recoveredValue: 0,
    }
    this.lastRescueOfferSourceMissionId = this.missionId
    this.recordRescueTransition(now)
    this.broadcastRoomState(now)
  }

  private resolveRescueOffer(now: number): void {
    if (!this.mission?.rescueOfferId || !this.rescueOffer || this.rescueOffer.id !== this.mission.rescueOfferId || this.rescueOffer.status !== "accepted") return
    this.rescueOffer.status = this.mission.status === "succeeded" ? "completed" : "failed"
    this.rescueOffer.resolvedAt = now
    if (this.mission.status === "succeeded" && !this.rescueOffer.rewardSettled) {
      this.rescueOffer.rewardSettled = true
      this.rescueOffer.recoveredValue = this.mission.delivered
    }
    this.recordRescueTransition(now)
    this.broadcastRoomState(now)
  }

  private expireRescueOffer(now: number): void {
    if (!this.rescueOffer || (this.rescueOffer.status !== "active" && this.rescueOffer.status !== "accepted") || now < this.rescueOffer.expiresAt) return
    if (this.phase === "mission" && this.mission?.rescueOfferId === this.rescueOffer.id) return
    this.rescueOffer.status = "expired"
    this.rescueOffer.resolvedAt = now
    this.selectedRescueOfferId = null
    this.recordRescueTransition(now)
    this.broadcastRoomState(now)
  }

  private releaseAcceptedRescue(now: number): void {
    if (!this.rescueOffer || this.rescueOffer.status !== "accepted" || this.selectedRescueOfferId !== this.rescueOffer.id) return
    this.rescueOffer.status = "active"
    this.rescueOffer.acceptedAt = null
    this.selectedRescueOfferId = null
    this.recordRescueTransition(now)
  }

  private recordRescueTransition(at: number): void {
    if (!this.rescueOffer) return
    this.rescueOfferEvents.push({ sequence: ++this.rescueEventSequence, at, offer: { ...this.rescueOffer } })
  }

  private expireContributions(now: number): boolean {
    let changed = false
    for (const contribution of this.contributions.values()) {
      if (contribution.status !== "available" || now < contribution.expiresAt) continue
      contribution.status = "expired"
      contribution.resolvedAt = now
      this.selectedContributionIds.delete(contribution.id)
      this.recordContributionTransition(contribution, now)
      changed = true
    }
    return changed
  }

  private resolveMissionContributions(now: number, broadcast = true): void {
    if (!this.mission || this.preparationsResolvedForMissionId === this.missionId) return
    for (const contribution of this.contributions.values()) {
      if (contribution.status !== "locked" || contribution.missionId !== this.missionId) continue
      const preparation = this.mission.preparations.find((candidate) => candidate.id === contribution.id)
      contribution.status = preparation?.status === "consumed" ? "consumed" : "refunded"
      contribution.resolvedAt = now
      this.recordContributionTransition(contribution, now)
    }
    this.selectedContributionIds.clear()
    this.preparationsResolvedForMissionId = this.missionId
    if (broadcast) this.broadcastRoomState(now)
  }

  private recordContributionTransition(contribution: BandContribution, at: number): void {
    this.contributionEvents.push({ sequence: ++this.contributionEventSequence, at, contribution: { ...contribution } })
  }

  private pruneContributionHistory(): void {
    const stale = [...this.contributions.values()]
      .filter((contribution) => contribution.status !== "available" && contribution.status !== "locked")
      .sort((left, right) => (right.resolvedAt ?? right.createdAt) - (left.resolvedAt ?? left.createdAt))
      .slice(12)
    for (const contribution of stale) this.contributions.delete(contribution.id)
  }

  private moderatorId(): string | null {
    return [...this.players.values()]
      .filter((player) => player.connected)
      .sort((a, b) => a.spawnIndex - b.spawnIndex)[0]?.id ?? null
  }

  private syncBandMembers(record: PersistentBandRecord): void {
    this.bandMemberRoles.clear()
    for (const member of record.members) this.bandMemberRoles.set(member.userId, member.membershipRole)
    for (const player of this.players.values()) player.bandRole = player.authUserId ? this.bandMemberRoles.get(player.authUserId) ?? null : null
  }

  broadcastRoomState(now = Date.now()): void {
    const rotationWindow = this.getRotationWindow(now)
    this.broadcast({
      type: "room_state",
      roomCode: this.code,
      phase: this.phase,
      missionSlug: this.missionSlug,
      selectedRotationId: this.selectedRotationId,
      rotationsPaused: rotationWindow.paused,
      rotations: rotationWindow.current,
      upcomingRotations: rotationWindow.upcoming,
      rescueOffer: this.rescueOffer ? { ...this.rescueOffer } : null,
      contributions: [...this.contributions.values()]
        .sort((left, right) => right.createdAt - left.createdAt)
        .map((contribution) => ({ ...contribution })),
      selectedContributionIds: [...this.selectedContributionIds],
      season: this.getSeasonSnapshot(now),
      band: this.band ? { ...this.band, camp: { ...this.band.camp } } : null,
      experiments: this.experimentAssignments.map((assignment) => ({ ...assignment, config: { ...assignment.config } })),
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
      experiments: this.experimentAssignments.map((assignment) => ({ ...assignment, config: { ...assignment.config } })),
      players: [...this.players.values()].map(({ id, position, lastInputSequence, arrows, loot, captureFor, bowCooldown, signatureCooldown, protectionScore, crowdControl, heavyCarryPeak, trapHits, sabotageCount, stealth, bowAction }) => ({ id, position, lastInputSequence, arrows, loot, captureFor, bowCooldown, signatureCooldown, protectionScore, crowdControl, heavyCarryPeak, trapHits, sabotageCount, stealth, bowAction: bowAction ? { ...bowAction } : null })),
      mission: this.mission.snapshot(),
    })
  }

  private broadcast(message: ServerMessage): void {
    const payload = JSON.stringify(message)
    for (const player of this.players.values()) {
      if (player.socket?.readyState === WebSocket.OPEN) player.socket.send(payload)
    }
  }

  private sendTo(player: ConnectedPlayer, message: ServerMessage): void {
    if (player.socket?.readyState === WebSocket.OPEN) player.socket.send(JSON.stringify(message))
  }

  private rejectBandChat(player: ConnectedPlayer, code: ChatErrorCode, message: string, retryAfterMs?: number): BandChatSendResult {
    this.sendTo(player, { type: "chat_error", channel: "band", code, message, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) })
    return { ok: false, code, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) }
  }

  private resetPlayerForHub(player: ConnectedPlayer): void {
    const spawn = spawnPoints[player.spawnIndex]
    player.ready = false
    player.arrows = maxArrows(player.characterId)
    player.loot = 0
    player.position = { ...spawn }
    player.input = { x: 0, z: 0 }
    player.captureFor = 0
    player.captured = false
    player.signatureCooldown = 0
    player.bowCooldown = 0
    player.bowAction = null
    player.invulnerableFor = 0
    player.veilFor = 0
    player.stealth = false
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
