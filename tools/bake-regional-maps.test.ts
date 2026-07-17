import { describe, expect, it } from "vitest"
import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import { MAP_QUALITY_DIMENSIONS, type MapQualityVector } from "../shared/map-quality"
import {
  REGIONAL_MAP_BAKER_VERSION,
  bakeRegionalMapPortfolio,
  selectCurationPortfolio,
} from "./bake-regional-maps"

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

describe("regional map baker", () => {
  it("rotates through Pareto dimensions without reviving dominated candidates", () => {
    const candidates = [
      { fingerprint: "route", quality: vector({ routeChoice: 0.9, pacingShape: 0.4 }) },
      { fingerprint: "pacing", quality: vector({ routeChoice: 0.4, pacingShape: 0.9 }) },
      { fingerprint: "balanced", quality: vector({ routeChoice: 0.7, pacingShape: 0.7 }) },
      { fingerprint: "dominated", quality: vector({ routeChoice: 0.2, pacingShape: 0.2 }) },
    ]
    const selected = selectCurationPortfolio(candidates, 3)
    expect(selected).toHaveLength(3)
    expect(selected.map(({ fingerprint }) => fingerprint)).not.toContain("dominated")
    expect(new Set(selected.map(({ fingerprint }) => fingerprint)).size).toBe(3)
  })

  it("builds a reproducible manifest and visual contact sheet", () => {
    const options = { candidateCount: 4, portfolioSize: 3, seedNamespace: "regional-map-baker-test" }
    const first = bakeRegionalMapPortfolio(PEOPLES_PURSE_MISSION, options)
    const second = bakeRegionalMapPortfolio(PEOPLES_PURSE_MISSION, options)
    expect(second).toEqual(first)
    expect(first.manifest.generatorVersion).toBe(REGIONAL_MAP_BAKER_VERSION)
    expect(first.manifest.status).toBe("curation-candidate")
    expect(first.manifest.requestedCandidateCount).toBe(4)
    expect(first.manifest.feasibleCandidateCount).toBe(4)
    expect(first.manifest.portfolio.length).toBeGreaterThan(0)
    expect(first.manifest.portfolio.length).toBeLessThanOrEqual(3)
    expect(first.manifest.qualityDimensions).toEqual(MAP_QUALITY_DIMENSIONS)
    expect(first.manifest.manifestHash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(first.manifest.portfolio.every((candidate) => (
      Object.values(candidate.quality).every((value) => value >= 0 && value <= 1)
    ))).toBe(true)
    expect(first.manifestJson).toContain(first.manifest.manifestHash)
    expect(first.contactSheetSvg).toContain("<svg")
    expect(first.contactSheetSvg).toContain("The People&apos;s Purse")
    expect(first.contactSheetSvg).toContain(first.manifest.manifestHash)
  })
})
