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
  _searchPressure = 0,
  objectivePosition: { x: number; z: number } = layout.objectivePosition,
): RegionMapCellState[] {
  const regionCells = sherwoodRegionCells()
  const explored = new Set(exploredCellIndices)
  explored.add(layout.campfireCell.index)
  const current = regionCellIndexAt(playerPosition)
  explored.add(current)
  // Search pressure is a non-spatial warning. Using it to highlight sectors
  // around the hidden objective would reveal generated mission information.
  const objectiveIndex = objectiveDiscovered ? regionCellIndexAt(objectivePosition) : -1
  return regionCells.map((cell) => ({
    index: cell.index,
    explored: explored.has(cell.index),
    current: cell.index === current,
    activity: false,
    objective: cell.index === objectiveIndex,
  }))
}
