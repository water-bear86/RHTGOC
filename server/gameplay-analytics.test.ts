import { describe, expect, it } from "vitest"
import type { GameplayAnalyticsDimension } from "../shared/gameplay-analytics"
import { GameplayAnalyticsAggregator } from "./gameplay-analytics"

const dimension: GameplayAnalyticsDimension = {
  missionSlug: "peoples-purse",
  mapVersion: "fnv1a32:1234abcd",
  buildId: "0c70a62-canary.1",
  phase: "scout",
  experimentId: "road-density",
  experimentRevision: 1,
  variantId: "control",
}

describe("GameplayAnalyticsAggregator", () => {
  it("accepts at most one position sample per room slot per second", () => {
    const analytics = new GameplayAnalyticsAggregator({ batchNamespace: "test-instance" })
    expect(analytics.observe("room-secret", 0, { observedAtMs: 0, x: 0, z: 0, dangerNearby: false, dimension })).toBe(true)
    expect(analytics.observe("room-secret", 0, { observedAtMs: 999, x: 8, z: 0, dangerNearby: false, dimension })).toBe(false)
    expect(analytics.observe("room-secret", 0, { observedAtMs: 1_000, x: 8, z: 0, dangerNearby: true, dimension })).toBe(true)
    expect(analytics.pendingAggregateCount()).toBe(2)
  })

  it("flushes coarse, five-minute aggregates without runtime room or player keys", () => {
    const analytics = new GameplayAnalyticsAggregator({ batchNamespace: "test-instance" })
    analytics.observe("SECRET-ROOM-CODE", 2, { observedAtMs: 0, x: 1, z: 1, dangerNearby: true, dimension })
    analytics.observe("SECRET-ROOM-CODE", 2, { observedAtMs: 1_000, x: 2, z: 2, dangerNearby: false, dimension })
    expect(analytics.flushReady(299_999)).toEqual([])
    const batches = analytics.flushReady(300_000)
    expect(batches).toHaveLength(1)
    expect(batches[0].aggregates[0]).toMatchObject({ sampleCount: 2, entryCount: 1, dangerSampleCount: 1, cellX: 0, cellZ: 0 })
    expect(JSON.stringify(batches)).not.toContain("SECRET-ROOM-CODE")
    expect(JSON.stringify(batches)).not.toContain("playerSlot")
    expect(JSON.stringify(batches)).not.toContain('"x"')
  })

  it("aggregates fixed outcome and bug signals instead of raw error details", () => {
    const analytics = new GameplayAnalyticsAggregator({ batchNamespace: "test-instance" })
    for (const event of ["mission-start", "objective-interaction", "player-downed", "stuck-recovery", "client-error", "mission-failure"] as const) {
      analytics.recordEvent({ observedAtMs: 20_000, x: -4, z: 9, event, dimension })
    }
    analytics.recordDiagnostic({ observedAtMs: 20_000, x: -4, z: 9, code: "webgl_context_lost", dimension })
    analytics.recordDiagnostic({ observedAtMs: 20_000, x: -4, z: 9, code: "snapshot_desync", dimension })
    const row = analytics.flushAll(21_000)[0].aggregates[0]
    expect(row).toMatchObject({
      missionStartCount: 1,
      objectiveInteractionCount: 1,
      downedCount: 1,
      stuckRecoveryCount: 1,
      clientErrorCount: 3,
      webglContextLostCount: 1,
      snapshotDesyncCount: 1,
      missionFailureCount: 1,
    })
  })

  it("generates deterministic batch ids for the same instance namespace and aggregate content", () => {
    const create = () => {
      const analytics = new GameplayAnalyticsAggregator({ batchNamespace: "stable-test-instance" })
      analytics.observe("room-a", 0, { observedAtMs: 0, x: 0, z: 0, dangerNearby: false, dimension })
      return analytics.flushReady(300_000)[0]
    }
    expect(create().batchId).toBe(create().batchId)
  })
})
