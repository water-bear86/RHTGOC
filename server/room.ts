import { createHash, randomUUID } from "node:crypto"
import { WebSocket } from "ws"
import { MAX_ROOM_PLAYERS, RECONNECT_GRACE_MS, type BandContribution, type CharacterId, type ContributionType, type LastMissionResult, type LoadoutId, type RescueOffer, type RoomPlayer, type ServerMessage, type VillageState } from "../shared/protocol"
import { Mission } from "./mission"
import { getMissionDefinition } from "../shared/mission-catalog"
import { isRotationActive, rotationWindowAt, type SheriffRotationWindow } from "../shared/sheriff-rotation"
import type { SeasonalMissionOutcome, SherwoodSeasonSnapshot } from "../shared/sherwood-season"

interface ConnectedPlayer extends RoomPlayer {
  authUserId: string | null
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
  lastResult: LastMissionResult | null = null
  readonly moderationEvents: Array<{ at: number; actorId: string; targetId: string; action: "report" | "remove" | "block"; reason?: string }> = []
  private readonly bannedReconnectTokens = new Set<string>()
  private missionId = randomUUID()
  private leaderboardPersistence: "idle" | "pending" | "done" = "idle"
  private lastRescueOfferSourceMissionId: string | null = null
  private rescueEventSequence = 0
  private contributionEventSequence = 0
  private preparationsResolvedForMissionId: string | null = null
  private seasonOutcomeClaimedForMissionId: string | null = null

  constructor(
    code: string,
    private readonly getRotationWindow: (now: number) => SheriffRotationWindow = rotationWindowAt,
    private readonly getSeasonSnapshot: (now: number) => SherwoodSeasonSnapshot | null = () => null,
  ) {
    this.code = code
  }

  addPlayer(socket: WebSocket, displayName: string, characterId: CharacterId, authUserId: string | null = null): ConnectedPlayer {
    this.pruneDisconnected(Date.now())
    if (this.phase !== "lobby") throw new Error("MISSION_STARTED")
    if (this.players.size >= MAX_ROOM_PLAYERS) throw new Error("ROOM_FULL")
    if (!this.characterAvailable(characterId)) throw new Error("ROLE_FULL")
    const occupiedSpawns = new Set([...this.players.values()].map((player) => player.spawnIndex))
    const spawnIndex = spawnPoints.findIndex((_, index) => !occupiedSpawns.has(index))
    const position = spawnPoints[spawnIndex]
    const player: ConnectedPlayer = {
      id: randomUUID(),
      authUserId,
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

  reconnect(socket: WebSocket, token: string, now = Date.now(), authUserId: string | null = null): ConnectedPlayer | null {
    if (this.bannedReconnectTokens.has(token)) return null
    const player = [...this.players.values()].find((candidate) => candidate.reconnectToken === token)
    if (!player || player.disconnectedAt === null || now - player.disconnectedAt > RECONNECT_GRACE_MS || (player.authUserId && player.authUserId !== authUserId)) return null
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

  setReady(playerId: string, ready: boolean, now = Date.now()): boolean {
    const player = this.players.get(playerId)
    if (!player || this.phase !== "lobby") return false
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
      const definition = getMissionDefinition(this.missionSlug)
      for (const player of this.players.values()) player.position = { ...definition.spawns.players[player.spawnIndex] }
      this.mission ??= new Mission(this.code, this.players, definition, {
        rotation,
        rescueOffer: rescueOffer ? { id: rescueOffer.id, sourceMissionId: rescueOffer.sourceMissionId } : null,
        preparations: preparations.map(({ id, type, contributorLabel }) => ({ id, type, contributorLabel })),
      })
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
    this.preparationsResolvedForMissionId = null
    this.seasonOutcomeClaimedForMissionId = null
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
    rotationId: string | null
    rotationModifierIds: string[]
    rescueOfferId: string | null
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
      rotationId: this.mission!.rotationId,
      rotationModifierIds: [...this.mission!.rotationModifierIds],
      rescueOfferId: this.mission!.rescueOfferId,
      result: this.mission!.result!,
    }))
  }

  finishLeaderboardPersistence(success: boolean): void {
    this.leaderboardPersistence = success ? "done" : "idle"
  }

  authenticatedUserIds(): string[] {
    return [...new Set([...this.players.values()].map((player) => player.authUserId).filter((id): id is string => id !== null))]
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
      cleanEscape: this.mission.status === "succeeded" && this.mission.damageTaken === 0,
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
