import { describe, expect, it } from "vitest"
import { MISSION_CATALOG } from "./mission-catalog"
import { ROTATION_DAY_MS, isRotationActive, rotationWindowAt, rotationsForUtcDay, validateSheriffRotation } from "./sheriff-rotation"
import { SheriffRotationService } from "../server/rotation-service"

const day = Date.UTC(2026, 6, 10)

describe("daily Sheriff rotation", () => {
  it("generates an auditable deterministic target for every supported party bracket", () => {
    const first = rotationsForUtcDay(day)
    const second = rotationsForUtcDay(day + 12 * 60 * 60 * 1_000)
    expect(first).toEqual(second)
    expect(first.map((rotation) => rotation.partySize)).toEqual([2, 3, 4])
    expect(new Set(first.map((rotation) => rotation.id)).size).toBe(3)
    for (const rotation of first) {
      expect(validateSheriffRotation(rotation)).toEqual([])
      expect(MISSION_CATALOG.has(rotation.missionSlug)).toBe(true)
      expect(isRotationActive(rotation, day)).toBe(true)
    }
  })

  it("changes exactly at the UTC boundary and publishes the next schedule", () => {
    const before = rotationWindowAt(day + ROTATION_DAY_MS - 1)
    const after = rotationWindowAt(day + ROTATION_DAY_MS)
    expect(before.current.map((rotation) => rotation.id)).not.toEqual(after.current.map((rotation) => rotation.id))
    expect(before.upcoming).toEqual(after.current)
    expect(before.current.every((rotation) => !isRotationActive(rotation, day + ROTATION_DAY_MS))).toBe(true)
  })

  it("pauses, replaces, and rolls back without changing the deterministic schedule", () => {
    const service = new SheriffRotationService()
    const generated = service.window(day + 1_000)
    service.pause(day + 60_000, day + 1_000)
    expect(service.window(day + 2_000)).toMatchObject({ paused: true, current: [] })
    service.replace([generated.current[0]], day + 2_000)
    expect(service.window(day + 3_000)).toMatchObject({ paused: false, current: [generated.current[0]] })
    service.rollback()
    expect(service.window(day + 4_000).current).toEqual(generated.current)
  })

  it("rejects stale, duplicated, or forged operator replacements", () => {
    const service = new SheriffRotationService()
    const target = structuredClone(rotationsForUtcDay(day)[0])
    expect(() => service.replace([{ ...target, endsAt: day }], day + 1)).toThrow("INVALID_ROTATION")
    expect(() => service.replace([{ ...target, modifierIds: [target.modifierIds[0], target.modifierIds[0]] }], day + 1)).toThrow("INVALID_ROTATION")
    expect(() => service.replace([{ ...target, missionContentHash: "fnv1a32:00000000" }], day + 1)).toThrow("INVALID_ROTATION")
  })
})
