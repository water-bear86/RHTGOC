import { describe, expect, it, vi } from "vitest"
import { PresentationEventBus } from "./presentation-events"

describe("presentation event bus", () => {
  it("delivers typed events in sequence", () => {
    let now = 100
    const bus = new PresentationEventBus(() => now)
    const listener = vi.fn()
    bus.subscribe(listener)
    expect(bus.publish({ channel: "objective", priority: "important", message: "Cart found", cue: "ui.confirm" })).toMatchObject({
      sequence: 1,
      createdAt: 100,
      channel: "objective",
    })
    now = 200
    bus.publish({ channel: "party", priority: "routine", message: "Regroup" })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener.mock.calls[1]?.[0]).toMatchObject({ sequence: 2, createdAt: 200 })
  })

  it("deduplicates repeated presentation events without hiding later changes", () => {
    let now = 0
    const bus = new PresentationEventBus(() => now, 350)
    const listener = vi.fn()
    bus.subscribe(listener)
    expect(bus.publish({ channel: "system", priority: "routine", message: "Reconnect", dedupeKey: "reconnect" })).not.toBeNull()
    now = 200
    expect(bus.publish({ channel: "system", priority: "routine", message: "Reconnect", dedupeKey: "reconnect" })).toBeNull()
    now = 351
    expect(bus.publish({ channel: "system", priority: "routine", message: "Reconnect", dedupeKey: "reconnect" })).not.toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("unsubscribes listeners cleanly", () => {
    const bus = new PresentationEventBus(() => 0)
    const listener = vi.fn()
    const unsubscribe = bus.subscribe(listener)
    unsubscribe()
    bus.publish({ channel: "action", priority: "routine", message: "Done" })
    expect(listener).not.toHaveBeenCalled()
  })
})
