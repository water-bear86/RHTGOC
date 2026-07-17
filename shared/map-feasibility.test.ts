import { describe, expect, it } from "vitest"
import { PEOPLES_PURSE_MISSION, PRISON_WAGON_MISSION, ROYAL_STOREHOUSE_MISSION } from "./mission-catalog"
import {
  MAP_FEASIBILITY_DIAGNOSTIC_CODES,
  validateRegionalMissionFeasibility,
} from "./map-feasibility"
import { regionalizeMissionDefinition } from "./regional-layout"
import {
  RegionalMapGenerationError,
  regionalizeFeasibleMissionDefinition,
} from "./regional-map-generator"

describe("regional map feasibility contract", () => {
  it("accepts a composed layout only after all hard checks pass", () => {
    const result = validateRegionalMissionFeasibility(
      regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 4219),
    )
    expect(result).toEqual({
      feasible: true,
      diagnostics: [],
      checkedPositions: 17,
      checkedRoadSegments: expect.any(Number),
    })
    expect(result.checkedRoadSegments).toBeGreaterThan(100)
  })

  it("reports stable machine-readable placement diagnostics", () => {
    const regional = structuredClone(regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 4219))
    regional.definition.spawns.players[0] = { x: 100, z: 100 }
    const result = validateRegionalMissionFeasibility(regional)
    expect(result.feasible).toBe(false)
    expect(result.diagnostics).toContainEqual({
      code: "unsafe_spawn",
      subject: "player:0",
      position: { x: 100, z: 100 },
    })
    expect(result.diagnostics.every(({ code }) => MAP_FEASIBILITY_DIAGNOSTIC_CODES.includes(code))).toBe(true)
  })

  it("retains rejected candidate evidence while deterministically promoting a feasible seed", () => {
    const first = regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, 42)
    const second = regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, 42)
    expect(second).toEqual(first)
    expect(first.feasibility.feasible).toBe(true)
    expect(first.generation.requestedSeed).toBe(42)
    expect(first.generation.layoutSeed).not.toBe(42)
    expect(first.generation.attempts).toBe(2)
    expect(first.generation.rejectedCandidates).toHaveLength(1)
    expect(first.generation.rejectedCandidates[0].diagnostics).toContainEqual(expect.objectContaining({
      code: "interaction_blocked",
      subject: "bow-cache:2",
    }))
  })

  it("fails closed when the candidate budget is exhausted", () => {
    expect(() => regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, 42, 1))
      .toThrowError(RegionalMapGenerationError)
    try {
      regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, 42, 1)
    } catch (error) {
      expect(error).toBeInstanceOf(RegionalMapGenerationError)
      expect((error as RegionalMapGenerationError).code).toBe("NO_FEASIBLE_REGIONAL_LAYOUT")
      expect((error as RegionalMapGenerationError).rejectedCandidates).toHaveLength(1)
    }
  })

  it("promotes feasible layouts for every shipped mission family", () => {
    for (const [mission, seed] of [
      [PEOPLES_PURSE_MISSION, 4219],
      [PRISON_WAGON_MISSION, 1937],
      [ROYAL_STOREHOUSE_MISSION, 1937],
    ] as const) {
      const regional = regionalizeFeasibleMissionDefinition(mission, seed)
      expect(regional.definition.slug).toBe(mission.slug)
      expect(regional.feasibility.feasible).toBe(true)
      expect(regional.generation.attempts).toBe(1)
    }
  })
})
