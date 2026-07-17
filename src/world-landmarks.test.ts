import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { regionalizeMissionDefinition } from "../shared/regional-layout"
import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import { composeSherwoodWorld } from "../shared/world-composer"
import { createSherwoodLandmarks } from "./world-landmarks"
import { countVillageDrawCalls } from "./village-assets"
import { sherwoodHeightAt } from "./sherwood-terrain"
import { NATURE_VARIANT_NAMES, indexNatureCatalog } from "./nature-assets"

describe("Sherwood landmarks", () => {
  it("builds a windmill farm and a readable wheat field", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 19).layout
    const landmarks = createSherwoodLandmarks(layout)
    expect(landmarks.group.getObjectByName("WindmillLandmark")).toBeTruthy()
    expect(landmarks.group.getObjectByName("WindmillRotor")).toBeTruthy()
    expect(landmarks.group.getObjectByName("GoldenWheatField")).toBeTruthy()
    expect(landmarks.group.getObjectByName("AncientStoneCircle")).toBeTruthy()
    expect(landmarks.group.getObjectByName("LoggingClearing")).toBeFalsy()
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

  it("moves the stone circle into an unused clearing away from generated roads", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 19).layout
    const world = composeSherwoodWorld(layout)
    const landmarks = createSherwoodLandmarks(layout, { world })
    expect(world.settlements.some(({ center }) => (
      center.x === landmarks.stoneCirclePosition.x && center.z === landmarks.stoneCirclePosition.z
    ))).toBe(false)
    expect(Math.hypot(
      landmarks.stoneCirclePosition.x - layout.campfirePosition.x,
      landmarks.stoneCirclePosition.z - layout.campfirePosition.z,
    )).toBeGreaterThan(15)
  })

  it("drapes farm surfaces and compound props onto their own terrain samples", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 19).layout
    const landmarks = createSherwoodLandmarks(layout)
    landmarks.group.updateMatrixWorld(true)

    for (const name of ["WindmillLandmark", "FarmhouseLandmark"]) {
      const object = landmarks.group.getObjectByName(name)!
      const world = object.getWorldPosition(new THREE.Vector3())
      expect(world.y).toBeCloseTo(sherwoodHeightAt(world.x, world.z), 5)
    }

    const fencePosts: THREE.Object3D[] = []
    landmarks.group.traverse((object) => {
      if (object.name === "FencePost") fencePosts.push(object)
    })
    expect(fencePosts).toHaveLength(9)
    for (const post of fencePosts) {
      const world = post.getWorldPosition(new THREE.Vector3())
      expect(world.y - 0.575).toBeCloseTo(sherwoodHeightAt(world.x, world.z), 5)
    }

    const soil = landmarks.group.getObjectByName("FarmFieldSoil") as THREE.Mesh
    const soilPositions = soil.geometry.getAttribute("position")
    for (let index = 0; index < soilPositions.count; index += 13) {
      const world = new THREE.Vector3().fromBufferAttribute(soilPositions, index).applyMatrix4(soil.matrixWorld)
      expect(world.y).toBeCloseTo(sherwoodHeightAt(world.x, world.z) + 0.018, 5)
    }

    const wheat = landmarks.group.getObjectByName("WheatInstances") as THREE.InstancedMesh
    const instanceMatrix = new THREE.Matrix4()
    for (const index of [0, Math.floor(wheat.count / 2), wheat.count - 1]) {
      wheat.getMatrixAt(index, instanceMatrix)
      instanceMatrix.premultiply(wheat.matrixWorld)
      const world = new THREE.Vector3().setFromMatrixPosition(instanceMatrix)
      expect(world.y).toBeCloseTo(sherwoodHeightAt(world.x, world.z) + 0.03, 5)
    }
  })

  it("uses the authored textured wheat variant when the nature catalogue is available", () => {
    const source = new THREE.Group()
    for (const name of NATURE_VARIANT_NAMES) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: new THREE.Texture() }))
      mesh.name = name
      source.add(mesh)
    }
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 19).layout
    const landmarks = createSherwoodLandmarks(layout, { natureCatalog: indexNatureCatalog(source) })
    const wheatGroup = landmarks.group.getObjectByName("WheatInstances")!
    const wheat = wheatGroup.children[0] as THREE.InstancedMesh
    expect(wheat).toBeInstanceOf(THREE.InstancedMesh)
    expect(wheat.count).toBe(330)
    expect((wheat.material as THREE.MeshStandardMaterial).map).toBeTruthy()
    expect(wheat.userData.sherwoodSharedGeometry).toBe(true)
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
