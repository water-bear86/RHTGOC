import { describe, expect, it, vi } from "vitest"
import type { GameplayAnalyticsBatch } from "../shared/gameplay-analytics"
import type { RpcClient } from "./band-store"
import { SupabaseGameplayAnalyticsStore } from "./gameplay-analytics-store"

const batch: GameplayAnalyticsBatch = {
  schemaVersion: 1,
  batchId: `ga_${"b".repeat(48)}`,
  createdAt: "2026-07-13T20:00:00.000Z",
  aggregates: [{
    windowStart: "2026-07-13T20:00:00.000Z",
    missionSlug: "peoples-purse",
    mapVersion: "fnv1a32:1234abcd",
    buildId: "0c70a62-canary.1",
    phase: "scout",
    experimentId: null,
    experimentRevision: null,
    variantId: null,
    cellX: 1,
    cellZ: -2,
    sampleCount: 4,
    entryCount: 1,
    dangerSampleCount: 0,
    objectiveInteractionCount: 0,
    downedCount: 0,
    stuckRecoveryCount: 0,
    clientErrorCount: 0,
    webglContextLostCount: 0,
    assetLoadFailedCount: 0,
    uncaughtErrorCount: 0,
    unhandledRejectionCount: 0,
    frameStallCount: 0,
    snapshotDesyncCount: 0,
    missionStartCount: 0,
    missionSuccessCount: 0,
    missionFailureCount: 0,
  }],
}

describe("SupabaseGameplayAnalyticsStore", () => {
  it("writes a bounded aggregate batch through the idempotent service RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { inserted: true, rows: 1 }, error: null })
    const result = await new SupabaseGameplayAnalyticsStore({ rpc } as RpcClient).recordBatch(batch)
    expect(result).toEqual({ inserted: true, rows: 1 })
    expect(rpc).toHaveBeenCalledWith("ingest_gameplay_analytics_batch", {
      p_batch_id: batch.batchId,
      p_schema_version: 1,
      p_created_at: batch.createdAt,
      p_aggregates: batch.aggregates,
    })
    expect(JSON.stringify(rpc.mock.calls[0])).not.toMatch(/playerId|roomCode|position|path/)
  })

  it("preserves the database's idempotent replay result", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { inserted: false, rows: 1 }, error: null })
    await expect(new SupabaseGameplayAnalyticsStore({ rpc } as RpcClient).recordBatch(batch)).resolves.toEqual({ inserted: false, rows: 1 })
  })

  it("surfaces database errors and malformed responses", async () => {
    await expect(new SupabaseGameplayAnalyticsStore({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "offline" } }) } as RpcClient).recordBatch(batch))
      .rejects.toThrow("GAMEPLAY_ANALYTICS_PERSISTENCE_FAILED: offline")
    await expect(new SupabaseGameplayAnalyticsStore({ rpc: vi.fn().mockResolvedValue({ data: {}, error: null }) } as RpcClient).recordBatch(batch))
      .rejects.toThrow("invalid response")
  })
})
