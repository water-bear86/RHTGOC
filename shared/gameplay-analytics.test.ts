import { describe, expect, it } from "vitest"
import {
  GAMEPLAY_AGGREGATION_WINDOW_MS,
  analyticsCellAt,
  analyticsWindowStart,
  emptyGameplayAggregate,
  parseGameplayAnalyticsAggregate,
  parseGameplayAnalyticsBatch,
  type GameplayAnalyticsDimension,
} from "./gameplay-analytics"

const dimension: GameplayAnalyticsDimension = {
  missionSlug: "peoples-purse",
  mapVersion: "fnv1a32:1234abcd",
  buildId: "0c70a62-canary.1",
  phase: "scout",
  experimentId: "topography-v1",
  experimentRevision: 2,
  variantId: "ridge-pass",
}

function aggregate() {
  return {
    ...emptyGameplayAggregate(1_800_000, dimension, { cellX: -2, cellZ: 4 }),
    sampleCount: 12,
    entryCount: 2,
    dangerSampleCount: 3,
  }
}

describe("privacy-safe gameplay analytics contract", () => {
  it("bins positions into coarse cells and timestamps into five-minute windows", () => {
    expect(analyticsCellAt(7.99, -0.01)).toEqual({ cellX: 0, cellZ: -1 })
    expect(analyticsCellAt(-8, 16)).toEqual({ cellX: -1, cellZ: 2 })
    expect(analyticsWindowStart(1_800_000 + GAMEPLAY_AGGREGATION_WINDOW_MS - 1)).toBe(1_800_000)
  })

  it("accepts bounded aggregates and clones the batch payload", () => {
    const source = aggregate()
    const parsed = parseGameplayAnalyticsBatch({
      schemaVersion: 1,
      batchId: `ga_${"a".repeat(48)}`,
      createdAt: "2026-07-13T20:00:00.000Z",
      aggregates: [source],
    })
    source.sampleCount = 99
    expect(parsed.aggregates[0].sampleCount).toBe(12)
    expect(parsed.aggregates[0].experimentId).toBe("topography-v1")
  })

  it("rejects personal identifiers, raw positions, and any other unapproved field", () => {
    for (const forbidden of ["playerId", "userId", "roomCode", "position", "path"]) {
      expect(() => parseGameplayAnalyticsAggregate({ ...aggregate(), [forbidden]: forbidden })).toThrow("unsupported fields")
    }
  })

  it("requires aligned windows and complete experiment dimensions", () => {
    expect(() => parseGameplayAnalyticsAggregate({ ...aggregate(), windowStart: "2026-07-13T20:01:00.000Z" })).toThrow("five-minute")
    expect(() => parseGameplayAnalyticsAggregate({ ...aggregate(), variantId: null })).toThrow("all null or all populated")
  })

  it("rejects impossible counters and empty aggregate rows", () => {
    expect(() => parseGameplayAnalyticsAggregate({ ...aggregate(), dangerSampleCount: 13 })).toThrow("cannot exceed")
    const empty = emptyGameplayAggregate(1_800_000, { ...dimension, experimentId: null, experimentRevision: null, variantId: null }, { cellX: 0, cellZ: 0 })
    expect(() => parseGameplayAnalyticsAggregate(empty)).toThrow("at least one metric")
  })
})
