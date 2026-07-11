import { describe, expect, it, vi } from "vitest"
import type { RpcClient } from "./band-store"
import { SupabaseRescueOfferStore } from "./rescue-offer-store"

const transition = {
  sequence: 2,
  at: Date.UTC(2026, 6, 10, 12),
  offer: {
    id: "8c02777e-2bb5-5afd-9f42-7a7b1ca4c622",
    sourceMissionId: "0bb19eb9-acde-5bc7-8fb6-91f095c2657b",
    sourceMissionSlug: "peoples-purse",
    rescueMissionSlug: "prison-wagon" as const,
    context: "captured-outlaws" as const,
    targetCount: 1,
    status: "accepted" as const,
    createdAt: Date.UTC(2026, 6, 10, 11, 55),
    expiresAt: Date.UTC(2026, 6, 10, 12, 25),
    acceptedAt: Date.UTC(2026, 6, 10, 12),
    resolvedAt: null,
    attempts: 0,
    rewardSettled: false,
    recoveredValue: 0,
  },
}

describe("rescue offer persistence", () => {
  it("records an idempotent server transition without exposing it to public roles", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const store = new SupabaseRescueOfferStore({ rpc } as RpcClient)
    await expect(store.recordTransition(transition)).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith("record_rescue_offer_transition", {
      p_sequence: 2,
      p_occurred_at: "2026-07-10T12:00:00.000Z",
      p_offer: transition.offer,
      p_band_id: null,
    })
  })

  it("surfaces persistence errors for retry telemetry", async () => {
    const store = new SupabaseRescueOfferStore({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "offline" } }) } as RpcClient)
    await expect(store.recordTransition(transition)).rejects.toThrow("RESCUE_OFFER_PERSISTENCE_FAILED: offline")
  })
})
