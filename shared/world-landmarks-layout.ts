import type { RegionalMissionLayout } from "./regional-layout"
import type { ComposedWorld } from "./world-composer"
import { SHERWOOD_SETTLEMENT_SITES } from "./world-topology"

export interface SherwoodStandingStonePlacement {
  x: number
  z: number
  rotation: number
  scaleX: number
  scaleY: number
  scaleZ: number
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

function distanceToRoads(point: { x: number; z: number }, world?: ComposedWorld): number {
  if (!world || world.roads.length === 0) return 30
  return Math.min(...world.roads.flatMap((road) => road.points.slice(1).map((end, index) => (
    distanceToSegment(point, road.points[index], end) - road.width / 2
  ))))
}

export function chooseFarmPosition(
  layout: RegionalMissionLayout,
  world?: ComposedWorld,
): Readonly<{ x: number; z: number }> {
  const candidates = [
    { x: -48, z: -48 }, { x: 48, z: -48 }, { x: -48, z: 48 }, { x: 48, z: 48 },
  ]
  const hazards = [
    layout.campfirePosition,
    layout.objectivePosition,
    ...layout.crossingPositions,
    ...(world?.settlements.map(({ center }) => center) ?? []),
  ]
  return candidates.sort((left, right) => {
    const score = (point: { x: number; z: number }): number => Math.min(
      distanceToRoads(point, world),
      ...hazards.map((hazard) => Math.hypot(point.x - hazard.x, point.z - hazard.z)),
    )
    return score(right) - score(left)
  })[0]
}

export function chooseStoneCirclePosition(
  layout: RegionalMissionLayout,
  world: ComposedWorld | undefined,
  farmPosition: Readonly<{ x: number; z: number }>,
): Readonly<{ x: number; z: number }> {
  const usedSettlements = new Set(world?.settlements.map(({ center }) => `${center.x}:${center.z}`) ?? [])
  const hazards = [layout.campfirePosition, layout.objectivePosition, farmPosition]
  const candidates = SHERWOOD_SETTLEMENT_SITES.filter((site) => (
    !usedSettlements.has(`${site.center.x}:${site.center.z}`)
    && hazards.every((hazard) => Math.hypot(site.center.x - hazard.x, site.center.z - hazard.z) > 15)
    && distanceToRoads(site.center, world) > 5.5
  ))
  const available = candidates.length > 0
    ? candidates
    : SHERWOOD_SETTLEMENT_SITES.filter((site) => !usedSettlements.has(`${site.center.x}:${site.center.z}`))
  return { ...[...available].sort((left, right) => {
    const score = (point: { x: number; z: number }): number => Math.min(
      distanceToRoads(point, world),
      ...hazards.map((hazard) => Math.hypot(point.x - hazard.x, point.z - hazard.z)),
    )
    return score(right.center) - score(left.center) || left.id.localeCompare(right.id)
  })[0].center }
}

export function createSherwoodStandingStoneLayout(
  layout: RegionalMissionLayout,
  world?: ComposedWorld,
): Readonly<{ center: Readonly<{ x: number; z: number }>; stones: readonly SherwoodStandingStonePlacement[] }> {
  const farmPosition = chooseFarmPosition(layout, world)
  const center = chooseStoneCirclePosition(layout, world, farmPosition)
  const stones = Array.from({ length: 7 }, (_, index) => {
    const angle = index / 7 * Math.PI * 2
    return Object.freeze({
      x: center.x + Math.cos(angle) * 3.1,
      z: center.z + Math.sin(angle) * 3.1,
      rotation: angle + 0.4,
      scaleX: 0.65,
      scaleY: 1.8 + (index % 3) * 0.25,
      scaleZ: 0.55,
    })
  })
  return Object.freeze({ center: Object.freeze({ ...center }), stones: Object.freeze(stones) })
}
