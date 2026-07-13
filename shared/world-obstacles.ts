import {
  SHERWOOD_REGIONAL_BOUNDS,
  riverPointAt,
  type RegionalMissionLayout,
} from "./regional-layout"
import { SHERWOOD_TREE_LAYOUT } from "./world-layout"

export interface SherwoodObstacle {
  id: string
  center: { x: number; z: number }
  halfExtents: { x: number; z: number }
  rotation: number
}

export const SHERWOOD_RIVER_HALF_WIDTH = 3.5
export const SHERWOOD_CROSSING_HALF_LENGTH = 3.4

export const VILLAGE_COTTAGE_OBSTACLE: SherwoodObstacle = Object.freeze({
  id: "sherwood-village-cottage",
  center: Object.freeze({ x: -10, z: 14 }),
  halfExtents: Object.freeze({ x: 2.75, z: 3 }),
  rotation: -0.55,
})

export const SHERWOOD_TREE_OBSTACLES: readonly SherwoodObstacle[] = Object.freeze(
  SHERWOOD_TREE_LAYOUT.map((tree, index) => Object.freeze({
    id: `sherwood-tree-${index}`,
    center: Object.freeze({ x: tree.x, z: tree.z }),
    halfExtents: Object.freeze({ x: 0.3 * tree.scale, z: 0.3 * tree.scale }),
    rotation: 0,
  })),
)

export const SHERWOOD_STATIC_OBSTACLES: readonly SherwoodObstacle[] = Object.freeze([
  VILLAGE_COTTAGE_OBSTACLE,
  ...SHERWOOD_TREE_OBSTACLES,
])

/** River spans are solid except for the two authored crossing apertures. */
export function createSherwoodRiverObstacles(
  layout: Pick<RegionalMissionLayout, "crossingPositions">,
): SherwoodObstacle[] {
  const crossingZs = layout.crossingPositions.map(({ z }) => z).sort((left, right) => left - right)
  const boundaries = [
    -SHERWOOD_REGIONAL_BOUNDS,
    crossingZs[0] - SHERWOOD_CROSSING_HALF_LENGTH,
    crossingZs[0] + SHERWOOD_CROSSING_HALF_LENGTH,
    crossingZs[1] - SHERWOOD_CROSSING_HALF_LENGTH,
    crossingZs[1] + SHERWOOD_CROSSING_HALF_LENGTH,
    SHERWOOD_REGIONAL_BOUNDS,
  ]
  const spans = [
    [boundaries[0], boundaries[1]],
    [boundaries[2], boundaries[3]],
    [boundaries[4], boundaries[5]],
  ]
  return spans.flatMap(([start, end], index) => {
    if (end - start < 0.1) return []
    const centerZ = (start + end) / 2
    return [{
      id: `sherwood-river-${index}`,
      center: riverPointAt(centerZ),
      halfExtents: { x: SHERWOOD_RIVER_HALF_WIDTH, z: (end - start) / 2 },
      rotation: -0.1,
    }]
  })
}

function toObstacleLocal(
  point: { x: number; z: number },
  obstacle: SherwoodObstacle,
): { x: number; z: number } {
  const cosine = Math.cos(obstacle.rotation)
  const sine = Math.sin(obstacle.rotation)
  const x = point.x - obstacle.center.x
  const z = point.z - obstacle.center.z
  return {
    x: cosine * x - sine * z,
    z: sine * x + cosine * z,
  }
}

export function isPointInsideSherwoodObstacle(
  point: { x: number; z: number },
  obstacle: SherwoodObstacle,
  clearance = 0,
): boolean {
  const local = toObstacleLocal(point, obstacle)
  return Math.abs(local.x) <= obstacle.halfExtents.x + clearance
    && Math.abs(local.z) <= obstacle.halfExtents.z + clearance
}

/** Exact segment-vs-expanded-rectangle test used by deterministic road routing. */
export function isSegmentBlockedBySherwoodObstacle(
  start: { x: number; z: number },
  end: { x: number; z: number },
  obstacle: SherwoodObstacle,
  clearance = 0,
): boolean {
  const localStart = toObstacleLocal(start, obstacle)
  const localEnd = toObstacleLocal(end, obstacle)
  const movement = { x: localEnd.x - localStart.x, z: localEnd.z - localStart.z }
  const halfExtents = {
    x: obstacle.halfExtents.x + clearance,
    z: obstacle.halfExtents.z + clearance,
  }
  let near = 0
  let far = 1
  for (const axis of ["x", "z"] as const) {
    if (Math.abs(movement[axis]) < 1e-9) {
      if (Math.abs(localStart[axis]) > halfExtents[axis]) return false
      continue
    }
    const first = (-halfExtents[axis] - localStart[axis]) / movement[axis]
    const second = (halfExtents[axis] - localStart[axis]) / movement[axis]
    near = Math.max(near, Math.min(first, second))
    far = Math.min(far, Math.max(first, second))
    if (near > far) return false
  }
  return far >= 0 && near <= 1
}
