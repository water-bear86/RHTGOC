import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { regionalizeMissionDefinition } from "../shared/regional-layout"
import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import { createSherwoodLandmarks } from "./world-landmarks"
import { countVillageDrawCalls } from "./village-assets"

describe("Sherwood landmarks", () => {
  it("builds a windmill farm and a readable wheat field", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 19).layout
    const landmarks = createSherwoodLandmarks(layout)
    expect(landmarks.group.getObjectByName("WindmillLandmark")).toBeTruthy()
    expect(landmarks.group.getObjectByName("WindmillRotor")).toBeTruthy()
    expect(landmarks.group.getObjectByName("GoldenWheatField")).toBeTruthy()
    const farmhouse = landmarks.group.getObjectByName("FarmhouseLandmark")
    expect(farmhouse?.getObjectByName("StylizedBuildingDetails")).toBeInstanceOf(THREE.InstancedMesh)
    expect(farmhouse?.getObjectByName("StylizedBuildingGables")).toBeInstanceOf(THREE.InstancedMesh)
    expect(farmhouse?.userData.sherwoodBuildingKind).toBe("farmhouse")
    expect(landmarks.wheatCount).toBeGreaterThanOrEqual(300)
    expect(countVillageDrawCalls(landmarks.group)).toBeLessThanOrEqual(49)
  })

  it("chooses a farm corner away from dynamic mission landmarks", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 19).layout
    const landmarks = createSherwoodLandmarks(layout)
    expect(Math.hypot(landmarks.farmPosition.x - layout.campfirePosition.x, landmarks.farmPosition.z - layout.campfirePosition.z)).toBeGreaterThan(25)
    expect(Math.hypot(landmarks.farmPosition.x - layout.objectivePosition.x, landmarks.farmPosition.z - layout.objectivePosition.z)).toBeGreaterThan(25)
  })

  it("disposes owned landmark geometry and instance buffers exactly once", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 19).layout
    const landmarks = createSherwoodLandmarks(layout)
    const details = landmarks.group.getObjectByName("StylizedBuildingDetails") as THREE.InstancedMesh
    const wheat = landmarks.group.getObjectByName("WheatInstances") as THREE.InstancedMesh
    const detailsDisposed = vi.fn()
    const wheatDisposed = vi.fn()
    const wheatGeometryDispose = vi.spyOn(wheat.geometry, "dispose")
    details.addEventListener("dispose", detailsDisposed)
    wheat.addEventListener("dispose", wheatDisposed)

    landmarks.dispose()
    landmarks.dispose()

    expect(detailsDisposed).toHaveBeenCalledOnce()
    expect(wheatDisposed).toHaveBeenCalledOnce()
    expect(wheatGeometryDispose).toHaveBeenCalledOnce()
  })
})
