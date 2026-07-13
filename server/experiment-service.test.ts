import { describe, expect, it, vi } from "vitest"
import type { GameplayExperimentDefinition } from "../shared/experiments"
import type { RpcClient } from "./band-store"
import { ExperimentService, SupabaseExperimentDefinitionSource, type ExperimentDefinitionSource } from "./experiment-service"

const control = {
  id: "road-density",
  revision: 1,
  salt: "road-density-r1",
  allocationBps: 10_000,
  variants: [
    { id: "control", weightBps: 5_000, config: { density: 1 } },
    { id: "treatment", weightBps: 5_000, config: { density: 1.2 } },
  ],
}

describe("SupabaseExperimentDefinitionSource", () => {
  it("loads active definitions through a service-only RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [control], error: null })
    const source = new SupabaseExperimentDefinitionSource({ rpc } as RpcClient)
    await expect(source.loadActive("2026-07-13T20:00:00.000Z")).resolves.toEqual([control])
    expect(rpc).toHaveBeenCalledWith("get_active_gameplay_experiments", { p_at: "2026-07-13T20:00:00.000Z" })
  })

  it("rejects RPC errors and malformed definitions", async () => {
    await expect(new SupabaseExperimentDefinitionSource({ rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "offline" } }) } as RpcClient)
      .loadActive("2026-07-13T20:00:00.000Z")).rejects.toThrow("EXPERIMENT_LOAD_FAILED: offline")
    await expect(new SupabaseExperimentDefinitionSource({ rpc: vi.fn().mockResolvedValue({ data: [{ ...control, roomId: "forbidden" }], error: null }) } as RpcClient)
      .loadActive("2026-07-13T20:00:00.000Z")).rejects.toThrow("unsupported fields")
  })
})

describe("ExperimentService", () => {
  it("freezes assignment for a room while refreshed definitions apply to new rooms", async () => {
    let definitions: GameplayExperimentDefinition[] = [control]
    const source: ExperimentDefinitionSource = { loadActive: vi.fn(async (): Promise<GameplayExperimentDefinition[]> => definitions) }
    const service = new ExperimentService(source, { refreshIntervalMs: 1_000 })
    await service.refresh(1_000)
    const first = service.assignRoom("existing-room")

    definitions = [{ ...control, revision: 2, salt: "road-density-r2" }]
    await service.refresh(2_000, true)
    expect(service.assignRoom("existing-room")).toEqual(first)
    expect(service.assignRoom("new-room")[0].experimentRevision).toBe(2)
    service.releaseRoom("existing-room")
    expect(service.assignRoom("existing-room")[0].experimentRevision).toBe(2)
  })

  it("deduplicates simultaneous refreshes and bounds the room cache", async () => {
    let resolve!: (definitions: GameplayExperimentDefinition[]) => void
    const loadActive: ExperimentDefinitionSource["loadActive"] = vi.fn(
      () => new Promise<GameplayExperimentDefinition[]>((done) => { resolve = done }),
    )
    const source: ExperimentDefinitionSource = { loadActive }
    const service = new ExperimentService(source, { refreshIntervalMs: 1_000, maxCachedRooms: 2 })
    const first = service.refresh(1_000)
    const second = service.refresh(1_000)
    resolve([control])
    await Promise.all([first, second])
    expect(source.loadActive).toHaveBeenCalledTimes(1)
    service.assignRoom("one")
    service.assignRoom("two")
    service.assignRoom("three")
    expect(service.cachedRoomCount()).toBe(2)
  })
})
