import { describe, expect, it } from "vitest"
import {
  SHERWOOD_ESCORT_BLOCK_RADIUS,
  activeEscortCount,
  activeGuardPositions,
  guardPatrolProfile,
  initialGuardPatrolAngle,
  stepGuardPatrol,
} from "./guard-rules"

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

  it("derives three deterministic, bounded patrol families from guard ids", () => {
    expect([0, 1, 2].map((id) => guardPatrolProfile(id).shape)).toEqual(["ellipse", "figure-eight", "clover"])
    expect(guardPatrolProfile(7)).toEqual(guardPatrolProfile(7))
    expect(guardPatrolProfile(-7)).toEqual(guardPatrolProfile(7))

    for (let id = 0; id < 24; id += 1) {
      const home = { x: 12, z: -8 }
      const step = stepGuardPatrol(home, id, initialGuardPatrolAngle(id), 0.25)
      expect(Number.isFinite(step.angle)).toBe(true)
      expect(step.moveSpeed).toBeGreaterThanOrEqual(1.35)
      expect(step.moveSpeed).toBeLessThan(1.7)
      expect(Math.hypot(step.target.x - home.x, step.target.z - home.z)).toBeLessThan(3.6)
    }
  })

  it("sanitizes invalid patrol inputs without producing invalid movement", () => {
    const step = stepGuardPatrol({ x: 0, z: 0 }, Number.NaN, Number.NaN, Number.POSITIVE_INFINITY)
    expect(step.angle).toBe(initialGuardPatrolAngle(0))
    expect(step.target).toEqual({ x: guardPatrolProfile(0).radiusX, z: 0 })
    const recovered = stepGuardPatrol({ x: Number.NaN, z: 4 }, 2, -100, 0.1)
    expect(recovered.angle).toBeGreaterThanOrEqual(0)
    expect(recovered.angle).toBeLessThan(Math.PI * 2)
    expect(Number.isFinite(recovered.target.x)).toBe(true)
    expect(Number.isFinite(recovered.target.z)).toBe(true)
  })
})
