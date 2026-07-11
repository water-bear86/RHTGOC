import { describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { MAX_ROOM_PLAYERS, RECONNECT_GRACE_MS } from "../shared/protocol"
import { Room } from "./room"
import { rotationWindowAt } from "../shared/sheriff-rotation"
import type { PersistentBandRecord } from "./band-store"

function fakeSocket(): WebSocket {
  return { readyState: WebSocket.CLOSED, OPEN: WebSocket.OPEN, send: () => undefined, close: () => undefined } as unknown as WebSocket
}

const persistedBand: PersistentBandRecord = {
  state: { id: "8c820e61-d711-4c0e-9020-789ea98d315a", name: "Oak Hearts", bannerId: "oak", camp: { hearth: 1, workbench: 0, stores: 0 }, progressionVersion: 1, missionCount: 0 },
  village: { granary: 2, infirmary: 1, watchtower: 0 },
  actorUserId: "b9fd2fb4-2114-4e4f-aa40-619a0af652a3",
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

  it("claims authenticated authoritative leaderboard runs once for the durable server retry queue", () => {
    const room = new Room("ABC234", rotationWindowAt, () => null, persistedBand)
    const robin = room.addPlayer(fakeSocket(), "Robin", "robin", persistedBand.actorUserId)
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
    expect(room.claimVerifiedRuns()).toEqual(expect.arrayContaining([
      expect.objectContaining({ authUserId: persistedBand.actorUserId, bandId: persistedBand.state.id, playerId: robin.id }),
      expect.objectContaining({ authUserId: undefined, bandId: persistedBand.state.id, playerId: marian.id }),
    ]))
    expect(room.claimVerifiedRuns()).toBeNull()
  })

  it("restores a recognizable band and claims each terminal mission outcome exactly once", () => {
    const room = new Room("BAND24", rotationWindowAt, () => null, persistedBand)
    expect(room.band).toMatchObject({ name: "Oak Hearts", bannerId: "oak", missionCount: 0 })
    expect(room.village).toEqual(persistedBand.village)
    const robin = room.addPlayer(fakeSocket(), "Robin", "robin", persistedBand.actorUserId)
    const marian = room.addPlayer(fakeSocket(), "Marian", "marian")
    room.setReady(robin.id, true)
    room.setReady(marian.id, true)
    room.mission!.status = "succeeded"
    room.mission!.result = {
      score: 8_000, grade: "A", breakdown: { speed: 80, stealth: 80, precision: 80, survival: 80, rescues: 80, generosity: 80 },
      thresholds: { S: 9_000, A: 7_500, B: 6_000, C: 0 }, communityCoin: 660, personalRenown: 4_000,
    }
    room.mission!.vote = { deadlineTick: 300, counts: { granary: 2, infirmary: 0, watchtower: 0 }, votes: {}, resolved: true, winner: "granary", allocatedCoin: 660 }
    expect(room.claimBandMission()).toMatchObject({ bandId: persistedBand.state.id, actorUserId: persistedBand.actorUserId, status: "succeeded", allocationChoice: "granary", allocationCoin: 660 })
    expect(room.claimBandMission()).toBeNull()
    expect(room.refreshPersistentBand({ ...persistedBand, state: { ...persistedBand.state, camp: { hearth: 1, workbench: 1, stores: 0 }, progressionVersion: 2, missionCount: 1 }, village: { granary: 3, infirmary: 1, watchtower: 0 } })).toBe(true)
    expect(room.band).toMatchObject({ missionCount: 1, progressionVersion: 2, camp: { workbench: 1 } })
    expect(room.village.granary).toBe(3)
  })

  it("emits one authoritative seasonal outcome only after community allocation resolves", () => {
    const room = new Room("SEASON")
    const robin = room.addPlayer(fakeSocket(), "Robin", "robin")
    const marian = room.addPlayer(fakeSocket(), "Marian", "marian")
    room.setReady(robin.id, true)
    room.setReady(marian.id, true)
    room.mission!.status = "succeeded"
    room.mission!.delivered = 660
    room.mission!.result = {
      score: 8_000, grade: "A", breakdown: { speed: 80, stealth: 80, precision: 80, survival: 80, rescues: 80, generosity: 80 },
      thresholds: { S: 9_000, A: 7_500, B: 6_000, C: 0 }, communityCoin: 660, personalRenown: 4_000,
    }
    room.mission!.vote = { deadlineTick: 300, counts: { granary: 2, infirmary: 0, watchtower: 0 }, votes: {}, resolved: false, winner: null, allocatedCoin: 660 }
    expect(room.claimSeasonOutcome(1_000)).toBeNull()
    room.mission!.vote.resolved = true
    room.mission!.vote.winner = "granary"
    expect(room.claimSeasonOutcome(1_001)).toMatchObject({ status: "succeeded", project: "granary", communityCoin: 660, tacticalScore: 8_000, cleanEscape: true })
    expect(room.claimSeasonOutcome(1_002)).toBeNull()
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

  it("caps, selects, locks, credits, and refunds shared preparations authoritatively", () => {
    const now = 10_000
    const room = new Room("PREP28")
    const leader = room.addPlayer(fakeSocket(), "Leader", "robin")
    const member = room.addPlayer(fakeSocket(), "Scout", "marian")
    const supplies = room.depositContribution(leader.id, "supplies", now)!
    const safeHouse = room.depositContribution(leader.id, "safe-house", now + 1)!
    const intelligence = room.depositContribution(member.id, "intelligence", now + 2)!
    const snare = room.depositContribution(member.id, "snare-kit", now + 3)!
    expect(room.depositContribution(leader.id, "supplies", now + 4)).toBeNull()
    expect(room.toggleContribution(member.id, supplies.id, now + 5)).toBe(false)
    expect(room.toggleContribution(leader.id, supplies.id, now + 6)).toBe(true)
    expect(room.toggleContribution(leader.id, intelligence.id, now + 7)).toBe(true)
    expect(room.toggleContribution(leader.id, snare.id, now + 8)).toBe(true)
    expect(room.toggleContribution(leader.id, safeHouse.id, now + 9)).toBe(false)
    room.disconnect(member.id, now + 9)
    expect(room.reconnect(fakeSocket(), member.reconnectToken, now + 9)?.id).toBe(member.id)
    expect(room.contributions.get(intelligence.id)?.contributorPlayerId).toBe(member.id)
    room.setReady(leader.id, true, now + 10)
    room.setReady(member.id, true, now + 11)
    expect(room.phase).toBe("mission")
    expect(room.mission?.snapshot().preparations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: supplies.id, status: "active" }),
      expect.objectContaining({ id: intelligence.id, status: "consumed" }),
      expect.objectContaining({ id: snare.id, status: "consumed" }),
    ]))
    expect(room.contributions.get(supplies.id)).toMatchObject({ status: "locked", missionId: expect.any(String) })
    room.mission!.status = "failed"
    room.update(0.05, now + 20)
    expect(room.contributions.get(supplies.id)?.status).toBe("refunded")
    expect(room.contributions.get(intelligence.id)?.status).toBe("consumed")
    expect(room.contributions.get(snare.id)?.status).toBe("consumed")
    expect(room.contributions.get(safeHouse.id)?.status).toBe("available")
    const terminal = room.drainContributionEvents().filter((transition) => transition.contribution.resolvedAt === now + 20)
    expect(terminal.map((transition) => transition.contribution.status).sort()).toEqual(["consumed", "consumed", "refunded"])
  })

  it("serializes concurrent-like deposits against room, type, and contributor caps", () => {
    const room = new Room("PREP31")
    const robin = room.addPlayer(fakeSocket(), "Robin", "robin")
    const marian = room.addPlayer(fakeSocket(), "Marian", "marian")
    const john = room.addPlayer(fakeSocket(), "John", "little-john")
    expect(room.depositContribution(robin.id, "supplies", 1_000)).not.toBeNull()
    expect(room.depositContribution(marian.id, "supplies", 1_000)).not.toBeNull()
    expect(room.depositContribution(john.id, "supplies", 1_000)).toBeNull()
    expect(room.depositContribution(robin.id, "intelligence", 1_000)).not.toBeNull()
    expect(room.depositContribution(robin.id, "snare-kit", 1_000)).toBeNull()
    expect(room.depositContribution(marian.id, "intelligence", 1_000)).not.toBeNull()
    expect(room.depositContribution(john.id, "snare-kit", 1_000)).not.toBeNull()
    expect(room.depositContribution(john.id, "safe-house", 1_000)).not.toBeNull()
    expect([...room.contributions.values()].filter((contribution) => contribution.status === "available")).toHaveLength(6)
  })

  it("expires available contributions and lets only their contributor revoke an unlocked one", () => {
    const room = new Room("PREP29")
    const leader = room.addPlayer(fakeSocket(), "Leader", "robin")
    const member = room.addPlayer(fakeSocket(), "Member", "marian")
    const expiring = room.depositContribution(member.id, "supplies", 1_000)!
    expect(room.revokeContribution(leader.id, expiring.id, 2_000)).toBe(false)
    expect(room.toggleContribution(leader.id, expiring.id, 2_001)).toBe(true)
    room.update(0, expiring.expiresAt)
    expect(room.contributions.get(expiring.id)?.status).toBe("expired")
    expect(room.selectedContributionIds.has(expiring.id)).toBe(false)
    const revocable = room.depositContribution(member.id, "safe-house", expiring.expiresAt + 1)!
    expect(room.revokeContribution(member.id, revocable.id, expiring.expiresAt + 2)).toBe(true)
    expect(room.contributions.get(revocable.id)?.status).toBe("revoked")
  })

  it("refunds unused locked preparation even when a cancelled run returns before another server tick", () => {
    const room = new Room("PREP30")
    const leader = room.addPlayer(fakeSocket(), "Leader", "robin")
    const member = room.addPlayer(fakeSocket(), "Member", "marian")
    const supplies = room.depositContribution(leader.id, "supplies", 1_000)!
    room.toggleContribution(leader.id, supplies.id, 1_001)
    room.setReady(leader.id, true, 1_002)
    room.setReady(member.id, true, 1_003)
    room.mission!.status = "failed"
    expect(room.returnToHub(leader.id, 1_004)).toBe(true)
    expect(room.contributions.get(supplies.id)).toMatchObject({ status: "refunded", resolvedAt: 1_004 })
  })

  it("reconnects within grace and rejects expired tokens", () => {
    const room = new Room("ABC234")
    const player = room.addPlayer(fakeSocket(), "Marian", "marian")
    room.disconnect(player.id, 1_000)
    expect(room.reconnect(fakeSocket(), player.reconnectToken, 1_000 + RECONNECT_GRACE_MS - 1)?.id).toBe(player.id)
    room.disconnect(player.id, 2_000)
    expect(room.reconnect(fakeSocket(), player.reconnectToken, 2_000 + RECONNECT_GRACE_MS + 1)).toBeNull()
  })

  it("preserves verified identity across reconnect and rejects a token bound to another user", () => {
    const room = new Room("AUTH24")
    const userId = "66778899-aabb-4cdd-8eef-001122334455"
    const player = room.addPlayer(fakeSocket(), "Oakheart", "robin", userId)
    room.disconnect(player.id, 1_000)
    expect(room.reconnect(fakeSocket(), player.reconnectToken, 1_001, "778899aa-bbcc-4dee-8ff0-112233445566")).toBeNull()
    expect(room.reconnect(fakeSocket(), player.reconnectToken, 1_002, userId)?.id).toBe(player.id)
    expect(room.authenticatedUserIds()).toEqual([userId])
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

  it("creates one bounded rescue offer and settles recovery exactly once across reconnects", () => {
    const now = Date.UTC(2026, 6, 10, 12)
    const room = new Room("RESCUE")
    const leader = room.addPlayer(fakeSocket(), "Robin", "robin")
    const member = room.addPlayer(fakeSocket(), "Marian", "marian")
    room.setReady(leader.id, true, now)
    room.setReady(member.id, true, now)
    const failed = room.mission!
    failed.status = "failed"
    failed.failureReason = "captured"
    leader.captured = true
    failed.result = {
      score: 3200, grade: "C",
      breakdown: { speed: 30, stealth: 40, precision: 60, survival: 20, rescues: 0, generosity: 0 },
      thresholds: { S: 9000, A: 7500, B: 6000, C: 0 },
      communityCoin: 0, personalRenown: 1600,
    }
    room.update(0.05, now + 1)
    const offer = structuredClone(room.rescueOffer!)
    expect(offer).toMatchObject({ context: "captured-outlaws", targetCount: 1, status: "active", attempts: 0, rewardSettled: false })
    room.update(0.05, now + 2)
    expect(room.rescueOffer?.id).toBe(offer.id)
    expect(room.rescueOfferEvents.filter((event) => event.offer.status === "active")).toHaveLength(1)

    expect(room.returnToHub(leader.id)).toBe(true)
    expect(leader.captured).toBe(false)
    room.disconnect(member.id, now + 3)
    expect(room.reconnect(fakeSocket(), member.reconnectToken, now + 4)?.id).toBe(member.id)
    expect(room.rescueOffer?.id).toBe(offer.id)
    expect(room.acceptRescue(member.id, offer.id, now + 5)).toBe(false)
    expect(room.acceptRescue(leader.id, offer.id, now + 5)).toBe(true)
    expect(room.acceptRescue(leader.id, offer.id, now + 5)).toBe(false)
    room.setReady(leader.id, true, now + 6)
    room.setReady(member.id, true, now + 6)
    expect(room.mission?.snapshot()).toMatchObject({ rescueOfferId: offer.id, rescueSourceMissionId: offer.sourceMissionId, missionKind: "prison-wagon" })
    expect(room.rescueOffer?.attempts).toBe(1)

    room.mission!.status = "succeeded"
    room.mission!.delivered = 300
    room.mission!.result = {
      score: 8000, grade: "A",
      breakdown: { speed: 80, stealth: 80, precision: 80, survival: 80, rescues: 75, generosity: 0 },
      thresholds: { S: 9000, A: 7500, B: 6000, C: 0 },
      communityCoin: 300, personalRenown: 4000,
    }
    room.update(0.05, now + 7)
    expect(room.rescueOffer).toMatchObject({ status: "completed", rewardSettled: true, recoveredValue: 300, attempts: 1 })
    const completedEvents = room.rescueOfferEvents.filter((event) => event.offer.status === "completed").length
    room.update(0.05, now + 8)
    expect(room.rescueOfferEvents.filter((event) => event.offer.status === "completed")).toHaveLength(completedEvents)
  })

  it("expires or abandons offers deterministically and does not chain repeated rescue failure", () => {
    const now = Date.UTC(2026, 6, 10, 12)
    const room = new Room("EXPIRE")
    const leader = room.addPlayer(fakeSocket(), "Robin", "robin")
    const member = room.addPlayer(fakeSocket(), "Marian", "marian")
    room.setReady(leader.id, true, now)
    room.setReady(member.id, true, now)
    room.mission!.status = "failed"
    room.mission!.failureReason = "timeout"
    room.update(0.05, now + 1)
    const offer = room.rescueOffer!
    expect(room.returnToHub(leader.id)).toBe(true)
    room.update(0.05, offer.expiresAt)
    expect(room.rescueOffer?.status).toBe("expired")

    const later = offer.expiresAt + 100
    room.setReady(leader.id, true, later)
    room.setReady(member.id, true, later)
    room.mission!.status = "failed"
    room.mission!.failureReason = "captured"
    room.update(0.05, later + 1)
    const second = room.rescueOffer!
    expect(second.id).not.toBe(offer.id)
    expect(room.returnToHub(leader.id)).toBe(true)
    expect(room.abandonRescue(leader.id, second.id, later + 2)).toBe(true)
    expect(room.rescueOffer?.status).toBe("abandoned")
    expect(room.acceptRescue(leader.id, second.id, later + 3)).toBe(false)
  })
})
