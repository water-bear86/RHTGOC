import { describe, expect, it, vi } from "vitest"
import type { RpcClient } from "./band-store"
import { SupabaseContributionStore } from "./contribution-store"

const transition = {
  sequence: 7,
  at: Date.UTC(2026, 6, 11, 7),
  contribution: {
    id: "b13b1ec9-a85b-4d0b-8eef-0fefc9413f50",
    type: "safe-house" as const,
    contributorPlayerId: "6ad54b67-0cc6-46ac-b67a-b09b315cb8ad",
    contributorLabel: "Oakheart",
    createdAt: Date.UTC(2026, 6, 11, 6, 30),
    expiresAt: Date.UTC(2026, 6, 12, 6, 30),
    status: "locked" as const,
    missionId: "d6c08d84-1795-4ac3-98c3-d5da9f02ed42",
    resolvedAt: null,
  },
}

describe("band contribution persistence", () => {
  it("records an idempotent private transition with contributor provenance", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const store = new SupabaseContributionStore({ rpc } as RpcClient)
    await expect(store.recordTransition(transition)).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith("record_band_contribution_transition", {
      p_sequence: 7,
      p_occurred_at: "2026-07-11T07:00:00.000Z",
      p_contribution: transition.contribution,
      p_band_id: null,
    })
  })

  it("surfaces persistence errors for retry telemetry", async () => {
    const store = new SupabaseContributionStore({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "offline" } }) } as RpcClient)
    await expect(store.recordTransition(transition)).rejects.toThrow("CONTRIBUTION_PERSISTENCE_FAILED: offline")
  })
})
