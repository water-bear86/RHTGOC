import { describe, expect, it } from "vitest"
import { regionalizeMissionDefinition } from "../shared/regional-layout"
import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import { createSherwoodLandmarks } from "./world-landmarks"

describe("Sherwood landmarks", () => {
  it("builds a windmill farm and a readable wheat field", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 19).layout
    const landmarks = createSherwoodLandmarks(layout)
    expect(landmarks.group.getObjectByName("WindmillLandmark")).toBeTruthy()
    expect(landmarks.group.getObjectByName("WindmillRotor")).toBeTruthy()
    expect(landmarks.group.getObjectByName("GoldenWheatField")).toBeTruthy()
    expect(landmarks.wheatCount).toBeGreaterThanOrEqual(300)
  })

  it("chooses a farm corner away from dynamic mission landmarks", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 19).layout
    const landmarks = createSherwoodLandmarks(layout)
    expect(Math.hypot(landmarks.farmPosition.x - layout.campfirePosition.x, landmarks.farmPosition.z - layout.campfirePosition.z)).toBeGreaterThan(25)
    expect(Math.hypot(landmarks.farmPosition.x - layout.objectivePosition.x, landmarks.farmPosition.z - layout.objectivePosition.z)).toBeGreaterThan(25)
  })
})
