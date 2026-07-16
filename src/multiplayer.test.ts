import { afterEach, describe, expect, it, vi } from "vitest"
import { classifyBowPredictionSnapshot, MultiplayerClient } from "./multiplayer"

afterEach(() => vi.unstubAllGlobals())

describe("multiplayer bow prediction", () => {
  it("waits for a causal acknowledgement but honors authoritative recovery", () => {
    expect(classifyBowPredictionSnapshot(null, {
      accepted: false,
      awaitingAck: true,
      serverActionSeen: false,
      suppressed: false,
    })).toBe("wait")
    expect(classifyBowPredictionSnapshot("recovery", {
      accepted: false,
      awaitingAck: true,
      serverActionSeen: true,
      suppressed: false,
    })).toBe("wait")
    expect(classifyBowPredictionSnapshot(null, {
      accepted: true,
      awaitingAck: false,
      serverActionSeen: false,
      suppressed: false,
    })).toBe("clear")
    expect(classifyBowPredictionSnapshot("drawing", {
      accepted: true,
      awaitingAck: false,
      serverActionSeen: true,
      suppressed: true,
    })).toBe("suppress-draw")
    expect(classifyBowPredictionSnapshot("recovery", {
      accepted: true,
      awaitingAck: false,
      serverActionSeen: true,
      suppressed: true,
    })).toBe("reconcile")
  })

  it("ignores messages queued by a retired socket after reconnect", () => {
    type Listener = (event: { data?: string }) => void
    class FakeSocket {
      static readonly instances: FakeSocket[] = []
      static readonly OPEN = 1
      readonly OPEN = 1
      readyState = 1
      private readonly listeners = new Map<string, Listener[]>()

      constructor(_url: string) {
        FakeSocket.instances.push(this)
      }

      addEventListener(type: string, listener: Listener): void {
        const listeners = this.listeners.get(type) ?? []
        listeners.push(listener)
        this.listeners.set(type, listeners)
      }

      close(): void {
        this.readyState = 3
        this.emit("close", {})
      }

      send(_value: string): void {}

      emit(type: string, event: { data?: string }): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event)
      }
    }

    vi.stubGlobal("WebSocket", FakeSocket)
    vi.stubGlobal("location", { protocol: "http:", hostname: "localhost", host: "localhost" })
    vi.stubGlobal("window", {
      clearInterval: vi.fn(),
      clearTimeout: vi.fn(),
      setInterval: vi.fn(() => 1),
      setTimeout: vi.fn(() => 1),
    })
    const onActionResult = vi.fn()
    const client = new MultiplayerClient({ onActionResult })
    const connect = (client as unknown as { connect: (action: () => void) => void }).connect.bind(client)
    const retiredAction = vi.fn()
    const currentAction = vi.fn()

    connect(retiredAction)
    const retired = FakeSocket.instances[0]
    connect(currentAction)
    const current = FakeSocket.instances[1]

    retired.emit("open", {})
    current.emit("open", {})
    current.emit("message", { data: JSON.stringify({ type: "action_result", requestId: 7, action: "shoot", accepted: true }) })
    retired.emit("message", { data: JSON.stringify({ type: "action_result", requestId: 7, action: "shoot", accepted: false }) })

    expect(retiredAction).not.toHaveBeenCalled()
    expect(currentAction).toHaveBeenCalledTimes(1)
    expect(onActionResult).toHaveBeenCalledTimes(1)
    expect(onActionResult).toHaveBeenCalledWith(7, "shoot", true)
  })
})
