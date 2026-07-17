import type { RegionalizedMission, RegionalMissionLayout } from "./regional-layout"
import { regionCellIndexAt, stableSeed } from "./regional-layout"
import { validateRegionalMissionFeasibility, type MapFeasibilityResult } from "./map-feasibility"
import { composeSherwoodWorld, type ComposedRoad } from "./world-composer"

export const MAP_QUALITY_DIMENSIONS = [
  "traversalFairness",
  "routeChoice",
  "riskRewardDistribution",
  "pacingShape",
  "landmarkLegibility",
  "cooperationCoverage",
  "novelty",
] as const

export type MapQualityDimension = typeof MAP_QUALITY_DIMENSIONS[number]

export interface MapQualityVector {
  traversalFairness: number
  routeChoice: number
  riskRewardDistribution: number
  pacingShape: number
  landmarkLegibility: number
  cooperationCoverage: number
  novelty: number
}

export interface MapQualityEvidence {
  playerObjectivePathCosts: number[]
  crossingObjectivePathCosts: number[]
  crossingSeparation: number
  cacheGuardClearances: number[]
  cacheRoadDetours: number[]
  nondominatedCacheCount: number
  guardProgressBins: number[]
  openingGuardClearance: number
  landmarkMinimumSeparation: number
  landmarkBearingSeparation: number
  occupiedGuardCells: number
  occupiedCacheCells: number
  referenceCount: number
}

export interface RegionalMapQualityResult {
  vector: MapQualityVector
  evidence: MapQualityEvidence
  fingerprint: string
  feasibility: MapFeasibilityResult
}

export interface RegionalMapQualityOptions {
  referenceLayouts?: readonly RegionalMissionLayout[]
}

export interface MapQualityCandidate {
  quality: MapQualityVector
}

interface RoadGraphNode {
  position: { x: number; z: number }
  edges: Array<{ target: number; cost: number }>
}

interface LayoutSignature {
  campCell: number
  objectiveCell: number
  crossingZs: number[]
  guardHistogram: number[]
  cacheCells: number[]
}

const ROAD_ENDPOINT_EPSILON = 0.25
const QUALITY_EPSILON = 1e-9

export class MapQualityEvaluationError extends Error {
  readonly code = "MAP_NOT_FEASIBLE"

  constructor(readonly feasibility: MapFeasibilityResult) {
    const codes = [...new Set(feasibility.diagnostics.map((diagnostic) => diagnostic.code))].sort()
    super(`Cannot score infeasible map: ${codes.join(",") || "unknown"}`)
    this.name = "MapQualityEvaluationError"
  }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function rounded(value: number): number {
  return Math.round(clamp01(value) * 1_000_000) / 1_000_000
}

function polylineLength(points: readonly { x: number; z: number }[]): number {
  return points.slice(1).reduce((sum, point, index) => (
    sum + Math.hypot(point.x - points[index].x, point.z - points[index].z)
  ), 0)
}

function buildRoadGraph(roads: readonly ComposedRoad[]): RoadGraphNode[] {
  const nodes: RoadGraphNode[] = []
  const nodeAt = (position: { x: number; z: number }): number => {
    const existing = nodes.findIndex((node) => (
      Math.hypot(node.position.x - position.x, node.position.z - position.z) <= ROAD_ENDPOINT_EPSILON
    ))
    if (existing >= 0) return existing
    nodes.push({ position: { ...position }, edges: [] })
    return nodes.length - 1
  }
  for (const road of roads) {
    const start = nodeAt(road.points[0])
    const end = nodeAt(road.points[road.points.length - 1])
    const cost = polylineLength(road.points)
    nodes[start].edges.push({ target: end, cost })
    nodes[end].edges.push({ target: start, cost })
  }
  for (const node of nodes) node.edges.sort((left, right) => left.target - right.target || left.cost - right.cost)
  return nodes
}

function nearestRoadNode(nodes: readonly RoadGraphNode[], position: { x: number; z: number }): number {
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  nodes.forEach((node, index) => {
    const distance = Math.hypot(node.position.x - position.x, node.position.z - position.z)
    if (distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

function shortestRoadDistance(
  nodes: readonly RoadGraphNode[],
  start: { x: number; z: number },
  end: { x: number; z: number },
): number {
  const startIndex = nearestRoadNode(nodes, start)
  const endIndex = nearestRoadNode(nodes, end)
  if (startIndex < 0 || endIndex < 0) return Number.POSITIVE_INFINITY
  const distances = nodes.map(() => Number.POSITIVE_INFINITY)
  const visited = new Set<number>()
  distances[startIndex] = Math.hypot(nodes[startIndex].position.x - start.x, nodes[startIndex].position.z - start.z)
  while (visited.size < nodes.length) {
    let current = -1
    let currentDistance = Number.POSITIVE_INFINITY
    distances.forEach((distance, index) => {
      if (!visited.has(index) && distance < currentDistance) {
        current = index
        currentDistance = distance
      }
    })
    if (current < 0 || current === endIndex) break
    visited.add(current)
    for (const edge of nodes[current].edges) {
      distances[edge.target] = Math.min(distances[edge.target], currentDistance + edge.cost)
    }
  }
  return distances[endIndex]
    + Math.hypot(nodes[endIndex].position.x - end.x, nodes[endIndex].position.z - end.z)
}

function distanceToRoad(position: { x: number; z: number }, roads: readonly ComposedRoad[]): number {
  return Math.min(...roads.flatMap((road) => road.points.map((point) => (
    Math.hypot(point.x - position.x, point.z - position.z)
  ))))
}

function spread(values: readonly number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values)
}

function countNondominatedCaches(clearances: readonly number[], detours: readonly number[]): number {
  return clearances.filter((clearance, index) => !clearances.some((otherClearance, otherIndex) => (
    otherIndex !== index
    && otherClearance >= clearance
    && detours[otherIndex] <= detours[index]
    && (otherClearance > clearance || detours[otherIndex] < detours[index])
  ))).length
}

function angleDifference(left: number, right: number): number {
  const difference = Math.abs(left - right) % (Math.PI * 2)
  return Math.min(difference, Math.PI * 2 - difference)
}

function minimumPairDistance(points: readonly { x: number; z: number }[]): number {
  let minimum = Number.POSITIVE_INFINITY
  for (let left = 0; left < points.length; left += 1) {
    for (let right = left + 1; right < points.length; right += 1) {
      minimum = Math.min(minimum, Math.hypot(
        points[left].x - points[right].x,
        points[left].z - points[right].z,
      ))
    }
  }
  return Number.isFinite(minimum) ? minimum : 0
}

function minimumBearingSeparation(origin: { x: number; z: number }, points: readonly { x: number; z: number }[]): number {
  const bearings = points.map((point) => Math.atan2(point.z - origin.z, point.x - origin.x))
  let minimum = Number.POSITIVE_INFINITY
  for (let left = 0; left < bearings.length; left += 1) {
    for (let right = left + 1; right < bearings.length; right += 1) {
      minimum = Math.min(minimum, angleDifference(bearings[left], bearings[right]))
    }
  }
  return Number.isFinite(minimum) ? minimum : 0
}

function signatureFor(layout: RegionalMissionLayout): LayoutSignature {
  const guardHistogram = Array.from({ length: 25 }, () => 0)
  for (const position of layout.guardPositions) guardHistogram[regionCellIndexAt(position)] += 1
  return {
    campCell: layout.campfireCell.index,
    objectiveCell: layout.objectiveCell.index,
    crossingZs: layout.crossingPositions.map(({ z }) => z).sort((left, right) => left - right),
    guardHistogram,
    cacheCells: [...new Set(layout.bowCachePositions.map(regionCellIndexAt))].sort((left, right) => left - right),
  }
}

function cellDistance(left: number, right: number): number {
  const leftRow = Math.floor(left / 5)
  const leftColumn = left % 5
  const rightRow = Math.floor(right / 5)
  const rightColumn = right % 5
  return (Math.abs(leftRow - rightRow) + Math.abs(leftColumn - rightColumn)) / 8
}

function jaccardDistance(left: readonly number[], right: readonly number[]): number {
  const leftSet = new Set(left)
  const rightSet = new Set(right)
  const union = new Set([...leftSet, ...rightSet])
  if (union.size === 0) return 0
  const intersection = [...leftSet].filter((value) => rightSet.has(value)).length
  return 1 - intersection / union.size
}

function signatureDistance(left: LayoutSignature, right: LayoutSignature): number {
  const anchorDistance = (cellDistance(left.campCell, right.campCell)
    + cellDistance(left.objectiveCell, right.objectiveCell)) / 2
  const crossingDistance = left.crossingZs.reduce((sum, value, index) => (
    sum + Math.abs(value - right.crossingZs[index]) / 134
  ), 0) / Math.max(1, left.crossingZs.length)
  const guardCount = Math.max(
    1,
    left.guardHistogram.reduce((sum, value) => sum + value, 0),
    right.guardHistogram.reduce((sum, value) => sum + value, 0),
  )
  const guardDistance = left.guardHistogram.reduce((sum, value, index) => (
    sum + Math.abs(value - right.guardHistogram[index])
  ), 0) / (guardCount * 2)
  return clamp01((anchorDistance + crossingDistance + guardDistance
    + jaccardDistance(left.cacheCells, right.cacheCells)) / 4)
}

function noveltyScore(layout: RegionalMissionLayout, references: readonly RegionalMissionLayout[]): number {
  if (references.length === 0) return 0.5
  const signature = signatureFor(layout)
  return Math.min(...references.map((reference) => signatureDistance(signature, signatureFor(reference))))
}

function qualityFingerprint(layout: RegionalMissionLayout, vector: MapQualityVector): string {
  const signature = signatureFor(layout)
  const hash = stableSeed(JSON.stringify({ signature, vector }))
  return `mapq1:${hash.toString(16).padStart(8, "0")}`
}

/**
 * Scores experience tradeoffs only after the hard feasibility gate passes.
 * Every dimension is normalized independently; consumers must not collapse the
 * vector into a hidden weighted total.
 */
export function evaluateRegionalMapQuality(
  regional: RegionalizedMission,
  options: RegionalMapQualityOptions = {},
): RegionalMapQualityResult {
  const feasibility = validateRegionalMissionFeasibility(regional)
  if (!feasibility.feasible) throw new MapQualityEvaluationError(feasibility)

  const { layout } = regional
  const world = composeSherwoodWorld(layout)
  const roadGraph = buildRoadGraph(world.roads)
  const objectiveRoadCost = shortestRoadDistance(roadGraph, layout.campfirePosition, layout.objectivePosition)
  const playerObjectivePathCosts = layout.playerSpawns.map((spawn) => (
    Math.hypot(spawn.x - layout.campfirePosition.x, spawn.z - layout.campfirePosition.z) + objectiveRoadCost
  ))
  const pathCostSpread = spread(playerObjectivePathCosts)
  const traversalFairness = clamp01(1 - pathCostSpread / 12)

  const crossingObjectivePathCosts = layout.crossingPositions.map((crossing) => (
    Math.hypot(crossing.x - layout.campfirePosition.x, crossing.z - layout.campfirePosition.z)
      + Math.hypot(layout.objectivePosition.x - crossing.x, layout.objectivePosition.z - crossing.z)
  ))
  const crossingSeparation = Math.hypot(
    layout.crossingPositions[0].x - layout.crossingPositions[1].x,
    layout.crossingPositions[0].z - layout.crossingPositions[1].z,
  )
  const routeBalance = Math.min(...crossingObjectivePathCosts) / Math.max(...crossingObjectivePathCosts)
  const routeChoice = clamp01(clamp01(crossingSeparation / 52) * 0.55 + routeBalance * 0.45)

  const cacheGuardClearances = layout.bowCachePositions.map((cache) => Math.min(
    ...layout.guardPositions.map((guard) => Math.hypot(cache.x - guard.x, cache.z - guard.z)),
  ))
  const cacheRoadDetours = layout.bowCachePositions.map((cache) => distanceToRoad(cache, world.roads))
  const nondominatedCacheCount = countNondominatedCaches(cacheGuardClearances, cacheRoadDetours)
  const riskRewardDistribution = clamp01(
    clamp01(spread(cacheGuardClearances) / 28) * 0.35
      + clamp01(spread(cacheRoadDetours) / 22) * 0.3
      + (nondominatedCacheCount / Math.max(1, layout.bowCachePositions.length)) * 0.35,
  )

  const missionVector = {
    x: layout.objectivePosition.x - layout.campfirePosition.x,
    z: layout.objectivePosition.z - layout.campfirePosition.z,
  }
  const missionLength = Math.max(0.001, Math.hypot(missionVector.x, missionVector.z))
  const guardProgress = layout.guardPositions.map((guard) => clamp01(
    ((guard.x - layout.campfirePosition.x) * missionVector.x
      + (guard.z - layout.campfirePosition.z) * missionVector.z) / (missionLength * missionLength),
  ))
  const guardProgressBins = [...new Set(guardProgress.map((value) => Math.min(3, Math.floor(value * 4))))].sort()
  const openingGuardClearance = Math.min(...layout.guardPositions.map((guard) => Math.hypot(
    guard.x - layout.campfirePosition.x,
    guard.z - layout.campfirePosition.z,
  )))
  const pacingShape = clamp01(
    clamp01((openingGuardClearance - 10) / 20) * 0.45
      + (guardProgressBins.length / 4) * 0.35
      + clamp01(new Set(layout.guardPositions.map(regionCellIndexAt)).size / 7) * 0.2,
  )

  const landmarkPoints = [
    layout.objectivePosition,
    ...layout.crossingPositions,
    ...world.settlements.map((settlement) => settlement.center),
  ]
  const landmarkMinimumSeparation = minimumPairDistance([layout.campfirePosition, ...landmarkPoints])
  const landmarkBearingSeparation = minimumBearingSeparation(layout.campfirePosition, landmarkPoints)
  const landmarkLegibility = clamp01(
    clamp01(landmarkMinimumSeparation / 12) * 0.6
      + clamp01(landmarkBearingSeparation / (Math.PI / 6)) * 0.4,
  )

  const occupiedGuardCells = new Set(layout.guardPositions.map(regionCellIndexAt)).size
  const occupiedCacheCells = new Set(layout.bowCachePositions.map(regionCellIndexAt)).size
  const riverSides = new Set(layout.bowCachePositions.map((position) => (
    Math.sign(position.x - 1 + 0.1 * position.z)
  ))).size
  const cooperationCoverage = clamp01(
    clamp01(crossingSeparation / 52) * 0.3
      + clamp01(occupiedGuardCells / 7) * 0.25
      + clamp01(occupiedCacheCells / 4) * 0.25
      + clamp01(riverSides / 2) * 0.2,
  )

  const references = options.referenceLayouts ?? []
  const vector: MapQualityVector = {
    traversalFairness: rounded(traversalFairness),
    routeChoice: rounded(routeChoice),
    riskRewardDistribution: rounded(riskRewardDistribution),
    pacingShape: rounded(pacingShape),
    landmarkLegibility: rounded(landmarkLegibility),
    cooperationCoverage: rounded(cooperationCoverage),
    novelty: rounded(noveltyScore(layout, references)),
  }
  const evidence: MapQualityEvidence = {
    playerObjectivePathCosts: playerObjectivePathCosts.map((value) => Math.round(value * 1_000) / 1_000),
    crossingObjectivePathCosts: crossingObjectivePathCosts.map((value) => Math.round(value * 1_000) / 1_000),
    crossingSeparation: Math.round(crossingSeparation * 1_000) / 1_000,
    cacheGuardClearances: cacheGuardClearances.map((value) => Math.round(value * 1_000) / 1_000),
    cacheRoadDetours: cacheRoadDetours.map((value) => Math.round(value * 1_000) / 1_000),
    nondominatedCacheCount,
    guardProgressBins,
    openingGuardClearance: Math.round(openingGuardClearance * 1_000) / 1_000,
    landmarkMinimumSeparation: Math.round(landmarkMinimumSeparation * 1_000) / 1_000,
    landmarkBearingSeparation: Math.round(landmarkBearingSeparation * 1_000_000) / 1_000_000,
    occupiedGuardCells,
    occupiedCacheCells,
    referenceCount: references.length,
  }
  return {
    vector,
    evidence,
    fingerprint: qualityFingerprint(layout, vector),
    feasibility,
  }
}

export function dominatesMapQuality(left: MapQualityVector, right: MapQualityVector): boolean {
  return MAP_QUALITY_DIMENSIONS.every((dimension) => left[dimension] + QUALITY_EPSILON >= right[dimension])
    && MAP_QUALITY_DIMENSIONS.some((dimension) => left[dimension] > right[dimension] + QUALITY_EPSILON)
}

/** Retains candidates whose quality tradeoff is not dominated by another candidate. */
export function selectNondominatedMapCandidates<T extends MapQualityCandidate>(candidates: readonly T[]): T[] {
  return candidates.filter((candidate, index) => !candidates.some((other, otherIndex) => (
    index !== otherIndex && dominatesMapQuality(other.quality, candidate.quality)
  )))
}
