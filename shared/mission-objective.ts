import type { MissionKind } from "./protocol"

export interface MissionObjectiveState {
  missionKind: MissionKind
  layout: { objectivePosition: { x: number; z: number } }
  cartPosition: { x: number; z: number }
}

/**
 * Returns the authoritative objective anchor for discovery and navigation.
 * Prison wagons move after mission creation, while the other mission anchors
 * remain fixed at the regional objective position.
 */
export function missionObjectivePosition(mission: MissionObjectiveState): { x: number; z: number } {
  return mission.missionKind === "prison-wagon"
    ? mission.cartPosition
    : mission.layout.objectivePosition
}
