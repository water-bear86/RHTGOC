import type { CharacterId, MissionEvent, MissionSnapshot } from "../shared/protocol"

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
export const DELIVERY_TARGET = 300

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
  status: "active" | "succeeded" | "failed" = "active"
  heat = 0
  cartCoin = 120
  cartRefill = 0
  delivered = 0
  tick = 0

  constructor(roomCode: string, private readonly players: Map<string, MissionPlayer>) {
    this.seed = missionSeed(roomCode)
    const random = seededUnit(this.seed)
    this.guards = [
      { id: 0, position: { x: 7, z: -5 }, home: { x: 7, z: -5 }, patrolAngle: random() * Math.PI * 2, stunnedFor: 0 },
      { id: 1, position: { x: 13, z: -6 }, home: { x: 13, z: -6 }, patrolAngle: random() * Math.PI * 2, stunnedFor: 0 },
      { id: 2, position: { x: 9, z: -11 }, home: { x: 9, z: -11 }, patrolAngle: random() * Math.PI * 2, stunnedFor: 0 },
    ]
    this.record("mission_started")
  }

  setInput(playerId: string, sequence: number, move: { x: number; z: number }, now = Date.now()): boolean {
    const player = this.players.get(playerId)
    if (!player || this.status !== "active" || !player.connected || player.health <= 0) return false
    if (sequence <= player.lastInputSequence || now - player.lastInputAt < 20) return false
    const length = Math.hypot(move.x, move.z)
    player.input = length > 1 ? { x: move.x / length, z: move.z / length } : { ...move }
    player.lastInputSequence = sequence
    player.lastInputAt = now
    return true
  }

  action(playerId: string, action: "interact" | "shoot" | "signature"): boolean {
    const player = this.players.get(playerId)
    if (!player || this.status !== "active" || !player.connected || player.health <= 0) return false
    if (action === "interact") return this.interact(player)
    if (action === "shoot") return this.shoot(player)
    return this.signature(player)
  }

  update(dt: number): void {
    if (this.status !== "active") return
    this.tick += 1
    this.cartRefill = Math.max(0, this.cartRefill - dt)
    if (this.cartRefill === 0 && this.cartCoin === 0) this.cartCoin = 120

    for (const player of this.players.values()) {
      player.bowCooldown = Math.max(0, player.bowCooldown - dt)
      player.signatureCooldown = Math.max(0, player.signatureCooldown - dt)
      player.invulnerableFor = Math.max(0, player.invulnerableFor - dt)
      player.veilFor = Math.max(0, player.veilFor - dt)
      if (!player.connected || player.health <= 0) continue
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
    const hidden = activePlayers.every((player) => Math.abs(player.position.x) > 13 || Math.abs(player.position.z) > 13 || player.veilFor > 0)
    this.heat = Math.max(0, this.heat - (hidden ? 7 : 1.2) * dt)
    for (const guard of this.guards) this.updateGuard(guard, activePlayers, dt)

    if (this.players.size > 0 && [...this.players.values()].every((player) => player.health <= 0)) {
      this.status = "failed"
      this.record("mission_failed")
    }
  }

  snapshot(): MissionSnapshot {
    return {
      seed: this.seed,
      status: this.status,
      heat: this.heat,
      cartCoin: this.cartCoin,
      delivered: this.delivered,
      target: DELIVERY_TARGET,
      guards: this.guards.map((guard) => ({ id: guard.id, position: { ...guard.position }, stunnedFor: guard.stunnedFor })),
      latestEvent: this.events.at(-1) ?? null,
    }
  }

  private interact(player: MissionPlayer): boolean {
    if (distance(player.position, CART_POSITION) < 3) {
      if (this.cartCoin === 0) return false
      const stolen = this.cartCoin
      player.loot += stolen
      this.cartCoin = 0
      this.cartRefill = 28
      this.heat = 100
      this.record("cart_robbed", player.id, stolen)
      return true
    }
    if (distance(player.position, VILLAGE_POSITION) >= 3.2 || player.loot <= 0) return false
    const delivered = player.loot
    player.loot = 0
    player.arrows = player.characterId === "robin" ? 6 : 4
    this.delivered += delivered
    this.heat = Math.max(0, this.heat - 45)
    this.record("loot_delivered", player.id, delivered)
    if (this.delivered >= DELIVERY_TARGET && this.status === "active") {
      this.status = "succeeded"
      this.record("mission_succeeded", player.id, this.delivered)
    }
    return true
  }

  private shoot(player: MissionPlayer): boolean {
    if (player.arrows <= 0 || player.bowCooldown > 0) return false
    const target = this.guards
      .filter((guard) => guard.stunnedFor <= 0 && distance(guard.position, player.position) < 9)
      .sort((a, b) => distance(a.position, player.position) - distance(b.position, player.position))[0]
    if (!target) return false
    target.stunnedFor = 3.2
    player.arrows -= 1
    player.bowCooldown = 0.7
    this.record("guard_stunned", player.id, target.id)
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
    }
    player.signatureCooldown = 18
    this.record("signature_used", player.id)
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
        target.invulnerableFor = 2
        this.heat = Math.min(100, this.heat + 15)
        this.record("player_hit", target.id, target.health)
      }
      return
    }
    guard.patrolAngle += dt * (0.45 + guard.id * 0.05)
    this.moveToward(guard.position, {
      x: guard.home.x + Math.cos(guard.patrolAngle) * 2.2,
      z: guard.home.z + Math.sin(guard.patrolAngle) * 2.2,
    }, 1.5, dt)
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

  private record(type: MissionEvent["type"], playerId?: string, value?: number): void {
    this.events.push({ sequence: this.events.length + 1, tick: this.tick, type, playerId, value })
  }
}
