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
    for (let index = 0; index < MAX_ROOM_PLAYERS; index += 1) room.addPlayer(fakeSocket(), `Player ${index}`, index % 2 === 0 ? "robin" : "marian")
    expect(() => room.addPlayer(fakeSocket(), "Fifth", "marian")).toThrow("ROOM_FULL")
  })

  it("reserves each specialist role for at most two players", () => {
    const room = new Room("ABC234")
    room.addPlayer(fakeSocket(), "Robin One", "robin")
    room.addPlayer(fakeSocket(), "Robin Two", "robin")
    expect(() => room.addPlayer(fakeSocket(), "Robin Three", "robin")).toThrow("ROLE_FULL")
    const marian = room.addPlayer(fakeSocket(), "Marian", "marian")
    expect(room.selectCharacter(marian.id, "robin")).toBe(false)
  })

  it("keeps deterministic, collision-free spawns when a slot is pruned", () => {
    const room = new Room("ABC234")
    const first = room.addPlayer(fakeSocket(), "First", "robin")
    const second = room.addPlayer(fakeSocket(), "Second", "marian")
    room.disconnect(first.id, 1_000)
    room.pruneDisconnected(1_000 + RECONNECT_GRACE_MS + 1)
    const replacement = room.addPlayer(fakeSocket(), "Replacement", "robin")
    expect(replacement.position).toEqual({ x: -8, z: 7 })
    expect(replacement.position).not.toEqual(second.position)
  })

  it("isolates players and ticks across concurrent rooms", () => {
    const rooms = Array.from({ length: 12 }, (_, index) => new Room(`RM${String(index).padStart(4, "2")}`))
    for (const [index, room] of rooms.entries()) {
      const robin = room.addPlayer(fakeSocket(), `Robin ${index}`, "robin")
      const marian = room.addPlayer(fakeSocket(), `Marian ${index}`, "marian")
      room.setReady(robin.id, true)
      room.setReady(marian.id, true)
      room.setInput(robin.id, 1, { x: 1, z: 0 })
      room.update(0.05)
    }
    expect(new Set(rooms.flatMap((room) => [...room.players.keys()])).size).toBe(24)
    expect(rooms.every((room) => room.tick === 1 && room.players.size === 2)).toBe(true)
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
