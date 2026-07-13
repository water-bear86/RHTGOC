import { describe, expect, it } from "vitest"
import { computeObjectivePointer, shouldShowMissionCampfireHalo } from "./objective-guidance"

describe("objective screen-edge guidance", () => {
  it("hides when the discovered objective marker is already in the safe playfield", () => {
    expect(computeObjectivePointer({ ndcX: 0.2, ndcY: -0.1, ndcZ: 0.4, viewportWidth: 1280, viewportHeight: 720, distanceMeters: 18 }).visible).toBe(false)
  })

  it("clamps offscreen targets to readable margins and reports distance", () => {
    const result = computeObjectivePointer({ ndcX: 3, ndcY: -2, ndcZ: 0.4, viewportWidth: 1280, viewportHeight: 720, distanceMeters: 42.4 })
    expect(result.visible).toBe(true)
    expect(result.x).toBeLessThanOrEqual(1280 - 76)
    expect(result.y).toBeLessThanOrEqual(720 - 86)
    expect(result.distanceLabel).toBe("42m")
  })

  it("keeps targets behind the camera visible on an edge", () => {
    const result = computeObjectivePointer({ ndcX: 0.1, ndcY: 0, ndcZ: 1.4, viewportWidth: 900, viewportHeight: 700, distanceMeters: 9 })
    expect(result.visible).toBe(true)
  })
})

describe("mission campfire guidance", () => {
  it("marks a solo delivery whenever the local outlaw carries coin", () => {
    expect(shouldShowMissionCampfireHalo({ multiplayerActive: false, loot: 40, mission: null })).toBe(true)
    expect(shouldShowMissionCampfireHalo({ multiplayerActive: false, loot: 0, mission: null })).toBe(false)
  })

  it("marks only an active multiplayer tax-cart escape", () => {
    expect(shouldShowMissionCampfireHalo({
      multiplayerActive: true,
      loot: 40,
      mission: { missionKind: "tax-cart", phase: "escape" },
    })).toBe(true)
    expect(shouldShowMissionCampfireHalo({
      multiplayerActive: true,
      loot: 40,
      mission: { missionKind: "storehouse", phase: "escape" },
    })).toBe(false)
    expect(shouldShowMissionCampfireHalo({
      multiplayerActive: true,
      loot: 40,
      mission: { missionKind: "tax-cart", phase: "pursuit" },
    })).toBe(false)
  })
})
