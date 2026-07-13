import { regionCellIndexAt, sherwoodRegionCells, type RegionalMissionLayout } from "../shared/regional-layout"

export interface RegionMapCellState {
  index: number
  explored: boolean
  current: boolean
  activity: boolean
  objective: boolean
}

export function buildRegionMapCells(
  layout: RegionalMissionLayout,
  exploredCellIndices: readonly number[],
  playerPosition: { x: number; z: number },
  objectiveDiscovered: boolean,
  searchPressure = 0,
): RegionMapCellState[] {
  const explored = new Set(exploredCellIndices)
  explored.add(layout.campfireCell.index)
  const current = regionCellIndexAt(playerPosition)
  explored.add(current)
  const objective = layout.objectiveCell
  return sherwoodRegionCells().map((cell) => {
    const searchDistance = Math.abs(cell.row - objective.row) + Math.abs(cell.column - objective.column)
    const activityRadius = searchPressure >= 2 ? 0 : searchPressure >= 1 ? 1 : 2
    return {
      index: cell.index,
      explored: explored.has(cell.index),
      current: cell.index === current,
      activity: !objectiveDiscovered && searchDistance <= activityRadius,
      objective: objectiveDiscovered && cell.index === objective.index,
    }
  })
}
