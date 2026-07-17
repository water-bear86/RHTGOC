import { describe, expect, it } from "vitest"
import { PEOPLES_PURSE_MISSION } from "./mission-catalog"
import {
  SHERWOOD_RIVER_CENTER_X,
  SHERWOOD_RIVER_SLOPE,
} from "./regional-layout"
import { regionalizeFeasibleMissionDefinition } from "./regional-map-generator"
import { regionalizeMissionDefinition } from "./regional-layout"
import { composeSherwoodWorld } from "./world-composer"
import { SHERWOOD_RIVER_HALF_WIDTH } from "./world-obstacles"
import { SHERWOOD_SETTLEMENT_SITES } from "./world-topology"

describe("Sherwood world composer", () => {
  const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 4219).layout

  it("deterministically creates connected settlement clusters", () => {
    const first = composeSherwoodWorld(layout)
    const second = composeSherwoodWorld(layout)
    expect(first).toEqual(second)
    expect(first.settlements).toHaveLength(3)
    expect(first.buildingCount).toBeGreaterThanOrEqual(10)
    expect(first.roads).toHaveLength(7)
    expect(first.roads.every((road) => road.points.length >= 2)).toBe(true)
    expect(first.roads.filter((road) => road.points.length >= 8).length).toBeGreaterThanOrEqual(6)
    expect(first.roads.some((road) => (road.passIds?.length ?? 0) > 0)).toBe(true)
    expect(first.roads.map(({ id }) => id)).toEqual([
      "camp-village-road",
      "village-ford-road",
      "sheriff-ford-road",
      "post-objective-road",
      "village-hamlet-track",
      "hamlet-ford-track",
      "far-ford-post-track",
    ])
  })

  it("forms a readable high-road and low-road loop between camp and objective", () => {
    const world = composeSherwoodWorld(layout)
    const endpointKey = (point: { x: number; z: number }): string => `${point.x.toFixed(3)}:${point.z.toFixed(3)}`
    const connections = new Map<string, Set<string>>()
    for (const road of world.roads) {
      const start = endpointKey(road.points[0])
      const end = endpointKey(road.points[road.points.length - 1])
      connections.set(start, (connections.get(start) ?? new Set()).add(end))
      connections.set(end, (connections.get(end) ?? new Set()).add(start))
    }
    const objective = endpointKey(layout.objectivePosition)
    const degrees = [...connections.values()].map((neighbors) => neighbors.size)
    expect(degrees.filter((degree) => degree === 3)).toHaveLength(2)
    expect(connections.get(objective)?.size).toBe(1)
    const nearestRoadStart = world.roads
      .flatMap((road) => [road.points[0], road.points[road.points.length - 1]])
      .sort((left, right) => (
        Math.hypot(left.x - layout.campfirePosition.x, left.z - layout.campfirePosition.z)
        - Math.hypot(right.x - layout.campfirePosition.x, right.z - layout.campfirePosition.z)
      ))[0]
    expect(Math.hypot(
      nearestRoadStart.x - layout.campfirePosition.x,
      nearestRoadStart.z - layout.campfirePosition.z,
    )).toBeCloseTo(2.8)
  })

  it("arranges settlement buildings as legible street fronts", () => {
    const world = composeSherwoodWorld(layout)
    for (const settlement of world.settlements) {
      const cosine = Math.cos(settlement.streetHeading)
      const sine = Math.sin(settlement.streetHeading)
      const localSides = settlement.buildings.map((building) => (
        sine * (building.position.x - settlement.center.x)
        + cosine * (building.position.z - settlement.center.z)
      ))
      expect(localSides.some((side) => side < -3.5)).toBe(true)
      expect(localSides.some((side) => side > 3.5)).toBe(true)
    }
  })

  it("keeps substantial buildings away from the exact mission anchors", () => {
    const world = composeSherwoodWorld(layout)
    for (const building of world.settlements.flatMap((settlement) => settlement.buildings)) {
      expect(Math.hypot(building.position.x - layout.campfirePosition.x, building.position.z - layout.campfirePosition.z)).toBeGreaterThan(10)
      expect(Math.hypot(building.position.x - layout.objectivePosition.x, building.position.z - layout.objectivePosition.z)).toBeGreaterThan(10)
    }
    for (const settlement of world.settlements) {
      expect(SHERWOOD_SETTLEMENT_SITES.some((site) => site.center.x === settlement.center.x && site.center.z === settlement.center.z)).toBe(true)
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

  it("finds sparse authored routes across a broad deterministic seed sample", () => {
    for (let index = 1; index <= 32; index += 1) {
      const seededLayout = regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, index * 7919).layout
      const world = composeSherwoodWorld(seededLayout)
      expect(world.roads).toHaveLength(7)
      expect(world.roads.every((road) => road.points.length >= 2)).toBe(true)
      expect(world.buildingCount).toBeGreaterThanOrEqual(10)
    }
  }, 20_000)

  it("keeps every building footprint entirely out of the river", () => {
    const riverNormalLength = Math.hypot(1, -SHERWOOD_RIVER_SLOPE)
    for (let index = 1; index <= 64; index += 1) {
      const seededLayout = regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, index * 7919).layout
      const buildings = composeSherwoodWorld(seededLayout).settlements.flatMap((settlement) => settlement.buildings)
      for (const building of buildings) {
        const centerlineDistance = Math.abs(
          building.position.x - SHERWOOD_RIVER_CENTER_X - SHERWOOD_RIVER_SLOPE * building.position.z,
        ) / riverNormalLength
        const footprintRadius = Math.hypot(building.halfExtents.x, building.halfExtents.z)
        expect(centerlineDistance - footprintRadius).toBeGreaterThan(SHERWOOD_RIVER_HALF_WIDTH)
      }
    }
  }, 20_000)
})
