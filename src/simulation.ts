export interface Vec2 { x: number; z: number }

export type CharacterId = "robin" | "marian"

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
  delivered: number
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

export const CART_POSITION: Vec2 = { x: 10, z: -8 }
export const VILLAGE_POSITION: Vec2 = { x: -11, z: 9 }
export const DELIVERY_TARGET = 300

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z)

export function getMaxArrows(characterId: CharacterId): number {
  return characterId === "robin" ? 6 : 4
}

export function createInitialState(characterId: CharacterId = "robin"): GameState {
  return {
    player: {
      characterId,
      position: { x: -8, z: 7 },
      health: 3,
      arrows: getMaxArrows(characterId),
      loot: 0,
      invulnerableFor: 0,
      signatureCooldown: 0,
      veilFor: 0,
    },
    guards: [
      { id: 0, position: { x: 7, z: -5 }, home: { x: 7, z: -5 }, patrolAngle: 0, stunnedFor: 0 },
      { id: 1, position: { x: 13, z: -6 }, home: { x: 13, z: -6 }, patrolAngle: 2, stunnedFor: 0 },
      { id: 2, position: { x: 9, z: -11 }, home: { x: 9, z: -11 }, patrolAngle: 4, stunnedFor: 0 },
    ],
    delivered: 0,
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

  const moveLength = Math.hypot(input.move.x, input.move.z)
  if (moveLength > 0.001) {
    const speed = player.characterId === "marian" ? 6.75 : 6.2
    const movement = speed * dt
    player.position.x += (input.move.x / moveLength) * movement
    player.position.z += (input.move.z / moveLength) * movement
    state.stats.distanceTravelled += movement
    player.position.x = Math.max(-22, Math.min(22, player.position.x))
    player.position.z = Math.max(-22, Math.min(22, player.position.z))
  }

  player.invulnerableFor = Math.max(0, player.invulnerableFor - dt)
  player.signatureCooldown = Math.max(0, player.signatureCooldown - dt)
  player.veilFor = Math.max(0, player.veilFor - dt)
  state.bowCooldown = Math.max(0, state.bowCooldown - dt)
  state.cartRefill = Math.max(0, state.cartRefill - dt)
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
  state.stats.peakHeat = Math.max(state.stats.peakHeat, state.heat)

  for (const guard of state.guards) {
    guard.stunnedFor = Math.max(0, guard.stunnedFor - dt)
    if (guard.stunnedFor > 0) continue

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

    if (distance(guard.position, player.position) < 1.25 && player.invulnerableFor === 0) {
      player.health -= 1
      state.stats.damageTaken += 1
      player.invulnerableFor = 2
      state.heat = Math.min(100, state.heat + 15)
      player.position.x -= (guard.position.x - player.position.x) * 1.8
      player.position.z -= (guard.position.z - player.position.z) * 1.8
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
  if (distance(state.player.position, CART_POSITION) < 3) {
    if (state.cartCoin === 0) return "cart-empty"
    state.player.loot += state.cartCoin
    state.cartCoin = 0
    state.cartRefill = 28
    state.heat = 100
    state.stats.peakHeat = 100
    state.stats.robberies += 1
    return "robbed-cart"
  }
  if (distance(state.player.position, VILLAGE_POSITION) < 3.2) {
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
  if (distance(state.player.position, CART_POSITION) < 3) {
    return state.cartCoin > 0 ? "E  ROB THE TAX CART" : `Cart returns in ${Math.ceil(state.cartRefill)}s`
  }
  if (distance(state.player.position, VILLAGE_POSITION) < 3.2) {
    return state.player.loot > 0 ? "E  GIVE COIN TO THE VILLAGE" : "E  RESTOCK ARROWS"
  }
  if (state.heat > 20) return "Lose the guards in the deep woods"
  return state.player.loot > 0 ? "Carry the coin back to the village fire" : "Find the Sheriff's tax cart"
}
