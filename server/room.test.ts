import { describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { MAX_ROOM_PLAYERS, RECONNECT_GRACE_MS } from "../shared/protocol"
import { Room } from "./room"

function fakeSocket(): WebSocket {
  return { readyState: WebSocket.CLOSED, OPEN: WebSocket.OPEN, send: () => undefined, close: () => undefined } as unknown as WebSocket
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

  it("synchronizes Little John selection and Vanguard resources before readiness", () => {
    const room = new Room("ABC234")
    const player = room.addPlayer(fakeSocket(), "John", "robin")
    expect(room.selectCharacter(player.id, "little-john")).toBe(true)
    expect(room.publicPlayer(player)).toMatchObject({ characterId: "little-john", arrows: 3, ready: false, protectionScore: 0, crowdControl: 0, heavyCarryPeak: 0 })
  })

  it("synchronizes Much selection and Saboteur contribution state", () => {
    const room = new Room("ABC234")
    const player = room.addPlayer(fakeSocket(), "Much", "much")
    expect(room.publicPlayer(player)).toMatchObject({ characterId: "much", trapHits: 0, sabotageCount: 0 })
  })

  it("keeps mission, role, loadout, and readiness synchronized in the campfire hub", () => {
    const room = new Room("ABC234")
    const leader = room.addPlayer(fakeSocket(), "Leader", "robin")
    const member = room.addPlayer(fakeSocket(), "Member", "marian")
    expect(room.selectMission(member.id, "peoples-purse")).toBe(false)
    expect(room.selectMission(leader.id, "peoples-purse")).toBe(true)
    expect(room.selectLoadout(member.id, "smoke")).toBe(true)
    expect(room.publicPlayer(member).loadoutId).toBe("smoke")
    room.setReady(leader.id, true)
    room.setReady(member.id, true)
    expect(room.phase).toBe("mission")
    expect(room.mission?.definition.slug).toBe("peoples-purse")
    expect(room.mission?.snapshot().village).toEqual({ granary: 0, infirmary: 0, watchtower: 0 })
  })

  it("returns a resolved band to the hub with village progress and a fresh replay state", () => {
    const room = new Room("ABC234")
    const leader = room.addPlayer(fakeSocket(), "Leader", "robin")
    const member = room.addPlayer(fakeSocket(), "Member", "marian")
    room.setReady(leader.id, true)
    room.setReady(member.id, true)
    const mission = room.mission!
    mission.status = "succeeded"
    mission.result = {
      score: 8000,
      grade: "A",
      breakdown: { speed: 80, stealth: 80, precision: 80, survival: 80, rescues: 80, generosity: 80 },
      thresholds: { S: 9000, A: 7500, B: 6000, C: 0 },
      communityCoin: 660,
      personalRenown: 4000,
    }
    mission.vote = { deadlineTick: 300, counts: { granary: 2, infirmary: 0, watchtower: 0 }, votes: {}, resolved: true, winner: "granary", allocatedCoin: 660 }
    mission.village.granary = 1
    expect(room.returnToHub(member.id)).toBe(false)
    expect(room.returnToHub(leader.id)).toBe(true)
    expect(room.phase).toBe("lobby")
    expect(room.mission).toBeNull()
    expect(room.village).toEqual({ granary: 1, infirmary: 0, watchtower: 0 })
    expect(room.lastResult).toEqual({ score: 8000, grade: "A" })
    expect([...room.players.values()].every((player) => !player.ready && player.health === 3 && player.loot === 0)).toBe(true)
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

  it("audits reports and restricts removal to the current room moderator", () => {
    const room = new Room("ABC234")
    const leader = room.addPlayer(fakeSocket(), "Leader", "robin")
    const member = room.addPlayer(fakeSocket(), "Member", "marian")
    expect(room.moderate(member.id, leader.id, "remove")).toBe(false)
    expect(room.moderate(member.id, leader.id, "report", "griefing", 1_000)).toBe(true)
    expect(room.moderationEvents).toEqual([{ at: 1_000, actorId: member.id, targetId: leader.id, action: "report", reason: "griefing" }])
  })

  it("blocks a removed reconnect token for the rest of the room", () => {
    const room = new Room("ABC234")
    const leader = room.addPlayer(fakeSocket(), "Leader", "robin")
    const member = room.addPlayer(fakeSocket(), "Member", "marian")
    expect(room.moderate(leader.id, member.id, "block", undefined, 2_000)).toBe(true)
    expect(room.players.has(member.id)).toBe(false)
    expect(room.reconnect(fakeSocket(), member.reconnectToken, 2_001)).toBeNull()
  })

  it("claims authoritative leaderboard runs once and retries only after failure", () => {
    const room = new Room("ABC234")
    const robin = room.addPlayer(fakeSocket(), "Robin", "robin")
    const marian = room.addPlayer(fakeSocket(), "Marian", "marian")
    room.setReady(robin.id, true)
    room.setReady(marian.id, true)
    room.mission!.status = "succeeded"
    room.mission!.elapsedSeconds = 900
    room.mission!.delivered = 660
    room.mission!.result = {
      score: 8000,
      grade: "A",
      breakdown: { speed: 80, stealth: 80, precision: 80, survival: 80, rescues: 80, generosity: 80 },
      thresholds: { S: 9000, A: 7500, B: 6000, C: 0 },
      communityCoin: 660,
      personalRenown: 4000,
    }
    expect(room.claimVerifiedRuns()).toHaveLength(2)
    expect(room.claimVerifiedRuns()).toBeNull()
    room.finishLeaderboardPersistence(false)
    expect(room.claimVerifiedRuns()).toHaveLength(2)
    room.finishLeaderboardPersistence(true)
    expect(room.claimVerifiedRuns()).toBeNull()
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
