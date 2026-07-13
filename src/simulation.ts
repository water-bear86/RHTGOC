import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import { resolveSherwoodPlayerMovement } from "../shared/world-collisions"
import { regionCellIndexAt, regionalizeMissionDefinition, stableSeed, type RegionalMissionLayout } from "../shared/regional-layout"

export interface Vec2 { x: number; z: number }

export type CharacterId = "robin" | "marian" | "little-john" | "much"

export interface MissionStats {
  elapsedSeconds: number
  distanceTravelled: number
  shotsFired: number
  shotsHit: number
  damageTaken: number
  signatureUses: number
  robberies: number
  peakHeat: number
}

export interface GuardState {
  id: number
  position: Vec2
  home: Vec2
  patrolAngle: number
  stunnedFor: number
}

export interface GameState {
  layout: RegionalMissionLayout
  exploredCellIndices: number[]
  player: {
    characterId: CharacterId
    position: Vec2
    health: number
    arrows: number
    loot: number
    invulnerableFor: number
    signatureCooldown: number
    veilFor: number
  }
  guards: GuardState[]
  traps: Array<{ id: number; position: Vec2; remaining: number }>
  delivered: number
  objectiveDiscovered: boolean
  searchPressure: number
  heat: number
  cartCoin: number
  cartRefill: number
  bowCooldown: number
  stats: MissionStats
  won: boolean
  lost: boolean
}

export interface InputState {
  move: Vec2
}

const DEFAULT_SOLO_MISSION = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, stableSeed("solo-default"))
export const CART_POSITION: Vec2 = { ...DEFAULT_SOLO_MISSION.layout.objectivePosition }
export const VILLAGE_POSITION: Vec2 = { ...DEFAULT_SOLO_MISSION.layout.campfirePosition }
export const DELIVERY_TARGET = PEOPLES_PURSE_MISSION.rewards.deliveryTarget

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z)

export function getMaxArrows(characterId: CharacterId): number {
  return characterId === "robin" ? 6 : characterId === "little-john" ? 3 : 4
}

export function createInitialState(characterId: CharacterId = "robin", seed = stableSeed("solo-default")): GameState {
  const regional = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, seed)
  return {
    layout: regional.layout,
    exploredCellIndices: [regional.layout.campfireCell.index],
    player: {
      characterId,
      position: { ...regional.definition.spawns.players[0] },
      health: 3,
      arrows: getMaxArrows(characterId),
      loot: 0,
      invulnerableFor: 0,
      signatureCooldown: 0,
      veilFor: 0,
    },
    guards: regional.definition.spawns.guards.map((guard, index) => ({ id: guard.id, position: { ...guard.position }, home: { ...guard.position }, patrolAngle: index * 2, stunnedFor: 0 })),
    traps: [],
    delivered: 0,
    objectiveDiscovered: false,
    searchPressure: 0,
    heat: 0,
    cartCoin: 120,
    cartRefill: 0,
    bowCooldown: 0,
    stats: {
      elapsedSeconds: 0,
      distanceTravelled: 0,
      shotsFired: 0,
      shotsHit: 0,
      damageTaken: 0,
      signatureUses: 0,
      robberies: 0,
      peakHeat: 0,
    },
    won: false,
    lost: false,
  }
}

function moveToward(position: Vec2, target: Vec2, speed: number, dt: number): void {
  const dx = target.x - position.x
  const dz = target.z - position.z
  const length = Math.hypot(dx, dz)
  if (length > 0.001) {
    const step = Math.min(length, speed * dt)
    position.x += (dx / length) * step
    position.z += (dz / length) * step
  }
}

export function updateSimulation(state: GameState, input: InputState, dt: number): string[] {
  if (state.won || state.lost) return []
  const events: string[] = []
  const player = state.player
  state.stats.elapsedSeconds += dt
  const currentCell = regionCellIndexAt(player.position)
  if (!state.exploredCellIndices.includes(currentCell)) state.exploredCellIndices.push(currentCell)

  if (!state.objectiveDiscovered) {
    if (distance(player.position, state.layout.objectivePosition) < 13) {
      state.objectiveDiscovered = true
      events.push("objective-found")
    } else {
      const nextPressure = Math.min(3, Math.floor(Math.max(0, state.stats.elapsedSeconds - 45) / 20))
      while (state.searchPressure < nextPressure) {
        state.searchPressure += 1
        state.heat = Math.min(100, state.heat + 18)
        const angle = state.searchPressure * 2.2
        const position = {
          x: state.layout.objectivePosition.x + Math.cos(angle) * (5 + state.searchPressure),
          z: state.layout.objectivePosition.z + Math.sin(angle) * (5 + state.searchPressure),
        }
        state.guards.push({ id: state.guards.length, position: { ...position }, home: { ...position }, patrolAngle: angle, stunnedFor: 0 })
        events.push("search-reinforced")
      }
    }
  }

  const moveLength = Math.hypot(input.move.x, input.move.z)
  let playerDisplacement: Vec2 = { x: 0, z: 0 }
  if (moveLength > 0.001) {
    const speed = player.characterId === "marian" ? 6.75 : player.characterId === "little-john" ? 5.9 : 6.2
    const lootPenalty = player.characterId === "little-john"
      ? Math.max(0.82, 1 - player.loot / 1_100)
      : Math.max(0.68, 1 - player.loot / 600)
    const movement = speed * lootPenalty * dt
    playerDisplacement = {
      x: (input.move.x / moveLength) * movement,
      z: (input.move.z / moveLength) * movement,
    }
    state.stats.distanceTravelled += movement
  }
  const resolvedPlayerPosition = resolveSherwoodPlayerMovement(player.position, playerDisplacement, state.layout.worldBounds, undefined, state.layout)
  player.position.x = resolvedPlayerPosition.x
  player.position.z = resolvedPlayerPosition.z

  player.invulnerableFor = Math.max(0, player.invulnerableFor - dt)
  player.signatureCooldown = Math.max(0, player.signatureCooldown - dt)
  player.veilFor = Math.max(0, player.veilFor - dt)
  state.bowCooldown = Math.max(0, state.bowCooldown - dt)
  state.cartRefill = Math.max(0, state.cartRefill - dt)
  for (let index = state.traps.length - 1; index >= 0; index -= 1) {
    state.traps[index].remaining -= dt
    if (state.traps[index].remaining <= 0) state.traps.splice(index, 1)
  }
  if (state.cartRefill === 0 && state.cartCoin === 0) {
    state.cartCoin = 120
    events.push("cart-ready")
  }

  const nearestGuard = Math.min(...state.guards.map((guard) => distance(guard.position, player.position)))
  const hiddenInWoods = Math.abs(player.position.x) > 13 || Math.abs(player.position.z) > 13
  const marianBonus = player.characterId === "marian" ? 1.3 : 1
  const veilBonus = player.veilFor > 0 ? 2.4 : 1
  const heatDecay = (hiddenInWoods && nearestGuard > 7 ? 9 : 1.4) * marianBonus * veilBonus
  state.heat = Math.max(0, state.heat - heatDecay * dt)
  if (!state.objectiveDiscovered && state.searchPressure > 0) state.heat = Math.max(state.heat, state.searchPressure * 18)
  state.stats.peakHeat = Math.max(state.stats.peakHeat, state.heat)

  for (const guard of state.guards) {
    guard.stunnedFor = Math.max(0, guard.stunnedFor - dt)
    if (guard.stunnedFor > 0) continue
    const trapIndex = state.traps.findIndex((trap) => distance(trap.position, guard.position) < 1.35)
    if (trapIndex >= 0) {
      state.traps.splice(trapIndex, 1)
      guard.stunnedFor = 4.5
      events.push("trap-triggered")
      continue
    }

    const guardOrigin = { ...guard.position }
    const detectionRange = player.veilFor > 0 ? 2.4 : 22
    if (state.heat > 8 && distance(guard.position, player.position) < detectionRange) {
      moveToward(guard.position, player.position, 3.35 + state.heat * 0.008, dt)
    } else {
      guard.patrolAngle += dt * (0.45 + guard.id * 0.05)
      const patrolTarget = {
        x: guard.home.x + Math.cos(guard.patrolAngle) * 2.2,
        z: guard.home.z + Math.sin(guard.patrolAngle) * 2.2,
      }
      moveToward(guard.position, patrolTarget, 1.5, dt)
    }
    const guardResolved = resolveSherwoodPlayerMovement(guardOrigin, {
      x: guard.position.x - guardOrigin.x,
      z: guard.position.z - guardOrigin.z,
    }, state.layout.worldBounds, 0.35, state.layout)
    guard.position = guardResolved

    if (distance(guard.position, player.position) < 1.25 && player.invulnerableFor === 0) {
      player.health -= 1
      state.stats.damageTaken += 1
      player.invulnerableFor = 2
      state.heat = Math.min(100, state.heat + 15)
      const knockback = resolveSherwoodPlayerMovement(player.position, {
        x: -(guard.position.x - player.position.x) * 1.8,
        z: -(guard.position.z - player.position.z) * 1.8,
      }, state.layout.worldBounds, undefined, state.layout)
      player.position.x = knockback.x
      player.position.z = knockback.z
      events.push("player-hit")
      if (player.health <= 0) {
        state.lost = true
        events.push("lost")
      }
    }
  }
  return events
}

export function interact(state: GameState): string {
  if (state.won || state.lost) return "none"
  const bowCache = state.layout.bowCachePositions.find((position) => distance(state.player.position, position) < 2.8)
  if (bowCache) {
    const maxArrows = getMaxArrows(state.player.characterId)
    if (state.player.arrows >= maxArrows) return "quiver-full"
    state.player.arrows = maxArrows
    return "bow-cache"
  }
  if (distance(state.player.position, state.layout.objectivePosition) < 3) {
    if (state.cartCoin === 0) return "cart-empty"
    state.player.loot += state.cartCoin
    state.cartCoin = 0
    state.cartRefill = 28
    state.heat = 100
    state.stats.peakHeat = 100
    state.stats.robberies += 1
    return "robbed-cart"
  }
  if (distance(state.player.position, state.layout.campfirePosition) < 3.2) {
    if (state.player.loot === 0) {
      const maxArrows = getMaxArrows(state.player.characterId)
      if (state.player.arrows < maxArrows) {
        state.player.arrows = maxArrows
        return "restocked"
      }
      return "no-loot"
    }
    state.delivered += state.player.loot
    state.player.loot = 0
    state.heat = Math.max(0, state.heat - 45)
    state.player.arrows = getMaxArrows(state.player.characterId)
    if (state.delivered >= DELIVERY_TARGET) {
      state.won = true
      return "won"
    }
    return "delivered"
  }
  return "none"
}

export function shoot(state: GameState): number | null {
  if (state.won || state.lost || state.bowCooldown > 0 || state.player.arrows <= 0) return null
  const candidates = state.guards
    .map((guard) => ({ guard, range: distance(guard.position, state.player.position) }))
    .filter(({ range }) => range < 9)
    .sort((a, b) => a.range - b.range)
  if (!candidates[0]) return null
  candidates[0].guard.stunnedFor = 3.2
  state.player.arrows -= 1
  state.bowCooldown = 0.7
  state.stats.shotsFired += 1
  state.stats.shotsHit += 1
  return candidates[0].guard.id
}

export function activateSignature(state: GameState): { event: string; guardIds: number[] } {
  const player = state.player
  if (state.won || state.lost || player.signatureCooldown > 0) return { event: "signature-unavailable", guardIds: [] }
  player.signatureCooldown = player.characterId === "marian" ? 14 : 11
  state.stats.signatureUses += 1

  if (player.characterId === "marian") {
    player.veilFor = 6
    state.heat = Math.max(0, state.heat - 28)
    return { event: "marian-veil", guardIds: [] }
  }

  if (player.characterId === "little-john") {
    const targets = state.guards
      .map((guard) => ({ guard, range: distance(guard.position, player.position) }))
      .filter(({ guard, range }) => guard.stunnedFor <= 0 && range < 6)
    if (targets.length === 0) {
      player.signatureCooldown = 0
      state.stats.signatureUses -= 1
      return { event: "signature-unavailable", guardIds: [] }
    }
    for (const { guard } of targets) guard.stunnedFor = 5
    player.signatureCooldown = 20
    return { event: "little-john-sweep", guardIds: targets.map(({ guard }) => guard.id) }
  }

  if (player.characterId === "much") {
    const invalidTerrain = Math.abs(player.position.x) > state.layout.worldBounds - 2
      || Math.abs(player.position.z) > state.layout.worldBounds - 2
      || (Math.abs(player.position.x) < 3.2 && Math.abs(player.position.z) < 18)
      || distance(player.position, state.layout.objectivePosition) < 3
      || distance(player.position, state.layout.campfirePosition) < 3
    if (invalidTerrain || state.traps.length > 0) {
      player.signatureCooldown = 0
      state.stats.signatureUses -= 1
      return { event: "signature-unavailable", guardIds: [] }
    }
    state.traps.push({ id: state.stats.signatureUses, position: { ...player.position }, remaining: 30 })
    player.signatureCooldown = 18
    return { event: "much-snare", guardIds: [] }
  }

  const targets = state.guards
    .map((guard) => ({ guard, range: distance(guard.position, player.position) }))
    .filter(({ range }) => range < 11)
    .sort((a, b) => a.range - b.range)
    .slice(0, 2)
  for (const { guard } of targets) guard.stunnedFor = Math.max(guard.stunnedFor, 2.4)
  return { event: targets.length > 0 ? "robin-volley" : "volley-missed", guardIds: targets.map(({ guard }) => guard.id) }
}

export interface MasteryResult {
  score: number
  grade: "S" | "A" | "B" | "C" | "D"
  speed: number
  precision: number
  survival: number
  generosity: number
}

export function calculateMastery(state: GameState): MasteryResult {
  const speed = Math.max(0, Math.round(2600 - state.stats.elapsedSeconds * 8))
  const accuracy = state.stats.shotsFired === 0 ? 1 : state.stats.shotsHit / state.stats.shotsFired
  const precision = Math.round(accuracy * 1200 + Math.max(0, state.player.arrows) * 80)
  const survival = Math.max(0, 1600 - state.stats.damageTaken * 550)
  const generosity = state.delivered * 12
  const score = Math.max(0, speed + precision + survival + generosity)
  const grade = score >= 8200 ? "S" : score >= 7000 ? "A" : score >= 5700 ? "B" : score >= 4300 ? "C" : "D"
  return { score, grade, speed, precision, survival, generosity }
}

export function getContextPrompt(state: GameState): string {
  if (distance(state.player.position, state.layout.objectivePosition) < 3) {
    return state.cartCoin > 0 ? "E  ROB THE TAX CART" : `Cart returns in ${Math.ceil(state.cartRefill)}s`
  }
  if (distance(state.player.position, state.layout.campfirePosition) < 3.2) {
    return state.player.loot > 0 ? "E  GIVE COIN TO THE VILLAGE" : "E  RESTOCK ARROWS"
  }
  if (state.heat > 20) return "Lose the guards in the deep woods"
  return state.player.loot > 0
    ? "Carry the coin back to the village fire"
    : state.objectiveDiscovered
      ? "Close on the Sheriff's tax cart"
      : "Search the 25 Sherwood sectors before the Sheriff reinforces"
}
