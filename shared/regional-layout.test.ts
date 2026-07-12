import { describe, expect, it } from "vitest"
import { PEOPLES_PURSE_MISSION, PRISON_WAGON_MISSION, ROYAL_STOREHOUSE_MISSION } from "./mission-catalog"
import { SHERWOOD_REGIONAL_BOUNDS, regionalizeMissionDefinition, sherwoodRegionCells, stableSeed } from "./regional-layout"

describe("5x5 regional mission layout", () => {
  it("publishes 25 stable cells and separates campfire from the objective as far as possible", () => {
    expect(sherwoodRegionCells()).toHaveLength(25)
    for (const token of ["first", "second", "third", "fourth"]) {
      const { layout } = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, stableSeed(token))
      const distance = Math.abs(layout.campfireCell.row - layout.objectiveCell.row)
        + Math.abs(layout.campfireCell.column - layout.objectiveCell.column)
      expect(distance).toBeGreaterThanOrEqual(4)
      expect(layout.campfireCell.index).not.toBe(layout.objectiveCell.index)
      expect(Math.hypot(layout.campfirePosition.x - layout.objectivePosition.x, layout.campfirePosition.z - layout.objectivePosition.z)).toBeGreaterThan(90)
      expect(layout.crossingPositions).toHaveLength(2)
      expect(Math.abs(layout.crossingPositions[0].z - layout.crossingPositions[1].z)).toBeGreaterThan(15)
      expect(layout.guardPositions).toHaveLength(12)
      expect(layout.bowCachePositions).toHaveLength(4)
    }
  })

  it("is deterministic for replay and varies across seeds", () => {
    const first = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 42)
    expect(regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 42)).toEqual(first)
    expect(regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 43).layout).not.toEqual(first.layout)
  })

  it("translates every mission family while preserving stable package identity", () => {
    for (const mission of [PEOPLES_PURSE_MISSION, PRISON_WAGON_MISSION, ROYAL_STOREHOUSE_MISSION]) {
      const regional = regionalizeMissionDefinition(mission, 1937)
      expect(regional.definition.id).toBe(mission.id)
      expect(regional.definition.contentHash).toBe(mission.contentHash)
      expect(regional.definition.rules.worldBounds).toBe(SHERWOOD_REGIONAL_BOUNDS)
      expect(regional.definition.spawns.players.every((spawn) => Math.hypot(spawn.x - regional.layout.campfirePosition.x, spawn.z - regional.layout.campfirePosition.z) < 11)).toBe(true)
      expect(regional.definition.spawns.guards).toHaveLength(12)
      for (let post = 0; post < 4; post += 1) {
        const guards = regional.definition.spawns.guards.slice(post * 3, post * 3 + 3)
        expect(guards).toHaveLength(3)
        expect(Math.max(...guards.map((guard) => Math.hypot(guard.position.x - guards[0].position.x, guard.position.z - guards[0].position.z)))).toBeLessThan(4)
      }
    }
  })
})
