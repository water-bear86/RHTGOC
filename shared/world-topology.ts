export interface TopologyPoint {
  x: number
  z: number
}

export interface SherwoodRidgeSegment {
  id: string
  ridgeId: string
  start: TopologyPoint
  end: TopologyPoint
  height: number
  visualHalfWidth: number
  collisionHalfWidth: number
}

export interface SherwoodPass {
  id: string
  ridgeId: string
  position: TopologyPoint
  radius: number
}

export interface SherwoodSettlementSite {
  id: string
  center: TopologyPoint
  radius: number
}

export interface SherwoodRoadRoute {
  points: TopologyPoint[]
  passIds: string[]
}

/**
 * Authored macro-landforms shared by rendering, road composition, and collision.
 * Each ridge is deliberately split around named passes rather than represented by
 * one opaque height-noise function.
 */
export const SHERWOOD_RIDGE_SEGMENTS: readonly SherwoodRidgeSegment[] = Object.freeze([
  Object.freeze({ id: "oak-ridge-south", ridgeId: "oak-ridge", start: Object.freeze({ x: -39, z: -64 }), end: Object.freeze({ x: -32, z: -35 }), height: 4.8, visualHalfWidth: 8, collisionHalfWidth: 2.4 }),
  Object.freeze({ id: "oak-ridge-middle", ridgeId: "oak-ridge", start: Object.freeze({ x: -29, z: -20 }), end: Object.freeze({ x: -27, z: 12 }), height: 5.2, visualHalfWidth: 8.5, collisionHalfWidth: 2.5 }),
  Object.freeze({ id: "oak-ridge-north", ridgeId: "oak-ridge", start: Object.freeze({ x: -24, z: 29 }), end: Object.freeze({ x: -19, z: 63 }), height: 4.9, visualHalfWidth: 8, collisionHalfWidth: 2.4 }),
  Object.freeze({ id: "hart-ridge-south", ridgeId: "hart-ridge", start: Object.freeze({ x: 22, z: -63 }), end: Object.freeze({ x: 29, z: -21 }), height: 5.1, visualHalfWidth: 8.5, collisionHalfWidth: 2.5 }),
  Object.freeze({ id: "hart-ridge-middle", ridgeId: "hart-ridge", start: Object.freeze({ x: 31, z: -4 }), end: Object.freeze({ x: 34, z: 22 }), height: 4.7, visualHalfWidth: 8, collisionHalfWidth: 2.4 }),
  Object.freeze({ id: "hart-ridge-north", ridgeId: "hart-ridge", start: Object.freeze({ x: 37, z: 40 }), end: Object.freeze({ x: 44, z: 63 }), height: 5.3, visualHalfWidth: 8.5, collisionHalfWidth: 2.5 }),
])

export const SHERWOOD_PASSES: readonly SherwoodPass[] = Object.freeze([
  Object.freeze({ id: "oak-south-pass", ridgeId: "oak-ridge", position: Object.freeze({ x: -30.5, z: -27.5 }), radius: 6.2 }),
  Object.freeze({ id: "oak-north-pass", ridgeId: "oak-ridge", position: Object.freeze({ x: -25.5, z: 20.5 }), radius: 6.4 }),
  Object.freeze({ id: "hart-south-pass", ridgeId: "hart-ridge", position: Object.freeze({ x: 30, z: -12.5 }), radius: 6.4 }),
  Object.freeze({ id: "hart-north-pass", ridgeId: "hart-ridge", position: Object.freeze({ x: 35.5, z: 31 }), radius: 6.6 }),
])

/** Fixed terraces let generated settlements move between known buildable sites. */
export const SHERWOOD_SETTLEMENT_SITES: readonly SherwoodSettlementSite[] = Object.freeze([
  Object.freeze({ id: "southwest-outer", center: Object.freeze({ x: -39, z: -43 }), radius: 12 }),
  Object.freeze({ id: "southwest-inner", center: Object.freeze({ x: -13, z: -43 }), radius: 12 }),
  Object.freeze({ id: "southeast-inner", center: Object.freeze({ x: 14, z: -44 }), radius: 12 }),
  Object.freeze({ id: "southeast-outer", center: Object.freeze({ x: 42, z: -40 }), radius: 12 }),
  Object.freeze({ id: "west-south", center: Object.freeze({ x: -44, z: -13 }), radius: 12 }),
  Object.freeze({ id: "west-north", center: Object.freeze({ x: -43, z: 13 }), radius: 12 }),
  Object.freeze({ id: "east-south", center: Object.freeze({ x: 44, z: -13 }), radius: 12 }),
  Object.freeze({ id: "east-north", center: Object.freeze({ x: 45, z: 13 }), radius: 12 }),
  Object.freeze({ id: "northwest-outer", center: Object.freeze({ x: -42, z: 48 }), radius: 12 }),
  Object.freeze({ id: "northwest-inner", center: Object.freeze({ x: -14, z: 50 }), radius: 12 }),
  Object.freeze({ id: "northeast-inner", center: Object.freeze({ x: 14, z: 49 }), radius: 12 }),
  Object.freeze({ id: "northeast-outer", center: Object.freeze({ x: 53, z: 34 }), radius: 12 }),
])

const EPSILON = 1e-6

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

function smoothstep(value: number): number {
  const clamped = clamp01(value)
  return clamped * clamped * (3 - 2 * clamped)
}

function distanceToSegment(point: TopologyPoint, start: TopologyPoint, end: TopologyPoint): number {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < EPSILON) return Math.hypot(point.x - start.x, point.z - start.z)
  const amount = clamp01(((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared)
  return Math.hypot(point.x - (start.x + dx * amount), point.z - (start.z + dz * amount))
}

function rawHeightAt(x: number, z: number): number {
  const rolling = Math.sin(x * 0.074) * 0.72 + Math.cos(z * 0.059) * 0.58
  const secondary = Math.sin((x - z) * 0.039 + 1.2) * 0.42
  const ridgeHeight = SHERWOOD_RIDGE_SEGMENTS.reduce((height, segment) => {
    const distance = distanceToSegment({ x, z }, segment.start, segment.end)
    const influence = smoothstep(1 - distance / segment.visualHalfWidth)
    return height + influence * segment.height
  }, 0)
  const passCut = SHERWOOD_PASSES.reduce((cut, pass) => {
    const influence = smoothstep(1 - Math.hypot(x - pass.position.x, z - pass.position.z) / pass.radius)
    return Math.max(cut, influence)
  }, 0)
  const riverDistance = Math.abs(x - 1 + z * 0.1)
  const valleyBlend = smoothstep((riverDistance - 3.2) / 6.5)
  const upland = 1.05 + rolling + secondary + ridgeHeight * (1 - passCut * 0.9)
  return -0.52 + (upland + 0.52) * valleyBlend
}

function riverValleyBlendAt(x: number, z: number): number {
  const riverDistance = Math.abs(x - 1 + z * 0.1)
  return smoothstep((riverDistance - 3.2) / 6.5)
}

/** Pure shared height contract; no Three.js state or renderer objects are involved. */
export function sherwoodTopologyHeightAt(x: number, z: number): number {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0
  const raw = rawHeightAt(x, z)
  let result = raw
  for (const site of SHERWOOD_SETTLEMENT_SITES) {
    const distance = Math.hypot(x - site.center.x, z - site.center.z)
    if (distance >= site.radius + 3.5) continue
    const terraceHeight = rawHeightAt(site.center.x, site.center.z)
    const blend = 1 - smoothstep((distance - site.radius + 3.5) / 7)
    // Terraces level buildable ground, but they must never fill the river
    // depression when an authored site overlaps the valley's outer blend.
    result += (terraceHeight - result) * blend * riverValleyBlendAt(x, z)
  }
  return result
}

function toBarrierLocal(point: TopologyPoint, segment: SherwoodRidgeSegment): TopologyPoint {
  const dx = segment.end.x - segment.start.x
  const dz = segment.end.z - segment.start.z
  const length = Math.max(EPSILON, Math.hypot(dx, dz))
  const centerX = (segment.start.x + segment.end.x) / 2
  const centerZ = (segment.start.z + segment.end.z) / 2
  const relativeX = point.x - centerX
  const relativeZ = point.z - centerZ
  return {
    x: relativeX * dx / length + relativeZ * dz / length,
    z: -relativeX * dz / length + relativeZ * dx / length,
  }
}

export function isSherwoodTopologySegmentBlocked(
  start: TopologyPoint,
  end: TopologyPoint,
  clearance = 0,
): boolean {
  return SHERWOOD_RIDGE_SEGMENTS.some((segment) => {
    const localStart = toBarrierLocal(start, segment)
    const localEnd = toBarrierLocal(end, segment)
    const halfLength = Math.hypot(segment.end.x - segment.start.x, segment.end.z - segment.start.z) / 2 + clearance
    const halfWidth = segment.collisionHalfWidth + clearance
    if ((Math.abs(localStart.x) <= halfLength && Math.abs(localStart.z) <= halfWidth)
      || (Math.abs(localEnd.x) <= halfLength && Math.abs(localEnd.z) <= halfWidth)) return true
    const dx = localEnd.x - localStart.x
    const dz = localEnd.z - localStart.z
    let near = 0
    let far = 1
    for (const [origin, direction, minimum, maximum] of [
      [localStart.x, dx, -halfLength, halfLength],
      [localStart.z, dz, -halfWidth, halfWidth],
    ] as const) {
      if (Math.abs(direction) < EPSILON) {
        if (origin < minimum || origin > maximum) return false
        continue
      }
      const first = (minimum - origin) / direction
      const second = (maximum - origin) / direction
      near = Math.max(near, Math.min(first, second))
      far = Math.min(far, Math.max(first, second))
      if (near > far) return false
    }
    return near <= far && far >= 0 && near <= 1
  })
}

/** Finds the shortest clear pass sequence between two points. */
export function routeThroughSherwoodPasses(start: TopologyPoint, end: TopologyPoint, clearance = 1.4): SherwoodRoadRoute {
  if (!isSherwoodTopologySegmentBlocked(start, end, clearance)) return { points: [{ ...start }, { ...end }], passIds: [] }
  const passApproaches = SHERWOOD_PASSES.flatMap((pass) => {
    const segments = SHERWOOD_RIDGE_SEGMENTS.filter((segment) => segment.ridgeId === pass.ridgeId)
    const direction = segments.reduce((sum, segment) => ({
      x: sum.x + segment.end.x - segment.start.x,
      z: sum.z + segment.end.z - segment.start.z,
    }), { x: 0, z: 0 })
    const length = Math.max(EPSILON, Math.hypot(direction.x, direction.z))
    const span = Math.max(...segments.map((segment) => segment.collisionHalfWidth)) + clearance + 1.15
    const normal = { x: -direction.z / length * span, z: direction.x / length * span }
    return [
      { id: `${pass.id}-approach-a`, passId: pass.id, position: { x: pass.position.x + normal.x, z: pass.position.z + normal.z } },
      { id: `${pass.id}-approach-b`, passId: pass.id, position: { x: pass.position.x - normal.x, z: pass.position.z - normal.z } },
    ]
  })
  const nodes = [
    { id: "road-start", passId: undefined, position: start },
    ...passApproaches,
    { id: "road-end", passId: undefined, position: end },
  ]
  const distances = nodes.map(() => Number.POSITIVE_INFINITY)
  const previous = nodes.map(() => -1)
  const visited = nodes.map(() => false)
  distances[0] = 0
  for (let iteration = 0; iteration < nodes.length; iteration += 1) {
    let current = -1
    for (let index = 0; index < nodes.length; index += 1) {
      if (!visited[index] && (current < 0 || distances[index] < distances[current])) current = index
    }
    if (current < 0 || !Number.isFinite(distances[current])) break
    if (current === nodes.length - 1) break
    visited[current] = true
    for (let next = 0; next < nodes.length; next += 1) {
      if (next === current || visited[next]) continue
      if (isSherwoodTopologySegmentBlocked(nodes[current].position, nodes[next].position, clearance)) continue
      const edgeLength = Math.hypot(nodes[next].position.x - nodes[current].position.x, nodes[next].position.z - nodes[current].position.z)
      const candidate = distances[current] + edgeLength
      if (candidate + EPSILON < distances[next]) {
        distances[next] = candidate
        previous[next] = current
      }
    }
  }
  const endIndex = nodes.length - 1
  if (!Number.isFinite(distances[endIndex])) return { points: [{ ...start }, { ...end }], passIds: [] }
  const route: number[] = []
  for (let index = endIndex; index >= 0; index = previous[index]) {
    route.push(index)
    if (index === 0) break
    if (previous[index] < 0) return { points: [{ ...start }, { ...end }], passIds: [] }
  }
  route.reverse()
  return {
    points: route.map((index) => ({ ...nodes[index].position })),
    passIds: [...new Set(route.slice(1, -1).flatMap((index) => nodes[index].passId ? [nodes[index].passId] : []))],
  }
}
