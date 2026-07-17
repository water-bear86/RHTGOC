import type { MissionDefinition } from "./mission-definition"
import type { RegionalizedMission, RegionalMissionLayout } from "./regional-layout"
import {
  SHERWOOD_PLAYER_RADIUS,
  isSherwoodPlayerPositionBlocked,
  resolveSherwoodPlayerMovement,
  type XzPoint,
} from "./world-collisions"
import { composeSherwoodWorld, type ComposedRoad } from "./world-composer"

export const MAP_FEASIBILITY_DIAGNOSTIC_CODES = [
  "invalid_world_bounds",
  "world_composition_failed",
  "anchor_out_of_bounds",
  "anchor_blocked",
  "unsafe_spawn",
  "interaction_out_of_bounds",
  "interaction_blocked",
  "crossing_blocked",
  "road_segment_blocked",
  "objective_unreachable",
  "crossing_unreachable",
] as const

export type MapFeasibilityDiagnosticCode = typeof MAP_FEASIBILITY_DIAGNOSTIC_CODES[number]

export interface MapFeasibilityDiagnostic {
  code: MapFeasibilityDiagnosticCode
  subject: string
  position?: XzPoint
  detail?: string
}

export interface MapFeasibilityResult {
  feasible: boolean
  diagnostics: MapFeasibilityDiagnostic[]
  checkedPositions: number
  checkedRoadSegments: number
}

interface NamedPosition {
  subject: string
  position: XzPoint
}

interface RoadNetworkResult {
  checkedSegments: number
  invalidRoadIds: Set<string>
  reachableRoadIds: Set<string>
}

const ROAD_ENDPOINT_EPSILON = 0.25
const ROAD_SEGMENT_EPSILON = 0.035

function copyPoint(position: XzPoint): XzPoint {
  return { x: position.x, z: position.z }
}

function withinWorldBounds(position: XzPoint, worldBounds: number): boolean {
  const limit = worldBounds - SHERWOOD_PLAYER_RADIUS
  return Number.isFinite(position.x)
    && Number.isFinite(position.z)
    && Math.abs(position.x) <= limit
    && Math.abs(position.z) <= limit
}

function missionInteractions(definition: MissionDefinition, layout: RegionalMissionLayout): NamedPosition[] {
  const interactions: NamedPosition[] = [
    { subject: "reinforcement-signal", position: definition.spawns.reinforcementSignal },
    ...layout.bowCachePositions.map((position, index) => ({ subject: `bow-cache:${index}`, position })),
    ...definition.routes.entry.map((route) => ({ subject: `entry-route:${route.id}`, position: route.position })),
    ...definition.routes.escape.map((route) => ({ subject: `escape-route:${route.id}`, position: route.position })),
  ]

  if (definition.scenario?.kind === "prison-wagon") {
    interactions.push(...definition.scenario.wagonPath.map((position, index) => ({
      subject: `wagon-path:${index}`,
      position,
    })))
  }
  if (definition.scenario?.kind === "storehouse") {
    interactions.push(
      ...definition.scenario.alarmPanels.map((panel) => ({
        subject: `alarm-panel:${panel.id}`,
        position: panel.position,
      })),
      ...definition.scenario.lootCaches.map((cache) => ({
        subject: `loot-cache:${cache.id}`,
        position: cache.position,
      })),
      { subject: "disguise", position: definition.scenario.disguisePosition },
    )
  }
  return interactions
}

function endpointsTouch(left: ComposedRoad, right: ComposedRoad): boolean {
  const leftEndpoints = [left.points[0], left.points[left.points.length - 1]]
  const rightEndpoints = [right.points[0], right.points[right.points.length - 1]]
  return leftEndpoints.some((leftPoint) => rightEndpoints.some((rightPoint) => (
    Math.hypot(leftPoint.x - rightPoint.x, leftPoint.z - rightPoint.z) <= ROAD_ENDPOINT_EPSILON
  )))
}

function roadTouchesPoint(road: ComposedRoad, position: XzPoint): boolean {
  return [road.points[0], road.points[road.points.length - 1]].some((endpoint) => (
    Math.hypot(endpoint.x - position.x, endpoint.z - position.z) <= ROAD_ENDPOINT_EPSILON
  ))
}

function inspectRoadNetwork(
  roads: readonly ComposedRoad[],
  layout: RegionalMissionLayout,
  worldBounds: number,
  diagnostics: MapFeasibilityDiagnostic[],
): RoadNetworkResult {
  let checkedSegments = 0
  const invalidRoadIds = new Set<string>()
  for (const road of roads) {
    for (let index = 1; index < road.points.length; index += 1) {
      checkedSegments += 1
      const start = road.points[index - 1]
      const end = road.points[index]
      if (isSherwoodPlayerPositionBlocked(start, SHERWOOD_PLAYER_RADIUS, layout)
        || isSherwoodPlayerPositionBlocked(end, SHERWOOD_PLAYER_RADIUS, layout)) {
        invalidRoadIds.add(road.id)
        diagnostics.push({
          code: "road_segment_blocked",
          subject: `${road.id}:${index - 1}`,
          position: copyPoint(start),
          detail: "road sample overlaps authoritative collision",
        })
        continue
      }
      const resolved = resolveSherwoodPlayerMovement(
        start,
        { x: end.x - start.x, z: end.z - start.z },
        worldBounds,
        SHERWOOD_PLAYER_RADIUS,
        layout,
      )
      if (Math.hypot(resolved.x - end.x, resolved.z - end.z) > ROAD_SEGMENT_EPSILON) {
        invalidRoadIds.add(road.id)
        diagnostics.push({
          code: "road_segment_blocked",
          subject: `${road.id}:${index - 1}`,
          position: copyPoint(start),
          detail: "authoritative movement cannot traverse road segment",
        })
      }
    }
  }

  const campRoads = roads.filter((road) => !invalidRoadIds.has(road.id) && roadTouchesPoint(road, layout.campfirePosition))
  const reachableRoadIds = new Set(campRoads.map((road) => road.id))
  const queue = [...campRoads]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const candidate of roads) {
      if (invalidRoadIds.has(candidate.id) || reachableRoadIds.has(candidate.id)) continue
      if (!endpointsTouch(current, candidate)) continue
      reachableRoadIds.add(candidate.id)
      queue.push(candidate)
    }
  }
  return { checkedSegments, invalidRoadIds, reachableRoadIds }
}

function hasReachableRoad(
  roads: readonly ComposedRoad[],
  network: RoadNetworkResult,
  position: XzPoint,
): boolean {
  return roads.some((road) => network.reachableRoadIds.has(road.id) && roadTouchesPoint(road, position))
}

/**
 * Validates the hard promotion boundary for a generated regional mission.
 *
 * This deliberately reports deterministic, machine-readable diagnostics rather
 * than repairing or rerolling a layout. Candidate selection lives in the
 * generator wrapper so tests, tools, clients, and servers share the same rule.
 */
export function validateRegionalMissionFeasibility(regional: RegionalizedMission): MapFeasibilityResult {
  const { definition, layout } = regional
  const diagnostics: MapFeasibilityDiagnostic[] = []
  let checkedPositions = 0
  const worldBounds = definition.rules.worldBounds
  if (!Number.isFinite(worldBounds) || worldBounds <= SHERWOOD_PLAYER_RADIUS) {
    diagnostics.push({ code: "invalid_world_bounds", subject: "mission", detail: String(worldBounds) })
    return { feasible: false, diagnostics, checkedPositions, checkedRoadSegments: 0 }
  }

  // Collision construction also consumes the composed settlement and road
  // layout. Establish that composition succeeds before any position check can
  // indirectly request those colliders.
  let roads: readonly ComposedRoad[]
  try {
    roads = composeSherwoodWorld(layout).roads
  } catch (error) {
    diagnostics.push({
      code: "world_composition_failed",
      subject: "world",
      detail: error instanceof Error ? error.message : String(error),
    })
    return { feasible: false, diagnostics, checkedPositions, checkedRoadSegments: 0 }
  }

  const checkPosition = (
    named: NamedPosition,
    outOfBoundsCode: MapFeasibilityDiagnosticCode,
    blockedCode: MapFeasibilityDiagnosticCode,
  ): void => {
    checkedPositions += 1
    if (!withinWorldBounds(named.position, worldBounds)) {
      diagnostics.push({
        code: outOfBoundsCode,
        subject: named.subject,
        position: copyPoint(named.position),
      })
      return
    }
    if (isSherwoodPlayerPositionBlocked(named.position, SHERWOOD_PLAYER_RADIUS, layout)) {
      diagnostics.push({
        code: blockedCode,
        subject: named.subject,
        position: copyPoint(named.position),
      })
    }
  }

  checkPosition({ subject: "campfire", position: layout.campfirePosition }, "anchor_out_of_bounds", "anchor_blocked")
  checkPosition({ subject: "objective", position: layout.objectivePosition }, "anchor_out_of_bounds", "anchor_blocked")
  definition.spawns.players.forEach((position, index) => {
    checkPosition({ subject: `player:${index}`, position }, "unsafe_spawn", "unsafe_spawn")
  })
  layout.crossingPositions.forEach((position, index) => {
    checkPosition({ subject: `crossing:${index}`, position }, "crossing_blocked", "crossing_blocked")
  })
  for (const interaction of missionInteractions(definition, layout)) {
    checkPosition(interaction, "interaction_out_of_bounds", "interaction_blocked")
  }

  const network = inspectRoadNetwork(roads, layout, worldBounds, diagnostics)
  if (!hasReachableRoad(roads, network, layout.objectivePosition)) {
    diagnostics.push({ code: "objective_unreachable", subject: "objective", position: copyPoint(layout.objectivePosition) })
  }
  layout.crossingPositions.forEach((position, index) => {
    if (!hasReachableRoad(roads, network, position)) {
      diagnostics.push({ code: "crossing_unreachable", subject: `crossing:${index}`, position: copyPoint(position) })
    }
  })

  return {
    feasible: diagnostics.length === 0,
    diagnostics,
    checkedPositions,
    checkedRoadSegments: network.checkedSegments,
  }
}
