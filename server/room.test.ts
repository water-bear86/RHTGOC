import { describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { MAX_ROOM_PLAYERS, RECONNECT_GRACE_MS } from "../shared/protocol"
import { Room } from "./room"

function fakeSocket(): WebSocket {
  return { readyState: WebSocket.CLOSED, OPEN: WebSocket.OPEN, send: () => undefined } as unknown as WebSocket
}

describe("Merry Band room", () => {
  it("caps rooms at four players", () => {
    const room = new Room("ABC234")
    for (let index = 0; index < MAX_ROOM_PLAYERS; index += 1) room.addPlayer(fakeSocket(), `Player ${index}`, "robin")
    expect(() => room.addPlayer(fakeSocket(), "Fifth", "marian")).toThrow("ROOM_FULL")
  })

  it("starts only when at least two connected players are ready", () => {
    const room = new Room("ABC234")
    const first = room.addPlayer(fakeSocket(), "Robin", "robin")
    const second = room.addPlayer(fakeSocket(), "Marian", "marian")
    room.setReady(first.id, true)
    expect(room.phase).toBe("lobby")
    room.setReady(second.id, true)
    expect(room.phase).toBe("mission")
  })

  it("reconnects within grace and rejects expired tokens", () => {
    const room = new Room("ABC234")
    const player = room.addPlayer(fakeSocket(), "Marian", "marian")
    room.disconnect(player.id, 1_000)
    expect(room.reconnect(fakeSocket(), player.reconnectToken, 1_000 + RECONNECT_GRACE_MS - 1)?.id).toBe(player.id)
    room.disconnect(player.id, 2_000)
    expect(room.reconnect(fakeSocket(), player.reconnectToken, 2_000 + RECONNECT_GRACE_MS + 1)).toBeNull()
  })

  it("normalizes input and advances authoritative movement", () => {
    const room = new Room("ABC234")
    const first = room.addPlayer(fakeSocket(), "Robin", "robin")
    const second = room.addPlayer(fakeSocket(), "Marian", "marian")
    room.setReady(first.id, true)
    room.setReady(second.id, true)
    const before = first.position.x
    room.setInput(first.id, 1, { x: 1, z: 1 })
    room.update(0.5)
    expect(first.position.x).toBeGreaterThan(before)
    expect(first.lastInputSequence).toBe(1)
  })
})
