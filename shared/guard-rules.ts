export interface GuardRulePoint {
  x: number
  z: number
}

export interface GuardRuleState {
  position: GuardRulePoint
  stunnedFor: number
}

export const GUARD_ARROW_STUN_SECONDS = 4.5

export type GuardPatrolShape = "ellipse" | "figure-eight" | "clover"

export interface GuardPatrolProfile {
  shape: GuardPatrolShape
  radiusX: number
  radiusZ: number
  angularSpeed: number
  moveSpeed: number
  direction: -1 | 1
}

export interface GuardPatrolStep {
  angle: number
  target: GuardRulePoint
  moveSpeed: number
}

/** Active guards inside this radius must be dealt with before an objective can be taken. */
export const SHERWOOD_ESCORT_BLOCK_RADIUS = 4.25

/** Minimum centre-to-centre spacing between an active guard and a player. */
export const SHERWOOD_GUARD_SEPARATION = 1

const TAU = Math.PI * 2

function stableGuardId(id: number): number {
  return Number.isFinite(id) ? Math.abs(Math.trunc(id)) : 0
}

/**
 * Patrol variety is derived only from the network-stable guard id. Keeping the
 * profile here prevents the solo and authoritative simulations from drifting.
 */
export function guardPatrolProfile(id: number): GuardPatrolProfile {
  const stableId = stableGuardId(id)
  const family = stableId % 3
  const band = Math.floor(stableId / 3) % 4
  const direction: -1 | 1 = Math.floor(stableId / 2) % 2 === 0 ? 1 : -1

  if (family === 1) {
    return {
      shape: "figure-eight",
      radiusX: 2.35 + band * 0.12,
      radiusZ: 1.75 + band * 0.1,
      angularSpeed: 0.42 + band * 0.018,
      moveSpeed: 1.46 + band * 0.035,
      direction,
    }
  }
  if (family === 2) {
    return {
      shape: "clover",
      radiusX: 2.05 + band * 0.1,
      radiusZ: 2.05 + band * 0.08,
      angularSpeed: 0.36 + band * 0.016,
      moveSpeed: 1.56 + band * 0.03,
      direction,
    }
  }
  return {
    shape: "ellipse",
    radiusX: 2.65 + band * 0.12,
    radiusZ: 1.7 + band * 0.08,
    angularSpeed: 0.39 + band * 0.017,
    moveSpeed: 1.38 + band * 0.03,
    direction,
  }
}

export function initialGuardPatrolAngle(id: number): number {
  return (stableGuardId(id) * 2.399963229728653) % TAU
}

export function guardPatrolTarget(home: GuardRulePoint, id: number, angle: number): GuardRulePoint {
  const profile = guardPatrolProfile(id)
  const safeHome = isFinitePoint(home) ? home : {
    x: Number.isFinite(home.x) ? home.x : 0,
    z: Number.isFinite(home.z) ? home.z : 0,
  }
  if (!Number.isFinite(angle)) return { ...safeHome }

  if (profile.shape === "figure-eight") {
    return {
      x: safeHome.x + Math.sin(angle) * profile.radiusX,
      z: safeHome.z + Math.sin(angle * 2) * profile.radiusZ,
    }
  }
  if (profile.shape === "clover") {
    const lobe = 1 + Math.cos(angle * 3) * 0.18
    return {
      x: safeHome.x + Math.cos(angle) * profile.radiusX * lobe,
      z: safeHome.z + Math.sin(angle) * profile.radiusZ * lobe,
    }
  }
  return {
    x: safeHome.x + Math.cos(angle) * profile.radiusX,
    z: safeHome.z + Math.sin(angle) * profile.radiusZ,
  }
}

/** Advances one bounded patrol sample for either simulation runtime. */
export function stepGuardPatrol(home: GuardRulePoint, id: number, angle: number, dt: number): GuardPatrolStep {
  const profile = guardPatrolProfile(id)
  const safeAngle = Number.isFinite(angle) ? angle : initialGuardPatrolAngle(id)
  const safeDt = Number.isFinite(dt) && dt > 0 ? dt : 0
  const rawAngle = safeAngle + profile.angularSpeed * profile.direction * safeDt
  const nextAngle = ((rawAngle % TAU) + TAU) % TAU
  return {
    angle: nextAngle,
    target: guardPatrolTarget(home, id, nextAngle),
    moveSpeed: profile.moveSpeed,
  }
}

function distance(a: GuardRulePoint, b: GuardRulePoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z)
}

function isFinitePoint(point: GuardRulePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.z)
}

export function activeEscortCount(
  guards: readonly GuardRuleState[],
  objective: GuardRulePoint,
  radius = SHERWOOD_ESCORT_BLOCK_RADIUS,
): number {
  const safeRadius = Number.isFinite(radius) && radius >= 0 ? radius : SHERWOOD_ESCORT_BLOCK_RADIUS
  if (!isFinitePoint(objective)) return 0
  return guards.filter((guard) => guard.stunnedFor <= 0
    && isFinitePoint(guard.position)
    && distance(guard.position, objective) <= safeRadius).length
}

/** Shared, deterministic dynamic blockers for solo, prediction, and authority. */
export function activeGuardPositions(guards: readonly GuardRuleState[]): GuardRulePoint[] {
  return guards
    .filter((guard) => guard.stunnedFor <= 0 && isFinitePoint(guard.position))
    .map((guard) => guard.position)
}
