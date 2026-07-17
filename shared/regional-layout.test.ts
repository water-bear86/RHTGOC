import { describe, expect, it } from "vitest"
import { PEOPLES_PURSE_MISSION, PRISON_WAGON_MISSION, ROYAL_STOREHOUSE_MISSION } from "./mission-catalog"
import {
  SHERWOOD_REGIONAL_BOUNDS,
  regionCellIndexAt,
  regionalizeMissionDefinition,
  sherwoodRegionCells,
  stableSeed,
  type RegionalLayoutVariant,
} from "./regional-layout"
import {
  SHERWOOD_MISSION_STATIC_OBSTACLES,
  createSherwoodRiverObstacles,
  isPointInsideSherwoodObstacle,
} from "./world-obstacles"

describe("5x5 regional mission layout", () => {
  it("publishes 25 stable cells and keeps every layout family meaningfully traversable", () => {
    expect(sherwoodRegionCells()).toHaveLength(25)
    for (const token of ["first", "second", "third", "fourth"]) {
      const { layout } = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, stableSeed(token))
      const distance = Math.abs(layout.campfireCell.row - layout.objectiveCell.row)
        + Math.abs(layout.campfireCell.column - layout.objectiveCell.column)
      expect(distance).toBeGreaterThanOrEqual(2)
      expect(layout.campfireCell.index).not.toBe(layout.objectiveCell.index)
      expect(Math.hypot(layout.campfirePosition.x - layout.objectivePosition.x, layout.campfirePosition.z - layout.objectivePosition.z)).toBeGreaterThan(30)
      expect(layout.crossingPositions).toHaveLength(2)
      expect(Math.abs(layout.crossingPositions[0].z - layout.crossingPositions[1].z)).toBeGreaterThan(15)
      expect(layout.guardPositions.length).toBeGreaterThanOrEqual(12)
      expect(layout.guardPositions.length).toBeLessThanOrEqual(21)
      expect(layout.guardPositions.length % 3).toBe(0)
      expect(layout.bowCachePositions).toHaveLength(4)
    }
  })

  it("is deterministic for replay and varies across seeds", () => {
    const first = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 42)
    expect(regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 42)).toEqual(first)
    expect(regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 43).layout).not.toEqual(first.layout)
  })

  it("keeps mission anchors off authoritative blockers without collapsing layout diversity", () => {
    const campCells = new Set<number>()
    const objectiveCells = new Set<number>()
    const anchorPairs = new Set<string>()
    const variants = new Set<RegionalLayoutVariant>()
    for (let seed = 1; seed <= 128; seed += 1) {
      const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, seed * 7919).layout
      campCells.add(layout.campfireCell.index)
      objectiveCells.add(layout.objectiveCell.index)
      anchorPairs.add(`${layout.campfireCell.index}:${layout.objectiveCell.index}`)
      variants.add(layout.variant)
      const blockers = [...SHERWOOD_MISSION_STATIC_OBSTACLES, ...createSherwoodRiverObstacles(layout)]
      for (const anchor of [layout.campfirePosition, layout.objectivePosition]) {
        expect(
          blockers.some((blocker) => isPointInsideSherwoodObstacle(anchor, blocker, 0.45)),
          `seed ${seed * 7919} placed a mission anchor inside ${blockers.find((blocker) => isPointInsideSherwoodObstacle(anchor, blocker, 0.45))?.id}`,
        ).toBe(false)
      }
      const cellDistance = Math.abs(layout.campfireCell.row - layout.objectiveCell.row)
        + Math.abs(layout.campfireCell.column - layout.objectiveCell.column)
      expect(cellDistance).toBeGreaterThanOrEqual(2)
    }
    expect(variants).toEqual(new Set<RegionalLayoutVariant>(["long-haul", "cross-river", "same-bank", "central-expedition"]))
    expect(campCells.size).toBeGreaterThanOrEqual(18)
    expect(objectiveCells.size).toBeGreaterThanOrEqual(18)
    expect(anchorPairs.size).toBeGreaterThanOrEqual(80)
  })

  it("translates every mission family while preserving stable package identity", () => {
    for (const mission of [PEOPLES_PURSE_MISSION, PRISON_WAGON_MISSION, ROYAL_STOREHOUSE_MISSION]) {
      const regional = regionalizeMissionDefinition(mission, 1937)
      const sheriffLoot = regional.definition.scenario?.kind === "storehouse"
        ? regional.definition.scenario.lootCaches.map((cache) => cache.position)
        : [regional.layout.objectivePosition]
      const expectedGuardPosts = sheriffLoot.length + 3
      expect(regional.definition.id).toBe(mission.id)
      expect(regional.definition.contentHash).toBe(mission.contentHash)
      expect(regional.definition.rules.worldBounds).toBe(SHERWOOD_REGIONAL_BOUNDS)
      expect(regional.definition.spawns.players.every((spawn) => Math.hypot(spawn.x - regional.layout.campfirePosition.x, spawn.z - regional.layout.campfirePosition.z) < 11)).toBe(true)
      expect(regional.definition.spawns.guards.length % 3).toBe(0)
      const actualGuardPosts = regional.definition.spawns.guards.length / 3
      expect(actualGuardPosts).toBeGreaterThanOrEqual(expectedGuardPosts)
      const occupiedGuardCells = new Set<number>()
      for (let post = 0; post < actualGuardPosts; post += 1) {
        const guards = regional.definition.spawns.guards.slice(post * 3, post * 3 + 3)
        expect(guards).toHaveLength(3)
        expect(Math.max(...guards.map((guard) => Math.hypot(guard.position.x - guards[0].position.x, guard.position.z - guards[0].position.z)))).toBeLessThan(4)
        const center = guards.reduce((sum, guard) => ({ x: sum.x + guard.position.x / 3, z: sum.z + guard.position.z / 3 }), { x: 0, z: 0 })
        occupiedGuardCells.add(regionCellIndexAt(center))
      }
      expect(occupiedGuardCells.size).toBeGreaterThanOrEqual(4)
      expect(occupiedGuardCells.size).toBeLessThanOrEqual(7)
      for (const loot of sheriffLoot) {
        expect(regional.definition.spawns.guards.filter((guard) => Math.hypot(guard.position.x - loot.x, guard.position.z - loot.z) < 2).length).toBeGreaterThanOrEqual(3)
      }
    }
  })
})
