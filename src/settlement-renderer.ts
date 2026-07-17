import * as THREE from "three"
import type { ComposedBuilding, ComposedWorld, SettlementKind } from "../shared/world-composer"
import { SHERWOOD_RIDGE_ROCK_LAYOUT } from "../shared/world-layout"
import { selectSherwoodRidgeRockObstaclesForRoads } from "../shared/world-obstacles"
import {
  createStylizedBuildingBatch,
  type StylizedBuildingDescriptor,
  type StylizedBuildingPalette,
} from "./building-visuals"
import { sherwoodFootprintGroundY, sherwoodHeightAt } from "./sherwood-terrain"
import { createToonMaterial } from "./toon-materials"
import {
  countVillageDrawCalls,
  createVillageCottageBatch,
  type VillageCottageInstance,
} from "./village-assets"

export const SETTLEMENT_WORLD_DRAW_CALL_BUDGET = 45

export interface SettlementWorldOptions {
  villageCatalog?: THREE.Object3D
  castShadow?: boolean
}

const settlementGreenShape = new THREE.Shape([
  new THREE.Vector2(-0.94, -0.18),
  new THREE.Vector2(-0.78, -0.74),
  new THREE.Vector2(-0.18, -1),
  new THREE.Vector2(0.5, -0.84),
  new THREE.Vector2(1, -0.3),
  new THREE.Vector2(0.88, 0.38),
  new THREE.Vector2(0.54, 0.92),
  new THREE.Vector2(-0.12, 0.96),
  new THREE.Vector2(-0.72, 0.7),
])
const settlementGreenGeometry = new THREE.ShapeGeometry(settlementGreenShape)
settlementGreenGeometry.rotateX(-Math.PI / 2)
const ridgeGeometry = new THREE.DodecahedronGeometry(1, 0)
const sharedSettlementMaterial = createToonMaterial({ color: 0xffffff })

function paletteFor(settlementKind: SettlementKind): StylizedBuildingPalette {
  if (settlementKind === "sheriff-post") return "sheriff"
  if (settlementKind === "outlaw-hamlet") return "outlaw"
  return "village"
}

function buildingDescriptor(
  building: ComposedBuilding,
  settlementKind: SettlementKind,
): StylizedBuildingDescriptor {
  return {
    id: building.id,
    kind: building.kind,
    palette: paletteFor(settlementKind),
    position: {
      x: building.position.x,
      y: sherwoodFootprintGroundY(
        building.position.x,
        building.position.z,
        building.halfExtents.x,
        building.halfExtents.z,
        building.rotation,
      ),
      z: building.position.z,
    },
    rotation: building.rotation,
    width: building.halfExtents.x * 2,
    depth: building.halfExtents.z * 2,
  }
}

function createBuildingMarker(building: ComposedBuilding, settlementKind: SettlementKind): THREE.Group {
  const marker = new THREE.Group()
  marker.name = building.id
  marker.position.set(
    building.position.x,
    sherwoodFootprintGroundY(
      building.position.x,
      building.position.z,
      building.halfExtents.x,
      building.halfExtents.z,
      building.rotation,
    ),
    building.position.z,
  )
  marker.rotation.y = building.rotation
  marker.userData = {
    sherwoodBuildingKind: building.kind,
    sherwoodSettlementKind: settlementKind,
    sherwoodColliderHalfExtents: { ...building.halfExtents },
  }
  return marker
}

function instanced(
  name: string,
  geometry: THREE.BufferGeometry,
  matrices: readonly THREE.Matrix4[],
  colors: readonly number[],
  castShadow: boolean,
): THREE.InstancedMesh {
  const result = new THREE.InstancedMesh(geometry, sharedSettlementMaterial, matrices.length)
  result.name = name
  result.userData.sherwoodOwnedInstanceBuffer = true
  result.castShadow = castShadow
  result.receiveShadow = true
  matrices.forEach((matrix, index) => {
    result.setMatrixAt(index, matrix)
    result.setColorAt(index, new THREE.Color(colors[index]))
  })
  result.instanceMatrix.needsUpdate = true
  if (result.instanceColor) result.instanceColor.needsUpdate = true
  result.computeBoundingBox()
  result.computeBoundingSphere()
  return result
}

function createSettlementSquares(world: ComposedWorld): THREE.InstancedMesh {
  const matrices = world.settlements.map((settlement, index) => (
    new THREE.Matrix4().compose(
      new THREE.Vector3(
        settlement.center.x,
        sherwoodFootprintGroundY(
          settlement.center.x,
          settlement.center.z,
          3.6,
          2.65,
          settlement.streetHeading,
        ) + 0.035,
        settlement.center.z,
      ),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        settlement.streetHeading,
      ),
      new THREE.Vector3(3.6 + (index % 2) * 0.2, 1, 2.65),
    )
  ))
  const colors = world.settlements.map((settlement) => (
    settlement.kind === "sheriff-post" ? 0x6d5942
      : settlement.kind === "outlaw-hamlet" ? 0x4c5b38
        : 0x586a40
  ))
  return instanced("SettlementGreenInstances", settlementGreenGeometry, matrices, colors, false)
}

function createBlindSpots(world: ComposedWorld, castShadow: boolean): THREE.Group {
  const group = new THREE.Group()
  group.name = "SherwoodBlindSpots"
  const visibleRockIds = new Set(selectSherwoodRidgeRockObstaclesForRoads(world.roads).map((rock) => rock.id))
  const visibleRocks = SHERWOOD_RIDGE_ROCK_LAYOUT.filter((_, index) => visibleRockIds.has(`sherwood-ridge-rock-${index}`))
  const ridgeMatrices = visibleRocks.map((rock) => new THREE.Matrix4().compose(
    new THREE.Vector3(rock.x, sherwoodHeightAt(rock.x, rock.z) + 0.8, rock.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rock.rotation),
    new THREE.Vector3(rock.scale.x, rock.scale.y, rock.scale.z),
  ))
  const ridgeColors = visibleRocks.map((rock) => rock.color)
  group.add(instanced("RidgeRockInstances", ridgeGeometry, ridgeMatrices, ridgeColors, castShadow))
  return group
}

function usesAuthoredCottage(settlementKind: SettlementKind, options: SettlementWorldOptions): boolean {
  return options.villageCatalog !== undefined && settlementKind !== "sheriff-post"
}

// Measured from the fingerprinted shipping village catalog. Scaling from the
// actual visual envelope keeps facades and steps inside authoritative collision.
const AUTHORED_COTTAGE_MAX_ABS_X = 2.12
const AUTHORED_COTTAGE_MAX_ABS_Z = 2.28
const AUTHORED_COTTAGE_COLLISION_MARGIN = 0.99

export function authoredCottageScaleForCollider(halfExtents: Readonly<{ x: number; z: number }>): Readonly<{ x: number; y: number; z: number }> {
  return {
    x: halfExtents.x / AUTHORED_COTTAGE_MAX_ABS_X * AUTHORED_COTTAGE_COLLISION_MARGIN,
    y: 1,
    z: halfExtents.z / AUTHORED_COTTAGE_MAX_ABS_Z * AUTHORED_COTTAGE_COLLISION_MARGIN,
  }
}

function authoredCottageInstance(building: ComposedBuilding): VillageCottageInstance {
  return {
    id: building.id,
    position: {
      x: building.position.x,
      y: sherwoodFootprintGroundY(
        building.position.x,
        building.position.z,
        building.halfExtents.x,
        building.halfExtents.z,
        building.rotation,
      ),
      z: building.position.z,
    },
    rotation: building.rotation,
    scale: authoredCottageScaleForCollider(building.halfExtents),
  }
}

/**
 * Renders collision-aligned settlement identities with aggressively batched
 * visual geometry. A loaded village catalog upgrades friendly cottages in one
 * constant-cost authored batch; the synchronous path remains a rich fallback.
 */
export function createSettlementWorld(
  world: ComposedWorld,
  options: SettlementWorldOptions = {},
): THREE.Group {
  const group = new THREE.Group()
  group.name = "SherwoodSettlementWorld"
  const castShadow = options.castShadow ?? true
  const proceduralBuildings: StylizedBuildingDescriptor[] = []
  const authoredCottages: VillageCottageInstance[] = []

  for (const settlement of world.settlements) {
    const cluster = new THREE.Group()
    cluster.name = settlement.id
    cluster.userData.sherwoodSettlementKind = settlement.kind
    for (const building of settlement.buildings) {
      cluster.add(createBuildingMarker(building, settlement.kind))
      if (building.kind === "cottage" && usesAuthoredCottage(settlement.kind, options)) {
        authoredCottages.push(authoredCottageInstance(building))
      } else {
        proceduralBuildings.push(buildingDescriptor(building, settlement.kind))
      }
    }
    group.add(cluster)
  }

  group.add(
    createSettlementSquares(world),
    createStylizedBuildingBatch(proceduralBuildings, { castShadow }),
    createBlindSpots(world, castShadow),
  )
  if (options.villageCatalog && authoredCottages.length > 0) {
    group.add(createVillageCottageBatch(options.villageCatalog, authoredCottages, { castShadow }))
  }

  const drawCalls = countVillageDrawCalls(group)
  group.userData = {
    sherwoodSettlementBuildingCount: world.buildingCount,
    sherwoodSettlementAuthoredCottageCount: authoredCottages.length,
    sherwoodSettlementDrawCalls: drawCalls,
  }
  if (drawCalls > SETTLEMENT_WORLD_DRAW_CALL_BUDGET) {
    disposeSettlementWorld(group)
    throw new Error(
      `Settlement world uses ${drawCalls} draw calls; budget is ${SETTLEMENT_WORLD_DRAW_CALL_BUDGET}`,
    )
  }
  return group
}

/** Releases view-owned instance buffers while preserving shared catalog assets. */
export function disposeSettlementWorld(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.userData.sherwoodOwnedInstanceBuffer === true) object.dispose()
  })
}
