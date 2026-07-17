import type { MissionGuard } from "../shared/protocol"
import type { RegionalMissionLayout, RegionCell } from "../shared/regional-layout"
import type { GuardState } from "./simulation"

interface Position {
  x: number
  z: number
}

function positionsEqual(left: Position, right: Position): boolean {
  return left.x === right.x && left.z === right.z
}

function positionListsEqual(left: readonly Position[], right: readonly Position[]): boolean {
  return left.length === right.length && left.every((position, index) => positionsEqual(position, right[index]))
}

function regionCellsEqual(left: RegionCell, right: RegionCell): boolean {
  return left.index === right.index
    && left.row === right.row
    && left.column === right.column
    && positionsEqual(left.center, right.center)
}

function regionalMissionLayoutsEqual(left: RegionalMissionLayout, right: RegionalMissionLayout): boolean {
  if (left === right) return true
  return left.seed === right.seed
    && left.variant === right.variant
    && left.gridSize === right.gridSize
    && left.cellSize === right.cellSize
    && left.worldBounds === right.worldBounds
    && regionCellsEqual(left.campfireCell, right.campfireCell)
    && regionCellsEqual(left.objectiveCell, right.objectiveCell)
    && positionsEqual(left.campfirePosition, right.campfirePosition)
    && positionsEqual(left.objectivePosition, right.objectivePosition)
    && positionListsEqual(left.crossingPositions, right.crossingPositions)
    && positionListsEqual(left.guardPositions, right.guardPositions)
    && positionListsEqual(left.bowCachePositions, right.bowCachePositions)
    && positionsEqual(left.reinforcementSignalPosition, right.reinforcementSignalPosition)
    && positionsEqual(left.disguisePosition, right.disguisePosition)
    && positionListsEqual(left.playerSpawns, right.playerSpawns)
}

/**
 * Snapshot decoding creates a fresh layout object on every tick. Keep the
 * canonical client object while its values are unchanged so world WeakMap
 * caches and layout-dependent render infrastructure remain stable.
 */
export function selectRegionalMissionLayout(
  current: RegionalMissionLayout,
  candidate: RegionalMissionLayout,
): RegionalMissionLayout {
  return regionalMissionLayoutsEqual(current, candidate) ? current : candidate
}

/** Reconciles the client guard list to the complete authoritative snapshot. */
export function synchronizeMissionGuards(
  current: readonly GuardState[],
  authoritative: readonly MissionGuard[],
): GuardState[] {
  const currentById = new Map(current.map((guard) => [guard.id, guard]))
  return authoritative.map((guard) => {
    const existing = currentById.get(guard.id)
    return {
      id: guard.id,
      position: { ...guard.position },
      home: existing ? { ...existing.home } : { ...guard.position },
      patrolAngle: existing?.patrolAngle ?? 0,
      stunnedFor: guard.stunnedFor,
      alertFor: guard.alertFor,
      lastKnownPosition: existing?.lastKnownPosition ? { ...existing.lastKnownPosition } : null,
    }
  })
}
