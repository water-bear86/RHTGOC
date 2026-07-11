import { describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { MAX_ROOM_PLAYERS, RECONNECT_GRACE_MS } from "../shared/protocol"
import { Room } from "./room"
import { rotationWindowAt } from "../shared/sheriff-rotation"

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
    expect(room.lastResult).toEqual({ score: 8000, grade: "A", status: "succeeded", rescuedCaptives: 0, totalCaptives: 0 })
    expect([...room.players.values()].every((player) => !player.ready && player.health === 3 && player.loot === 0)).toBe(true)
  })

  it("launches the selected prison package and preserves a partial rescue on return", () => {
    const room = new Room("IRON25")
    const leader = room.addPlayer(fakeSocket(), "Leader", "little-john")
    const member = room.addPlayer(fakeSocket(), "Member", "much")
    expect(room.selectMission(leader.id, "prison-wagon")).toBe(true)
    room.setReady(leader.id, true)
    room.setReady(member.id, true)
    expect(room.mission?.snapshot()).toMatchObject({ missionId: "prison-wagon@1.0.0", missionKind: "prison-wagon" })
    room.mission!.status = "failed"
    room.mission!.failureReason = "timeout"
    room.mission!.captives[0].rewarded = true
    room.mission!.captives[0].status = "extracted"
    room.mission!.result = {
      score: 4200,
      grade: "C",
      breakdown: { speed: 40, stealth: 50, precision: 70, survival: 60, rescues: 25, generosity: 0 },
      thresholds: { S: 9000, A: 7500, B: 6000, C: 0 },
      communityCoin: 100,
      personalRenown: 2100,
    }
    expect(room.returnToHub(leader.id)).toBe(true)
    expect(room.lastResult).toEqual({ score: 4200, grade: "C", status: "failed", rescuedCaptives: 1, totalCaptives: 3 })
  })

  it("launches the selected storehouse package with mission-owned alarm and cache state", () => {
    const room = new Room("LEDGER")
    const leader = room.addPlayer(fakeSocket(), "Marian", "marian")
    const member = room.addPlayer(fakeSocket(), "Much", "much")
    expect(room.selectMission(leader.id, "royal-storehouse")).toBe(true)
    room.setReady(leader.id, true)
    room.setReady(member.id, true)
    const snapshot = room.mission!.snapshot()
    expect(snapshot).toMatchObject({
      missionId: "royal-storehouse@1.0.0",
      missionKind: "storehouse",
    })
    expect(snapshot.alarms).toEqual(expect.arrayContaining([expect.objectContaining({ id: "alarm.front-gate", status: "active" })]))
    expect(snapshot.lootCaches).toHaveLength(4)
    expect(leader.position).toEqual({ x: -12, z: 9 })
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

  it("launches only the active server-owned Sheriff target for the exact party bracket", () => {
    const now = Date.UTC(2026, 6, 10, 12)
    const window = rotationWindowAt(now)
    const target = window.current.find((rotation) => rotation.partySize === 2)!
    const room = new Room("DAILY2", () => window)
    const leader = room.addPlayer(fakeSocket(), "Robin", "robin")
    const member = room.addPlayer(fakeSocket(), "Marian", "marian")
    expect(room.selectRotation(member.id, target.id, now)).toBe(false)
    expect(room.selectRotation(leader.id, target.id, now)).toBe(true)
    room.setReady(leader.id, true, now)
    expect(room.setReady(member.id, true, now)).toBe(true)
    expect(room.phase).toBe("mission")
    expect(room.mission?.snapshot()).toMatchObject({
      rotationId: target.id,
      rotationModifierIds: target.modifierIds,
      rotationObjectiveIds: target.optionalObjectiveIds,
      missionId: `${target.missionSlug}@${target.missionVersion}`,
    })
    expect(room.mission?.modifiers.map((modifier) => modifier.id)).toEqual(target.modifierIds)
    expect(room.rotationAttemptCount).toBe(1)
  })

  it("rejects stale or wrong-sized daily targets and clears forged readiness", () => {
    const now = Date.UTC(2026, 6, 10, 12)
    const window = rotationWindowAt(now)
    const target = window.current.find((rotation) => rotation.partySize === 3)!
    const room = new Room("DAILY3", () => window)
    const leader = room.addPlayer(fakeSocket(), "Robin", "robin")
    const member = room.addPlayer(fakeSocket(), "Marian", "marian")
    expect(room.selectRotation(leader.id, target.id, now)).toBe(true)
    room.setReady(leader.id, true, now)
    expect(room.setReady(member.id, true, now)).toBe(false)
    expect(room.phase).toBe("lobby")
    expect(room.selectedRotationId).toBeNull()
    expect([...room.players.values()].every((player) => !player.ready)).toBe(true)
    expect(room.selectRotation(leader.id, target.id, target.endsAt)).toBe(false)
  })
})
