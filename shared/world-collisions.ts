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
export const VILLAGE_COTTAGE_COLLIDER: OrientedRectangleCollider = Object.freeze({
  id: "sherwood-village-cottage",
  center: Object.freeze({ x: -10, z: 14 }),
  halfExtents: Object.freeze({ x: 2.75, z: 3 }),
  rotation: -0.55,
})

export const SHERWOOD_STATIC_COLLIDERS: readonly OrientedRectangleCollider[] = Object.freeze([
  VILLAGE_COTTAGE_COLLIDER,
])

export const SHERWOOD_MISSION_WORLD_BOUNDS = 22
export const PUBLIC_HUB_WORLD_BOUNDS: XzWorldBounds = Object.freeze({ minX: -18, maxX: -4, minZ: 2, maxZ: 16 })

const COLLISION_EPSILON = 1e-6
const DIRECTION_EPSILON = 1e-10

interface SweepHit {
  time: number
  normal: XzPoint
  colliderId: string
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
): XzPoint {
  const bounds = normalizeBounds(worldBounds)
  const radius = Number.isFinite(playerRadius) && playerRadius >= 0 ? playerRadius : SHERWOOD_PLAYER_RADIUS
  const midpoint = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2 }
  let position = depenetrate({
    x: finiteOr(start.x, midpoint.x),
    z: finiteOr(start.z, midpoint.z),
  }, SHERWOOD_STATIC_COLLIDERS, radius, bounds)
  const requested = {
    x: finiteOr(displacement.x, 0),
    z: finiteOr(displacement.z, 0),
  }
  const boundedTarget = clampPoint({ x: position.x + requested.x, z: position.z + requested.z }, bounds)
  let remaining = { x: boundedTarget.x - position.x, z: boundedTarget.z - position.z }

  for (let pass = 0; pass < SHERWOOD_STATIC_COLLIDERS.length + 2; pass += 1) {
    if (Math.hypot(remaining.x, remaining.z) < DIRECTION_EPSILON) break
    const hit = SHERWOOD_STATIC_COLLIDERS
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

  return depenetrate(clampPoint(position, bounds), SHERWOOD_STATIC_COLLIDERS, radius, bounds)
}

export function isSherwoodPlayerPositionBlocked(
  position: XzPoint,
  playerRadius = SHERWOOD_PLAYER_RADIUS,
): boolean {
  const radius = Number.isFinite(playerRadius) && playerRadius >= 0 ? playerRadius : SHERWOOD_PLAYER_RADIUS
  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) return true
  return SHERWOOD_STATIC_COLLIDERS.some((collider) => isInsideCollider(position, collider, radius))
}
