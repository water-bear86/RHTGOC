import { describe, expect, it } from "vitest"
import { SHERWOOD_GUARD_SEPARATION, initialGuardPatrolAngle, stepGuardPatrol } from "../shared/guard-rules"
import { SHERWOOD_PLAYER_RADIUS, isSherwoodPlayerPositionBlocked } from "../shared/world-collisions"
import { BOW_DRAW_SECONDS, BOW_TOTAL_SECONDS, SIGNATURE_ACTION_SECONDS } from "../shared/archery"
import { CART_POSITION, DELIVERY_TARGET, VILLAGE_POSITION, acquireBowTarget, activateSignature, beginSoloBowDraw, calculateMastery, createInitialState, getContextPrompt, interact, stepSoloBowAction, updateSimulation } from "./simulation"

describe("Sherwood simulation", () => {
  it("requires the immediate escort to be cleared before robbing the tax cart", () => {
    const state = createInitialState()
    state.player.position = { ...CART_POSITION }
    expect(getContextPrompt(state)).toBe("ESCORT BLOCKING CART · STUN THEM FIRST")
    expect(interact(state)).toBe("escort-blocking")
    expect(state.player.loot).toBe(0)
    for (const guard of state.guards) guard.stunnedFor = 2
    expect(getContextPrompt(state)).toBe("E  ROB THE TAX CART")
    expect(interact(state)).toBe("robbed-cart")
    expect(state.player.loot).toBe(120)
    expect(state.heat).toBe(100)
  })

  it("delivers stolen coin and wins at the target", () => {
    const state = createInitialState()
    state.player.position = { ...VILLAGE_POSITION }
    state.guards[0].position = { ...VILLAGE_POSITION }
    expect(beginSoloBowDraw(state, { x: 0, z: 0 })).toBe("started")
    state.player.loot = DELIVERY_TARGET
    expect(interact(state)).toBe("won")
    expect(state.won).toBe(true)
    expect(state.bowAction).toBeNull()
  })

  it("loads, fires, and stuns a nearby guard", () => {
    const state = createInitialState()
    state.player.position = { ...state.guards[0].position }
    expect(beginSoloBowDraw(state, { x: 0, z: 0 })).toBe("started")
    expect(stepSoloBowAction(state, { x: 0, z: 0 }, BOW_DRAW_SECONDS)).toEqual(["bow-hit:0"])
    expect(state.guards[0].stunnedFor).toBeGreaterThan(3)
    expect(state.player.arrows).toBe(5)
  })

  it("commits an arrow and cooldown when a locked target escapes during the draw", () => {
    const state = createInitialState()
    state.player.position = { ...state.guards[0].position }
    expect(beginSoloBowDraw(state, { x: 0, z: 0 })).toBe("started")
    state.guards[0].position = { x: state.player.position.x + 50, z: state.player.position.z + 50 }

    expect(stepSoloBowAction(state, { x: 0, z: 0 }, BOW_DRAW_SECONDS)).toEqual(["bow-missed"])
    expect(state.player.arrows).toBe(5)
    expect(state.bowCooldown).toBe(0.7)
    expect(state.stats.shotsFired).toBe(1)
    expect(state.stats.shotsHit).toBe(0)
    expect(beginSoloBowDraw(state, { x: 0, z: 0 })).toBe("unavailable")
    expect(state.player.arrows).toBe(5)
  })

  it("does not acquire a bow draw without a valid target", () => {
    const state = createInitialState()
    state.guards = []
    expect(acquireBowTarget(state)).toBeNull()
    expect(state.player.arrows).toBe(6)
  })

  it("cancels a solo draw on movement without spending an arrow", () => {
    const state = createInitialState()
    state.player.position = { ...state.guards[0].position }

    expect(beginSoloBowDraw(state, { x: 0, z: 0 })).toBe("started")
    expect(stepSoloBowAction(state, { x: 1, z: 0 }, BOW_DRAW_SECONDS / 2)).toEqual(["bow-cancelled"])
    expect(state.bowAction).toBeNull()
    expect(state.player.arrows).toBe(6)
    expect(state.stats.shotsFired).toBe(0)
  })

  it("cancels before applying movement on the interruption frame", () => {
    const state = createInitialState()
    state.player.position = { x: -30, z: -30 }
    state.guards = [{ id: 0, position: { x: -26, z: -30 }, home: { x: -26, z: -30 }, patrolAngle: 0, stunnedFor: 0 }]
    state.player.invulnerableFor = 10
    expect(beginSoloBowDraw(state, { x: 0, z: 0 })).toBe("started")
    const before = { ...state.player.position }

    expect(updateSimulation(state, { move: { x: 1, z: 0 } }, 0.05)).toContain("bow-cancelled")
    expect(state.player.position).toEqual(before)
    expect(state.bowAction).toBeNull()
  })

  it("releases a solo draw exactly once, then permits movement during recovery", () => {
    const state = createInitialState()
    state.player.position = { ...state.guards[0].position }
    expect(beginSoloBowDraw(state, { x: 0, z: 0 })).toBe("started")

    expect(stepSoloBowAction(state, { x: 0, z: 0 }, BOW_DRAW_SECONDS - 0.01)).toEqual([])
    expect(state.player.arrows).toBe(6)
    expect(stepSoloBowAction(state, { x: 0, z: 0 }, 0.01)).toEqual(["bow-hit:0"])
    expect(state.bowAction?.phase).toBe("recovery")
    expect(state.player.arrows).toBe(5)
    expect(state.stats.shotsFired).toBe(1)

    expect(stepSoloBowAction(state, { x: 1, z: 0 }, BOW_TOTAL_SECONDS - BOW_DRAW_SECONDS)).toEqual([])
    expect(state.bowAction).toBeNull()
    expect(state.player.arrows).toBe(5)
    expect(state.stats.shotsFired).toBe(1)
  })

  it("does not start a solo draw while direct movement is active", () => {
    const state = createInitialState()
    state.player.position = { ...state.guards[0].position }
    expect(beginSoloBowDraw(state, { x: 0.1, z: 0 })).toBe("moving")
    expect(state.bowAction).toBeNull()
  })

  it("cancels a drawing shot before release when a guard downs the player", () => {
    const state = createInitialState()
    state.objectiveDiscovered = true
    state.player.position = { x: -30, z: -30 }
    state.player.health = 1
    state.heat = 100
    state.guards = [{ id: 0, position: { x: -28.8, z: -30 }, home: { x: -28.8, z: -30 }, patrolAngle: 0, stunnedFor: 0 }]
    expect(beginSoloBowDraw(state, { x: 0, z: 0 })).toBe("started")

    const events = updateSimulation(state, { move: { x: 0, z: 0 } }, BOW_DRAW_SECONDS)

    expect(events).toContain("lost")
    expect(events).not.toContain("bow-hit:0")
    expect(events).not.toContain("bow-missed")
    expect(state.bowAction).toBeNull()
    expect(state.player.arrows).toBe(6)
    expect(state.stats.shotsFired).toBe(0)
  })

  it("does not let a signature replace an in-progress bow draw", () => {
    const state = createInitialState("robin")
    state.player.position = { ...state.guards[0].position }
    expect(beginSoloBowDraw(state, { x: 0, z: 0 })).toBe("started")

    expect(activateSignature(state)).toEqual({ event: "signature-unavailable", guardIds: [] })
    expect(state.player.signatureCooldown).toBe(0)
    expect(state.bowAction?.phase).toBe("drawing")
  })

  it("does not begin a bow draw until a successful signature action finishes", () => {
    const state = createInitialState("marian")
    state.objectiveDiscovered = true
    state.player.position = { x: -30, z: -30 }
    state.player.invulnerableFor = 10
    state.guards = [{ id: 0, position: { x: -26, z: -30 }, home: { x: -26, z: -30 }, patrolAngle: 0, stunnedFor: 0 }]

    expect(activateSignature(state).event).toBe("marian-veil")
    expect(state.signatureActionRemaining).toBe(SIGNATURE_ACTION_SECONDS)
    expect(beginSoloBowDraw(state, { x: 0, z: 0 })).toBe("unavailable")

    updateSimulation(state, { move: { x: 0, z: 0 } }, SIGNATURE_ACTION_SECONDS - 0.01)
    expect(state.signatureActionRemaining).toBeGreaterThan(0)
    expect(beginSoloBowDraw(state, { x: 0, z: 0 })).toBe("unavailable")

    updateSimulation(state, { move: { x: 0, z: 0 } }, 0.02)
    expect(state.signatureActionRemaining).toBe(0)
    expect(beginSoloBowDraw(state, { x: 0, z: 0 })).toBe("started")
  })

  it("moves independently of the renderer", () => {
    const state = createInitialState()
    const before = state.player.position.x
    updateSimulation(state, { move: { x: 1, z: 0 } }, 0.5)
    expect(state.player.position.x).toBeGreaterThan(before)
  })

  it("does not let the player tunnel through an active guard", () => {
    const state = createInitialState()
    state.player.position = { x: -20, z: -20 }
    state.guards = [{ id: 0, position: { x: -18, z: -20 }, home: { x: -18, z: -20 }, patrolAngle: 0, stunnedFor: 0 }]
    updateSimulation(state, { move: { x: 1, z: 0 } }, 0.75)
    expect(state.player.position.x).toBeLessThan(state.guards[0].position.x)
    expect(Math.hypot(
      state.player.position.x - state.guards[0].position.x,
      state.player.position.z - state.guards[0].position.z,
    )).toBeGreaterThanOrEqual(SHERWOOD_GUARD_SEPARATION)
  })

  it("lets the player pass through a stunned guard", () => {
    const state = createInitialState()
    state.player.position = { x: -20, z: -20 }
    state.guards = [{ id: 0, position: { x: -18, z: -20 }, home: { x: -18, z: -20 }, patrolAngle: 0, stunnedFor: 2 }]
    updateSimulation(state, { move: { x: 1, z: 0 } }, 0.75)
    expect(state.player.position.x).toBeGreaterThan(state.guards[0].position.x)
  })

  it("keeps solo guard avoidance outside buildings at shared collision corners", () => {
    const state = createInitialState()
    state.player.position = { x: -15, z: 8 }
    state.player.invulnerableFor = 10
    state.objectiveDiscovered = true
    state.guards = [{ id: 0, position: { x: -14, z: 10.5 }, home: { x: -14, z: 10.5 }, patrolAngle: 0, stunnedFor: 0 }]
    updateSimulation(state, { move: { x: 6, z: 5 } }, Math.hypot(6, 5) / 6.2)

    expect(isSherwoodPlayerPositionBlocked(state.player.position, SHERWOOD_PLAYER_RADIUS, state.layout)).toBe(false)
    expect(Math.hypot(
      state.player.position.x - state.guards[0].position.x,
      state.player.position.z - state.guards[0].position.z,
    )).toBeGreaterThanOrEqual(SHERWOOD_GUARD_SEPARATION)
  })

  it("uses the shared deterministic patrol step in solo play", () => {
    const state = createInitialState()
    state.objectiveDiscovered = true
    state.heat = 0
    state.player.position = { x: -42, z: -42 }
    const guard = state.guards[0]
    state.guards.splice(1)
    guard.home = { x: 20, z: 20 }
    guard.position = { ...guard.home }
    guard.patrolAngle = initialGuardPatrolAngle(guard.id)
    const expected = stepGuardPatrol(guard.home, guard.id, guard.patrolAngle, 0.25)

    updateSimulation(state, { move: { x: 0, z: 0 } }, 0.25)

    expect(guard.patrolAngle).toBeCloseTo(expected.angle, 8)
    expect(Math.hypot(guard.position.x - guard.home.x, guard.position.z - guard.home.z)).toBeLessThanOrEqual(expected.moveSpeed * 0.25 + 0.0001)
  })

  it("lets a wrong 5x5 search route strengthen the Sheriff before discovery", () => {
    const state = createInitialState("marian", 42)
    state.player.position = { ...state.layout.campfirePosition }
    const events = updateSimulation(state, { move: { x: 0, z: 0 } }, 66)
    expect(state.searchPressure).toBe(1)
    expect(state.heat).toBeGreaterThan(0)
    expect(events).toContain("search-reinforced")
    state.player.position = { ...state.layout.objectivePosition }
    expect(updateSimulation(state, { move: { x: 0, z: 0 } }, 0.05)).toContain("objective-found")
    expect(state.objectiveDiscovered).toBe(true)
  })

  it("makes Maid Marian a faster playable scout with a pursuit-breaking veil", () => {
    const marian = createInitialState("marian")
    const robin = createInitialState("robin")
    updateSimulation(marian, { move: { x: 1, z: 0 } }, 0.5)
    updateSimulation(robin, { move: { x: 1, z: 0 } }, 0.5)
    expect(marian.player.position.x).toBeGreaterThan(robin.player.position.x)
    marian.heat = 80
    expect(activateSignature(marian).event).toBe("marian-veil")
    expect(marian.player.veilFor).toBe(6)
    expect(marian.heat).toBe(52)
  })

  it("gives Robin a twin-shot mastery ability", () => {
    const state = createInitialState("robin")
    state.player.position = { ...state.guards[0].position }
    const signature = activateSignature(state)
    expect(signature.event).toBe("robin-volley")
    expect(signature.guardIds).toHaveLength(2)
  })

  it("gives Little John readable crowd control and a heavy-carry advantage", () => {
    const john = createInitialState("little-john")
    john.player.position = { ...john.guards[0].position }
    john.guards[1].position = { ...john.guards[0].position }
    expect(john.player.arrows).toBe(3)
    const signature = activateSignature(john)
    expect(signature.event).toBe("little-john-sweep")
    expect(signature.guardIds.length).toBeGreaterThanOrEqual(2)
    expect(john.player.signatureCooldown).toBe(20)

    const robin = createInitialState("robin")
    john.player.loot = 300
    robin.player.loot = 300
    updateSimulation(john, { move: { x: 1, z: 0 } }, 1)
    updateSimulation(robin, { move: { x: 1, z: 0 } }, 1)
    expect(john.player.position.x).toBeGreaterThan(robin.player.position.x)
  })

  it("gives Much a bounded visible snare that cleans up after triggering", () => {
    const state = createInitialState("much")
    const target = state.guards.find((guard) => Math.hypot(guard.position.x - state.layout.objectivePosition.x, guard.position.z - state.layout.objectivePosition.z) >= 3)!
    state.player.position = { ...target.position }
    expect(activateSignature(state).event).toBe("much-snare")
    expect(activateSignature(state).event).toBe("signature-unavailable")
    expect(state.traps).toHaveLength(1)
    expect(updateSimulation(state, { move: { x: 0, z: 0 } }, 0.05)).toContain("trap-triggered")
    expect(state.traps).toHaveLength(0)
    expect(target.stunnedFor).toBe(4.5)
  })

  it("scores speed, precision, survival, and generosity", () => {
    const state = createInitialState("marian")
    state.delivered = DELIVERY_TARGET
    state.stats.elapsedSeconds = 90
    const result = calculateMastery(state)
    expect(result.generosity).toBe(DELIVERY_TARGET * 12)
    expect(result.score).toBeGreaterThan(7000)
    expect(["S", "A"]).toContain(result.grade)
  })
})
