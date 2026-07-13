import type { RegionalMissionLayout } from "./regional-layout"
import { SHERWOOD_TREE_LAYOUT } from "./world-layout"

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
}

export interface ComposedWorld {
  settlements: ComposedSettlement[]
  roads: ComposedRoad[]
  buildingCount: number
}

const composedWorldCache = new WeakMap<RegionalMissionLayout, ComposedWorld>()

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

function createSettlement(
  id: string,
  kind: SettlementKind,
  center: { x: number; z: number },
  count: number,
): ComposedSettlement {
  const buildings: ComposedBuilding[] = []
  for (let index = 0; index < count * 6 && buildings.length < count; index += 1) {
    const angle = index * 2.399963 + (kind === "sheriff-post" ? 0.4 : -0.25)
    const radius = 4.6 + (index % 3) * 2.2
    const position = { x: clamp(center.x + Math.cos(angle) * radius), z: clamp(center.z + Math.sin(angle) * radius) }
    const kindForBuilding = kind === "sheriff-post" && buildings.length === 0
      ? "watchtower"
      : buildings.length % 4 === 3 ? "barn" : "cottage"
    const halfExtents = kindForBuilding === "watchtower" ? { x: 1.45, z: 1.45 }
      : kindForBuilding === "barn" ? { x: 2.5, z: 1.75 }
        : { x: 1.9, z: 1.45 }
    if (!treeClear(position, Math.max(halfExtents.x, halfExtents.z) + 0.8)) continue
    const footprintRadius = Math.hypot(halfExtents.x, halfExtents.z)
    const overlapsBuilding = buildings.some((existing) => {
      const existingRadius = Math.hypot(existing.halfExtents.x, existing.halfExtents.z)
      return Math.hypot(position.x - existing.position.x, position.z - existing.position.z) < footprintRadius + existingRadius + 1.1
    })
    if (overlapsBuilding) continue
    buildings.push({ id: `${id}-building-${buildings.length}`, kind: kindForBuilding, position, halfExtents, rotation: angle + Math.PI / 2 })
  }
  return { id, kind, center, buildings }
}

function curvedRoad(id: string, start: { x: number; z: number }, end: { x: number; z: number }, bend: number, width = 2.8): ComposedRoad {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const length = Math.max(0.001, Math.hypot(dx, dz))
  const normal = { x: -dz / length, z: dx / length }
  return {
    id,
    width,
    points: Array.from({ length: 9 }, (_, index) => {
      const t = index / 8
      const offset = Math.sin(t * Math.PI) * bend
      return { x: start.x + dx * t + normal.x * offset, z: start.z + dz * t + normal.z * offset }
    }),
  }
}

/** Deterministic layout data consumed by both the renderer and authoritative collision. */
export function composeSherwoodWorld(layout: RegionalMissionLayout): ComposedWorld {
  const cached = composedWorldCache.get(layout)
  if (cached) return cached
  const villageCenter = inward(layout.campfirePosition, 12)
  const sheriffCenter = inward(layout.objectivePosition, 13)
  const hamletCandidates = [{ x: -34, z: -28 }, { x: 34, z: 28 }, { x: -34, z: 30 }, { x: 34, z: -30 }]
  const hamletCenter = hamletCandidates.sort((left, right) => {
    const score = (point: { x: number; z: number }): number => Math.min(
      Math.hypot(point.x - villageCenter.x, point.z - villageCenter.z),
      Math.hypot(point.x - sheriffCenter.x, point.z - sheriffCenter.z),
    )
    return score(right) - score(left)
  })[0]
  const settlements = [
    createSettlement("greenwood-village", "forest-village", villageCenter, 6),
    createSettlement("foresters-hamlet", "outlaw-hamlet", hamletCenter, 5),
    createSettlement("sheriff-road-post", "sheriff-post", sheriffCenter, 5),
  ]
  const nearestCrossing = (point: { x: number; z: number }): { x: number; z: number } => [...layout.crossingPositions]
    .sort((left, right) => Math.hypot(point.x - left.x, point.z - left.z) - Math.hypot(point.x - right.x, point.z - right.z))[0]
  const roads = [
    curvedRoad("camp-village-road", layout.campfirePosition, villageCenter, 2.5, 3.2),
    curvedRoad("village-ford-road", villageCenter, nearestCrossing(villageCenter), -5.5, 3.4),
    curvedRoad("sheriff-ford-road", nearestCrossing(sheriffCenter), sheriffCenter, 5, 3.4),
    curvedRoad("post-objective-road", sheriffCenter, layout.objectivePosition, -2.2, 3.2),
    curvedRoad("hamlet-track", hamletCenter, nearestCrossing(hamletCenter), 7.5, 2.15),
    curvedRoad("river-road", layout.crossingPositions[0], layout.crossingPositions[1], -8, 2.2),
  ]
  const world = { settlements, roads, buildingCount: settlements.reduce((sum, settlement) => sum + settlement.buildings.length, 0) }
  composedWorldCache.set(layout, world)
  return world
}
