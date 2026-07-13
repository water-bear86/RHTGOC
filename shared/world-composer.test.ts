import { describe, expect, it } from "vitest"
import { PEOPLES_PURSE_MISSION } from "./mission-catalog"
import { regionalizeMissionDefinition } from "./regional-layout"
import { composeSherwoodWorld } from "./world-composer"

describe("Sherwood world composer", () => {
  const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 4219).layout

  it("deterministically creates connected settlement clusters", () => {
    const first = composeSherwoodWorld(layout)
    const second = composeSherwoodWorld(layout)
    expect(first).toEqual(second)
    expect(first.settlements).toHaveLength(3)
    expect(first.buildingCount).toBeGreaterThanOrEqual(10)
    expect(first.roads).toHaveLength(6)
    expect(first.roads.every((road) => road.points.length >= 8)).toBe(true)
  })

  it("keeps substantial buildings away from the exact mission anchors", () => {
    const world = composeSherwoodWorld(layout)
    for (const building of world.settlements.flatMap((settlement) => settlement.buildings)) {
      expect(Math.hypot(building.position.x - layout.campfirePosition.x, building.position.z - layout.campfirePosition.z)).toBeGreaterThan(4)
      expect(Math.hypot(building.position.x - layout.objectivePosition.x, building.position.z - layout.objectivePosition.z)).toBeGreaterThan(4)
    }
    for (const settlement of world.settlements) {
      for (let left = 0; left < settlement.buildings.length; left += 1) {
        for (let right = left + 1; right < settlement.buildings.length; right += 1) {
          const a = settlement.buildings[left]
          const b = settlement.buildings[right]
          const minimum = Math.hypot(a.halfExtents.x, a.halfExtents.z) + Math.hypot(b.halfExtents.x, b.halfExtents.z)
          expect(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z)).toBeGreaterThan(minimum)
        }
      }
    }
  })
})
