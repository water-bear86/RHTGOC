import { regionCellIndexAt, sherwoodRegionCells, type RegionalMissionLayout } from "../shared/regional-layout"

export interface RegionMapCellState {
  index: number
  explored: boolean
  current: boolean
  activity: boolean
  objective: boolean
}

const REGION_MAP_CELL_CLASS = "region-map-cell"

export function regionMapCellClassName(cell: RegionMapCellState): string {
  return [
    REGION_MAP_CELL_CLASS,
    `${REGION_MAP_CELL_CLASS}--${cell.explored ? "explored" : "fogged"}`,
    cell.activity ? `${REGION_MAP_CELL_CLASS}--activity` : "",
    cell.objective ? `${REGION_MAP_CELL_CLASS}--objective` : "",
    cell.current ? `${REGION_MAP_CELL_CLASS}--current` : "",
  ].filter(Boolean).join(" ")
}

export function buildRegionMapCells(
  layout: RegionalMissionLayout,
  exploredCellIndices: readonly number[],
  playerPosition: { x: number; z: number },
  objectiveDiscovered: boolean,
  searchPressure = 0,
  objectivePosition: { x: number; z: number } = layout.objectivePosition,
): RegionMapCellState[] {
  const regionCells = sherwoodRegionCells()
  const explored = new Set(exploredCellIndices)
  explored.add(layout.campfireCell.index)
  const current = regionCellIndexAt(playerPosition)
  explored.add(current)
  const objectiveIndex = regionCellIndexAt(objectivePosition)
  const objective = regionCells[objectiveIndex]
  return regionCells.map((cell) => {
    const searchDistance = Math.abs(cell.row - objective.row) + Math.abs(cell.column - objective.column)
    const activityRadius = searchPressure >= 2 ? 0 : searchPressure >= 1 ? 1 : 2
    return {
      index: cell.index,
      explored: explored.has(cell.index),
      current: cell.index === current,
      activity: !objectiveDiscovered && searchDistance <= activityRadius,
      objective: objectiveDiscovered && cell.index === objectiveIndex,
    }
  })
}
