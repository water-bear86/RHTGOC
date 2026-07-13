import type { RegionalMissionLayout } from "./regional-layout"
import { SHERWOOD_GUARD_SEPARATION } from "./guard-rules"
import { composeSherwoodWorld } from "./world-composer"
import {
  SHERWOOD_STATIC_OBSTACLES,
  SHERWOOD_TREE_OBSTACLES,
  VILLAGE_COTTAGE_OBSTACLE,
  createSherwoodRiverObstacles,
} from "./world-obstacles"

export { SHERWOOD_CROSSING_HALF_LENGTH, SHERWOOD_RIVER_HALF_WIDTH } from "./world-obstacles"

export interface XzPoint {
  x: number
  z: number
}

export interface XzWorldBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export interface OrientedRectangleCollider {
  id: string
  center: XzPoint
  halfExtents: XzPoint
  rotation: number
}

/** Radius of the authoritative player footprint in world metres. */
export const SHERWOOD_PLAYER_RADIUS = 0.45

/**
 * Conservative authored footprint for the village cottage.
 * Rotation follows Three.js' Y-axis convention.
 */
export const VILLAGE_COTTAGE_COLLIDER: OrientedRectangleCollider = VILLAGE_COTTAGE_OBSTACLE

/** Tight square trunk footprints; the player's radius rounds their effective corners. */
export const SHERWOOD_TREE_COLLIDERS: readonly OrientedRectangleCollider[] = SHERWOOD_TREE_OBSTACLES

export const SHERWOOD_STATIC_COLLIDERS: readonly OrientedRectangleCollider[] = SHERWOOD_STATIC_OBSTACLES

/** Builds solid river-bank spans while leaving exactly two seeded bridge gaps. */
export function createSherwoodRiverColliders(layout: Pick<RegionalMissionLayout, "crossingPositions">): OrientedRectangleCollider[] {
  return createSherwoodRiverObstacles(layout)
}

const settlementColliderCache = new WeakMap<RegionalMissionLayout, OrientedRectangleCollider[]>()

export function createSherwoodSettlementColliders(layout: RegionalMissionLayout): OrientedRectangleCollider[] {
  const cached = settlementColliderCache.get(layout)
  if (cached) return cached
  const colliders = composeSherwoodWorld(layout).settlements.flatMap((settlement) => settlement.buildings.map((building) => ({
    id: building.id,
    center: building.position,
    halfExtents: building.halfExtents,
    rotation: building.rotation,
  })))
  settlementColliderCache.set(layout, colliders)
  return colliders
}

const topologyColliderCache = new WeakMap<RegionalMissionLayout, OrientedRectangleCollider[]>()

/**
 * Ridges are traversable heightfield features, not invisible movement walls.
 * Road composition still uses the authored ridge/pass contract, while runtime
 * collision remains reserved for visible buildings, trees, and river banks.
 */
export function createSherwoodTopologyColliders(layout: RegionalMissionLayout): OrientedRectangleCollider[] {
  const cached = topologyColliderCache.get(layout)
  if (cached) return cached
  const colliders: OrientedRectangleCollider[] = []
  topologyColliderCache.set(layout, colliders)
  return colliders
}

export const SHERWOOD_MISSION_WORLD_BOUNDS = 22
export const PUBLIC_HUB_WORLD_BOUNDS: XzWorldBounds = Object.freeze({ minX: -18, maxX: -4, minZ: 2, maxZ: 16 })

const COLLISION_EPSILON = 1e-6
const DIRECTION_EPSILON = 1e-10

interface SweepHit {
  time: number
  normal: XzPoint
  colliderId: string
}

export interface SherwoodCombinedMovementOptions {
  worldBounds?: number | XzWorldBounds
  moverRadius?: number
  layout?: RegionalMissionLayout
  circleBlockers: readonly XzPoint[]
  circleSeparation: number
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function normalizeBounds(bounds: number | XzWorldBounds): XzWorldBounds {
  if (typeof bounds === "number") {
    const halfExtent = Number.isFinite(bounds) && bounds > 0 ? bounds : SHERWOOD_MISSION_WORLD_BOUNDS
    return { minX: -halfExtent, maxX: halfExtent, minZ: -halfExtent, maxZ: halfExtent }
  }

  const minX = finiteOr(bounds.minX, -SHERWOOD_MISSION_WORLD_BOUNDS)
  const maxX = finiteOr(bounds.maxX, SHERWOOD_MISSION_WORLD_BOUNDS)
  const minZ = finiteOr(bounds.minZ, -SHERWOOD_MISSION_WORLD_BOUNDS)
  const maxZ = finiteOr(bounds.maxZ, SHERWOOD_MISSION_WORLD_BOUNDS)
  if (minX >= maxX || minZ >= maxZ) {
    return {
      minX: -SHERWOOD_MISSION_WORLD_BOUNDS,
      maxX: SHERWOOD_MISSION_WORLD_BOUNDS,
      minZ: -SHERWOOD_MISSION_WORLD_BOUNDS,
      maxZ: SHERWOOD_MISSION_WORLD_BOUNDS,
    }
  }
  return { minX, maxX, minZ, maxZ }
}

function clampPoint(point: XzPoint, bounds: XzWorldBounds): XzPoint {
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, point.x)),
    z: Math.max(bounds.minZ, Math.min(bounds.maxZ, point.z)),
  }
}

function toColliderLocal(point: XzPoint, collider: OrientedRectangleCollider): XzPoint {
  const cosine = Math.cos(collider.rotation)
  const sine = Math.sin(collider.rotation)
  const x = point.x - collider.center.x
  const z = point.z - collider.center.z
  return {
    x: cosine * x - sine * z,
    z: sine * x + cosine * z,
  }
}

function localVectorToWorld(vector: XzPoint, collider: OrientedRectangleCollider): XzPoint {
  const cosine = Math.cos(collider.rotation)
  const sine = Math.sin(collider.rotation)
  return {
    x: cosine * vector.x + sine * vector.z,
    z: -sine * vector.x + cosine * vector.z,
  }
}

function localPointToWorld(point: XzPoint, collider: OrientedRectangleCollider): XzPoint {
  const vector = localVectorToWorld(point, collider)
  return { x: collider.center.x + vector.x, z: collider.center.z + vector.z }
}

function isInsideCollider(point: XzPoint, collider: OrientedRectangleCollider, playerRadius: number): boolean {
  const local = toColliderLocal(point, collider)
  return Math.abs(local.x) < collider.halfExtents.x + playerRadius
    && Math.abs(local.z) < collider.halfExtents.z + playerRadius
}

function depenetrateFromCollider(
  point: XzPoint,
  collider: OrientedRectangleCollider,
  playerRadius: number,
  bounds: XzWorldBounds,
): XzPoint | null {
  const local = toColliderLocal(point, collider)
  const halfX = collider.halfExtents.x + playerRadius
  const halfZ = collider.halfExtents.z + playerRadius
  if (Math.abs(local.x) >= halfX || Math.abs(local.z) >= halfZ) return point

  const candidates = [
    { distance: local.x + halfX, order: 0, local: { x: -halfX - COLLISION_EPSILON, z: local.z } },
    { distance: halfX - local.x, order: 1, local: { x: halfX + COLLISION_EPSILON, z: local.z } },
    { distance: local.z + halfZ, order: 2, local: { x: local.x, z: -halfZ - COLLISION_EPSILON } },
    { distance: halfZ - local.z, order: 3, local: { x: local.x, z: halfZ + COLLISION_EPSILON } },
  ].sort((left, right) => left.distance - right.distance || left.order - right.order)

  for (const candidate of candidates) {
    const world = clampPoint(localPointToWorld(candidate.local, collider), bounds)
    if (!isInsideCollider(world, collider, playerRadius)) return world
  }
  return null
}

function depenetrate(
  point: XzPoint,
  colliders: readonly OrientedRectangleCollider[],
  playerRadius: number,
  bounds: XzWorldBounds,
): XzPoint {
  let resolved = clampPoint(point, bounds)
  for (let pass = 0; pass < Math.max(1, colliders.length * 2); pass += 1) {
    const collider = colliders.find((candidate) => isInsideCollider(resolved, candidate, playerRadius))
    if (!collider) return resolved
    const next = depenetrateFromCollider(resolved, collider, playerRadius, bounds)
    if (!next) return resolved
    resolved = next
  }
  return resolved
}

function sweepAgainstCollider(
  origin: XzPoint,
  movement: XzPoint,
  collider: OrientedRectangleCollider,
  playerRadius: number,
): SweepHit | null {
  const localOrigin = toColliderLocal(origin, collider)
  const localMovement = toColliderLocal({
    x: collider.center.x + movement.x,
    z: collider.center.z + movement.z,
  }, collider)
  const halfX = collider.halfExtents.x + playerRadius
  const halfZ = collider.halfExtents.z + playerRadius

  let nearX = Number.NEGATIVE_INFINITY
  let farX = Number.POSITIVE_INFINITY
  let normalX = 0
  if (Math.abs(localMovement.x) < DIRECTION_EPSILON) {
    if (localOrigin.x < -halfX || localOrigin.x > halfX) return null
  } else {
    const first = (-halfX - localOrigin.x) / localMovement.x
    const second = (halfX - localOrigin.x) / localMovement.x
    nearX = Math.min(first, second)
    farX = Math.max(first, second)
    normalX = localMovement.x > 0 ? -1 : 1
  }

  let nearZ = Number.NEGATIVE_INFINITY
  let farZ = Number.POSITIVE_INFINITY
  let normalZ = 0
  if (Math.abs(localMovement.z) < DIRECTION_EPSILON) {
    if (localOrigin.z < -halfZ || localOrigin.z > halfZ) return null
  } else {
    const first = (-halfZ - localOrigin.z) / localMovement.z
    const second = (halfZ - localOrigin.z) / localMovement.z
    nearZ = Math.min(first, second)
    farZ = Math.max(first, second)
    normalZ = localMovement.z > 0 ? -1 : 1
  }

  const near = Math.max(nearX, nearZ)
  const far = Math.min(farX, farZ)
  if (near > far || far < 0 || near > 1 || near < -COLLISION_EPSILON) return null

  const localNormal = nearX >= nearZ ? { x: normalX, z: 0 } : { x: 0, z: normalZ }
  const normal = localVectorToWorld(localNormal, collider)
  if (movement.x * normal.x + movement.z * normal.z >= -DIRECTION_EPSILON) return null
  return { time: Math.max(0, near), normal, colliderId: collider.id }
}

function isInsideCircle(point: XzPoint, blocker: XzPoint, separation: number): boolean {
  return Math.hypot(point.x - blocker.x, point.z - blocker.z) < separation - COLLISION_EPSILON
}

function sweepAgainstCircle(
  origin: XzPoint,
  movement: XzPoint,
  blocker: XzPoint,
  separation: number,
  blockerIndex: number,
): SweepHit | null {
  const movementLengthSquared = movement.x * movement.x + movement.z * movement.z
  if (movementLengthSquared < DIRECTION_EPSILON) return null
  const offset = { x: origin.x - blocker.x, z: origin.z - blocker.z }
  const outsideDistanceSquared = offset.x * offset.x + offset.z * offset.z - separation * separation
  if (outsideDistanceSquared < -COLLISION_EPSILON) return null
  const directionDot = offset.x * movement.x + offset.z * movement.z
  if (directionDot >= 0) return null
  const discriminant = directionDot * directionDot - movementLengthSquared * outsideDistanceSquared
  if (discriminant < 0) return null
  const time = (-directionDot - Math.sqrt(discriminant)) / movementLengthSquared
  if (time < -COLLISION_EPSILON || time > 1) return null
  const impact = {
    x: origin.x + movement.x * Math.max(0, time),
    z: origin.z + movement.z * Math.max(0, time),
  }
  const normalLength = Math.max(DIRECTION_EPSILON, Math.hypot(impact.x - blocker.x, impact.z - blocker.z))
  return {
    time: Math.max(0, time),
    normal: { x: (impact.x - blocker.x) / normalLength, z: (impact.z - blocker.z) / normalLength },
    colliderId: `circle-${String(blockerIndex).padStart(6, "0")}`,
  }
}

function isCombinedPositionValid(
  point: XzPoint,
  colliders: readonly OrientedRectangleCollider[],
  moverRadius: number,
  circleBlockers: readonly XzPoint[],
  circleSeparation: number,
): boolean {
  return !colliders.some((collider) => isInsideCollider(point, collider, moverRadius))
    && !circleBlockers.some((blocker) => isInsideCircle(point, blocker, circleSeparation))
}

function depenetrateFromCircle(
  point: XzPoint,
  destination: XzPoint,
  blocker: XzPoint,
  blockerIndex: number,
  separation: number,
  bounds: XzWorldBounds,
): XzPoint {
  let dx = point.x - blocker.x
  let dz = point.z - blocker.z
  let length = Math.hypot(dx, dz)
  if (length < DIRECTION_EPSILON) {
    dx = destination.x - blocker.x
    dz = destination.z - blocker.z
    length = Math.hypot(dx, dz)
  }
  if (length < DIRECTION_EPSILON) {
    const fallbackAngle = blockerIndex * Math.PI * (3 - Math.sqrt(5))
    dx = Math.cos(fallbackAngle)
    dz = Math.sin(fallbackAngle)
    length = 1
  }
  return clampPoint({
    x: blocker.x + (dx / length) * (separation + COLLISION_EPSILON),
    z: blocker.z + (dz / length) * (separation + COLLISION_EPSILON),
  }, bounds)
}

function depenetrateCombined(
  point: XzPoint,
  destination: XzPoint,
  colliders: readonly OrientedRectangleCollider[],
  moverRadius: number,
  circleBlockers: readonly XzPoint[],
  circleSeparation: number,
  bounds: XzWorldBounds,
): XzPoint | null {
  let resolved = clampPoint(point, bounds)
  const passLimit = Math.max(8, (colliders.length + circleBlockers.length) * 4)
  for (let pass = 0; pass < passLimit; pass += 1) {
    const collider = colliders.find((candidate) => isInsideCollider(resolved, candidate, moverRadius))
    if (collider) {
      const next = depenetrateFromCollider(resolved, collider, moverRadius, bounds)
      if (!next) return null
      resolved = next
      continue
    }
    const blockerIndex = circleBlockers.findIndex((blocker) => isInsideCircle(resolved, blocker, circleSeparation))
    if (blockerIndex >= 0) {
      resolved = depenetrateFromCircle(resolved, destination, circleBlockers[blockerIndex], blockerIndex, circleSeparation, bounds)
      continue
    }
    return resolved
  }
  return isCombinedPositionValid(resolved, colliders, moverRadius, circleBlockers, circleSeparation) ? resolved : null
}

function findCombinedRecovery(
  origin: XzPoint,
  destination: XzPoint,
  colliders: readonly OrientedRectangleCollider[],
  moverRadius: number,
  circleBlockers: readonly XzPoint[],
  circleSeparation: number,
  bounds: XzWorldBounds,
): XzPoint | null {
  const preferredAngle = Math.atan2(destination.z - origin.z, destination.x - origin.x)
  const maxRadius = Math.hypot(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)
  for (let radius = 0.5; radius <= maxRadius; radius += 0.5) {
    for (let direction = 0; direction < 32; direction += 1) {
      const angle = preferredAngle + direction * Math.PI / 16
      const candidate = clampPoint({
        x: origin.x + Math.cos(angle) * radius,
        z: origin.z + Math.sin(angle) * radius,
      }, bounds)
      if (isCombinedPositionValid(candidate, colliders, moverRadius, circleBlockers, circleSeparation)) return candidate
    }
  }
  return null
}

/**
 * Resolves a player displacement against Sherwood's static authored geometry.
 * The continuous sweep blocks tunnelling and projects the remaining displacement
 * along the contacted face so movement can slide naturally around the cottage.
 */
export function resolveSherwoodPlayerMovement(
  start: XzPoint,
  displacement: XzPoint,
  worldBounds: number | XzWorldBounds = SHERWOOD_MISSION_WORLD_BOUNDS,
  playerRadius = SHERWOOD_PLAYER_RADIUS,
  layout?: RegionalMissionLayout,
): XzPoint {
  const bounds = normalizeBounds(worldBounds)
  const radius = Number.isFinite(playerRadius) && playerRadius >= 0 ? playerRadius : SHERWOOD_PLAYER_RADIUS
  const midpoint = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }
  const colliders = layout ? [...SHERWOOD_STATIC_COLLIDERS, ...createSherwoodRiverColliders(layout), ...createSherwoodSettlementColliders(layout), ...createSherwoodTopologyColliders(layout)] : SHERWOOD_STATIC_COLLIDERS
  let position = depenetrate({
    x: finiteOr(start.x, midpoint.x),
    z: finiteOr(start.z, midpoint.z),
  }, colliders, radius, bounds)
  const requested = {
    x: finiteOr(displacement.x, 0),
    z: finiteOr(displacement.z, 0),
  }
  const boundedTarget = clampPoint({ x: position.x + requested.x, z: position.z + requested.z }, bounds)
  let remaining = { x: boundedTarget.x - position.x, z: boundedTarget.z - position.z }

  for (let pass = 0; pass < colliders.length + 2; pass += 1) {
    if (Math.hypot(remaining.x, remaining.z) < DIRECTION_EPSILON) break
    const hit = colliders
      .map((collider) => sweepAgainstCollider(position, remaining, collider, radius))
      .filter((candidate): candidate is SweepHit => candidate !== null)
      .sort((left, right) => left.time - right.time || left.colliderId.localeCompare(right.colliderId))[0]

    if (!hit) {
      position = { x: position.x + remaining.x, z: position.z + remaining.z }
      remaining = { x: 0, z: 0 }
      break
    }

    position = {
      x: position.x + remaining.x * hit.time + hit.normal.x * COLLISION_EPSILON,
      z: position.z + remaining.z * hit.time + hit.normal.z * COLLISION_EPSILON,
    }
    const unspent = {
      x: remaining.x * (1 - hit.time),
      z: remaining.z * (1 - hit.time),
    }
    const inward = unspent.x * hit.normal.x + unspent.z * hit.normal.z
    remaining = inward < 0
      ? { x: unspent.x - hit.normal.x * inward, z: unspent.z - hit.normal.z * inward }
      : unspent
  }

  return depenetrate(clampPoint(position, bounds), colliders, radius, bounds)
}

/**
 * Resolves world geometry and dynamic circular actors in one continuous sweep.
 * Treating both contact sets together prevents a circle slide or depenetration
 * from pushing the mover back through a river bank, ridge, tree, or building.
 */
export function resolveSherwoodCombinedMovement(
  start: XzPoint,
  displacement: XzPoint,
  options: SherwoodCombinedMovementOptions,
): XzPoint {
  const bounds = normalizeBounds(options.worldBounds ?? SHERWOOD_MISSION_WORLD_BOUNDS)
  const moverRadius = Number.isFinite(options.moverRadius) && (options.moverRadius ?? -1) >= 0
    ? options.moverRadius!
    : SHERWOOD_PLAYER_RADIUS
  const circleSeparation = Number.isFinite(options.circleSeparation) && (options.circleSeparation ?? 0) > 0
    ? options.circleSeparation!
    : SHERWOOD_GUARD_SEPARATION
  const midpoint = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }
  const colliders = options.layout
    ? [...SHERWOOD_STATIC_COLLIDERS, ...createSherwoodRiverColliders(options.layout), ...createSherwoodSettlementColliders(options.layout), ...createSherwoodTopologyColliders(options.layout)]
    : SHERWOOD_STATIC_COLLIDERS
  const circleBlockers = options.circleBlockers.filter((blocker) => Number.isFinite(blocker.x) && Number.isFinite(blocker.z))
  const safeStart = clampPoint({
    x: finiteOr(start.x, midpoint.x),
    z: finiteOr(start.z, midpoint.z),
  }, bounds)
  const requested = {
    x: finiteOr(displacement.x, 0),
    z: finiteOr(displacement.z, 0),
  }
  const requestedDestination = clampPoint({ x: safeStart.x + requested.x, z: safeStart.z + requested.z }, bounds)

  let position = depenetrateCombined(
    safeStart,
    requestedDestination,
    colliders,
    moverRadius,
    circleBlockers,
    circleSeparation,
    bounds,
  ) ?? findCombinedRecovery(
    safeStart,
    requestedDestination,
    colliders,
    moverRadius,
    circleBlockers,
    circleSeparation,
    bounds,
  ) ?? safeStart
  const safeFallback = isCombinedPositionValid(position, colliders, moverRadius, circleBlockers, circleSeparation)
    ? { ...position }
    : findCombinedRecovery(midpoint, requestedDestination, colliders, moverRadius, circleBlockers, circleSeparation, bounds)

  const boundedTarget = clampPoint({ x: position.x + requested.x, z: position.z + requested.z }, bounds)
  let remaining = { x: boundedTarget.x - position.x, z: boundedTarget.z - position.z }
  const passLimit = colliders.length + circleBlockers.length + 4
  for (let pass = 0; pass < passLimit; pass += 1) {
    if (Math.hypot(remaining.x, remaining.z) < DIRECTION_EPSILON) break
    const hit = [
      ...colliders.map((collider) => sweepAgainstCollider(position, remaining, collider, moverRadius)),
      ...circleBlockers.map((blocker, blockerIndex) => sweepAgainstCircle(position, remaining, blocker, circleSeparation, blockerIndex)),
    ]
      .filter((candidate): candidate is SweepHit => candidate !== null)
      .sort((left, right) => left.time - right.time || left.colliderId.localeCompare(right.colliderId))[0]

    if (!hit) {
      position = { x: position.x + remaining.x, z: position.z + remaining.z }
      remaining = { x: 0, z: 0 }
      break
    }

    position = {
      x: position.x + remaining.x * hit.time + hit.normal.x * COLLISION_EPSILON,
      z: position.z + remaining.z * hit.time + hit.normal.z * COLLISION_EPSILON,
    }
    const unspent = {
      x: remaining.x * (1 - hit.time),
      z: remaining.z * (1 - hit.time),
    }
    const inward = unspent.x * hit.normal.x + unspent.z * hit.normal.z
    remaining = inward < 0
      ? { x: unspent.x - hit.normal.x * inward, z: unspent.z - hit.normal.z * inward }
      : unspent
  }

  const resolved = depenetrateCombined(
    clampPoint(position, bounds),
    boundedTarget,
    colliders,
    moverRadius,
    circleBlockers,
    circleSeparation,
    bounds,
  )
  if (resolved && isCombinedPositionValid(resolved, colliders, moverRadius, circleBlockers, circleSeparation)) return resolved
  if (safeFallback) return safeFallback
  const recovery = findCombinedRecovery(safeStart, requestedDestination, colliders, moverRadius, circleBlockers, circleSeparation, bounds)
  if (recovery) return recovery
  if (isCombinedPositionValid(midpoint, colliders, moverRadius, circleBlockers, circleSeparation)) return midpoint
  throw new Error("Sherwood movement has no valid world-and-actor position")
}

export function isSherwoodPlayerPositionBlocked(
  position: XzPoint,
  playerRadius = SHERWOOD_PLAYER_RADIUS,
  layout?: RegionalMissionLayout,
): boolean {
  const radius = Number.isFinite(playerRadius) && playerRadius >= 0 ? playerRadius : SHERWOOD_PLAYER_RADIUS
  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) return true
  const colliders = layout ? [...SHERWOOD_STATIC_COLLIDERS, ...createSherwoodRiverColliders(layout), ...createSherwoodSettlementColliders(layout), ...createSherwoodTopologyColliders(layout)] : SHERWOOD_STATIC_COLLIDERS
  return colliders.some((collider) => isInsideCollider(position, collider, radius))
}
