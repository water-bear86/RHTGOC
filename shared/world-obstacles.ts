import {
  SHERWOOD_REGIONAL_BOUNDS,
  riverPointAt,
  type RegionalMissionLayout,
} from "./regional-layout"
import { SHERWOOD_RIDGE_ROCK_LAYOUT, SHERWOOD_TREE_LAYOUT } from "./world-layout"

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

/**
 * Insets the box proxy into the irregular dodecahedron while the player radius
 * covers its visible edge, avoiding both walk-throughs and an oversized wall.
 */
export const SHERWOOD_RIDGE_ROCK_OBSTACLES: readonly SherwoodObstacle[] = Object.freeze(
  SHERWOOD_RIDGE_ROCK_LAYOUT.map((rock, index) => Object.freeze({
    id: `sherwood-ridge-rock-${index}`,
    center: Object.freeze({ x: rock.x, z: rock.z }),
    halfExtents: Object.freeze({ x: rock.scale.x * 0.82, z: rock.scale.z * 0.82 }),
    rotation: rock.rotation,
  })),
)

export const SHERWOOD_STATIC_OBSTACLES: readonly SherwoodObstacle[] = Object.freeze([
  VILLAGE_COTTAGE_OBSTACLE,
  ...SHERWOOD_TREE_OBSTACLES,
])

/** Mission maps use generated settlements; the fixed cottage belongs only to the public camp hub. */
export const SHERWOOD_MISSION_STATIC_OBSTACLES: readonly SherwoodObstacle[] = SHERWOOD_TREE_OBSTACLES

export interface SherwoodRoadCorridor {
  width: number
  points: readonly { x: number; z: number }[]
}

/**
 * Keeps generated roads traversable by removing conflicting boulders from
 * both the renderer and runtime collision through one shared selection rule.
 */
export function selectSherwoodRidgeRockObstaclesForRoads(
  roads: readonly SherwoodRoadCorridor[],
): readonly SherwoodObstacle[] {
  return SHERWOOD_RIDGE_ROCK_OBSTACLES.filter((rock) => roads.every((road) => (
    road.points.slice(1).every((point, index) => !isSegmentBlockedBySherwoodObstacle(
      road.points[index],
      point,
      rock,
      road.width / 2 + 0.45 + 0.18,
    ))
  )))
}

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
