import { riverPointAt, sherwoodRegionCells, type RegionalMissionLayout } from "./regional-layout"
import { SHERWOOD_TREE_LAYOUT } from "./world-layout"
import {
  SHERWOOD_PASSES,
  SHERWOOD_RIDGE_SEGMENTS,
  SHERWOOD_SETTLEMENT_SITES,
  isSherwoodTopologySegmentBlocked,
  type TopologyPoint,
} from "./world-topology"
import {
  SHERWOOD_RIVER_HALF_WIDTH,
  SHERWOOD_STATIC_OBSTACLES,
  createSherwoodRiverObstacles,
  isPointInsideSherwoodObstacle,
  isSegmentBlockedBySherwoodObstacle,
  type SherwoodObstacle,
} from "./world-obstacles"

export type SettlementKind = "outlaw-hamlet" | "forest-village" | "sheriff-post"

export interface ComposedBuilding {
  id: string
  kind: "cottage" | "barn" | "watchtower"
  position: { x: number; z: number }
  halfExtents: { x: number; z: number }
  rotation: number
}

export interface ComposedSettlement {
  id: string
  kind: SettlementKind
  center: { x: number; z: number }
  buildings: ComposedBuilding[]
}

export interface ComposedRoad {
  id: string
  width: number
  points: Array<{ x: number; z: number }>
  passIds?: string[]
}

export interface ComposedWorld {
  settlements: ComposedSettlement[]
  roads: ComposedRoad[]
  buildingCount: number
}

const composedWorldCache = new WeakMap<RegionalMissionLayout, ComposedWorld>()
const ROAD_PLAYER_RADIUS = 0.45
const ROAD_SAFETY_MARGIN = 0.18
const ROAD_COMPOSITION_BOUND = 65
const ROAD_VISIBILITY_EDGE_LIMIT = 42
const SETTLEMENT_ROAD_APPROACH_CLEARANCE = 3.4 / 2 + ROAD_PLAYER_RADIUS + ROAD_SAFETY_MARGIN

interface RoadRoutingContext {
  layout: RegionalMissionLayout
  obstacles: readonly SherwoodObstacle[]
  topologyClearings: readonly { center: TopologyPoint; radius: number }[]
  navigationGraphs: Map<number, RoadNavigationGraph>
}

interface RoadNavigationNode {
  position: TopologyPoint
}

interface RoadNavigationGraph {
  nodes: RoadNavigationNode[]
  neighbors: number[][]
}

function clamp(value: number): number {
  return Math.max(-59, Math.min(59, value))
}

function inward(point: { x: number; z: number }, distance: number): { x: number; z: number } {
  const length = Math.max(0.001, Math.hypot(point.x, point.z))
  return { x: point.x - point.x / length * distance, z: point.z - point.z / length * distance }
}

function treeClear(position: { x: number; z: number }, radius: number): boolean {
  return SHERWOOD_TREE_LAYOUT.every((tree) => Math.hypot(position.x - tree.x, position.z - tree.z) > radius + tree.scale * 0.55)
}

function distanceToSegment(point: TopologyPoint, start: TopologyPoint, end: TopologyPoint): number {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-9) return Math.hypot(point.x - start.x, point.z - start.z)
  const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared))
  return Math.hypot(point.x - (start.x + dx * amount), point.z - (start.z + dz * amount))
}

function roadCorridorClearForBuilding(
  position: TopologyPoint,
  footprintRadius: number,
  roads: readonly ComposedRoad[],
): boolean {
  return roads.every((road) => road.points.slice(1).every((point, index) => (
    distanceToSegment(position, road.points[index], point) > footprintRadius + road.width / 2 + ROAD_PLAYER_RADIUS + ROAD_SAFETY_MARGIN
  )))
}

function createSettlement(
  id: string,
  kind: SettlementKind,
  center: { x: number; z: number },
  count: number,
  roads: readonly ComposedRoad[],
): ComposedSettlement {
  const buildings: ComposedBuilding[] = []
  for (let index = 0; index < count * 18 && buildings.length < count; index += 1) {
    const angle = index * 2.399963 + (kind === "sheriff-post" ? 0.4 : -0.25)
    const radius = 4.6 + (index % 5) * 1.75
    const position = { x: clamp(center.x + Math.cos(angle) * radius), z: clamp(center.z + Math.sin(angle) * radius) }
    const kindForBuilding = kind === "sheriff-post" && buildings.length === 0
      ? "watchtower"
      : buildings.length % 4 === 3 ? "barn" : "cottage"
    const halfExtents = kindForBuilding === "watchtower" ? { x: 1.45, z: 1.45 }
      : kindForBuilding === "barn" ? { x: 2.5, z: 1.75 }
        : { x: 1.9, z: 1.45 }
    if (!treeClear(position, Math.max(halfExtents.x, halfExtents.z) + 0.8)) continue
    const footprintRadius = Math.hypot(halfExtents.x, halfExtents.z)
    if (!roadCorridorClearForBuilding(position, footprintRadius, roads)) continue
    const overlapsBuilding = buildings.some((existing) => {
      const existingRadius = Math.hypot(existing.halfExtents.x, existing.halfExtents.z)
      return Math.hypot(position.x - existing.position.x, position.z - existing.position.z) < footprintRadius + existingRadius + 1.1
    })
    if (overlapsBuilding) continue
    buildings.push({ id: `${id}-building-${buildings.length}`, kind: kindForBuilding, position, halfExtents, rotation: angle + Math.PI / 2 })
  }
  return { id, kind, center, buildings }
}

function isRoadSegmentClear(
  start: TopologyPoint,
  end: TopologyPoint,
  clearance: number,
  context: RoadRoutingContext,
): boolean {
  if (Math.abs(start.x) > ROAD_COMPOSITION_BOUND || Math.abs(start.z) > ROAD_COMPOSITION_BOUND
    || Math.abs(end.x) > ROAD_COMPOSITION_BOUND || Math.abs(end.z) > ROAD_COMPOSITION_BOUND) return false
  if (isSherwoodTopologySegmentBlocked(start, end, clearance)) {
    const length = Math.hypot(end.x - start.x, end.z - start.z)
    const topologySamples = Math.max(1, Math.ceil(length))
    for (let index = 0; index <= topologySamples; index += 1) {
      const amount = index / topologySamples
      const point = {
        x: start.x + (end.x - start.x) * amount,
        z: start.z + (end.z - start.z) * amount,
      }
      const inAuthoredClearing = context.topologyClearings.some((clearing) => (
        Math.hypot(point.x - clearing.center.x, point.z - clearing.center.z) < clearing.radius
      ))
      if (!inAuthoredClearing && isSherwoodTopologySegmentBlocked(point, point, clearance)) return false
    }
  }
  return context.obstacles.every((obstacle) => (
    !isSegmentBlockedBySherwoodObstacle(start, end, obstacle, clearance)
  ))
}

function crossingPortalPoints(layout: RegionalMissionLayout, clearance: number): TopologyPoint[] {
  const normalLength = Math.hypot(1, 0.1)
  const normal = { x: 1 / normalLength, z: 0.1 / normalLength }
  const bankDistance = SHERWOOD_RIVER_HALF_WIDTH + clearance + 0.35
  return layout.crossingPositions.flatMap((crossing) => [
    { ...crossing },
    { x: crossing.x + normal.x * bankDistance, z: crossing.z + normal.z * bankDistance },
    { x: crossing.x - normal.x * bankDistance, z: crossing.z - normal.z * bankDistance },
  ])
}

function riverBankPortalPoints(clearance: number): TopologyPoint[] {
  const normalLength = Math.hypot(1, 0.1)
  const normal = { x: 1 / normalLength, z: 0.1 / normalLength }
  const bankDistance = SHERWOOD_RIVER_HALF_WIDTH + clearance + 0.35
  return [-52, -39, -26, -13, 0, 13, 26, 39, 52].flatMap((z) => {
    const river = riverPointAt(z)
    return [
      { x: river.x + normal.x * bankDistance, z: river.z + normal.z * bankDistance },
      { x: river.x - normal.x * bankDistance, z: river.z - normal.z * bankDistance },
    ]
  })
}

function navigationClearance(width: number): number {
  const tierWidth = width >= 3 ? 3.4 : 2.2
  return tierWidth / 2 + ROAD_PLAYER_RADIUS + ROAD_SAFETY_MARGIN
}

function topologyPassPortalPoints(clearance: number): TopologyPoint[] {
  return SHERWOOD_PASSES.flatMap((pass) => {
    const segments = SHERWOOD_RIDGE_SEGMENTS.filter((segment) => segment.ridgeId === pass.ridgeId)
    const direction = segments.reduce((sum, segment) => ({
      x: sum.x + segment.end.x - segment.start.x,
      z: sum.z + segment.end.z - segment.start.z,
    }), { x: 0, z: 0 })
    const length = Math.max(0.001, Math.hypot(direction.x, direction.z))
    const span = Math.max(...segments.map((segment) => segment.collisionHalfWidth)) + clearance + 0.8
    const normal = { x: -direction.z / length * span, z: direction.x / length * span }
    const tangent = { x: direction.x / length * 3.2, z: direction.z / length * 3.2 }
    const firstSide = { x: pass.position.x + normal.x, z: pass.position.z + normal.z }
    const secondSide = { x: pass.position.x - normal.x, z: pass.position.z - normal.z }
    return [
      { ...pass.position },
      firstSide,
      { x: firstSide.x + tangent.x, z: firstSide.z + tangent.z },
      { x: firstSide.x - tangent.x, z: firstSide.z - tangent.z },
      secondSide,
      { x: secondSide.x + tangent.x, z: secondSide.z + tangent.z },
      { x: secondSide.x - tangent.x, z: secondSide.z - tangent.z },
    ]
  })
}

function settlementPortalPoints(): TopologyPoint[] {
  return SHERWOOD_SETTLEMENT_SITES.flatMap((site) => [
    site.center,
    { x: site.center.x + 6, z: site.center.z },
    { x: site.center.x - 6, z: site.center.z },
    { x: site.center.x, z: site.center.z + 6 },
    { x: site.center.x, z: site.center.z - 6 },
  ])
}

function regionClearingPortalPoints(): TopologyPoint[] {
  return sherwoodRegionCells().map((cell) => cell.center)
}

function roadNavigationGraph(context: RoadRoutingContext, clearance: number): RoadNavigationGraph {
  const cached = context.navigationGraphs.get(clearance)
  if (cached) return cached

  const candidates = [
    ...regionClearingPortalPoints(),
    ...settlementPortalPoints(),
    ...crossingPortalPoints(context.layout, clearance),
    ...riverBankPortalPoints(clearance),
    ...topologyPassPortalPoints(clearance),
  ]
  const seen = new Set<string>()
  const nodes = candidates.flatMap((point): RoadNavigationNode[] => {
    const key = `${point.x.toFixed(4)}:${point.z.toFixed(4)}`
    if (seen.has(key) || !isRoadSegmentClear(point, point, clearance, context)) return []
    seen.add(key)
    return [{ position: { ...point } }]
  })

  const neighbors = nodes.map((): number[] => [])
  const connect = (left: number, right: number): void => {
    neighbors[left].push(right)
    neighbors[right].push(left)
  }
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      if (Math.hypot(
        nodes[left].position.x - nodes[right].position.x,
        nodes[left].position.z - nodes[right].position.z,
      ) > ROAD_VISIBILITY_EDGE_LIMIT) continue
      if (isRoadSegmentClear(nodes[left].position, nodes[right].position, clearance, context)) connect(left, right)
    }
  }
  for (const list of neighbors) list.sort((left, right) => left - right)
  const graph = { nodes, neighbors }
  context.navigationGraphs.set(clearance, graph)
  return graph
}

function findRoadPath(
  start: TopologyPoint,
  end: TopologyPoint,
  width: number,
  context: RoadRoutingContext,
): TopologyPoint[] {
  const clearance = navigationClearance(width)
  if (isRoadSegmentClear(start, end, clearance, context)) return [{ ...start }, { ...end }]
  const graph = roadNavigationGraph(context, clearance)
  const nodes = [...graph.nodes]
  const baseNodeCount = nodes.length
  const startIndex = nodes.length
  nodes.push({ position: { ...start } })
  const endIndex = nodes.length
  nodes.push({ position: { ...end } })
  const startNeighbors = graph.nodes.flatMap((node, index) => (
    isRoadSegmentClear(start, node.position, clearance, context) ? [index] : []
  ))
  const endNeighbors = graph.nodes.flatMap((node, index) => (
    isRoadSegmentClear(end, node.position, clearance, context) ? [index] : []
  ))
  const startNeighborSet = new Set(startNeighbors)
  const endNeighborSet = new Set(endNeighbors)

  const scores = nodes.map(() => Number.POSITIVE_INFINITY)
  const previous = nodes.map(() => -1)
  const queue: Array<{ index: number; estimate: number; serial: number }> = []
  let serial = 0
  const push = (entry: { index: number; estimate: number; serial: number }): void => {
    queue.push(entry)
    let child = queue.length - 1
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2)
      const parentEntry = queue[parent]
      if (parentEntry.estimate < entry.estimate
        || (parentEntry.estimate === entry.estimate && parentEntry.serial <= entry.serial)) break
      queue[child] = parentEntry
      child = parent
    }
    queue[child] = entry
  }
  const pop = (): { index: number; estimate: number; serial: number } | undefined => {
    const first = queue[0]
    const last = queue.pop()
    if (!first || !last || queue.length === 0) return first
    let parent = 0
    while (true) {
      const left = parent * 2 + 1
      const right = left + 1
      if (left >= queue.length) break
      let child = left
      if (right < queue.length && (queue[right].estimate < queue[left].estimate
        || (queue[right].estimate === queue[left].estimate && queue[right].serial < queue[left].serial))) child = right
      if (queue[child].estimate > last.estimate
        || (queue[child].estimate === last.estimate && queue[child].serial >= last.serial)) break
      queue[parent] = queue[child]
      parent = child
    }
    queue[parent] = last
    return first
  }
  const heuristic = (index: number): number => Math.hypot(
    nodes[index].position.x - end.x,
    nodes[index].position.z - end.z,
  )
  scores[startIndex] = 0
  push({ index: startIndex, estimate: heuristic(startIndex), serial: serial++ })

  while (queue.length > 0) {
    const currentEntry = pop()!
    const currentIndex = currentEntry.index
    if (currentEntry.estimate > scores[currentIndex] + heuristic(currentIndex) + 1e-7) continue
    if (currentIndex === endIndex) break
    const current = nodes[currentIndex]
    const candidates = new Set<number>()
    if (currentIndex < baseNodeCount) {
      for (const neighbor of graph.neighbors[currentIndex]) candidates.add(neighbor)
      if (startNeighborSet.has(currentIndex)) candidates.add(startIndex)
      if (endNeighborSet.has(currentIndex)) candidates.add(endIndex)
    } else {
      for (const neighbor of currentIndex === startIndex ? startNeighbors : endNeighbors) candidates.add(neighbor)
    }

    for (const candidateIndex of [...candidates].sort((left, right) => left - right)) {
      const candidate = nodes[candidateIndex]
      const edgeLength = Math.hypot(
        candidate.position.x - current.position.x,
        candidate.position.z - current.position.z,
      )
      const score = scores[currentIndex] + edgeLength
      if (score + 1e-7 >= scores[candidateIndex]) continue
      scores[candidateIndex] = score
      previous[candidateIndex] = currentIndex
      push({ index: candidateIndex, estimate: score + heuristic(candidateIndex), serial: serial++ })
    }
  }

  if (!Number.isFinite(scores[endIndex])) {
    throw new Error(`Unable to compose traversable road from (${start.x}, ${start.z}) to (${end.x}, ${end.z})`)
  }
  const routeIndices: number[] = []
  for (let index = endIndex; index >= 0; index = previous[index]) {
    routeIndices.push(index)
    if (index === startIndex) break
  }
  routeIndices.reverse()
  const raw = routeIndices.map((index) => nodes[index].position)
  const simplified: TopologyPoint[] = [{ ...raw[0] }]
  for (let index = 0; index < raw.length - 1;) {
    let next = raw.length - 1
    while (next > index + 1 && !isRoadSegmentClear(raw[index], raw[next], clearance, context)) next -= 1
    simplified.push({ ...raw[next] })
    index = next
  }
  return simplified
}

function sampleRoadPath(points: readonly TopologyPoint[], spacing = 1.8): TopologyPoint[] {
  return points.flatMap((start, index) => {
    if (index === points.length - 1) return []
    const end = points[index + 1]
    const steps = Math.max(1, Math.ceil(Math.hypot(end.x - start.x, end.z - start.z) / spacing))
    const sampled = Array.from({ length: steps + 1 }, (_, step) => {
      const amount = step / steps
      return { x: start.x + (end.x - start.x) * amount, z: start.z + (end.z - start.z) * amount }
    })
    return index === 0 ? sampled : sampled.slice(1)
  })
}

function curvedRoad(
  id: string,
  start: TopologyPoint,
  end: TopologyPoint,
  width: number,
  context: RoadRoutingContext,
): ComposedRoad {
  const points = sampleRoadPath(findRoadPath(start, end, width, context))
  const passIds = SHERWOOD_PASSES.filter((pass) => points.some((point) => (
    Math.hypot(point.x - pass.position.x, point.z - pass.position.z) < pass.radius
  ))).map((pass) => pass.id)
  return { id, width, points, passIds }
}

function chooseSettlementSite(
  target: TopologyPoint,
  anchors: readonly TopologyPoint[],
  used: Set<string>,
  farthest = false,
): TopologyPoint {
  const eligible = SHERWOOD_SETTLEMENT_SITES.filter((site) => !used.has(site.id)
    && SHERWOOD_STATIC_OBSTACLES.every((obstacle) => !isPointInsideSherwoodObstacle(site.center, obstacle, SETTLEMENT_ROAD_APPROACH_CLEARANCE))
    && anchors.every((anchor) => Math.hypot(site.center.x - anchor.x, site.center.z - anchor.z) > 12.5))
  const candidates = eligible.length > 0 ? eligible : SHERWOOD_SETTLEMENT_SITES.filter((site) => !used.has(site.id)
    && SHERWOOD_STATIC_OBSTACLES.every((obstacle) => !isPointInsideSherwoodObstacle(site.center, obstacle, SETTLEMENT_ROAD_APPROACH_CLEARANCE)))
  const sorted = [...candidates].sort((left, right) => {
    const leftDistance = Math.hypot(left.center.x - target.x, left.center.z - target.z)
    const rightDistance = Math.hypot(right.center.x - target.x, right.center.z - target.z)
    return (farthest ? rightDistance - leftDistance : leftDistance - rightDistance) || left.id.localeCompare(right.id)
  })
  const selected = sorted[0]
  used.add(selected.id)
  return { ...selected.center }
}

/** Deterministic layout data consumed by both the renderer and authoritative collision. */
export function composeSherwoodWorld(layout: RegionalMissionLayout): ComposedWorld {
  const cached = composedWorldCache.get(layout)
  if (cached) return cached
  const usedSites = new Set<string>()
  const anchors = [layout.campfirePosition, layout.objectivePosition]
  const villageCenter = chooseSettlementSite(inward(layout.campfirePosition, 12), anchors, usedSites)
  const sheriffCenter = chooseSettlementSite(inward(layout.objectivePosition, 13), anchors, usedSites)
  const hamletCenter = chooseSettlementSite({
    x: (villageCenter.x + sheriffCenter.x) / 2,
    z: (villageCenter.z + sheriffCenter.z) / 2,
  }, anchors, usedSites, true)
  const nearestCrossing = (point: { x: number; z: number }): { x: number; z: number } => [...layout.crossingPositions]
    .sort((left, right) => Math.hypot(point.x - left.x, point.z - left.z) - Math.hypot(point.x - right.x, point.z - right.z))[0]
  const routingContext: RoadRoutingContext = {
    layout,
    obstacles: [...SHERWOOD_STATIC_OBSTACLES, ...createSherwoodRiverObstacles(layout)],
    navigationGraphs: new Map(),
    topologyClearings: [
      { center: layout.campfirePosition, radius: 7.5 },
      { center: layout.objectivePosition, radius: 8 },
      ...layout.crossingPositions.map((center) => ({ center, radius: 6.5 })),
      ...[villageCenter, sheriffCenter, hamletCenter].map((center) => ({ center, radius: 13.5 })),
    ],
  }
  const roads = [
    curvedRoad("camp-village-road", layout.campfirePosition, villageCenter, 3.2, routingContext),
    curvedRoad("village-ford-road", villageCenter, nearestCrossing(villageCenter), 3.4, routingContext),
    curvedRoad("sheriff-ford-road", nearestCrossing(sheriffCenter), sheriffCenter, 3.4, routingContext),
    curvedRoad("post-objective-road", sheriffCenter, layout.objectivePosition, 3.2, routingContext),
    curvedRoad("hamlet-track", hamletCenter, nearestCrossing(hamletCenter), 2.15, routingContext),
    curvedRoad("river-road", layout.crossingPositions[0], layout.crossingPositions[1], 2.2, routingContext),
  ]
  const settlements = [
    createSettlement("greenwood-village", "forest-village", villageCenter, 6, roads),
    createSettlement("foresters-hamlet", "outlaw-hamlet", hamletCenter, 5, roads),
    createSettlement("sheriff-road-post", "sheriff-post", sheriffCenter, 5, roads),
  ]
  const world = { settlements, roads, buildingCount: settlements.reduce((sum, settlement) => sum + settlement.buildings.length, 0) }
  composedWorldCache.set(layout, world)
  return world
}
