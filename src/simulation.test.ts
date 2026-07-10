import { describe, expect, it } from "vitest"
import { CART_POSITION, DELIVERY_TARGET, VILLAGE_POSITION, activateSignature, calculateMastery, createInitialState, interact, shoot, updateSimulation } from "./simulation"

describe("Sherwood simulation", () => {
  it("robs the tax cart and raises the wanted level", () => {
    const state = createInitialState()
    state.player.position = { ...CART_POSITION }
    expect(interact(state)).toBe("robbed-cart")
    expect(state.player.loot).toBe(120)
    expect(state.heat).toBe(100)
  })

  it("delivers stolen coin and wins at the target", () => {
    const state = createInitialState()
    state.player.position = { ...VILLAGE_POSITION }
    state.player.loot = DELIVERY_TARGET
    expect(interact(state)).toBe("won")
    expect(state.won).toBe(true)
  })

  it("fires at and stuns a nearby guard", () => {
    const state = createInitialState()
    state.player.position = { x: 7, z: -4 }
    expect(shoot(state)).toBe(0)
    expect(state.guards[0].stunnedFor).toBeGreaterThan(3)
    expect(state.player.arrows).toBe(5)
  })

  it("moves independently of the renderer", () => {
    const state = createInitialState()
    const before = state.player.position.x
    updateSimulation(state, { move: { x: 1, z: 0 } }, 0.5)
    expect(state.player.position.x).toBeGreaterThan(before)
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
    state.player.position = { x: 9, z: -7 }
    const signature = activateSignature(state)
    expect(signature.event).toBe("robin-volley")
    expect(signature.guardIds).toHaveLength(2)
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
