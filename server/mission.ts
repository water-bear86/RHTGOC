import type { CharacterId, LoadoutId, MissionAlarm, MissionCaptive, MissionEvent, MissionKind, MissionLootCache, MissionResult, MissionSnapshot, MissionTrap, PingKind, RedistributionVote, VillageState, VoteChoice, WorldPing } from "../shared/protocol"
import { getMissionDefinition } from "../shared/mission-catalog"
import type { MissionDefinition } from "../shared/mission-definition"

export interface MissionPlayer {
  id: string
  characterId: CharacterId
  loadoutId: LoadoutId
  connected: boolean
  position: { x: number; z: number }
  health: number
  arrows: number
  loot: number
  input: { x: number; z: number }
  lastInputSequence: number
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

interface MissionGuardState {
  id: number
  position: { x: number; z: number }
  home: { x: number; z: number }
  patrolAngle: number
  stunnedFor: number
}

const defaultMission = getMissionDefinition()
export const SIGNAL_POSITION = { ...defaultMission.spawns.reinforcementSignal }
export const DELIVERY_TARGET = defaultMission.rewards.deliveryTarget

function routeMap(routes: MissionDefinition["routes"]["entry"]): Record<"forest" | "river", { x: number; z: number }> {
  return Object.fromEntries(routes.map((route) => [route.id, { ...route.position }])) as Record<"forest" | "river", { x: number; z: number }>
}

export const ENTRY_ROUTES = routeMap(defaultMission.routes.entry)
export const ESCAPE_ROUTES = routeMap(defaultMission.routes.escape)

const distance = (a: { x: number; z: number }, b: { x: number; z: number }): number => Math.hypot(a.x - b.x, a.z - b.z)

function seededUnit(seed: number): () => number {
  let value = seed || 1
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

export function missionSeed(roomCode: string): number {
  let seed = 2166136261
  for (const character of roomCode) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619)
  return seed >>> 0
}

export class Mission {
  readonly seed: number
  readonly events: MissionEvent[] = []
  readonly guards: MissionGuardState[]
  readonly pings: WorldPing[] = []
  readonly traps: MissionTrap[] = []
  readonly missionKind: MissionKind
  readonly captives: MissionCaptive[] = []
  readonly alarms: MissionAlarm[] = []
  readonly lootCaches: MissionLootCache[] = []
  status: "active" | "succeeded" | "failed" = "active"
  phase: "scout" | "ambush" | "robbery" | "pursuit" | "escape" | "extraction" = "scout"
  entryRoute: "forest" | "river" | null = null
  escapeRoute: "forest" | "river" | null = null
  cycle = 1
  elapsedSeconds = 0
  ambushStuns = 0
  peakHeat = 0
  alertedSeconds = 0
  shotsFired = 0
  shotsHit = 0
  damageTaken = 0
  result: MissionResult | null = null
  vote: RedistributionVote | null = null
  village: VillageState = { granary: 0, infirmary: 0, watchtower: 0 }
  readonly modifiers: MissionSnapshot["modifiers"]
  readonly deliveryTarget: number
  private readonly cartValue: number
  private readonly ambushTarget: number
  private readonly entryRoutesUsed = new Set<"forest" | "river">()
  private readonly escapeRoutesUsed = new Set<"forest" | "river">()
  private capturedOccurred = false
  heat = 0
  cartCoin = 120
  cartRefill = 0
  reinforcementDelaySeconds = 0
  signalSabotaged = false
  cartPosition: { x: number; z: number }
  wagonMoving = false
  lockProgress = 0
  alarmLevel = 0
  disguisePlayerId: string | null = null
  intelFound = false
  ledgerStolen = false
  reinforcementWave = 0
  failureReason: MissionSnapshot["failureReason"] = null
  delivered = 0
  tick = 0
  private nextTrapId = 1
  private wagonPathIndex = 1
  private reinforcementClock = 0
  private readonly lockContributors = new Set<string>()
  private cleanRelease = false

  constructor(
    roomCode: string,
    private readonly players: Map<string, MissionPlayer>,
    readonly definition: MissionDefinition = getMissionDefinition(),
  ) {
    this.seed = missionSeed(roomCode)
    this.missionKind = definition.scenario?.kind ?? "tax-cart"
    this.cartPosition = { ...definition.spawns.cart }
    if (definition.scenario?.kind === "prison-wagon") {
      const scenario = definition.scenario
      this.cartPosition = { ...scenario.wagonPath[0] }
      this.wagonMoving = true
      this.captives.push(...Array.from({ length: scenario.captiveCount }, (_, id) => ({
        id,
        status: "locked" as const,
        position: { x: this.cartPosition.x + (id - (scenario.captiveCount - 1) / 2) * 0.55, z: this.cartPosition.z },
        rewarded: false,
      })))
    }
    const random = seededUnit(this.seed)
    const pool: MissionSnapshot["modifiers"] = definition.modifiers.map((modifier) => ({ ...modifier }))
    const firstModifier = this.seed % pool.length
    const secondModifier = (firstModifier + 1 + (this.seed % (pool.length - 1))) % pool.length
    this.modifiers = [pool[firstModifier], pool[secondModifier]]
    this.cartValue = this.modifiers.some((modifier) => modifier.id === "double-tithe") ? definition.rewards.doubleTitheCartValue : definition.rewards.baseCartValue
    this.deliveryTarget = this.modifiers.some((modifier) => modifier.id === "double-tithe") ? definition.rewards.doubleTitheTarget : definition.rewards.deliveryTarget
    this.ambushTarget = this.modifiers.some((modifier) => modifier.id === "armored-escort") ? definition.rules.armoredAmbushStuns : definition.rules.baseAmbushStuns
    this.cartCoin = this.missionKind === "prison-wagon" ? 0 : this.cartValue
    if (definition.scenario?.kind === "storehouse") {
      const scale = this.cartValue / definition.rewards.baseCartValue
      this.alarms.push(...definition.scenario.alarmPanels.map((alarm) => ({ id: alarm.id, status: "active" as const, position: { ...alarm.position } })))
      this.lootCaches.push(...definition.scenario.lootCaches.map((cache) => ({
        id: cache.id,
        kind: cache.kind,
        status: "secured" as const,
        position: { ...cache.position },
        value: Math.round(cache.value * scale),
      })))
      this.cartCoin = this.lootCaches.reduce((sum, cache) => sum + cache.value, 0)
    }
    if (this.modifiers.some((modifier) => modifier.id === "scarce-quivers")) {
      for (const player of players.values()) player.arrows = Math.max(1, player.arrows - 1)
    }
    for (const player of players.values()) if (player.loadoutId === "smoke") player.veilFor = Math.max(player.veilFor, 2)
    const guardStarts = definition.spawns.guards.map((guard) => ({ id: guard.id, position: { ...guard.position }, home: { ...guard.position }, patrolAngle: random() * Math.PI * 2, stunnedFor: 0 }))
    const modifierGuard = this.modifiers.some((modifier) => modifier.id === "watchful-sheriff") ? 1 : 0
    this.guards = guardStarts.slice(0, 3 + Math.max(0, Math.min(2, players.size - 2)) + modifierGuard)
    this.record("mission_started")
  }

  setInput(playerId: string, sequence: number, move: { x: number; z: number }, now = Date.now()): boolean {
    const player = this.players.get(playerId)
    if (!player || this.status !== "active" || !player.connected || player.health <= 0 || player.downedFor > 0 || player.captured) return false
    if (sequence <= player.lastInputSequence || now - player.lastInputAt < 20) return false
    const length = Math.hypot(move.x, move.z)
    player.input = length > 1 ? { x: move.x / length, z: move.z / length } : { ...move }
    player.lastInputSequence = sequence
    player.lastInputAt = now
    return true
  }

  action(playerId: string, action: "interact" | "shoot" | "signature" | "revive" | "transfer_loot", targetPlayerId?: string): boolean {
    const player = this.players.get(playerId)
    if (!player || this.status !== "active" || !player.connected || player.health <= 0 || player.downedFor > 0 || player.captured) return false
    if (action === "interact") return this.interact(player)
    if (action === "shoot") return this.shoot(player)
    if (action === "signature") return this.signature(player)
    if (!targetPlayerId) return false
    const target = this.players.get(targetPlayerId)
    if (!target || target.id === player.id || distance(player.position, target.position) > 2.4) return false
    if (action === "revive") return this.revive(player, target)
    return this.transferLoot(player, target)
  }

  ping(playerId: string, kind: PingKind): boolean {
    const player = this.players.get(playerId)
    if (!player || !player.connected || player.captured || this.status !== "active" || this.tick - player.lastPingTick < 20) return false
    player.lastPingTick = this.tick
    const ping: WorldPing = {
      id: this.events.length + 1,
      kind,
      playerId,
      position: { ...player.position },
      expiresAtTick: this.tick + 100,
    }
    this.pings.push(ping)
    this.record("ping_sent", playerId, ping.id)
    return true
  }

  castVote(playerId: string, choice: VoteChoice): boolean {
    const player = this.players.get(playerId)
    if (!player?.connected || !this.vote || this.vote.resolved || this.tick > this.vote.deadlineTick) return false
    this.vote.votes[playerId] = choice
    this.recountVotes()
    this.record("vote_cast", playerId, undefined, choice)
    const eligible = [...this.players.values()].filter((candidate) => candidate.connected && !candidate.captured)
    if (eligible.length > 0 && eligible.every((candidate) => this.vote?.votes[candidate.id])) this.resolveVote()
    return true
  }

  update(dt: number): void {
    if (this.status === "failed") return
    this.tick += 1
    if (this.status === "succeeded") {
      if (this.vote && !this.vote.resolved && this.tick >= this.vote.deadlineTick) this.resolveVote()
      return
    }
    this.elapsedSeconds += dt
    for (let index = this.pings.length - 1; index >= 0; index -= 1) {
      if (this.pings[index].expiresAtTick <= this.tick) this.pings.splice(index, 1)
    }
    for (let index = this.traps.length - 1; index >= 0; index -= 1) {
      if (this.traps[index].expiresAtTick <= this.tick) this.traps.splice(index, 1)
    }
    this.cartRefill = Math.max(0, this.cartRefill - dt)
    this.reinforcementDelaySeconds = Math.max(0, this.reinforcementDelaySeconds - dt)
    if (this.cartRefill === 0 && this.cartCoin === 0) this.cartCoin = this.cartValue

    for (const player of this.players.values()) {
      player.bowCooldown = Math.max(0, player.bowCooldown - dt)
      player.signatureCooldown = Math.max(0, player.signatureCooldown - dt)
      player.invulnerableFor = Math.max(0, player.invulnerableFor - dt)
      player.veilFor = Math.max(0, player.veilFor - dt)
      if (player.downedFor > 0) {
        player.downedFor = Math.max(0, player.downedFor - dt)
        player.input = { x: 0, z: 0 }
        if (player.downedFor === 0) {
          player.captured = true
          this.capturedOccurred = true
          this.record("player_captured", player.id)
        }
      }
      if (!player.connected || player.health <= 0 || player.captured) continue
      const moveLength = Math.hypot(player.input.x, player.input.z)
      if (moveLength > 0.001) {
        const roleSpeed = player.characterId === "marian" ? 6.75 : player.characterId === "little-john" ? 5.9 : 6.2
        const lootPenalty = player.characterId === "little-john"
          ? Math.max(0.82, 1 - player.loot / 1_100)
          : Math.max(0.68, 1 - player.loot / 600)
        const movement = roleSpeed * lootPenalty * dt
        const bounds = this.definition.rules.worldBounds
        player.position.x = Math.max(-bounds, Math.min(bounds, player.position.x + (player.input.x / moveLength) * movement))
        player.position.z = Math.max(-bounds, Math.min(bounds, player.position.z + (player.input.z / moveLength) * movement))
      }
    }

    const activePlayers = [...this.players.values()].filter((player) => player.connected && player.health > 0 && !player.captured)
    if (this.missionKind === "prison-wagon") this.updatePrisonWagon(activePlayers, dt)
    if (this.missionKind === "storehouse") this.updateStorehouse(activePlayers, dt)
    if (this.phase === "scout") this.detectRoute(activePlayers, routeMap(this.definition.routes.entry), "entry")
    if (this.phase === "pursuit") this.detectRoute(this.missionKind === "prison-wagon" ? activePlayers : activePlayers.filter((player) => player.loot > 0), routeMap(this.definition.routes.escape), "escape")
    const hidden = activePlayers.every((player) => Math.abs(player.position.x) > 13 || Math.abs(player.position.z) > 13 || player.veilFor > 0)
    this.heat = Math.max(0, this.heat - (hidden ? 7 : 1.2) * dt)
    this.peakHeat = Math.max(this.peakHeat, this.heat)
    if (this.heat > 50) this.alertedSeconds += dt
    for (const guard of this.guards) this.updateGuard(guard, activePlayers, dt)

    if (this.players.size > 0 && [...this.players.values()].every((player) => player.captured)) this.failMission("captured")
    if (this.definition.scenario?.kind === "prison-wagon" && this.elapsedSeconds >= this.definition.scenario.failureSeconds) this.failMission("timeout")
    if (this.definition.scenario?.kind === "storehouse" && this.elapsedSeconds >= this.definition.scenario.failureSeconds) this.failMission("timeout")
  }

  snapshot(): MissionSnapshot {
    return {
      missionId: this.definition.id,
      missionVersion: this.definition.missionVersion,
      contentHash: this.definition.contentHash,
      missionKind: this.missionKind,
      seed: this.seed,
      status: this.status,
      phase: this.phase,
      entryRoute: this.entryRoute,
      escapeRoute: this.escapeRoute,
      cycle: this.cycle,
      elapsedSeconds: this.elapsedSeconds,
      parSeconds: this.definition.mastery.parSeconds,
      heat: this.heat,
      cartCoin: this.cartCoin,
      delivered: this.delivered,
      target: this.deliveryTarget,
      supportScore: [...this.players.values()].reduce((total, player) => total + player.rescueCount * 350 + player.transferCount * 100 + player.protectionScore + player.crowdControl * 75 + player.trapHits * 125 + player.sabotageCount * 200, 0),
      guards: this.guards.map((guard) => ({ id: guard.id, position: { ...guard.position }, stunnedFor: guard.stunnedFor })),
      pings: this.pings.map((ping) => ({ ...ping, position: { ...ping.position } })),
      latestEvent: this.events.at(-1) ?? null,
      result: this.result,
      vote: this.vote ? { ...this.vote, counts: { ...this.vote.counts }, votes: { ...this.vote.votes } } : null,
      village: { ...this.village },
      modifiers: this.modifiers,
      sheriffPlan: this.cycle >= 4 || this.players.size >= 4 ? "reinforcement" : this.cycle >= 2 ? "pursuit" : "patrol",
      optionalObjectives: this.optionalObjectives(),
      traps: this.traps.map((trap) => ({ ...trap, position: { ...trap.position } })),
      reinforcementDelaySeconds: this.reinforcementDelaySeconds,
      signalSabotaged: this.signalSabotaged,
      cartPosition: { ...this.cartPosition },
      wagonMoving: this.wagonMoving,
      captives: this.captives.map((captive) => ({ ...captive, position: { ...captive.position } })),
      lockProgress: this.lockProgress,
      lockTarget: this.definition.scenario?.kind === "prison-wagon" ? this.definition.scenario.lockStrength : 0,
      failureReason: this.failureReason,
      alarms: this.alarms.map((alarm) => ({ ...alarm, position: { ...alarm.position } })),
      lootCaches: this.lootCaches.map((cache) => ({ ...cache, position: { ...cache.position } })),
      alarmLevel: this.alarmLevel,
      disguisePlayerId: this.disguisePlayerId,
      intelFound: this.intelFound,
      ledgerStolen: this.ledgerStolen,
      reinforcementWave: this.reinforcementWave,
    }
  }

  private interact(player: MissionPlayer): boolean {
    if (this.missionKind === "prison-wagon") return this.interactPrisonWagon(player)
    if (this.missionKind === "storehouse") return this.interactStorehouse(player)
    if (player.characterId === "much" && !this.signalSabotaged && this.phase !== "extraction" && distance(player.position, this.definition.spawns.reinforcementSignal) < 3.2) {
      this.signalSabotaged = true
      this.reinforcementDelaySeconds = 30
      player.sabotageCount += 1
      this.heat = Math.max(0, this.heat - 20)
      this.record("reinforcement_sabotaged", player.id, 30, "signal-cut")
      return true
    }
    if (distance(player.position, this.definition.spawns.cart) < 3) {
      if (this.phase !== "robbery" || this.cartCoin === 0) return false
      const stolen = this.cartCoin
      player.loot += stolen
      if (player.characterId === "little-john") {
        player.heavyCarryPeak = Math.max(player.heavyCarryPeak, player.loot)
        this.record("heavy_carry", player.id, player.heavyCarryPeak)
      }
      this.cartCoin = 0
      this.cartRefill = 28
      this.heat = 100
      this.record("cart_robbed", player.id, stolen)
      this.setPhase("pursuit", player.id)
      return true
    }
    if (this.phase !== "escape" || distance(player.position, this.definition.spawns.village) >= 3.2 || player.loot <= 0) return false
    this.setPhase("extraction", player.id)
    const delivered = player.loot
    player.loot = 0
    player.arrows = player.characterId === "robin" ? 6 : player.characterId === "little-john" ? 3 : 4
    this.delivered += delivered
    this.heat = Math.max(0, this.heat - 45)
    this.record("loot_delivered", player.id, delivered)
    if (this.delivered >= this.deliveryTarget && this.status === "active") {
      this.status = "succeeded"
      this.result = this.calculateResult()
      this.vote = {
        deadlineTick: this.tick + 300,
        counts: { granary: 0, infirmary: 0, watchtower: 0 },
        votes: {},
        resolved: false,
        winner: null,
        allocatedCoin: this.delivered,
      }
      this.record("mission_succeeded", player.id, this.delivered)
    } else {
      this.cycle += 1
      this.entryRoute = null
      this.escapeRoute = null
      this.ambushStuns = 0
      this.setPhase("scout", player.id)
    }
    return true
  }

  private interactPrisonWagon(player: MissionPlayer): boolean {
    const scenario = this.definition.scenario
    if (!scenario || scenario.kind !== "prison-wagon") return false
    if (player.characterId === "much" && !this.signalSabotaged && this.phase !== "extraction" && distance(player.position, this.definition.spawns.reinforcementSignal) < 3.2) {
      this.signalSabotaged = true
      this.reinforcementDelaySeconds = 30
      player.sabotageCount += 1
      this.heat = Math.max(0, this.heat - 20)
      this.record("reinforcement_sabotaged", player.id, 30, "signal-cut")
      return true
    }
    if (this.phase === "robbery" && distance(player.position, this.cartPosition) < 3.2) {
      if (this.lockContributors.has(player.id)) return false
      const contribution = player.characterId === "little-john" || player.characterId === "much" ? 3 : 2
      this.lockContributors.add(player.id)
      this.lockProgress = Math.min(scenario.lockStrength, this.lockProgress + contribution)
      if (player.characterId === "much" || player.characterId === "marian") this.cleanRelease = true
      if (player.characterId === "little-john") player.protectionScore += 150
      if (player.characterId === "much") player.sabotageCount += 1
      this.record("lock_breached", player.id, contribution, player.characterId)
      if (this.lockProgress >= scenario.lockStrength) {
        for (const captive of this.captives) captive.status = "following"
        this.heat = Math.max(this.heat, 65)
        this.record("captives_freed", player.id, this.captives.length)
        this.setPhase("pursuit", player.id)
      }
      return true
    }
    if (this.phase !== "escape" || !this.escapeRoute) return false
    const extraction = routeMap(this.definition.routes.escape)[this.escapeRoute]
    if (distance(player.position, extraction) > scenario.extractionRadius) return false
    let rescued = 0
    for (const captive of this.captives) {
      if (captive.status !== "following" || distance(captive.position, extraction) > scenario.extractionRadius + 1.5) continue
      captive.status = "extracted"
      if (!captive.rewarded) {
        captive.rewarded = true
        rescued += 1
        this.delivered += this.cartValue
        player.rescueCount += 1
        this.record("captive_extracted", player.id, captive.id, this.escapeRoute)
      }
    }
    if (rescued === 0) return false
    if (this.captives.every((captive) => captive.status === "extracted")) this.succeedMission(player.id)
    return true
  }

  private interactStorehouse(player: MissionPlayer): boolean {
    const scenario = this.definition.scenario
    if (!scenario || scenario.kind !== "storehouse") return false
    if (player.characterId === "marian" && this.disguisePlayerId === null && distance(player.position, scenario.disguisePosition) < 2.8 && (this.phase === "ambush" || this.phase === "robbery")) {
      this.disguisePlayerId = player.id
      this.heat = Math.max(0, this.heat - 15)
      this.record("disguise_acquired", player.id)
      if (this.phase === "ambush") this.setPhase("robbery", player.id)
      return true
    }
    const nearbyAlarm = this.alarms
      .filter((alarm) => alarm.status === "active")
      .sort((left, right) => distance(left.position, player.position) - distance(right.position, player.position))[0]
    if (player.characterId === "much" && nearbyAlarm && distance(nearbyAlarm.position, player.position) < 3) {
      nearbyAlarm.status = "sabotaged"
      player.sabotageCount += 1
      this.reinforcementDelaySeconds = Math.max(this.reinforcementDelaySeconds, 30)
      this.heat = Math.max(0, this.heat - 12)
      this.record("alarm_sabotaged", player.id, undefined, nearbyAlarm.id)
      if (this.phase === "ambush") this.setPhase("robbery", player.id)
      return true
    }
    if (this.phase === "ambush" && this.entryRoute) {
      const entrance = routeMap(this.definition.routes.entry)[this.entryRoute]
      if (distance(player.position, entrance) >= 3.5) return false
      if (this.disguisePlayerId !== player.id) this.triggerAlarm(nearbyAlarm, player.id, `${this.entryRoute}-forced-entry`)
      if (player.characterId === "little-john") player.protectionScore += 125
      this.setPhase("robbery", player.id)
      return true
    }
    if (this.phase === "robbery") {
      const cache = this.lootCaches
        .filter((candidate) => candidate.status === "secured")
        .sort((left, right) => distance(left.position, player.position) - distance(right.position, player.position))[0]
      if (!cache || distance(cache.position, player.position) >= 2.7) return false
      cache.status = "looted"
      if (cache.kind === "coin") {
        player.loot += cache.value
        this.cartCoin = Math.max(0, this.cartCoin - cache.value)
        if (player.characterId === "little-john") player.heavyCarryPeak = Math.max(player.heavyCarryPeak, player.loot)
        this.record("cache_looted", player.id, cache.value, cache.id)
      } else if (cache.kind === "intel") {
        this.intelFound = true
        this.record("intel_found", player.id, undefined, cache.id)
      } else {
        this.ledgerStolen = true
        this.record("ledger_stolen", player.id, undefined, cache.id)
      }
      if (this.disguisePlayerId !== player.id && player.veilFor <= 0 && player.characterId !== "much") {
        const alarm = this.alarms
          .filter((candidate) => candidate.status === "active")
          .sort((left, right) => distance(left.position, cache.position) - distance(right.position, cache.position))[0]
        this.triggerAlarm(alarm, player.id, `cache:${cache.id}`)
      }
      const carried = [...this.players.values()].reduce((sum, candidate) => sum + candidate.loot, 0)
      if (carried >= this.deliveryTarget) this.setPhase("pursuit", player.id)
      return true
    }
    if (this.phase !== "escape" || !this.escapeRoute || player.loot <= 0) return false
    const extraction = routeMap(this.definition.routes.escape)[this.escapeRoute]
    if (distance(player.position, extraction) > scenario.extractionRadius) return false
    const value = player.loot
    player.loot = 0
    this.delivered += value
    this.heat = Math.max(0, this.heat - 30)
    this.record("extraction_reached", player.id, value, this.escapeRoute)
    if (this.delivered >= this.deliveryTarget) this.succeedMission(player.id)
    return true
  }

  private updateStorehouse(players: MissionPlayer[], dt: number): void {
    const scenario = this.definition.scenario
    if (!scenario || scenario.kind !== "storehouse") return
    if (this.phase === "robbery" || this.phase === "pursuit" || this.phase === "escape") {
      for (const alarm of this.alarms.filter((candidate) => candidate.status === "active")) {
        const intruder = players.find((player) => player.id !== this.disguisePlayerId && player.veilFor <= 0 && distance(player.position, alarm.position) < 2.1)
        if (intruder) this.triggerAlarm(alarm, intruder.id, "proximity")
      }
    }
    if (this.alarmLevel > 0 && this.phase !== "extraction") {
      this.reinforcementClock += dt * this.alarmLevel
      if (this.reinforcementClock >= scenario.reinforcementSeconds && this.reinforcementDelaySeconds <= 0) {
        this.reinforcementClock = 0
        const existing = new Set(this.guards.map((guard) => guard.id))
        const start = this.definition.spawns.guards.find((guard) => !existing.has(guard.id))
        if (start) this.guards.push({ id: start.id, position: { ...start.position }, home: { ...start.position }, patrolAngle: 0, stunnedFor: 0 })
        this.reinforcementWave += 1
        this.heat = Math.min(100, this.heat + 12)
        this.record("reinforcement_arrived", undefined, this.reinforcementWave, `alarm:${this.alarmLevel}`)
      }
    }
  }

  private triggerAlarm(alarm: MissionAlarm | undefined, playerId?: string, detail?: string): void {
    if (!alarm || alarm.status !== "active") return
    alarm.status = "triggered"
    this.alarmLevel = Math.min(3, this.alarmLevel + 1)
    this.heat = Math.max(this.heat, 35 + this.alarmLevel * 20)
    this.record("alarm_triggered", playerId, this.alarmLevel, detail ?? alarm.id)
  }

  private updatePrisonWagon(players: MissionPlayer[], dt: number): void {
    const scenario = this.definition.scenario
    if (!scenario || scenario.kind !== "prison-wagon") return
    if (this.wagonMoving && (this.phase === "scout" || this.phase === "ambush")) {
      const target = scenario.wagonPath[this.wagonPathIndex]
      const before = { ...this.cartPosition }
      this.moveToward(this.cartPosition, target, scenario.wagonSpeed, dt)
      const dx = this.cartPosition.x - before.x
      const dz = this.cartPosition.z - before.z
      for (const guard of this.guards) {
        guard.position.x += dx
        guard.position.z += dz
        guard.home.x += dx
        guard.home.z += dz
      }
      this.positionLockedCaptives()
      if (distance(this.cartPosition, target) < 0.08) {
        this.wagonPathIndex += 1
        if (this.wagonPathIndex >= scenario.wagonPath.length) this.failMission("wagon-escaped")
      }
    }
    const followers = this.captives.filter((captive) => captive.status === "following")
    for (const captive of followers) {
      const escort = players
        .slice()
        .sort((left, right) => distance(left.position, captive.position) - distance(right.position, captive.position))[0]
      if (escort) this.moveToward(captive.position, escort.position, 4.1, dt)
    }
    if ((this.phase === "pursuit" || this.phase === "escape") && this.heat > 45) {
      this.reinforcementClock += dt
      if (this.reinforcementClock >= scenario.reinforcementSeconds && this.reinforcementDelaySeconds <= 0) {
        this.reinforcementClock = 0
        const existing = new Set(this.guards.map((guard) => guard.id))
        const start = this.definition.spawns.guards.find((guard) => !existing.has(guard.id))
        if (start) {
          this.guards.push({ id: start.id, position: { ...start.position }, home: { ...start.position }, patrolAngle: 0, stunnedFor: 0 })
          this.record("reinforcement_arrived", undefined, start.id)
        }
      }
    }
  }

  private positionLockedCaptives(): void {
    const locked = this.captives.filter((captive) => captive.status === "locked")
    for (let index = 0; index < locked.length; index += 1) {
      locked[index].position = { x: this.cartPosition.x + (index - (locked.length - 1) / 2) * 0.55, z: this.cartPosition.z }
    }
  }

  private succeedMission(playerId?: string): void {
    if (this.status !== "active") return
    this.status = "succeeded"
    this.setPhase("extraction", playerId)
    this.result = this.calculateResult()
    this.vote = {
      deadlineTick: this.tick + 300,
      counts: { granary: 0, infirmary: 0, watchtower: 0 },
      votes: {},
      resolved: false,
      winner: null,
      allocatedCoin: this.delivered,
    }
    this.record("mission_succeeded", playerId, this.delivered)
  }

  private failMission(reason: NonNullable<MissionSnapshot["failureReason"]>): void {
    if (this.status !== "active") return
    this.status = "failed"
    this.wagonMoving = false
    this.failureReason = reason
    this.result = this.calculateResult()
    this.record("mission_failed", undefined, this.captives.filter((captive) => captive.rewarded).length, reason)
  }

  private optionalObjectives(): MissionSnapshot["optionalObjectives"] {
    if (this.missionKind === "prison-wagon") {
      const rescued = this.captives.filter((captive) => captive.rewarded).length
      return [
        { id: "clean-release", label: "Open the cage without harming captives", completed: this.status === "succeeded" && this.cleanRelease, failed: this.status !== "active" && !this.cleanRelease },
        { id: "all-captives", label: `Rescue every captive (${rescued}/${this.captives.length})`, completed: rescued === this.captives.length, failed: this.status === "failed" && rescued < this.captives.length },
        { id: "no-civilian-harm", label: "Bring every villager through unharmed", completed: this.status === "succeeded" && !this.capturedOccurred, failed: this.capturedOccurred },
      ]
    }
    if (this.missionKind === "storehouse") {
      return [
        { id: "clean-infiltration", label: `Leave every alarm quiet (${this.alarmLevel}/3 raised)`, completed: this.status === "succeeded" && this.alarmLevel === 0, failed: this.alarmLevel > 0 },
        { id: "patrol-intelligence", label: "Steal the patrol intelligence", completed: this.intelFound, failed: this.status !== "active" && !this.intelFound },
        { id: "nottingham-ledger", label: "Take the Sheriff's ledger", completed: this.ledgerStolen, failed: this.status !== "active" && !this.ledgerStolen },
      ]
    }
    return [
      { id: "no-captures", label: "Leave no outlaw behind", completed: this.status === "succeeded" && !this.capturedOccurred, failed: this.capturedOccurred },
      { id: "share-the-wealth", label: "Transfer 120 coin between outlaws", completed: [...this.players.values()].reduce((sum, player) => sum + player.totalTransferred, 0) >= 120, failed: false },
      { id: "two-roads", label: "Use both forest and river routes", completed: this.entryRoutesUsed.size === 2 || this.escapeRoutesUsed.size === 2, failed: false },
    ]
  }

  private shoot(player: MissionPlayer): boolean {
    if (player.arrows <= 0 || player.bowCooldown > 0) return false
    this.shotsFired += 1
    player.arrows -= 1
    player.bowCooldown = 0.7
    if (this.missionKind === "storehouse") {
      const alarm = this.alarms.find((candidate) => candidate.status === "active")
      this.triggerAlarm(alarm, player.id, "bow-shot")
    }
    const target = this.guards
      .filter((guard) => guard.stunnedFor <= 0 && distance(guard.position, player.position) < 9)
      .sort((a, b) => distance(a.position, player.position) - distance(b.position, player.position))[0]
    if (!target) return false
    target.stunnedFor = 3.2
    this.shotsHit += 1
    this.record("guard_stunned", player.id, target.id)
    if (this.phase === "ambush") {
      this.ambushStuns += 1
      if (this.ambushStuns >= this.ambushTarget) this.setPhase("robbery", player.id)
    }
    return true
  }

  private signature(player: MissionPlayer): boolean {
    if (player.signatureCooldown > 0) return false
    if (player.characterId === "marian") {
      player.veilFor = 5
      this.heat = Math.max(0, this.heat - 30)
    } else if (player.characterId === "little-john") {
      if (this.missionKind === "storehouse") this.triggerAlarm(this.alarms.find((candidate) => candidate.status === "active"), player.id, "oak-sweep")
      const targets = this.guards.filter((guard) => guard.stunnedFor <= 0 && distance(guard.position, player.position) < 6)
      const allies = [...this.players.values()].filter((candidate) => candidate.id !== player.id && candidate.connected && !candidate.captured && distance(candidate.position, player.position) < 6)
      if (targets.length === 0 && allies.length === 0) return false
      for (const target of targets) target.stunnedFor = 5
      for (const ally of allies) ally.invulnerableFor = Math.max(ally.invulnerableFor, 3.5)
      player.crowdControl += targets.length
      player.protectionScore += allies.length * 100
      if (targets.length > 0) this.record("crowd_controlled", player.id, targets.length, "little-john-sweep")
      if (allies.length > 0) this.record("ally_protected", player.id, allies.length, "little-john-sweep")
      if (this.phase === "ambush") {
        this.ambushStuns += targets.length
        if (this.ambushStuns >= this.ambushTarget) this.setPhase("robbery", player.id)
      }
    } else if (player.characterId === "much") {
      if (!this.placeTrap(player)) return false
    } else {
      if (this.missionKind === "storehouse") this.triggerAlarm(this.alarms.find((candidate) => candidate.status === "active"), player.id, "twin-shot")
      const targets = this.guards
        .filter((guard) => distance(guard.position, player.position) < 11)
        .sort((a, b) => distance(a.position, player.position) - distance(b.position, player.position))
        .slice(0, 2)
      if (targets.length === 0) return false
      for (const target of targets) target.stunnedFor = 3.2
      if (this.phase === "ambush") {
        this.ambushStuns += targets.length
        if (this.ambushStuns >= this.ambushTarget) this.setPhase("robbery", player.id)
      }
    }
    player.signatureCooldown = player.characterId === "little-john" ? 20 : 18
    const signatureDetail = player.characterId === "little-john" ? "little-john-sweep" : player.characterId === "much" ? "much-snare" : player.characterId
    this.record("signature_used", player.id, undefined, signatureDetail)
    return true
  }

  private revive(player: MissionPlayer, target: MissionPlayer): boolean {
    if (target.downedFor <= 0 || target.captured) return false
    target.health = Math.min(3, (player.characterId === "little-john" ? 2 : 1) + (player.loadoutId === "bandage" ? 1 : 0))
    target.downedFor = 0
    target.invulnerableFor = player.characterId === "little-john" ? 4.5 : 2.5
    player.rescueCount += 1
    if (player.characterId === "little-john") {
      player.protectionScore += 250
      this.record("ally_protected", player.id, 250, "vanguard-revive")
    }
    this.record("player_revived", player.id, player.rescueCount)
    return true
  }

  private transferLoot(player: MissionPlayer, target: MissionPlayer): boolean {
    if (player.loot <= 0 || target.health <= 0 || target.captured || target.downedFor > 0) return false
    const amount = Math.min(60, player.loot)
    player.loot -= amount
    target.loot += amount
    player.transferCount += 1
    player.totalTransferred += amount
    this.record("loot_transferred", player.id, amount)
    return true
  }

  private updateGuard(guard: MissionGuardState, players: MissionPlayer[], dt: number): void {
    guard.stunnedFor = Math.max(0, guard.stunnedFor - dt)
    if (guard.stunnedFor > 0) return
    const trapIndex = this.traps.findIndex((trap) => distance(trap.position, guard.position) < 1.35)
    if (trapIndex >= 0) {
      const [trap] = this.traps.splice(trapIndex, 1)
      guard.stunnedFor = 4.5
      const owner = this.players.get(trap.ownerId)
      if (owner) owner.trapHits += 1
      this.record("trap_triggered", trap.ownerId, guard.id, `trap:${trap.id}`)
      return
    }
    const target = players
      .filter((player) => player.veilFor <= 0)
      .sort((a, b) => distance(a.position, guard.position) - distance(b.position, guard.position))[0]
    if (target && this.heat > 8 && distance(target.position, guard.position) < 22) {
      const disruption = this.reinforcementDelaySeconds > 0 ? 0.7 : 0
      this.moveToward(guard.position, target.position, 3.35 + this.heat * 0.008 - disruption, dt)
      if (distance(target.position, guard.position) < 1.25 && target.invulnerableFor === 0) {
        target.health = Math.max(0, target.health - 1)
        this.damageTaken += 1
        target.invulnerableFor = 2
        this.heat = Math.min(100, this.heat + 15)
        this.record("player_hit", target.id, target.health)
        if (target.health === 0 && target.downedFor === 0) {
          target.downedFor = 20
          target.input = { x: 0, z: 0 }
          this.record("player_downed", target.id, 20)
        }
      }
      return
    }
    guard.patrolAngle += dt * (0.45 + guard.id * 0.05)
    this.moveToward(guard.position, {
      x: guard.home.x + Math.cos(guard.patrolAngle) * 2.2,
      z: guard.home.z + Math.sin(guard.patrolAngle) * 2.2,
    }, 1.5, dt)
  }

  private placeTrap(player: MissionPlayer): boolean {
    if (this.phase === "extraction") return false
    if (Math.abs(player.position.x) > 20 || Math.abs(player.position.z) > 20) return false
    if (Math.abs(player.position.x) < 3.2 && Math.abs(player.position.z) < 18) return false
    if (distance(player.position, this.definition.spawns.cart) < 3 || distance(player.position, this.definition.spawns.village) < 3) return false
    if (this.traps.some((trap) => trap.ownerId === player.id)) return false
    const trap: MissionTrap = {
      id: this.nextTrapId++,
      ownerId: player.id,
      position: { ...player.position },
      expiresAtTick: this.tick + this.definition.rules.trapLifetimeTicks,
    }
    this.traps.push(trap)
    this.record("trap_placed", player.id, trap.id, this.phase)
    return true
  }

  private detectRoute(
    players: MissionPlayer[],
    routes: typeof ENTRY_ROUTES | typeof ESCAPE_ROUTES,
    kind: "entry" | "escape",
  ): void {
    for (const route of ["forest", "river"] as const) {
      const scout = players.find((player) => distance(player.position, routes[route]) < 3)
      if (!scout) continue
      if (kind === "entry") {
        this.entryRoute = route
        this.entryRoutesUsed.add(route)
        this.setPhase("ambush", scout.id)
      } else {
        this.escapeRoute = route
        this.escapeRoutesUsed.add(route)
        this.setPhase("escape", scout.id)
      }
      this.record("route_selected", scout.id, undefined, `${kind}:${route}`)
      return
    }
  }

  private setPhase(phase: Mission["phase"], playerId?: string): void {
    if (this.phase === phase) return
    this.phase = phase
    if (this.missionKind === "prison-wagon" && phase === "robbery") {
      this.wagonMoving = false
      this.record("wagon_intercepted", playerId, this.ambushStuns)
    }
    this.record("phase_changed", playerId, undefined, phase)
  }

  private calculateResult(): MissionResult {
    const playerCount = Math.max(1, this.players.size)
    const clamp = (value: number): number => Math.round(Math.max(0, Math.min(100, value)))
    const speed = clamp(100 - Math.max(0, this.elapsedSeconds - 720) / 4.8)
    const stealth = clamp(100 - (this.alertedSeconds / Math.max(1, this.elapsedSeconds)) * 100)
    const precision = clamp(this.shotsFired === 0 ? 100 : (this.shotsHit / this.shotsFired) * 100)
    const survival = clamp(100 - (this.damageTaken / (playerCount * 3)) * 100)
    const rescues = clamp([...this.players.values()].reduce((total, player) => total + player.rescueCount, 0) * 25)
    const transferred = [...this.players.values()].reduce((total, player) => total + player.totalTransferred, 0)
    const generosity = clamp((transferred / Math.max(1, this.delivered)) * 200)
    const weights = this.definition.mastery.weights
    const score = Math.round((speed * weights.speed + stealth * weights.stealth + precision * weights.precision + survival * weights.survival + rescues * weights.rescues + generosity * weights.generosity) * 100)
    const thresholds = this.definition.mastery.thresholds
    const grade = score >= thresholds.S ? "S" : score >= thresholds.A ? "A" : score >= thresholds.B ? "B" : "C"
    return {
      score,
      grade,
      breakdown: { speed, stealth, precision, survival, rescues, generosity },
      thresholds,
      communityCoin: this.delivered,
      personalRenown: Math.round(score / playerCount),
    }
  }

  private recountVotes(): void {
    if (!this.vote) return
    this.vote.counts = { granary: 0, infirmary: 0, watchtower: 0 }
    for (const [playerId, choice] of Object.entries(this.vote.votes)) {
      if (this.players.get(playerId)?.connected) this.vote.counts[choice] += 1
    }
  }

  private resolveVote(): void {
    if (!this.vote || this.vote.resolved) return
    this.recountVotes()
    const highest = Math.max(...Object.values(this.vote.counts))
    const candidates = (["granary", "infirmary", "watchtower"] as VoteChoice[]).filter((choice) => this.vote?.counts[choice] === highest)
    const winner = candidates[this.seed % candidates.length]
    this.vote.resolved = true
    this.vote.winner = winner
    this.village[winner] += 1
    this.record("vote_resolved", undefined, this.vote.allocatedCoin, winner)
  }

  private moveToward(position: { x: number; z: number }, target: { x: number; z: number }, speed: number, dt: number): void {
    const dx = target.x - position.x
    const dz = target.z - position.z
    const length = Math.hypot(dx, dz)
    if (length <= 0.001) return
    const step = Math.min(length, speed * dt)
    position.x += (dx / length) * step
    position.z += (dz / length) * step
  }

  private record(type: MissionEvent["type"], playerId?: string, value?: number, detail?: string): void {
    this.events.push({ sequence: this.events.length + 1, tick: this.tick, type, playerId, value, detail })
  }
}
