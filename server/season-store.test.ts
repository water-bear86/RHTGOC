import { describe, expect, it, vi } from "vitest"
import type { RpcClient } from "./band-store"
import { SupabaseSeasonStore } from "./season-store"
import { SherwoodSeasonService } from "./season-service"

describe("season persistence", () => {
  it("records idempotent event-sourced snapshots", async () => {
    const service = new SherwoodSeasonService(1_000)
    service.pause(2_000)
    const transition = service.drainTransitions().at(-1)!
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    await expect(new SupabaseSeasonStore({ rpc } as RpcClient).recordTransition(transition)).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith("record_sherwood_campaign_transition", expect.objectContaining({
      p_sequence: 2,
      p_occurred_at: "1970-01-01T00:00:02.000Z",
      p_event_type: "operator",
      p_snapshot: transition.snapshot,
    }))
  })

  it("surfaces storage failures for the retry queue", async () => {
    const service = new SherwoodSeasonService(1_000)
    service.pause(2_000)
    const store = new SupabaseSeasonStore({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "offline" } }) } as RpcClient)
    await expect(store.recordTransition(service.drainTransitions().at(-1)!)).rejects.toThrow("SEASON_PERSISTENCE_FAILED: offline")
  })

  it("recovers the latest snapshot and replay ledger", async () => {
    const service = new SherwoodSeasonService(1_000)
    const snapshot = service.snapshot(1_000)
    const rpc = vi.fn().mockResolvedValue({ data: { snapshot, processedEventIds: ["mission-1"] }, error: null })
    const store = new SupabaseSeasonStore({ rpc } as RpcClient)
    await expect(store.loadCurrent()).resolves.toEqual({ snapshot, processedEventIds: ["mission-1"] })
    expect(rpc).toHaveBeenCalledWith("load_current_sherwood_campaign", {})
  })
})
