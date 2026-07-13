import { describe, expect, it } from "vitest"
import { regionalizeMissionDefinition, stableSeed } from "../shared/regional-layout"
import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import { buildRegionMapCells } from "./region-map"

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

  it("narrows the Sheriff activity area as search pressure rises", () => {
    const broad = buildRegionMapCells(layout, [], layout.campfirePosition, false, 0)
    const narrow = buildRegionMapCells(layout, [], layout.campfirePosition, false, 2)
    expect(narrow.filter((cell) => cell.activity)).toHaveLength(1)
    expect(narrow.filter((cell) => cell.activity).length).toBeLessThan(broad.filter((cell) => cell.activity).length)
  })
})
