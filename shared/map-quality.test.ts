import { describe, expect, it } from "vitest"
import { PEOPLES_PURSE_MISSION, PRISON_WAGON_MISSION, ROYAL_STOREHOUSE_MISSION } from "./mission-catalog"
import {
  MAP_QUALITY_DIMENSIONS,
  MapQualityEvaluationError,
  dominatesMapQuality,
  evaluateRegionalMapQuality,
  selectNondominatedMapCandidates,
  type MapQualityVector,
} from "./map-quality"
import { regionalizeMissionDefinition } from "./regional-layout"
import { regionalizeFeasibleMissionDefinition } from "./regional-map-generator"

const vector = (overrides: Partial<MapQualityVector> = {}): MapQualityVector => ({
  traversalFairness: 0.5,
  routeChoice: 0.5,
  riskRewardDistribution: 0.5,
  pacingShape: 0.5,
  landmarkLegibility: 0.5,
  cooperationCoverage: 0.5,
  novelty: 0.5,
  ...overrides,
})

describe("regional map quality vector", () => {
  it("refuses to score candidates that have not passed feasibility", () => {
    expect(() => evaluateRegionalMapQuality(regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 1)))
      .toThrowError(MapQualityEvaluationError)
  })

  it("publishes deterministic bounded dimensions and inspectable evidence without a composite score", () => {
    const regional = regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, 4219)
    const first = evaluateRegionalMapQuality(regional)
    const second = evaluateRegionalMapQuality(regional)
    expect(second).toEqual(first)
    expect(Object.keys(first.vector)).toEqual(MAP_QUALITY_DIMENSIONS)
    expect(Object.values(first.vector).every((value) => value >= 0 && value <= 1)).toBe(true)
    expect(first).not.toHaveProperty("score")
    expect(first.fingerprint).toMatch(/^mapq1:[a-f0-9]{8}$/)
    expect(first.evidence.playerObjectivePathCosts).toHaveLength(4)
    expect(first.evidence.crossingObjectivePathCosts).toHaveLength(2)
    expect(first.evidence.referenceCount).toBe(0)
  })

  it("measures novelty against explicit reference layouts", () => {
    const reference = regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, 4219)
    const same = evaluateRegionalMapQuality(reference, { referenceLayouts: [reference.layout] })
    const different = evaluateRegionalMapQuality(
      regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, 42),
      { referenceLayouts: [reference.layout] },
    )
    expect(same.vector.novelty).toBe(0)
    expect(different.vector.novelty).toBeGreaterThan(0)
    expect(different.evidence.referenceCount).toBe(1)
  })

  it("retains tradeoffs while removing dominated candidates", () => {
    const routeSpecialist = { id: "route", quality: vector({ routeChoice: 0.9, pacingShape: 0.4 }) }
    const pacingSpecialist = { id: "pacing", quality: vector({ routeChoice: 0.4, pacingShape: 0.9 }) }
    const balanced = { id: "balanced", quality: vector({ routeChoice: 0.7, pacingShape: 0.7 }) }
    const dominated = { id: "dominated", quality: vector({ routeChoice: 0.3, pacingShape: 0.3 }) }
    expect(dominatesMapQuality(balanced.quality, dominated.quality)).toBe(true)
    expect(dominatesMapQuality(routeSpecialist.quality, pacingSpecialist.quality)).toBe(false)
    expect(selectNondominatedMapCandidates([
      routeSpecialist,
      pacingSpecialist,
      balanced,
      dominated,
    ]).map(({ id }) => id)).toEqual(["route", "pacing", "balanced"])
  })

  it("scores every shipped mission family with finite reproducible evidence", () => {
    for (const [mission, seed] of [
      [PEOPLES_PURSE_MISSION, 4219],
      [PRISON_WAGON_MISSION, 1937],
      [ROYAL_STOREHOUSE_MISSION, 1937],
    ] as const) {
      const result = evaluateRegionalMapQuality(regionalizeFeasibleMissionDefinition(mission, seed))
      expect(result.feasibility.feasible).toBe(true)
      expect(Object.values(result.vector).every(Number.isFinite)).toBe(true)
      expect(Object.values(result.evidence).flat().every((value) => (
        typeof value === "number" ? Number.isFinite(value) : true
      ))).toBe(true)
    }
  })
})
