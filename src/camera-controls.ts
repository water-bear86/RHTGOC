import type { Vec2 } from "./simulation"

export const CAMERA_QUARTER_TURN = Math.PI / 2

export interface CharacterCoverQuery {
  camera: Vec2
  focus: Vec2
  occluder: Vec2
  radius: number
  bodyDepth?: number
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
 * character can become a readable silhouette through the forest. Two
 * conditions keep the trigger honest:
 *
 * - The cover's centre must sit strictly between the camera and the character.
 *   A crown the character has already reached (projection at or beyond the
 *   character) hangs overhead rather than in front, so it is not cover.
 * - The cover must actually reach the character's body, measured to a point one
 *   body-depth toward the camera from the character's feet. A crown that merely
 *   crosses the corridor further ahead never hides the outlaw behind it.
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

  const bodyDepth = Math.max(0, query.bodyDepth ?? 0.55)
  const bodyX = query.focus.x - (cameraToFocusX / corridorLength) * bodyDepth
  const bodyZ = query.focus.z - (cameraToFocusZ / corridorLength) * bodyDepth
  return Math.hypot(query.occluder.x - bodyX, query.occluder.z - bodyZ) < query.radius
}
