import type { CharacterId, MissionEvent, MissionResult, MissionSnapshot, PingKind, RedistributionVote, VillageState, VoteChoice, WorldPing } from "../shared/protocol"

export interface MissionPlayer {
  id: string
  characterId: CharacterId
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
}

interface MissionGuardState {
  id: number
  position: { x: number; z: number }
  home: { x: number; z: number }
  patrolAngle: number
  stunnedFor: number
}

const CART_POSITION = { x: 10, z: -8 }
const VILLAGE_POSITION = { x: -11, z: 9 }
export const DELIVERY_TARGET = 600
export const ENTRY_ROUTES = {
  forest: { x: -16, z: -4 },
  river: { x: 16, z: 2 },
} as const
export const ESCAPE_ROUTES = {
  forest: { x: -18, z: 15 },
  river: { x: 18, z: 15 },
} as const

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
  heat = 0
  cartCoin = 120
  cartRefill = 0
  delivered = 0
  tick = 0

  constructor(roomCode: string, private readonly players: Map<string, MissionPlayer>) {
    this.seed = missionSeed(roomCode)
    const random = seededUnit(this.seed)
    const guardStarts = [
      { id: 0, position: { x: 7, z: -5 }, home: { x: 7, z: -5 }, patrolAngle: random() * Math.PI * 2, stunnedFor: 0 },
      { id: 1, position: { x: 13, z: -6 }, home: { x: 13, z: -6 }, patrolAngle: random() * Math.PI * 2, stunnedFor: 0 },
      { id: 2, position: { x: 9, z: -11 }, home: { x: 9, z: -11 }, patrolAngle: random() * Math.PI * 2, stunnedFor: 0 },
      { id: 3, position: { x: 5, z: -10 }, home: { x: 5, z: -10 }, patrolAngle: random() * Math.PI * 2, stunnedFor: 0 },
      { id: 4, position: { x: 14, z: -10 }, home: { x: 14, z: -10 }, patrolAngle: random() * Math.PI * 2, stunnedFor: 0 },
    ]
    this.guards = guardStarts.slice(0, 3 + Math.max(0, Math.min(2, players.size - 2)))
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
    this.cartRefill = Math.max(0, this.cartRefill - dt)
    if (this.cartRefill === 0 && this.cartCoin === 0) this.cartCoin = 120

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
          this.record("player_captured", player.id)
        }
      }
      if (!player.connected || player.health <= 0 || player.captured) continue
      const moveLength = Math.hypot(player.input.x, player.input.z)
      if (moveLength > 0.001) {
        const roleSpeed = player.characterId === "marian" ? 6.75 : 6.2
        const lootPenalty = Math.max(0.68, 1 - player.loot / 600)
        const movement = roleSpeed * lootPenalty * dt
        player.position.x = Math.max(-22, Math.min(22, player.position.x + (player.input.x / moveLength) * movement))
        player.position.z = Math.max(-22, Math.min(22, player.position.z + (player.input.z / moveLength) * movement))
      }
    }

    const activePlayers = [...this.players.values()].filter((player) => player.connected && player.health > 0)
    if (this.phase === "scout") this.detectRoute(activePlayers, ENTRY_ROUTES, "entry")
    if (this.phase === "pursuit") this.detectRoute(activePlayers.filter((player) => player.loot > 0), ESCAPE_ROUTES, "escape")
    const hidden = activePlayers.every((player) => Math.abs(player.position.x) > 13 || Math.abs(player.position.z) > 13 || player.veilFor > 0)
    this.heat = Math.max(0, this.heat - (hidden ? 7 : 1.2) * dt)
    this.peakHeat = Math.max(this.peakHeat, this.heat)
    if (this.heat > 50) this.alertedSeconds += dt
    for (const guard of this.guards) this.updateGuard(guard, activePlayers, dt)

    if (this.players.size > 0 && [...this.players.values()].every((player) => player.captured)) {
      this.status = "failed"
      this.record("mission_failed")
    }
  }

  snapshot(): MissionSnapshot {
    return {
      seed: this.seed,
      status: this.status,
      phase: this.phase,
      entryRoute: this.entryRoute,
      escapeRoute: this.escapeRoute,
      cycle: this.cycle,
      elapsedSeconds: this.elapsedSeconds,
      parSeconds: 900,
      heat: this.heat,
      cartCoin: this.cartCoin,
      delivered: this.delivered,
      target: DELIVERY_TARGET,
      supportScore: [...this.players.values()].reduce((total, player) => total + player.rescueCount * 350 + player.transferCount * 100, 0),
      guards: this.guards.map((guard) => ({ id: guard.id, position: { ...guard.position }, stunnedFor: guard.stunnedFor })),
      pings: this.pings.map((ping) => ({ ...ping, position: { ...ping.position } })),
      latestEvent: this.events.at(-1) ?? null,
      result: this.result,
      vote: this.vote ? { ...this.vote, counts: { ...this.vote.counts }, votes: { ...this.vote.votes } } : null,
      village: { ...this.village },
    }
  }

  private interact(player: MissionPlayer): boolean {
    if (distance(player.position, CART_POSITION) < 3) {
      if (this.phase !== "robbery" || this.cartCoin === 0) return false
      const stolen = this.cartCoin
      player.loot += stolen
      this.cartCoin = 0
      this.cartRefill = 28
      this.heat = 100
      this.record("cart_robbed", player.id, stolen)
      this.setPhase("pursuit", player.id)
      return true
    }
    if (this.phase !== "escape" || distance(player.position, VILLAGE_POSITION) >= 3.2 || player.loot <= 0) return false
    this.setPhase("extraction", player.id)
    const delivered = player.loot
    player.loot = 0
    player.arrows = player.characterId === "robin" ? 6 : 4
    this.delivered += delivered
    this.heat = Math.max(0, this.heat - 45)
    this.record("loot_delivered", player.id, delivered)
    if (this.delivered >= DELIVERY_TARGET && this.status === "active") {
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

  private shoot(player: MissionPlayer): boolean {
    if (player.arrows <= 0 || player.bowCooldown > 0) return false
    this.shotsFired += 1
    player.arrows -= 1
    player.bowCooldown = 0.7
    const target = this.guards
      .filter((guard) => guard.stunnedFor <= 0 && distance(guard.position, player.position) < 9)
      .sort((a, b) => distance(a.position, player.position) - distance(b.position, player.position))[0]
    if (!target) return false
    target.stunnedFor = 3.2
    this.shotsHit += 1
    this.record("guard_stunned", player.id, target.id)
    if (this.phase === "ambush") {
      this.ambushStuns += 1
      if (this.ambushStuns >= 2) this.setPhase("robbery", player.id)
    }
    return true
  }

  private signature(player: MissionPlayer): boolean {
    if (player.signatureCooldown > 0) return false
    if (player.characterId === "marian") {
      player.veilFor = 5
      this.heat = Math.max(0, this.heat - 30)
    } else {
      const targets = this.guards
        .filter((guard) => distance(guard.position, player.position) < 11)
        .sort((a, b) => distance(a.position, player.position) - distance(b.position, player.position))
        .slice(0, 2)
      if (targets.length === 0) return false
      for (const target of targets) target.stunnedFor = 3.2
      if (this.phase === "ambush") {
        this.ambushStuns += targets.length
        if (this.ambushStuns >= 2) this.setPhase("robbery", player.id)
      }
    }
    player.signatureCooldown = 18
    this.record("signature_used", player.id)
    return true
  }

  private revive(player: MissionPlayer, target: MissionPlayer): boolean {
    if (target.downedFor <= 0 || target.captured) return false
    target.health = 1
    target.downedFor = 0
    target.invulnerableFor = 2.5
    player.rescueCount += 1
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
    const target = players
      .filter((player) => player.veilFor <= 0)
      .sort((a, b) => distance(a.position, guard.position) - distance(b.position, guard.position))[0]
    if (target && this.heat > 8 && distance(target.position, guard.position) < 22) {
      this.moveToward(guard.position, target.position, 3.35 + this.heat * 0.008, dt)
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
        this.setPhase("ambush", scout.id)
      } else {
        this.escapeRoute = route
        this.setPhase("escape", scout.id)
      }
      this.record("route_selected", scout.id, undefined, `${kind}:${route}`)
      return
    }
  }

  private setPhase(phase: Mission["phase"], playerId?: string): void {
    if (this.phase === phase) return
    this.phase = phase
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
    const score = Math.round((speed * 0.2 + stealth * 0.2 + precision * 0.2 + survival * 0.15 + rescues * 0.15 + generosity * 0.1) * 100)
    const grade = score >= 9000 ? "S" : score >= 7500 ? "A" : score >= 6000 ? "B" : "C"
    return {
      score,
      grade,
      breakdown: { speed, stealth, precision, survival, rescues, generosity },
      thresholds: { S: 9000, A: 7500, B: 6000, C: 0 },
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
