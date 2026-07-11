import { regionCellIndexAt, sherwoodRegionCells, type RegionalMissionLayout } from "../shared/regional-layout"

export interface RegionMapCellState {
  index: number
  explored: boolean
  current: boolean
  camp: boolean
  objective: boolean
}

export function buildRegionMapCells(
  layout: RegionalMissionLayout,
  exploredCellIndices: readonly number[],
  playerPosition: { x: number; z: number },
  objectiveDiscovered: boolean,
): RegionMapCellState[] {
  const explored = new Set(exploredCellIndices)
  explored.add(layout.campfireCell.index)
  const current = regionCellIndexAt(playerPosition)
  explored.add(current)
  return sherwoodRegionCells().map((cell) => ({
    index: cell.index,
    explored: explored.has(cell.index),
    current: cell.index === current,
    camp: cell.index === layout.campfireCell.index,
    objective: objectiveDiscovered && cell.index === layout.objectiveCell.index,
  }))
}
