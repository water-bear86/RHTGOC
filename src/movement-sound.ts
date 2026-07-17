import type { AudioCueId } from "./audio-cues"
import type { ComposedRoad } from "../shared/world-composer"

export interface MovementSoundState {
  distanceSinceStep: number
}

export interface MovementSoundFrame {
  distance: number
  onRoad: boolean
  enabled: boolean
}

const STEP_DISTANCE = 1.25
const TELEPORT_DISTANCE = 3

export function createMovementSoundState(): MovementSoundState {
  return { distanceSinceStep: 0 }
}

export function advanceMovementSound(
  state: MovementSoundState,
  frame: MovementSoundFrame,
): AudioCueId | null {
  if (!frame.enabled || frame.distance <= 0 || frame.distance >= TELEPORT_DISTANCE) {
    state.distanceSinceStep = 0
    return null
  }
  state.distanceSinceStep += frame.distance
  if (state.distanceSinceStep < STEP_DISTANCE) return null
  state.distanceSinceStep %= STEP_DISTANCE
  return frame.onRoad ? "movement.footstep-road" : "movement.footstep-grass"
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

export function isPositionOnRoad(
  position: { x: number; z: number },
  roads: readonly ComposedRoad[],
): boolean {
  return roads.some((road) => road.points.slice(1).some((point, index) => (
    distanceToSegment(position, road.points[index], point) <= road.width / 2 + 0.35
  )))
}
