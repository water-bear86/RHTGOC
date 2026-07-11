import { describe, expect, it } from "vitest"
import type { MissionPlayer } from "./mission"
import { Mission, SIGNAL_POSITION, missionSeed } from "./mission"
import type { CharacterId } from "../shared/protocol"
import referencePackage from "../missions/peoples-purse.v1.json"
import { missionContentHash, parseMissionDefinition } from "../shared/mission-definition"
import { PRISON_WAGON_MISSION, ROYAL_STOREHOUSE_MISSION } from "../shared/mission-catalog"
import { VILLAGE_COTTAGE_COLLIDER, isSherwoodPlayerPositionBlocked } from "../shared/world-collisions"
import { createInitialState, updateSimulation } from "../src/simulation"

function player(id = "robin", characterId: CharacterId = "robin"): MissionPlayer {
  return {
    id,
    characterId,
    loadoutId: "balanced",
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
    expect(first.snapshot()).toMatchObject({ missionId: "peoples-purse@1.0.0", missionVersion: "1.0.0", contentHash: referencePackage.contentHash })
  })

  it("runs a cloned package variant without changing core mission code", () => {
    const variant = structuredClone(referencePackage) as typeof referencePackage
    variant.id = "peoples-purse-fast@1.1.0"
    variant.slug = "peoples-purse-fast"
    variant.missionVersion = "1.1.0"
    variant.name = "The People's Purse: Fast"
    variant.rewards.deliveryTarget = 777
    variant.rewards.doubleTitheTarget = 777
    variant.rewards.baseCartValue = 99
    variant.rewards.doubleTitheCartValue = 99
    variant.contentHash = missionContentHash(variant)
    const definition = parseMissionDefinition(variant)
    const robin = player()
    const mission = new Mission("ABC234", new Map([[robin.id, robin]]), definition)
    mission.phase = "robbery"
    robin.position = { ...definition.spawns.cart }
    expect(mission.action(robin.id, "interact")).toBe(true)
    expect(robin.loot).toBe(99)
    expect(mission.snapshot()).toMatchObject({ missionId: variant.id, missionVersion: "1.1.0", contentHash: variant.contentHash, target: 777 })
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

  it("keeps solo prediction and authoritative movement identical at the rotated cottage", () => {
    const cosine = Math.cos(VILLAGE_COTTAGE_COLLIDER.rotation)
    const sine = Math.sin(VILLAGE_COTTAGE_COLLIDER.rotation)
    const start = {
      x: VILLAGE_COTTAGE_COLLIDER.center.x + cosine * -4 + sine * -1.5,
      z: VILLAGE_COTTAGE_COLLIDER.center.z - sine * -4 + cosine * -1.5,
    }
    const diagonal = 1 / Math.sqrt(2)
    const move = {
      x: cosine * diagonal + sine * diagonal,
      z: -sine * diagonal + cosine * diagonal,
    }
    const local = createInitialState("robin")
    local.player.position = { ...start }
    const remote = player("remote", "robin")
    remote.position = { ...start }
    const mission = new Mission("COTTAGE", new Map([[remote.id, remote]]))

    updateSimulation(local, { move }, 0.5)
    expect(mission.setInput(remote.id, 1, move, 100)).toBe(true)
    mission.update(0.5)

    expect(remote.position.x).toBeCloseTo(local.player.position.x, 10)
    expect(remote.position.z).toBeCloseTo(local.player.position.z, 10)
    expect(isSherwoodPlayerPositionBlocked(remote.position)).toBe(false)
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

  it("applies synchronized field-kit rules without trusting the renderer", () => {
    const rescuer = player("rescuer", "robin")
    rescuer.loadoutId = "bandage"
    const target = player("target", "marian")
    target.health = 0
    target.downedFor = 10
    target.position = { ...rescuer.position }
    const smoker = player("smoker", "much")
    smoker.loadoutId = "smoke"
    const mission = new Mission("ABC234", new Map([[rescuer.id, rescuer], [target.id, target], [smoker.id, smoker]]))
    expect(smoker.veilFor).toBe(2)
    expect(mission.action(rescuer.id, "revive", target.id)).toBe(true)
    expect(target.health).toBe(2)
  })

  it("materializes bounded band preparations and consumes only authoritative interactions", () => {
    const robin = player()
    robin.arrows = 1
    const mission = new Mission("PREP28", new Map([[robin.id, robin]]), undefined, {
      preparations: [
        { id: "b13b1ec9-a85b-4d0b-8eef-0fefc9413f50", type: "supplies", contributorLabel: "Oakheart" },
        { id: "6ad54b67-0cc6-46ac-b67a-b09b315cb8ad", type: "intelligence", contributorLabel: "Marian" },
        { id: "d6c08d84-1795-4ac3-98c3-d5da9f02ed42", type: "snare-kit", contributorLabel: "Much" },
        { id: "ff5f45d4-02a1-43c2-a922-f5ddcf2adca8", type: "safe-house", contributorLabel: "John" },
      ],
    })
    const initial = mission.snapshot()
    expect(initial.preparations).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "supplies", status: "active" }),
      expect.objectContaining({ type: "intelligence", status: "consumed" }),
      expect.objectContaining({ type: "snare-kit", status: "consumed" }),
      expect.objectContaining({ type: "safe-house", status: "active" }),
    ]))
    expect(initial.traps.some((trap) => trap.ownerId === "contribution:d6c08d84-1795-4ac3-98c3-d5da9f02ed42")).toBe(true)
    expect(mission.events.filter((event) => event.type === "contribution_consumed")).toHaveLength(2)
    expect(mission.action(robin.id, "interact")).toBe(true)
    expect(robin.arrows).toBe(6)
    expect(mission.snapshot().preparations.find((preparation) => preparation.type === "supplies")?.status).toBe("consumed")
    expect(mission.action(robin.id, "interact")).toBe(false)
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
    expect(mission.isCleanEscape()).toBe(true)
    mission.update(0.05)
    expect(mission.status).toBe("failed")
    expect(mission.isCleanEscape()).toBe(false)
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

  it("owns the moving prison wagon, escort, cage, and captive identities on the server", () => {
    const robin = player("robin", "robin")
    const marian = player("marian", "marian")
    const mission = new Mission("IRON22", new Map([[robin.id, robin], [marian.id, marian]]), PRISON_WAGON_MISSION)
    const before = mission.snapshot()
    mission.update(1)
    const after = mission.snapshot()
    expect(after).toMatchObject({ missionKind: "prison-wagon", wagonMoving: true, lockProgress: 0, lockTarget: 4 })
    expect(after.cartPosition).not.toEqual(before.cartPosition)
    expect(after.guards[0].position).not.toEqual(before.guards[0].position)
    expect(after.captives).toHaveLength(3)
    expect(after.captives.map((captive) => captive.id)).toEqual([0, 1, 2])
    expect(after.captives.every((captive) => captive.status === "locked" && !captive.rewarded)).toBe(true)
  })

  it("completes a two-player prison rescue through lock, reconnect, alternate extraction, and idempotent rewards", () => {
    const john = player("john", "little-john")
    const much = player("much", "much")
    const mission = new Mission("IRON23", new Map([[john.id, john], [much.id, much]]), PRISON_WAGON_MISSION)
    mission.phase = "robbery"
    mission.wagonMoving = false
    john.position = { ...mission.cartPosition }
    much.position = { ...mission.cartPosition }
    expect(mission.action(john.id, "interact")).toBe(true)
    expect(mission.action(john.id, "interact")).toBe(false)
    expect(mission.action(much.id, "interact")).toBe(true)
    expect(mission.phase).toBe("pursuit")
    expect(mission.captives.every((captive) => captive.status === "following")).toBe(true)

    much.connected = false
    const identitiesBeforeReconnect = mission.snapshot().captives.map((captive) => captive.id)
    mission.update(0.05)
    much.connected = true
    expect(mission.snapshot().captives.map((captive) => captive.id)).toEqual(identitiesBeforeReconnect)

    const extraction = PRISON_WAGON_MISSION.routes.escape.find((route) => route.id === "river")!.position
    john.position = { ...extraction }
    for (const captive of mission.captives) captive.position = { ...extraction }
    mission.update(0.05)
    expect([mission.phase, mission.escapeRoute]).toEqual(["escape", "river"])
    expect(mission.action(john.id, "interact")).toBe(true)
    expect(mission.status).toBe("succeeded")
    expect(mission.action(john.id, "interact")).toBe(false)
    expect(mission.captives.every((captive) => captive.status === "extracted" && captive.rewarded)).toBe(true)
    expect(mission.events.filter((event) => event.type === "captive_extracted")).toHaveLength(3)
    expect(mission.result?.communityCoin).toBe(mission.delivered)
  })

  it("records explicit partial rescue failure without duplicating captive rewards", () => {
    const marian = player("marian", "marian")
    const much = player("much", "much")
    const mission = new Mission("IRON24", new Map([[marian.id, marian], [much.id, much]]), PRISON_WAGON_MISSION)
    mission.wagonMoving = false
    mission.captives[0].status = "extracted"
    mission.captives[0].rewarded = true
    mission.delivered = PRISON_WAGON_MISSION.rewards.baseCartValue
    mission.elapsedSeconds = PRISON_WAGON_MISSION.scenario!.failureSeconds - 0.1
    mission.update(0.2)
    const snapshot = mission.snapshot()
    expect(snapshot).toMatchObject({ status: "failed", failureReason: "timeout", delivered: 100 })
    expect(snapshot.captives.filter((captive) => captive.rewarded)).toHaveLength(1)
    expect(snapshot.optionalObjectives.find((objective) => objective.id === "all-captives")).toMatchObject({ completed: false, failed: true })
    expect(mission.events.filter((event) => event.type === "mission_failed")).toHaveLength(1)
    mission.update(1)
    expect(mission.events.filter((event) => event.type === "mission_failed")).toHaveLength(1)
  })

  it("supports a clean ranged-and-scout release through the forest refuge", () => {
    const robin = player("robin", "robin")
    const marian = player("marian", "marian")
    const mission = new Mission("IRON26", new Map([[robin.id, robin], [marian.id, marian]]), PRISON_WAGON_MISSION)
    mission.phase = "robbery"
    mission.wagonMoving = false
    robin.position = { ...mission.cartPosition }
    marian.position = { ...mission.cartPosition }
    expect(mission.action(robin.id, "interact")).toBe(true)
    expect(mission.action(marian.id, "interact")).toBe(true)
    const refuge = PRISON_WAGON_MISSION.routes.escape.find((route) => route.id === "forest")!.position
    marian.position = { ...refuge }
    for (const captive of mission.captives) captive.position = { ...refuge }
    mission.update(0.05)
    expect([mission.phase, mission.escapeRoute]).toEqual(["escape", "forest"])
    expect(mission.action(marian.id, "interact")).toBe(true)
    expect(mission.snapshot().optionalObjectives.find((objective) => objective.id === "clean-release")).toMatchObject({ completed: true, failed: false })
  })

  it("completes a clean storehouse infiltration through disguise, sabotage, intelligence, and split extraction", () => {
    const scenario = ROYAL_STOREHOUSE_MISSION.scenario
    if (!scenario || scenario.kind !== "storehouse") throw new Error("storehouse scenario missing")
    const marian = player("marian", "marian")
    const much = player("much", "much")
    const mission = new Mission("LEDGER", new Map([[marian.id, marian], [much.id, much]]), ROYAL_STOREHOUSE_MISSION)
    const roof = ROYAL_STOREHOUSE_MISSION.routes.entry.find((route) => route.id === "river")!.position
    much.position = { ...roof }
    mission.update(0.05)
    expect([mission.phase, mission.entryRoute]).toEqual(["ambush", "river"])
    much.position = { ...mission.alarms.find((alarm) => alarm.id === "alarm.canal-roof")!.position }
    expect(mission.action(much.id, "interact")).toBe(true)
    expect(mission.phase).toBe("robbery")
    marian.position = { ...scenario.disguisePosition }
    expect(mission.action(marian.id, "interact")).toBe(true)
    expect(mission.disguisePlayerId).toBe(marian.id)

    for (const kind of ["intel", "ledger"] as const) {
      const cache = mission.lootCaches.find((candidate) => candidate.kind === kind)!
      marian.position = { ...cache.position }
      expect(mission.action(marian.id, "interact")).toBe(true)
    }
    const coins = mission.lootCaches.filter((cache) => cache.kind === "coin")
    marian.position = { ...coins[0].position }
    much.position = { ...coins[1].position }
    expect(mission.action(marian.id, "interact")).toBe(true)
    expect(mission.action(much.id, "interact")).toBe(true)
    if (coins[1].status === "secured") expect(mission.action(much.id, "interact")).toBe(true)
    expect(mission.phase).toBe("pursuit")
    expect(mission.alarmLevel).toBe(0)

    const extraction = ROYAL_STOREHOUSE_MISSION.routes.escape.find((route) => route.id === "forest")!.position
    marian.position = { ...extraction }
    much.position = { ...extraction }
    mission.update(0.05)
    expect([mission.phase, mission.escapeRoute]).toEqual(["escape", "forest"])
    expect(mission.action(marian.id, "interact")).toBe(true)
    expect(mission.status).toBe("active")
    expect(mission.action(much.id, "interact")).toBe(true)
    expect(mission.status).toBe("succeeded")
    expect(mission.snapshot()).toMatchObject({ intelFound: true, ledgerStolen: true, alarmLevel: 0, delivered: 300 })
    expect(mission.snapshot().optionalObjectives.every((objective) => objective.completed)).toBe(true)
  })

  it("makes loud storehouse entry readable and scales relief waves with alarm pressure", () => {
    const scenario = ROYAL_STOREHOUSE_MISSION.scenario
    if (!scenario || scenario.kind !== "storehouse") throw new Error("storehouse scenario missing")
    const john = player("john", "little-john")
    const robin = player("robin", "robin")
    const mission = new Mission("LOUD22", new Map([[john.id, john], [robin.id, robin]]), ROYAL_STOREHOUSE_MISSION)
    const gate = ROYAL_STOREHOUSE_MISSION.routes.entry.find((route) => route.id === "forest")!.position
    john.position = { ...gate }
    mission.update(0.05)
    expect(mission.action(john.id, "interact")).toBe(true)
    expect(mission.phase).toBe("robbery")
    expect(mission.alarmLevel).toBe(1)
    expect(john.protectionScore).toBe(125)
    const beforeGuards = mission.guards.length
    robin.veilFor = 100
    john.veilFor = 100
    mission.update(scenario.reinforcementSeconds + 1)
    expect(mission.reinforcementWave).toBeGreaterThanOrEqual(1)
    expect(mission.guards.length).toBeGreaterThanOrEqual(beforeGuards)
    expect(mission.events.some((event) => event.type === "reinforcement_arrived" && event.detail?.startsWith("alarm:"))).toBe(true)
  })

  it("supports Robin's ranged storehouse opening with an explicit alarm cost", () => {
    const robin = player("robin", "robin")
    const marian = player("marian", "marian")
    const mission = new Mission("ARROW2", new Map([[robin.id, robin], [marian.id, marian]]), ROYAL_STOREHOUSE_MISSION)
    mission.phase = "ambush"
    robin.position = { ...mission.guards[0].position }
    expect(mission.action(robin.id, "signature")).toBe(true)
    if (mission.snapshot().phase !== "robbery") {
      mission.update(18)
      robin.position = { ...mission.guards.find((guard) => guard.stunnedFor <= 0)!.position }
      expect(mission.action(robin.id, "shoot")).toBe(true)
    }
    expect(mission.phase).toBe("robbery")
    expect(mission.alarmLevel).toBeGreaterThanOrEqual(1)
    expect(mission.events.some((event) => event.type === "alarm_triggered" && event.detail === "twin-shot")).toBe(true)
  })

  it("keeps secured-cache state idempotent across a storehouse reconnect", () => {
    const marian = player("marian", "marian")
    const much = player("much", "much")
    const mission = new Mission("CACHE2", new Map([[marian.id, marian], [much.id, much]]), ROYAL_STOREHOUSE_MISSION)
    mission.phase = "robbery"
    mission.disguisePlayerId = marian.id
    const cache = mission.lootCaches.find((candidate) => candidate.kind === "coin")!
    marian.position = { ...cache.position }
    expect(mission.action(marian.id, "interact")).toBe(true)
    const carried = marian.loot
    marian.connected = false
    expect(mission.action(marian.id, "interact")).toBe(false)
    marian.connected = true
    expect(mission.action(marian.id, "interact")).toBe(false)
    expect(marian.loot).toBe(carried)
    expect(mission.snapshot().lootCaches.find((candidate) => candidate.id === cache.id)?.status).toBe("looted")
    expect(mission.events.filter((event) => event.type === "cache_looted" && event.detail === cache.id)).toHaveLength(1)
  })
})
