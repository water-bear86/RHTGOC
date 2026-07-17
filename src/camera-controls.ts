import type { Vec2 } from "./simulation"

export const CAMERA_QUARTER_TURN = Math.PI / 2

export interface CameraSightlineQuery {
  camera: Vec2
  focus: Vec2
  occluder: Vec2
  radius: number
  clearance?: number
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
 * Keeps the controlled outlaw readable when a tree or structure overlaps the
 * camera-to-player corridor. The small endpoint allowance catches tree crowns
 * immediately behind the player without hiding unrelated scenery.
 */
export function blocksCameraSightline(query: CameraSightlineQuery): boolean {
  const cameraToFocusX = query.focus.x - query.camera.x
  const cameraToFocusZ = query.focus.z - query.camera.z
  const lengthSquared = cameraToFocusX ** 2 + cameraToFocusZ ** 2
  if (lengthSquared <= 0.0001) return false

  const cameraToOccluderX = query.occluder.x - query.camera.x
  const cameraToOccluderZ = query.occluder.z - query.camera.z
  const projection = (
    cameraToOccluderX * cameraToFocusX
    + cameraToOccluderZ * cameraToFocusZ
  ) / lengthSquared
  if (projection <= 0.04 || projection >= 1.08) return false

  const closestX = query.camera.x + cameraToFocusX * projection
  const closestZ = query.camera.z + cameraToFocusZ * projection
  const clearance = Math.max(0, query.clearance ?? 0.65)
  return Math.hypot(query.occluder.x - closestX, query.occluder.z - closestZ) < query.radius + clearance
}
