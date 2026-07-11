import { describe, expect, it } from "vitest"
import type { MissionPlayer } from "./mission"
import { Mission, SIGNAL_POSITION, missionSeed } from "./mission"
import type { CharacterId } from "../shared/protocol"

function player(id = "robin", characterId: CharacterId = "robin"): MissionPlayer {
  return {
    id,
    characterId,
    connected: true,
    position: { x: -8, z: 7 },
    health: 3,
    arrows: characterId === "robin" ? 6 : characterId === "little-john" ? 3 : 4,
    loot: 0,
    input: { x: 0, z: 0 },
    lastInputSequence: 0,
    lastInputAt: 0,
    bowCooldown: 0,
    signatureCooldown: 0,
    invulnerableFor: 0,
    veilFor: 0,
    downedFor: 0,
    captured: false,
    rescueCount: 0,
    transferCount: 0,
    lastPingTick: -20,
    totalTransferred: 0,
    protectionScore: 0,
    crowdControl: 0,
    heavyCarryPeak: 0,
    trapHits: 0,
    sabotageCount: 0,
  }
}

describe("authoritative mission", () => {
  it("derives a deterministic seed and replayable first event", () => {
    const players = new Map([["robin", player()]])
    const first = new Mission("ABC234", players)
    const second = new Mission("ABC234", new Map([["robin", player()]]))
    expect(first.seed).toBe(missionSeed("ABC234"))
    expect(first.snapshot()).toEqual(second.snapshot())
    expect(first.events).toEqual([{ sequence: 1, tick: 0, type: "mission_started", playerId: undefined, value: undefined, detail: undefined }])
  })

  it("rejects replayed, over-rate, and post-completion inputs", () => {
    const robin = player()
    const mission = new Mission("ABC234", new Map([[robin.id, robin]]))
    expect(mission.setInput(robin.id, 1, { x: 1, z: 0 }, 100)).toBe(true)
    expect(mission.setInput(robin.id, 1, { x: -1, z: 0 }, 200)).toBe(false)
    expect(mission.setInput(robin.id, 2, { x: -1, z: 0 }, 110)).toBe(false)
    mission.status = "succeeded"
    expect(mission.setInput(robin.id, 3, { x: 1, z: 0 }, 300)).toBe(false)
  })

  it("validates action range and cooldown on the server", () => {
    const robin = player()
    const mission = new Mission("ABC234", new Map([[robin.id, robin]]))
    expect(mission.action(robin.id, "interact")).toBe(false)
    expect(mission.action(robin.id, "shoot")).toBe(false)
    robin.position = { x: 8, z: -6 }
    mission.update(0.7)
    expect(mission.action(robin.id, "shoot")).toBe(true)
    expect(mission.action(robin.id, "shoot")).toBe(false)
    expect(robin.arrows).toBe(4)
  })

  it("records robbery, extraction, and one idempotent completion", () => {
    const robin = player()
    const mission = new Mission("ABC234", new Map([[robin.id, robin]]))
    mission.phase = "robbery"
    robin.position = { x: 10, z: -8 }
    expect(mission.action(robin.id, "interact")).toBe(true)
    expect(robin.loot).toBe(120)
    mission.phase = "escape"
    robin.position = { x: -11, z: 9 }
    mission.delivered = 540
    expect(mission.action(robin.id, "interact")).toBe(true)
    expect(mission.status).toBe("succeeded")
    expect(mission.result?.communityCoin).toBe(660)
    expect(mission.vote?.allocatedCoin).toBe(mission.result?.communityCoin)
    expect(mission.action(robin.id, "interact")).toBe(false)
    expect(mission.events.filter((event) => event.type === "mission_succeeded")).toHaveLength(1)
  })

  it("clamps movement to the world even under sustained tampered intent", () => {
    const robin = player()
    robin.position = { x: 21.9, z: 21.9 }
    const mission = new Mission("ABC234", new Map([[robin.id, robin]]))
    mission.setInput(robin.id, 1, { x: 1, z: 1 }, 100)
    for (let index = 0; index < 100; index += 1) mission.update(0.05)
    expect(robin.position.x).toBeLessThanOrEqual(22)
    expect(robin.position.z).toBeLessThanOrEqual(22)
  })

  it("requires proximity for revive and loot transfer and scores support", () => {
    const robin = player("robin", "robin")
    const marian = player("marian", "marian")
    const mission = new Mission("ABC234", new Map([[robin.id, robin], [marian.id, marian]]))
    robin.loot = 100
    marian.position = { x: 12, z: 12 }
    expect(mission.action(robin.id, "transfer_loot", marian.id)).toBe(false)
    marian.position = { ...robin.position }
    expect(mission.action(robin.id, "transfer_loot", marian.id)).toBe(true)
    expect([robin.loot, marian.loot]).toEqual([40, 60])
    marian.health = 0
    marian.downedFor = 10
    expect(mission.action(robin.id, "revive", marian.id)).toBe(true)
    expect(marian.health).toBe(1)
    expect(marian.downedFor).toBe(0)
    expect(mission.snapshot().supportScore).toBe(450)
  })

  it("validates Little John's crowd-control signature and cooldown on the server", () => {
    const john = player("john", "little-john")
    const marian = player("marian", "marian")
    john.position = { x: 9, z: -7 }
    marian.position = { ...john.position }
    const mission = new Mission("ABC234", new Map([[john.id, john], [marian.id, marian]]))
    expect(mission.action(john.id, "signature")).toBe(true)
    expect(mission.action(john.id, "signature")).toBe(false)
    expect(john.signatureCooldown).toBe(20)
    expect(john.crowdControl).toBeGreaterThanOrEqual(2)
    expect(john.protectionScore).toBe(100)
    expect(marian.invulnerableFor).toBe(3.5)
    expect(mission.events.some((event) => event.type === "crowd_controlled" && event.detail === "little-john-sweep")).toBe(true)
  })

  it("gives the Vanguard a stronger revive and lower heavy-loot slowdown", () => {
    const john = player("john", "little-john")
    const robin = player("robin", "robin")
    const downed = player("downed", "marian")
    downed.health = 0
    downed.downedFor = 10
    downed.position = { ...john.position }
    const mission = new Mission("ABC234", new Map([[john.id, john], [robin.id, robin], [downed.id, downed]]))
    expect(mission.action(john.id, "revive", downed.id)).toBe(true)
    expect(downed.health).toBe(2)
    expect(downed.invulnerableFor).toBe(4.5)
    expect(john.protectionScore).toBe(250)

    john.loot = 300
    robin.loot = 300
    const johnBefore = john.position.x
    const robinBefore = robin.position.x
    mission.setInput(john.id, 1, { x: 1, z: 0 }, 100)
    mission.setInput(robin.id, 1, { x: 1, z: 0 }, 100)
    mission.update(1)
    expect(john.position.x - johnBefore).toBeGreaterThan(robin.position.x - robinBefore)
  })

  it("validates Much's trap placement, duplicate actions, reconnect state, and cleanup", () => {
    const much = player("much", "much")
    const mission = new Mission("ABC234", new Map([[much.id, much]]))
    much.position = { x: 0, z: 0 }
    expect(mission.action(much.id, "signature")).toBe(false)
    much.position = { x: 5, z: 5 }
    expect(mission.action(much.id, "signature")).toBe(true)
    expect(mission.action(much.id, "signature")).toBe(false)
    expect(mission.snapshot().traps).toHaveLength(1)
    much.connected = false
    mission.update(0.05)
    expect(mission.snapshot().traps).toHaveLength(1)
    much.connected = true
    for (let index = 0; index < 599; index += 1) mission.update(0.05)
    expect(mission.snapshot().traps).toHaveLength(0)
    much.signatureCooldown = 0
    mission.phase = "extraction"
    expect(mission.action(much.id, "signature")).toBe(false)
  })

  it("triggers readable traps and shares reinforcement sabotage state", () => {
    const much = player("much", "much")
    const robin = player("robin", "robin")
    const mission = new Mission("ABC234", new Map([[much.id, much], [robin.id, robin]]))
    much.position = { ...mission.guards[0].position }
    expect(mission.action(much.id, "signature")).toBe(true)
    mission.update(0.05)
    expect(much.trapHits).toBe(1)
    expect(mission.snapshot().traps).toHaveLength(0)
    expect(mission.events.some((event) => event.type === "trap_triggered")).toBe(true)

    much.signatureCooldown = 0
    much.position = { ...SIGNAL_POSITION }
    mission.heat = 60
    expect(mission.action(much.id, "interact")).toBe(true)
    expect(mission.action(much.id, "interact")).toBe(false)
    expect(mission.snapshot()).toMatchObject({ signalSabotaged: true, reinforcementDelaySeconds: 30 })
    expect(much.sabotageCount).toBe(1)
    expect(mission.heat).toBe(40)
  })

  it("rate-limits contextual pings and expires them deterministically", () => {
    const robin = player()
    const mission = new Mission("ABC234", new Map([[robin.id, robin]]))
    expect(mission.ping(robin.id, "danger")).toBe(true)
    expect(mission.ping(robin.id, "loot")).toBe(false)
    expect(mission.snapshot().pings).toHaveLength(1)
    for (let index = 0; index < 100; index += 1) mission.update(0.05)
    expect(mission.snapshot().pings).toHaveLength(0)
  })

  it("fails only after every downed player is captured", () => {
    const robin = player("robin", "robin")
    const marian = player("marian", "marian")
    robin.health = 0
    marian.health = 0
    robin.downedFor = 0.05
    marian.downedFor = 0.05
    const mission = new Mission("ABC234", new Map([[robin.id, robin], [marian.id, marian]]))
    mission.update(0.05)
    expect(mission.status).toBe("failed")
    expect(mission.events.filter((event) => event.type === "mission_failed")).toHaveLength(1)
  })

  it("runs the full forest heist phase loop and starts the next shipment", () => {
    const robin = player("robin", "robin")
    const marian = player("marian", "marian")
    const mission = new Mission("ABC234", new Map([[robin.id, robin], [marian.id, marian]]))
    marian.position = { x: -16, z: -4 }
    mission.update(0.05)
    expect([mission.phase, mission.entryRoute]).toEqual(["ambush", "forest"])
    robin.position = { x: 8, z: -6 }
    expect(mission.action(robin.id, "signature")).toBe(true)
    mission.update(18)
    expect(mission.action(robin.id, "shoot")).toBe(true)
    expect(mission.phase).toBe("robbery")
    robin.position = { x: 10, z: -8 }
    expect(mission.action(robin.id, "interact")).toBe(true)
    expect(mission.phase).toBe("pursuit")
    robin.position = { x: -18, z: 15 }
    mission.update(0.05)
    expect([mission.phase, mission.escapeRoute]).toEqual(["escape", "forest"])
    robin.position = { x: -11, z: 9 }
    expect(mission.action(robin.id, "interact")).toBe(true)
    expect([mission.phase, mission.cycle, mission.delivered]).toEqual(["scout", 2, 120])
  })

  it("supports the river route and scales escorts for four players", () => {
    const players = new Map([
      ["r1", player("r1", "robin")],
      ["r2", player("r2", "robin")],
      ["m1", player("m1", "marian")],
      ["m2", player("m2", "marian")],
    ])
    const mission = new Mission("ABC234", players)
    players.get("m1")!.position = { x: 16, z: 2 }
    mission.update(0.05)
    expect(mission.entryRoute).toBe("river")
    expect(mission.guards).toHaveLength(6)
  })

  it("rotates readable modifiers deterministically and exposes optional mastery", () => {
    const robin = player()
    const first = new Mission("ABC234", new Map([[robin.id, robin]]))
    const second = new Mission("ABC234", new Map([["copy", player("copy")]]))
    expect(first.modifiers).toEqual(second.modifiers)
    expect(first.modifiers).toHaveLength(2)
    expect(first.snapshot().optionalObjectives.map((objective) => objective.id)).toEqual(["no-captures", "share-the-wealth", "two-roads"])
    expect(["patrol", "pursuit", "reinforcement"]).toContain(first.snapshot().sheriffPlan)
  })

  it("resolves redistribution ties deterministically and changes the village", () => {
    const robin = player("robin", "robin")
    const marian = player("marian", "marian")
    const mission = new Mission("ABC234", new Map([[robin.id, robin], [marian.id, marian]]))
    mission.phase = "robbery"
    robin.position = { x: 10, z: -8 }
    mission.action(robin.id, "interact")
    mission.phase = "escape"
    mission.delivered = 540
    robin.position = { x: -11, z: 9 }
    mission.action(robin.id, "interact")
    expect(mission.castVote(robin.id, "granary")).toBe(true)
    expect(mission.castVote(marian.id, "watchtower")).toBe(true)
    expect(mission.vote?.resolved).toBe(true)
    expect(mission.vote?.winner).not.toBeNull()
    expect(Object.values(mission.village).reduce((sum, level) => sum + level, 0)).toBe(1)
    expect(mission.vote?.allocatedCoin).toBe(660)
  })

  it("does not wait for a disconnected voter", () => {
    const robin = player("robin", "robin")
    const marian = player("marian", "marian")
    const mission = new Mission("ABC234", new Map([[robin.id, robin], [marian.id, marian]]))
    mission.status = "succeeded"
    mission.vote = { deadlineTick: 300, counts: { granary: 0, infirmary: 0, watchtower: 0 }, votes: {}, resolved: false, winner: null, allocatedCoin: 600 }
    marian.connected = false
    expect(mission.castVote(robin.id, "infirmary")).toBe(true)
    expect(mission.vote.resolved).toBe(true)
    expect(mission.vote.winner).toBe("infirmary")
  })
})
