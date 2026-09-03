import type { RegionalMissionLayout } from "./regional-layout"
import { composeSherwoodWorld } from "./world-composer"
import { chooseFarmPosition, createSherwoodStandingStoneLayout } from "./world-landmarks-layout"

export interface SherwoodDressingExclusion {
  x: number
  z: number
  radius: number
}

export interface SherwoodDressingRoad {
  width: number
  points: readonly { x: number; z: number }[]
}

export interface SherwoodForestRockPlacement {
  x: number
  z: number
  rotation: number
  scaleX: number
  scaleY: number
  scaleZ: number
}

function seededRandom(seed: number): () => number {
  let value = (seed >>> 0) || 1
  return () => {
    value = value * 16807 % 2147483647
    return (value - 1) / 2147483646
  }
}

function distanceToSegment(
  point: { x: number; z: number },
  start: { x: number; z: number },
  end: { x: number; z: number },
): number {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-9) return Math.hypot(point.x - start.x, point.z - start.z)
  const amount = Math.max(0, Math.min(1, (
    (point.x - start.x) * dx + (point.z - start.z) * dz
  ) / lengthSquared))
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.z - (start.z + dz * amount),
  )
}

function clearOfExclusions(x: number, z: number, exclusions: readonly SherwoodDressingExclusion[]): boolean {
  return exclusions.every((area) => Math.hypot(x - area.x, z - area.z) >= area.radius)
}

function clearOfRoads(x: number, z: number, roads: readonly SherwoodDressingRoad[], margin: number): boolean {
  return roads.every((road) => road.points.slice(1).every((point, index) => (
    distanceToSegment({ x, z }, road.points[index], point) >= road.width / 2 + margin
  )))
}

export function createSherwoodMissionDressingExclusions(layout: RegionalMissionLayout): {
  exclusions: readonly SherwoodDressingExclusion[]
  roads: readonly SherwoodDressingRoad[]
} {
  const world = composeSherwoodWorld(layout)
  const farmPosition = chooseFarmPosition(layout, world)
  const stoneCircle = createSherwoodStandingStoneLayout(layout, world)
  return {
    roads: world.roads,
    exclusions: [
      { ...layout.campfirePosition, radius: 10 },
      { ...layout.objectivePosition, radius: 10 },
      { ...layout.objectiveGateKeyPosition, radius: 4 },
      ...layout.crossingPositions.map((position) => ({ ...position, radius: 6 })),
      ...world.settlements.map((settlement) => ({ ...settlement.center, radius: 12.5 })),
      ...world.settlements.flatMap((settlement) => settlement.buildings.map((building) => ({
        ...building.position,
        radius: Math.hypot(building.halfExtents.x, building.halfExtents.z) + 1.8,
      }))),
      { ...farmPosition, radius: 17 },
      { ...stoneCircle.center, radius: 6.5 },
    ],
  }
}

/** Shared by rendering and authoritative collision; pebbles remain visual-only. */
export function createSherwoodMissionForestRockLayout(
  layout: RegionalMissionLayout,
): readonly SherwoodForestRockPlacement[] {
  const { exclusions, roads } = createSherwoodMissionDressingExclusions(layout)
  const random = seededRandom((layout.seed ^ 0x524f434b) >>> 0)
  const centers: Array<{ x: number; z: number }> = []
  let attempts = 0
  while (centers.length < 7 && attempts < 560) {
    attempts += 1
    const x = random() * 116 - 58
    const z = random() * 116 - 58
    if (Math.abs(x - 1 + z * 0.1) < 5.8
      || !clearOfExclusions(x, z, exclusions)
      || !clearOfRoads(x, z, roads, 4.2)
      || centers.some((center) => Math.hypot(x - center.x, z - center.z) < 8)) continue
    centers.push({ x, z })
  }

  const rocks: SherwoodForestRockPlacement[] = []
  attempts = 0
  while (rocks.length < 14 && attempts < 336 && centers.length > 0) {
    attempts += 1
    const center = centers[Math.floor(random() * centers.length)]
    const angle = random() * Math.PI * 2
    const radius = Math.sqrt(random()) * 3.5
    const x = center.x + Math.cos(angle) * radius
    const z = center.z + Math.sin(angle) * radius
    if (Math.abs(x) > 62 || Math.abs(z) > 62
      || !clearOfExclusions(x, z, exclusions)
      || !clearOfRoads(x, z, roads, 2.4)) continue
    const scale = 0.7 + random() * 0.55
    rocks.push(Object.freeze({
      x,
      z,
      rotation: random() * Math.PI * 2,
      scaleX: scale,
      scaleY: scale * (0.84 + random() * 0.35),
      scaleZ: scale,
    }))
  }
  return Object.freeze(rocks)
}
