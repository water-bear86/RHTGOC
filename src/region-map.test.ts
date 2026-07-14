import { describe, expect, it } from "vitest"
import { regionalizeMissionDefinition, sherwoodRegionCells, stableSeed } from "../shared/regional-layout"
import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import { buildRegionMapCells, regionMapCellClassName, type RegionMapCellState } from "./region-map"

describe("region map fog of war", () => {
  const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, stableSeed("map-test")).layout
  const regionCells = sherwoodRegionCells()
  const objectiveCorner = regionCells[0]
  const playerCorner = regionCells[24]
  const cornerLayout = {
    ...layout,
    campfireCell: playerCorner,
    campfirePosition: playerCorner.center,
    objectiveCell: objectiveCorner,
    objectivePosition: objectiveCorner.center,
  }

  it("renders all 25 cells while keeping unexplored cells fogged", () => {
    const cells = buildRegionMapCells(layout, [], layout.campfirePosition, false)
    expect(cells).toHaveLength(25)
    expect(cells.filter((cell) => cell.explored)).toHaveLength(1)
    expect(cells.every((cell) => !cell.activity)).toBe(true)
    expect(cells.every((cell) => !cell.objective)).toBe(true)
  })

  it("shares explored cells and reveals the objective only after discovery", () => {
    const sharedCell = (layout.campfireCell.index + 1) % 25
    const cells = buildRegionMapCells(layout, [sharedCell], layout.campfirePosition, true)
    expect(cells[sharedCell].explored).toBe(true)
    expect(cells[layout.objectiveCell.index].objective).toBe(true)
    expect(cells.every((cell) => !cell.activity)).toBe(true)
  })

  it("moves a discovered objective marker into the active objective position's cell", () => {
    const movedObjective = { x: layout.campfirePosition.x, z: layout.campfirePosition.z }
    const cells = buildRegionMapCells(layout, [], layout.campfirePosition, true, 0, movedObjective)

    expect(cells[layout.campfireCell.index].objective).toBe(true)
    expect(cells[layout.objectiveCell.index].objective).toBe(false)
  })

  it("never leaks a hidden objective through its position or search pressure", () => {
    const secondObjective = regionCells[12]
    const secondLayout = {
      ...cornerLayout,
      objectiveCell: secondObjective,
      objectivePosition: secondObjective.center,
    }
    const explored = [playerCorner.index, regionCells[23].index]
    const first = buildRegionMapCells(cornerLayout, explored, playerCorner.center, false, 0, objectiveCorner.center)
    const second = buildRegionMapCells(secondLayout, explored, playerCorner.center, false, 3, secondObjective.center)

    expect(second).toEqual(first)
    expect(first.every((cell) => !cell.activity && !cell.objective)).toBe(true)
  })

  it("reveals exactly one target marker after discovery", () => {
    const cells = buildRegionMapCells(cornerLayout, [], playerCorner.center, true, 0)

    expect(cells.every((cell) => !cell.activity)).toBe(true)
    expect(cells.filter((cell) => cell.objective).map((cell) => cell.index)).toEqual([objectiveCorner.index])
  })

  it("uses component-scoped class names for every rendered map state", () => {
    const state: RegionMapCellState = {
      index: 7,
      explored: false,
      current: true,
      activity: true,
      objective: true,
    }

    const classNames = regionMapCellClassName(state).split(" ")
    expect(classNames).toEqual([
      "region-map-cell",
      "region-map-cell--fogged",
      "region-map-cell--activity",
      "region-map-cell--objective",
      "region-map-cell--current",
    ])
    expect(classNames.every((className) => className === "region-map-cell" || className.startsWith("region-map-cell--"))).toBe(true)
    expect(classNames).not.toContain("activity")
    expect(classNames).not.toContain("objective")
    expect(classNames).not.toContain("current")
  })

  it("marks explored cells without leaking a generic explored or fogged class", () => {
    const state: RegionMapCellState = {
      index: 4,
      explored: true,
      current: false,
      activity: false,
      objective: false,
    }

    expect(regionMapCellClassName(state)).toBe("region-map-cell region-map-cell--explored")
  })
})
