export interface GuardRulePoint {
  x: number
  z: number
}

export interface GuardRuleState {
  position: GuardRulePoint
  stunnedFor: number
}

/** Active guards inside this radius must be dealt with before an objective can be taken. */
export const SHERWOOD_ESCORT_BLOCK_RADIUS = 4.25

/** Minimum centre-to-centre spacing between an active guard and a player. */
export const SHERWOOD_GUARD_SEPARATION = 1

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
