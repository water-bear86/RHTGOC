import { describe, expect, it } from "vitest"
import {
  advanceMovementSound,
  createMovementSoundState,
  isPositionOnRoad,
} from "./movement-sound"

describe("movement sound", () => {
  it("emits one surface-aware footstep after enough real movement", () => {
    const state = createMovementSoundState()
    expect(advanceMovementSound(state, { distance: 0.7, onRoad: false, enabled: true })).toBeNull()
    expect(advanceMovementSound(state, { distance: 0.6, onRoad: false, enabled: true })).toBe("movement.footstep-grass")
    expect(advanceMovementSound(state, { distance: 1.21, onRoad: true, enabled: true })).toBe("movement.footstep-road")
  })

  it("does not turn teleports or disabled movement into footsteps", () => {
    const state = createMovementSoundState()
    expect(advanceMovementSound(state, { distance: 3.5, onRoad: false, enabled: true })).toBeNull()
    expect(advanceMovementSound(state, { distance: 2, onRoad: false, enabled: false })).toBeNull()
    expect(state.distanceSinceStep).toBe(0)
  })

  it("classifies a position against composed road widths", () => {
    const roads = [{ id: "forest-road", width: 3, points: [{ x: -5, z: 0 }, { x: 5, z: 0 }] }]
    expect(isPositionOnRoad({ x: 1, z: 1.6 }, roads)).toBe(true)
    expect(isPositionOnRoad({ x: 1, z: 2.2 }, roads)).toBe(false)
  })
})
