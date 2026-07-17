import { describe, expect, it } from "vitest"
import {
  ARCHERY_TICK_RATE,
  BOW_DRAW_TICKS,
  BOW_MOVEMENT_EPSILON,
  BOW_RECOVERY_TICKS,
  BOW_TOTAL_TICKS,
  SIGNATURE_ACTION_SECONDS,
  SIGNATURE_ACTION_TICKS,
  bowActionAtTick,
  createBowAction,
  hasBowMovement,
} from "./archery"

describe("shared archery timing", () => {
  it("derives the complete one-second action from the fixed simulation rate", () => {
    expect(ARCHERY_TICK_RATE).toBe(20)
    expect(BOW_DRAW_TICKS).toBe(12)
    expect(BOW_RECOVERY_TICKS).toBe(8)
    expect(BOW_TOTAL_TICKS).toBe(20)
    expect(SIGNATURE_ACTION_SECONDS).toBe(0.9)
    expect(SIGNATURE_ACTION_TICKS).toBe(18)
  })

  it("changes phase at the exact release tick and ends at the exact total tick", () => {
    const action = createBowAction(40)
    expect(action).toEqual({ phase: "drawing", startedAtTick: 40, releaseAtTick: 52, endsAtTick: 60 })
    expect(bowActionAtTick(action, 51)?.phase).toBe("drawing")
    const recovery = bowActionAtTick(action, 52)
    expect(recovery?.phase).toBe("recovery")
    expect(bowActionAtTick(recovery!, 59)?.phase).toBe("recovery")
    expect(bowActionAtTick(recovery!, 60)).toBeNull()
  })

  it("ignores controller noise within the movement epsilon", () => {
    expect(hasBowMovement({ x: BOW_MOVEMENT_EPSILON, z: 0 })).toBe(false)
    expect(hasBowMovement({ x: BOW_MOVEMENT_EPSILON * 1.01, z: 0 })).toBe(true)
  })
})
