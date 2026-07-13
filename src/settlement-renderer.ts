import * as THREE from "three"
import type { ComposedBuilding, ComposedWorld, SettlementKind } from "../shared/world-composer"
import {
  createStylizedBuildingBatch,
  type StylizedBuildingDescriptor,
  type StylizedBuildingPalette,
} from "./building-visuals"
import { sherwoodHeightAt } from "./sherwood-terrain"
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

const unitCircleGeometry = new THREE.CircleGeometry(1, 20)
unitCircleGeometry.rotateX(-Math.PI / 2)
const ridgeGeometry = new THREE.DodecahedronGeometry(1, 0)
const hedgeGeometry = new THREE.IcosahedronGeometry(1, 1)
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
      y: sherwoodHeightAt(building.position.x, building.position.z),
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
    sherwoodHeightAt(building.position.x, building.position.z),
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
  const matrices = world.settlements.map((settlement) => new THREE.Matrix4().compose(
    new THREE.Vector3(
      settlement.center.x,
      sherwoodHeightAt(settlement.center.x, settlement.center.z) + 0.035,
      settlement.center.z,
    ),
    new THREE.Quaternion(),
    new THREE.Vector3(5.5, 1, 5.5),
  ))
  const colors = world.settlements.map((settlement) => (
    settlement.kind === "sheriff-post" ? 0x765d46
      : settlement.kind === "outlaw-hamlet" ? 0x796546
        : 0x8d744d
  ))
  return instanced("SettlementGreenInstances", unitCircleGeometry, matrices, colors, false)
}

function createBlindSpots(castShadow: boolean): THREE.Group {
  const group = new THREE.Group()
  group.name = "SherwoodBlindSpots"
  const ridgeMatrices: THREE.Matrix4[] = []
  const ridgeColors: number[] = []
  for (let index = 0; index < 22; index += 1) {
    const angle = index * 1.71
    const radius = 25 + (index % 5) * 7
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle * 0.87) * radius
    ridgeMatrices.push(new THREE.Matrix4().compose(
      new THREE.Vector3(x, sherwoodHeightAt(x, z) + 0.8, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
      new THREE.Vector3(1.4 + index % 3, 1.25 + index % 4 * 0.35, 1.2 + index % 2),
    ))
    ridgeColors.push(index % 3 === 0 ? 0x5c6458 : 0x697063)
  }
  const hedgeMatrices: THREE.Matrix4[] = []
  const hedgeColors: number[] = []
  for (let index = 0; index < 18; index += 1) {
    const x = -48 + index * 5.5
    const z = 20 + Math.sin(index * 0.85) * 7
    hedgeMatrices.push(new THREE.Matrix4().compose(
      new THREE.Vector3(x, sherwoodHeightAt(x, z) + 1.05, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.25 + Math.sin(index) * 0.2),
      new THREE.Vector3(2.1, 1.4, 0.9),
    ))
    hedgeColors.push(index % 4 === 0 ? 0x315a36 : 0x274e2e)
  }
  group.add(
    instanced("RidgeRockInstances", ridgeGeometry, ridgeMatrices, ridgeColors, castShadow),
    instanced("HedgerowInstances", hedgeGeometry, hedgeMatrices, hedgeColors, castShadow),
  )
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
      y: sherwoodHeightAt(building.position.x, building.position.z),
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
    createBlindSpots(castShadow),
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
