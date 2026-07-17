import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import {
  SHERWOOD_RIVER_CENTER_X,
  SHERWOOD_RIVER_SLOPE,
  regionalizeMissionDefinition,
} from "../shared/regional-layout"
import { composeSherwoodWorld } from "../shared/world-composer"
import { SHERWOOD_RIVER_HALF_WIDTH, selectSherwoodRidgeRockObstaclesForRoads } from "../shared/world-obstacles"
import { SHERWOOD_RIDGE_ROCK_LAYOUT } from "../shared/world-layout"
import { SHERWOOD_SETTLEMENT_SITES } from "../shared/world-topology"
import { sherwoodFootprintGroundY } from "./sherwood-terrain"
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
          sherwoodFootprintGroundY(
            building.position.x,
            building.position.z,
            building.halfExtents.x,
            building.halfExtents.z,
            building.rotation,
          ),
          building.position.z,
        ])
        expect(marker?.rotation.y).toBeCloseTo(building.rotation)
        expect(marker?.userData.sherwoodColliderHalfExtents).toEqual(building.halfExtents)
      }
    }
  })

  it("batches rich fallback buildings, compact commons, and ridge rocks into four submissions", () => {
    const rendered = createSettlementWorld(composed)
    const details = rendered.getObjectByName("StylizedBuildingDetails") as THREE.InstancedMesh
    const ridges = rendered.getObjectByName("RidgeRockInstances") as THREE.InstancedMesh
    const greens = rendered.getObjectByName("SettlementGreenInstances") as THREE.InstancedMesh

    expect(countVillageDrawCalls(rendered)).toBe(4)
    expect(rendered.userData.sherwoodSettlementDrawCalls).toBe(4)
    expect(rendered.userData.sherwoodSettlementBuildingCount).toBe(composed.buildingCount)
    expect(details.count).toBeGreaterThan(composed.buildingCount * 20)
    expect(ridges.count).toBe(selectSherwoodRidgeRockObstaclesForRoads(composed.roads).length)
    expect(greens.count).toBe(3)
  })

  it("renders ridge boulders from the authoritative shared layout", () => {
    const rendered = createSettlementWorld(composed)
    const ridges = rendered.getObjectByName("RidgeRockInstances") as THREE.InstancedMesh
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const rotation = new THREE.Quaternion()
    const scale = new THREE.Vector3()

    const visibleRockIds = new Set(selectSherwoodRidgeRockObstaclesForRoads(composed.roads).map((rock) => rock.id))
    const visibleRocks = SHERWOOD_RIDGE_ROCK_LAYOUT.filter((_, index) => visibleRockIds.has(`sherwood-ridge-rock-${index}`))
    visibleRocks.forEach((rock, index) => {
      ridges.getMatrixAt(index, matrix)
      matrix.decompose(position, rotation, scale)
      expect(position.x).toBeCloseTo(rock.x)
      expect(position.z).toBeCloseTo(rock.z)
      expect(scale.x).toBeCloseTo(rock.scale.x)
      expect(scale.y).toBeCloseTo(rock.scale.y)
      expect(scale.z).toBeCloseTo(rock.scale.z)
      expect(rotation.angleTo(
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rock.rotation),
      )).toBeCloseTo(0)
    })
  })

  it("renders irregular settlement commons entirely outside the river", () => {
    const siteWorld = {
      settlements: SHERWOOD_SETTLEMENT_SITES.map((site, index) => ({
        id: `test-settlement-${site.id}`,
        kind: index % 2 === 0 ? "forest-village" as const : "outlaw-hamlet" as const,
        center: { ...site.center },
        streetHeading: 0,
        buildings: [],
      })),
      roads: [],
      buildingCount: 0,
    }
    const rendered = createSettlementWorld(siteWorld)
    const greens = rendered.getObjectByName("SettlementGreenInstances") as THREE.InstancedMesh
    const positions = greens.geometry.getAttribute("position")
    const radii = new Set<string>()
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      radii.add(Math.hypot(positions.getX(vertex), positions.getZ(vertex)).toFixed(2))
    }
    expect(radii.size).toBeGreaterThan(4)

    const matrix = new THREE.Matrix4()
    const point = new THREE.Vector3()
    const riverNormalLength = Math.hypot(1, -SHERWOOD_RIVER_SLOPE)
    for (let instance = 0; instance < greens.count; instance += 1) {
      greens.getMatrixAt(instance, matrix)
      const signedDistances: number[] = []
      for (let vertex = 0; vertex < positions.count; vertex += 1) {
        point.set(positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)).applyMatrix4(matrix)
        signedDistances.push(
          (point.x - SHERWOOD_RIVER_CENTER_X - SHERWOOD_RIVER_SLOPE * point.z) / riverNormalLength,
        )
      }
      expect(Math.min(...signedDistances.map(Math.abs))).toBeGreaterThanOrEqual(SHERWOOD_RIVER_HALF_WIDTH + 0.39)
      expect(Math.min(...signedDistances) > 0 || Math.max(...signedDistances) < 0).toBe(true)
    }
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
