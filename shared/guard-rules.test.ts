import { describe, expect, it } from "vitest"
import { SHERWOOD_ESCORT_BLOCK_RADIUS, activeEscortCount, activeGuardPositions } from "./guard-rules"

describe("shared guard rules", () => {
  it("counts only active guards in the immediate objective escort", () => {
    const guards = [
      { position: { x: 1.8, z: 0 }, stunnedFor: 0 },
      { position: { x: 0, z: 1.8 }, stunnedFor: 2 },
      { position: { x: SHERWOOD_ESCORT_BLOCK_RADIUS + 0.1, z: 0 }, stunnedFor: 0 },
    ]
    expect(activeEscortCount(guards, { x: 0, z: 0 })).toBe(1)
  })

  it("publishes only active guards to the combined world resolver", () => {
    const active = { position: { x: 1, z: 2 }, stunnedFor: 0 }
    const stunned = { position: { x: 3, z: 4 }, stunnedFor: 1 }
    expect(activeGuardPositions([active, stunned])).toEqual([active.position])
  })
})
