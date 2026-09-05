import type { Vec2 } from "./simulation"
import { SHERWOOD_TREE_LAYOUT } from "../shared/world-layout"
import { createAuthoredTreePlacements } from "./tree-placements"
import { sherwoodHeightAt } from "./sherwood-terrain"

export const CAMERA_QUARTER_TURN = Math.PI / 2

export interface CharacterCoverQuery {
  camera: Vec2
  focus: Vec2
  occluder: Vec2
  radius: number
  cameraHeight?: number
  focusHeight?: number
  occluderBaseHeight?: number
  occluderHeight?: number
}

const AUTHORED_TREE_VERTICALS = createAuthoredTreePlacements(SHERWOOD_TREE_LAYOUT).map((tree) => ({
  x: tree.x,
  z: tree.z,
  radius: tree.visualRadius,
  baseHeight: sherwoodHeightAt(tree.x, tree.z),
  height: tree.height,
}))

function authoredTreeVerticals(query: CharacterCoverQuery): { baseHeight: number; height: number } | null {
  const tree = AUTHORED_TREE_VERTICALS.find((candidate) => (
    Math.abs(candidate.x - query.occluder.x) < 0.0001
    && Math.abs(candidate.z - query.occluder.z) < 0.0001
    && Math.abs(candidate.radius - query.radius) < 0.0001
  ))
  return tree ? { baseHeight: tree.baseHeight, height: tree.height } : null
}

export function rotateCameraOffset(offset: Vec2, quarterTurns: number): Vec2 {
  const angle = quarterTurns * CAMERA_QUARTER_TURN
  const cosine = Math.cos(angle)
  const sine = Math.sin(angle)
  return {
    x: offset.x * cosine + offset.z * sine,
    z: -offset.x * sine + offset.z * cosine,
  }
}

/** Chooses the closest quarter-turn that presents a route ahead of the player. */
export function cameraQuarterTurnsForRoute(offset: Vec2, routeDirection: Vec2): number {
  const routeLength = Math.hypot(routeDirection.x, routeDirection.z)
  if (routeLength <= 0.0001) return 0
  const direction = {
    x: routeDirection.x / routeLength,
    z: routeDirection.z / routeLength,
  }
  return [0, 1, 2, 3]
    .map((quarterTurns) => {
      const rotated = rotateCameraOffset(offset, quarterTurns)
      const cameraDistance = Math.max(0.0001, Math.hypot(rotated.x, rotated.z))
      const forward = { x: -rotated.x / cameraDistance, z: -rotated.z / cameraDistance }
      return { quarterTurns, alignment: forward.x * direction.x + forward.z * direction.z }
    })
    .sort((left, right) => right.alignment - left.alignment || left.quarterTurns - right.quarterTurns)[0]
    .quarterTurns
}

export function cameraRelativeMove(screenMove: Vec2, cameraPosition: Vec2, focus: Vec2): Vec2 {
  const forwardX = focus.x - cameraPosition.x
  const forwardZ = focus.z - cameraPosition.z
  const length = Math.hypot(forwardX, forwardZ)
  if (length <= 0.0001) return { ...screenMove }
  const normalizedForwardX = forwardX / length
  const normalizedForwardZ = forwardZ / length
  const rightX = -normalizedForwardZ
  const rightZ = normalizedForwardX
  return {
    x: rightX * screenMove.x - normalizedForwardX * screenMove.z,
    z: rightZ * screenMove.x - normalizedForwardZ * screenMove.z,
  }
}

/**
 * Decides whether scenery truly hides a character from the camera, so the
 * character can become a readable silhouette through the forest.
 *
 * The horizontal test rejects scenery that is not strictly between the camera
 * and character, whose footprint does not cross the sightline, or whose crown
 * does not reach the character in the ground plane. The proximity check keeps
 * a distant, wide crown from turning a character into a silhouette while they
 * are still standing in open ground. Authored trees additionally receive a
 * vertical test so the elevated camera does not treat every crown as an
 * infinitely tall cylinder.
 */
export function characterCoveredByScenery(query: CharacterCoverQuery): boolean {
  const cameraToFocusX = query.focus.x - query.camera.x
  const cameraToFocusZ = query.focus.z - query.camera.z
  const corridorLength = Math.hypot(cameraToFocusX, cameraToFocusZ)
  if (corridorLength <= 0.0001) return false

  const cameraToOccluderX = query.occluder.x - query.camera.x
  const cameraToOccluderZ = query.occluder.z - query.camera.z
  const projection = (
    cameraToOccluderX * cameraToFocusX
    + cameraToOccluderZ * cameraToFocusZ
  ) / (corridorLength * corridorLength)
  if (projection <= 0 || projection >= 1) return false

  const lateralDistance = Math.abs(
    cameraToOccluderX * cameraToFocusZ - cameraToOccluderZ * cameraToFocusX,
  ) / corridorLength
  if (lateralDistance >= query.radius) return false

  const playerToOccluderDistance = Math.hypot(
    query.occluder.x - query.focus.x,
    query.occluder.z - query.focus.z,
  )
  if (playerToOccluderDistance >= query.radius) return false

  const explicitVerticals = (
    query.cameraHeight !== undefined
    && query.focusHeight !== undefined
    && query.occluderBaseHeight !== undefined
    && query.occluderHeight !== undefined
  )
    ? {
        cameraHeight: query.cameraHeight,
        focusHeight: query.focusHeight,
        baseHeight: query.occluderBaseHeight,
        height: query.occluderHeight,
      }
    : null

  const treeVerticals = explicitVerticals ? null : authoredTreeVerticals(query)
  const verticals = explicitVerticals ?? (treeVerticals
    ? {
        cameraHeight: sherwoodHeightAt(query.focus.x, query.focus.z) + 14.5,
        focusHeight: sherwoodHeightAt(query.focus.x, query.focus.z) + 0.9,
        baseHeight: treeVerticals.baseHeight,
        height: treeVerticals.height,
      }
    : null)

  if (verticals) {
    const sightlineHeight = verticals.cameraHeight
      + (verticals.focusHeight - verticals.cameraHeight) * projection
    const occluderTop = verticals.baseHeight + verticals.height
    if (sightlineHeight < verticals.baseHeight || sightlineHeight > occluderTop) return false
  }

  return true
}
