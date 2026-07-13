import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import { regionalizeMissionDefinition } from "../shared/regional-layout"
import { composeSherwoodWorld } from "../shared/world-composer"
import { sherwoodHeightAt } from "./sherwood-terrain"
import {
  SETTLEMENT_WORLD_DRAW_CALL_BUDGET,
  authoredCottageScaleForCollider,
  createSettlementWorld,
  disposeSettlementWorld,
} from "./settlement-renderer"
import { VILLAGE_MODULE_NAMES, countVillageDrawCalls } from "./village-assets"

function syntheticVillageCatalog(): THREE.Group {
  const scene = new THREE.Group()
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff })
  for (const name of VILLAGE_MODULE_NAMES) {
    const root = new THREE.Group()
    root.name = name
    const mesh = new THREE.Mesh(geometry, material)
    mesh.name = `${name}:mesh`
    root.add(mesh)
    scene.add(root)
  }
  return scene
}

describe("settlement renderer", () => {
  const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 818).layout
  const composed = composeSherwoodWorld(layout)

  it("keeps every rendered building identity aligned with authoritative collision", () => {
    const rendered = createSettlementWorld(composed)

    expect(rendered.getObjectByName("SherwoodBlindSpots")).toBeTruthy()
    for (const settlement of composed.settlements) {
      expect(rendered.getObjectByName(settlement.id)?.userData.sherwoodSettlementKind).toBe(settlement.kind)
      for (const building of settlement.buildings) {
        const marker = rendered.getObjectByName(building.id)
        expect(marker).toBeTruthy()
        expect(marker?.position.toArray()).toEqual([
          building.position.x,
          sherwoodHeightAt(building.position.x, building.position.z),
          building.position.z,
        ])
        expect(marker?.rotation.y).toBeCloseTo(building.rotation)
        expect(marker?.userData.sherwoodColliderHalfExtents).toEqual(building.halfExtents)
      }
    }
  })

  it("batches rich fallback buildings, greens, rocks, and hedges into five submissions", () => {
    const rendered = createSettlementWorld(composed)
    const details = rendered.getObjectByName("StylizedBuildingDetails") as THREE.InstancedMesh
    const ridges = rendered.getObjectByName("RidgeRockInstances") as THREE.InstancedMesh
    const hedges = rendered.getObjectByName("HedgerowInstances") as THREE.InstancedMesh
    const greens = rendered.getObjectByName("SettlementGreenInstances") as THREE.InstancedMesh

    expect(countVillageDrawCalls(rendered)).toBe(5)
    expect(rendered.userData.sherwoodSettlementDrawCalls).toBe(5)
    expect(rendered.userData.sherwoodSettlementBuildingCount).toBe(composed.buildingCount)
    expect(details.count).toBeGreaterThan(composed.buildingCount * 20)
    expect(ridges.count).toBe(22)
    expect(hedges.count).toBe(18)
    expect(greens.count).toBe(3)
  })

  it("upgrades friendly cottages through one authored batch without duplicating sheriff visuals", () => {
    const catalog = syntheticVillageCatalog()
    const friendlyCottages = composed.settlements
      .filter((settlement) => settlement.kind !== "sheriff-post")
      .flatMap((settlement) => settlement.buildings)
      .filter((building) => building.kind === "cottage")
    const proceduralCount = composed.buildingCount - friendlyCottages.length
    const rendered = createSettlementWorld(composed, { villageCatalog: catalog })
    const authored = rendered.getObjectByName("SherwoodVillageCottageBatch")
    const procedural = rendered.getObjectByName("SherwoodStylizedBuildingBatch")

    expect(authored?.userData.sherwoodVillageCottageCount).toBe(friendlyCottages.length)
    expect(procedural?.userData.sherwoodBuildingCount).toBe(proceduralCount)
    expect(rendered.userData.sherwoodSettlementAuthoredCottageCount).toBe(friendlyCottages.length)
    expect(countVillageDrawCalls(rendered)).toBeLessThanOrEqual(SETTLEMENT_WORLD_DRAW_CALL_BUDGET)
  })

  it("fits the fingerprinted authored cottage envelope inside authoritative collision", () => {
    const halfExtents = { x: 1.9, z: 1.45 }
    const scale = authoredCottageScaleForCollider(halfExtents)

    expect(scale.x * 2.12).toBeLessThanOrEqual(halfExtents.x)
    expect(scale.z * 2.28).toBeLessThanOrEqual(halfExtents.z)
    expect(scale.x).toBeCloseTo(0.8873, 4)
    expect(scale.z).toBeCloseTo(0.6296, 4)
  })

  it("releases only renderer-owned instance buffers", () => {
    const rendered = createSettlementWorld(composed, { villageCatalog: syntheticVillageCatalog() })
    const instance = rendered.getObjectByName("StylizedBuildingDetails") as THREE.InstancedMesh
    const disposed = vi.fn()
    instance.addEventListener("dispose", disposed)

    disposeSettlementWorld(rendered)

    expect(disposed).toHaveBeenCalledOnce()
  })
})
