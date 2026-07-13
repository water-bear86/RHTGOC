import { describe, expect, it, vi } from "vitest"
import { Telemetry, structuredLog } from "./telemetry"

describe("Telemetry", () => {
  it("tracks sorted counters and gauges without player identity", () => {
    const telemetry = new Telemetry()
    telemetry.reset(1_000)
    telemetry.increment("rooms_created_total")
    telemetry.increment("rooms_created_total")
    telemetry.gauge("active_rooms", 3)
    expect(telemetry.snapshot()).toMatchObject({ counters: { rooms_created_total: 2 }, gauges: { active_rooms: 3 } })
  })

  it("emits one-line structured JSON", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
    structuredLog("room_created", { partySize: 1 })
    expect(() => JSON.parse(String(log.mock.calls[0][0]))).not.toThrow()
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ level: "info", event: "room_created", partySize: 1 })
    log.mockRestore()
  })

  it("routes errors to structured stderr without personal data", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    structuredLog("persistence_failed", { traceId: "trace-1", reason: "timeout" }, "error")
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      level: "error",
      event: "persistence_failed",
      traceId: "trace-1",
      reason: "timeout",
    })
    log.mockRestore()
  })
})
