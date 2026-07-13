import { describe, expect, it } from "vitest"
import { regionalizeMissionDefinition, stableSeed } from "../shared/regional-layout"
import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import { buildRegionMapCells, regionMapCellClassName, type RegionMapCellState } from "./region-map"

describe("region map fog of war", () => {
  const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, stableSeed("map-test")).layout

  it("renders all 25 cells while keeping unexplored cells fogged", () => {
    const cells = buildRegionMapCells(layout, [], layout.campfirePosition, false)
    expect(cells).toHaveLength(25)
    expect(cells.filter((cell) => cell.explored)).toHaveLength(1)
    expect(cells.filter((cell) => cell.activity).length).toBeGreaterThan(1)
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

  it("narrows the Sheriff activity area as search pressure rises", () => {
    const broad = buildRegionMapCells(layout, [], layout.campfirePosition, false, 0)
    const narrow = buildRegionMapCells(layout, [], layout.campfirePosition, false, 2)
    expect(narrow.filter((cell) => cell.activity)).toHaveLength(1)
    expect(narrow.filter((cell) => cell.activity).length).toBeLessThan(broad.filter((cell) => cell.activity).length)
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
