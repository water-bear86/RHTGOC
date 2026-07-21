import * as THREE from "three"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import type { RegionalMissionLayout } from "../shared/regional-layout"
import type { ComposedWorld } from "../shared/world-composer"
import {
  SHERWOOD_OBJECTIVE_GATE_HALF_WIDTH,
  SHERWOOD_OBJECTIVE_STOCKADE_HALF_DEPTH,
  SHERWOOD_OBJECTIVE_STOCKADE_HALF_WIDTH,
} from "../shared/world-obstacles"
import { SHERWOOD_SETTLEMENT_SITES } from "../shared/world-topology"
import { createStylizedBuildingVisual, disposeStylizedBuildingVisuals } from "./building-visuals"
import { createToonMaterial } from "./toon-materials"
import { sherwoodHeightAt } from "./sherwood-terrain"
import { createNatureVariantInstances, type NatureCatalog } from "./nature-assets"

export interface SherwoodLandmarks {
  group: THREE.Group
  windmillRotor: THREE.Group
  objectiveGate: THREE.Group | null
  objectiveKey: THREE.Group | null
  farmPosition: Readonly<{ x: number; z: number }>
  stoneCirclePosition: Readonly<{ x: number; z: number }>
  wheatCount: number
  dispose(): void
}

const materialCache = new Map<number, THREE.MeshToonMaterial>()
function material(color: number): THREE.MeshToonMaterial {
  let result = materialCache.get(color)
  if (!result) {
    result = createToonMaterial({ color })
    materialCache.set(color, result)
  }
  return result
}

function mesh(name: string, geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material(color))
  result.name = name
  result.castShadow = true
  result.receiveShadow = true
  return result
}

function instancedMesh(
  name: string,
  geometry: THREE.BufferGeometry,
  color: number,
  count: number,
): THREE.InstancedMesh {
  const result = new THREE.InstancedMesh(geometry, material(color), count)
  result.name = name
  result.castShadow = true
  result.receiveShadow = true
  return result
}

function distanceToSegment(
  point: { x: number; z: number },
  start: { x: number; z: number },
  end: { x: number; z: number },
): number {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const lengthSquared = dx * dx + dz * dz
  if (lengthSquared < 1e-9) return Math.hypot(point.x - start.x, point.z - start.z)
  const amount = Math.max(0, Math.min(1, (
    (point.x - start.x) * dx + (point.z - start.z) * dz
  ) / lengthSquared))
  return Math.hypot(
    point.x - (start.x + dx * amount),
    point.z - (start.z + dz * amount),
  )
}

function distanceToRoads(point: { x: number; z: number }, world?: ComposedWorld): number {
  if (!world || world.roads.length === 0) return 30
  return Math.min(...world.roads.flatMap((road) => road.points.slice(1).map((end, index) => (
    distanceToSegment(point, road.points[index], end) - road.width / 2
  ))))
}

export function chooseFarmPosition(
  layout: RegionalMissionLayout,
  world?: ComposedWorld,
): Readonly<{ x: number; z: number }> {
  const candidates = [
    { x: -48, z: -48 }, { x: 48, z: -48 }, { x: -48, z: 48 }, { x: 48, z: 48 },
  ]
  const hazards = [
    layout.campfirePosition,
    layout.objectivePosition,
    ...layout.crossingPositions,
    ...(world?.settlements.map(({ center }) => center) ?? []),
  ]
  return candidates.sort((left, right) => {
    const score = (point: { x: number; z: number }): number => Math.min(
      distanceToRoads(point, world),
      ...hazards.map((hazard) => Math.hypot(point.x - hazard.x, point.z - hazard.z)),
    )
    return score(right) - score(left)
  })[0]
}

export function chooseStoneCirclePosition(
  layout: RegionalMissionLayout,
  world: ComposedWorld | undefined,
  farmPosition: Readonly<{ x: number; z: number }>,
): Readonly<{ x: number; z: number }> {
  const usedSettlements = new Set(world?.settlements.map(({ center }) => `${center.x}:${center.z}`) ?? [])
  const hazards = [layout.campfirePosition, layout.objectivePosition, farmPosition]
  const candidates = SHERWOOD_SETTLEMENT_SITES.filter((site) => (
    !usedSettlements.has(`${site.center.x}:${site.center.z}`)
    && hazards.every((hazard) => Math.hypot(site.center.x - hazard.x, site.center.z - hazard.z) > 15)
    && distanceToRoads(site.center, world) > 5.5
  ))
  const available = candidates.length > 0
    ? candidates
    : SHERWOOD_SETTLEMENT_SITES.filter((site) => !usedSettlements.has(`${site.center.x}:${site.center.z}`))
  return { ...[...available].sort((left, right) => {
    const score = (point: { x: number; z: number }): number => Math.min(
      distanceToRoads(point, world),
      ...hazards.map((hazard) => Math.hypot(point.x - hazard.x, point.z - hazard.z)),
    )
    return score(right.center) - score(left.center)
  })[0].center }
}

interface TerrainFrame {
  x: number
  z: number
  y: number
  rotation: number
}

function worldPointInFrame(frame: TerrainFrame, x: number, z: number): Readonly<{ x: number; z: number }> {
  const cosine = Math.cos(frame.rotation)
  const sine = Math.sin(frame.rotation)
  return {
    x: frame.x + cosine * x + sine * z,
    z: frame.z - sine * x + cosine * z,
  }
}

function terrainYInFrame(frame: TerrainFrame, x: number, z: number, offset = 0): number {
  const world = worldPointInFrame(frame, x, z)
  return sherwoodHeightAt(world.x, world.z) - frame.y + offset
}

function setOnTerrainInFrame(
  object: THREE.Object3D,
  frame: TerrainFrame,
  x: number,
  z: number,
  offset = 0,
): void {
  object.position.set(x, terrainYInFrame(frame, x, z, offset), z)
}

function createDrapedFarmSoil(frame: TerrainFrame): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(15, 10, 12, 8)
  geometry.rotateX(-Math.PI / 2)
  const positions = geometry.getAttribute("position")
  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(index, terrainYInFrame(frame, positions.getX(index) - 1, positions.getZ(index) - 0.2, 0.018))
    positions.setX(index, positions.getX(index) - 1)
    positions.setZ(index, positions.getZ(index) - 0.2)
  }
  positions.needsUpdate = true
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const soil = mesh("FarmFieldSoil", geometry, 0x80613d)
  soil.castShadow = false
  return soil
}

function addFence(
  parent: THREE.Group,
  frame: TerrainFrame,
  x: number,
  z: number,
  length: number,
  rotation: number,
): void {
  const fence = new THREE.Group()
  fence.name = "FarmFence"
  fence.position.set(x, 0, z)
  fence.rotation.y = rotation
  const terrainAt = (localX: number): number => terrainYInFrame(
    frame,
    x + Math.cos(rotation) * localX,
    z - Math.sin(rotation) * localX,
  )
  for (const localX of [-length / 2, 0, length / 2]) {
    const post = mesh("FencePost", new THREE.BoxGeometry(0.16, 1.15, 0.16), 0x604329)
    post.position.set(localX, terrainAt(localX) + 0.575, 0)
    fence.add(post)
  }
  const startY = terrainAt(-length / 2)
  const endY = terrainAt(length / 2)
  const railAngle = Math.atan2(endY - startY, length)
  const railLength = Math.hypot(length, endY - startY)
  for (const y of [0.42, 0.85]) {
    const rail = mesh("FenceRail", new THREE.BoxGeometry(railLength, 0.12, 0.12), 0x765536)
    rail.position.y = (startY + endY) / 2 + y
    rail.rotation.z = railAngle
    fence.add(rail)
  }
  parent.add(fence)
}

interface StockadeSpanPlacement {
  x: number
  z: number
  length: number
  rotation: number
}

function createStockadeWalls(spans: readonly StockadeSpanPlacement[]): THREE.Group {
  const group = new THREE.Group()
  group.name = "StockadeWalls"
  const postCounts = spans.map(({ length }) => Math.max(2, Math.ceil(length / 0.72)) + 1)
  const posts = instancedMesh(
    "StockadePosts",
    new THREE.CylinderGeometry(0.17, 0.2, 2.35, 5),
    0x5a3822,
    postCounts.reduce((sum, count) => sum + count, 0),
  )
  const rails = instancedMesh(
    "StockadeRails",
    new THREE.BoxGeometry(1, 0.16, 0.18),
    0x3f291d,
    spans.length * 2,
  )
  const matrix = new THREE.Matrix4()
  const position = new THREE.Vector3()
  const rotation = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  let postInstance = 0
  let railInstance = 0

  spans.forEach((span, spanIndex) => {
    const postCount = postCounts[spanIndex]
    const cosine = Math.cos(span.rotation)
    const sine = Math.sin(span.rotation)
    for (let index = 0; index < postCount; index += 1) {
      const localX = (index / (postCount - 1) - 0.5) * span.length
      position.set(
        span.x + cosine * localX,
        1.12 + (index % 3) * 0.035,
        span.z - sine * localX,
      )
      rotation.setFromEuler(new THREE.Euler(0, span.rotation + index * 0.47, 0))
      scale.set(1, 1, 1)
      matrix.compose(position, rotation, scale)
      posts.setMatrixAt(postInstance, matrix)
      postInstance += 1
    }
    for (const y of [0.55, 1.45]) {
      position.set(span.x, y, span.z)
      rotation.setFromEuler(new THREE.Euler(0, span.rotation, 0))
      scale.set(span.length, 1, 1)
      matrix.compose(position, rotation, scale)
      rails.setMatrixAt(railInstance, matrix)
      railInstance += 1
    }
  })
  posts.instanceMatrix.needsUpdate = true
  rails.instanceMatrix.needsUpdate = true
  group.add(posts, rails)
  return group
}

function createObjectiveStockade(layout: RegionalMissionLayout): {
  group: THREE.Group
  gate: THREE.Group
  key: THREE.Group
} {
  const group = new THREE.Group()
  group.name = "SheriffsTaxStockade"
  group.position.set(
    layout.objectivePosition.x,
    sherwoodHeightAt(layout.objectivePosition.x, layout.objectivePosition.z),
    layout.objectivePosition.z,
  )
  group.rotation.y = layout.objectiveGateRotation
  const halfWidth = SHERWOOD_OBJECTIVE_STOCKADE_HALF_WIDTH
  const halfDepth = SHERWOOD_OBJECTIVE_STOCKADE_HALF_DEPTH
  const gateHalfWidth = SHERWOOD_OBJECTIVE_GATE_HALF_WIDTH
  const frontSegmentLength = halfWidth - gateHalfWidth
  group.add(createStockadeWalls([
    { x: 0, z: -halfDepth, length: halfWidth * 2, rotation: 0 },
    { x: -halfWidth, z: 0, length: halfDepth * 2, rotation: Math.PI / 2 },
    { x: halfWidth, z: 0, length: halfDepth * 2, rotation: Math.PI / 2 },
    { x: -(halfWidth + gateHalfWidth) / 2, z: halfDepth, length: frontSegmentLength, rotation: 0 },
    { x: (halfWidth + gateHalfWidth) / 2, z: halfDepth, length: frontSegmentLength, rotation: 0 },
  ]))

  const gate = new THREE.Group()
  gate.name = "StockadeGateHinge"
  gate.position.set(-gateHalfWidth, 0, halfDepth)
  const gatePlanks = instancedMesh(
    "StockadeGatePlanks",
    new THREE.BoxGeometry(0.54, 2.15, 0.2),
    0x6a4226,
    5,
  )
  const gateBraces = instancedMesh(
    "StockadeGateBraces",
    new THREE.BoxGeometry(3, 0.15, 0.24),
    0x3c281d,
    2,
  )
  const gateMatrix = new THREE.Matrix4()
  for (let index = 0; index < 5; index += 1) {
    gateMatrix.makeTranslation(0.3 + index * 0.6, 1.05 + (index % 2) * 0.04, 0)
    gatePlanks.setMatrixAt(index, gateMatrix)
  }
  ;[0.52, 1.52].forEach((y, index) => {
    gateMatrix.makeTranslation(gateHalfWidth, y, 0)
    gateBraces.setMatrixAt(index, gateMatrix)
  })
  gatePlanks.instanceMatrix.needsUpdate = true
  gateBraces.instanceMatrix.needsUpdate = true
  const chain = mesh("StockadeGateChain", new THREE.TorusGeometry(0.24, 0.045, 6, 14), 0x8b806c)
  chain.position.set(gateHalfWidth, 1.12, 0.16)
  gate.add(gatePlanks, gateBraces, chain)
  group.add(gate)

  const cosine = Math.cos(layout.objectiveGateRotation)
  const sine = Math.sin(layout.objectiveGateRotation)
  const keyDx = layout.objectiveGateKeyPosition.x - layout.objectivePosition.x
  const keyDz = layout.objectiveGateKeyPosition.z - layout.objectivePosition.z
  const key = new THREE.Group()
  key.name = "SheriffsGateKey"
  key.position.set(
    cosine * keyDx - sine * keyDz,
    sherwoodHeightAt(layout.objectiveGateKeyPosition.x, layout.objectiveGateKeyPosition.z) - group.position.y,
    sine * keyDx + cosine * keyDz,
  )
  const post = mesh("GateKeyPost", new THREE.CylinderGeometry(0.16, 0.2, 1.8, 6), 0x4c3020)
  post.position.y = 0.9
  const pennant = mesh("GateKeyPennant", new THREE.BoxGeometry(0.72, 0.48, 0.05), 0x8f2f23)
  pennant.position.set(0.42, 1.52, 0)
  const keyParts = [
    new THREE.TorusGeometry(0.2, 0.055, 7, 18).translate(0, 1.16, 0.22),
    new THREE.BoxGeometry(0.08, 0.48, 0.08).translate(0, 0.88, 0.22),
    new THREE.BoxGeometry(0.2, 0.08, 0.08).translate(0.07, 0.66, 0.22),
  ]
  const keyGeometry = mergeGeometries(keyParts)
  keyParts.forEach((geometry) => geometry.dispose())
  if (!keyGeometry) throw new Error("Unable to build Sheriff's gate key")
  const keyMetal = mesh("GateKey", keyGeometry, 0xd3a23d)
  key.add(post, pennant, keyMetal)
  group.add(key)
  return { group, gate, key }
}

function createWheatField(frame: TerrainFrame, natureCatalog?: NatureCatalog): { group: THREE.Group; count: number } {
  const group = new THREE.Group()
  group.name = "GoldenWheatField"
  const rows = 15
  const columns = 22
  const count = rows * columns
  const matrix = new THREE.Matrix4()
  const matrices: THREE.Matrix4[] = []
  let index = 0
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = -6.4 + column * 0.58 + Math.sin(row * 2.3 + column) * 0.06
      const z = -4.1 + row * 0.56
      const height = 0.78 + ((row * 17 + column * 7) % 9) * 0.025
      const localX = x - 1
      matrix.compose(
        new THREE.Vector3(localX, terrainYInFrame(frame, localX, z, 0.03), z),
        new THREE.Quaternion(),
        new THREE.Vector3(1, height, 1),
      )
      matrices.push(matrix.clone())
      index += 1
    }
  }
  if (natureCatalog) {
    const wheat = createNatureVariantInstances(natureCatalog, "Nature_Wheat_Tall", matrices)
    wheat.name = "WheatInstances"
    group.add(wheat)
  } else {
    const geometry = new THREE.ConeGeometry(0.1, 0.82, 4)
    geometry.translate(0, 0.41, 0)
    const wheat = new THREE.InstancedMesh(geometry, material(0xd7a938), count)
    wheat.name = "WheatInstances"
    matrices.forEach((placement, placementIndex) => wheat.setMatrixAt(placementIndex, placement))
    wheat.castShadow = false
    wheat.receiveShadow = true
    wheat.instanceMatrix.needsUpdate = true
    group.add(wheat)
  }
  return { group, count }
}

function createWindmill(): { group: THREE.Group; rotor: THREE.Group } {
  const group = new THREE.Group()
  group.name = "WindmillLandmark"
  const base = mesh("WindmillStoneBase", new THREE.CylinderGeometry(2.45, 2.9, 4.8, 10), 0xb9aa88)
  base.position.y = 2.4
  const timberBand = mesh("WindmillTimberBand", new THREE.CylinderGeometry(2.52, 2.72, 0.28, 10), 0x59402a)
  timberBand.position.y = 3.45
  const roof = mesh("WindmillRoof", new THREE.ConeGeometry(3.05, 2.05, 10), 0x5c3828)
  roof.position.y = 5.82
  const door = mesh("WindmillDoor", new THREE.BoxGeometry(0.9, 1.75, 0.16), 0x4a3022)
  door.position.set(0, 0.9, 2.61)
  const window = mesh("WindmillWindow", new THREE.BoxGeometry(0.72, 0.72, 0.18), 0x4a3022)
  window.position.set(0, 3.25, 2.47)
  group.add(base, timberBand, roof, door, window)

  const rotor = new THREE.Group()
  rotor.name = "WindmillRotor"
  rotor.position.set(0, 4.35, 2.72)
  for (let bladeIndex = 0; bladeIndex < 4; bladeIndex += 1) {
    const arm = new THREE.Group()
    arm.rotation.z = bladeIndex * Math.PI / 2
    const spar = mesh("WindmillBladeSpar", new THREE.BoxGeometry(0.16, 4.8, 0.16), 0x4a3022)
    spar.position.y = 2.15
    const sail = mesh("WindmillBladeSail", new THREE.BoxGeometry(0.78, 3.25, 0.08), 0xd8cba5)
    sail.position.set(0.42, 2.55, 0)
    arm.add(spar, sail)
    rotor.add(arm)
  }
  const axle = mesh("WindmillAxle", new THREE.CylinderGeometry(0.27, 0.27, 0.7, 8), 0x3c2b21)
  axle.rotation.x = Math.PI / 2
  rotor.add(axle)
  group.add(rotor)
  return { group, rotor }
}

function createFarmhouse(): THREE.Group {
  return createStylizedBuildingVisual({
    id: "FarmhouseLandmark",
    kind: "farmhouse",
    palette: "farm",
    width: 4.7,
    depth: 3.5,
  })
}

export function createSherwoodLandmarks(
  layout: RegionalMissionLayout,
  options: { natureCatalog?: NatureCatalog; world?: ComposedWorld } = {},
): SherwoodLandmarks {
  const group = new THREE.Group()
  group.name = "SherwoodLandmarks"
  const objectiveStockade = layout.objectiveStockadeEnabled
    ? createObjectiveStockade(layout)
    : null
  if (objectiveStockade) group.add(objectiveStockade.group)
  const farmPosition = chooseFarmPosition(layout, options.world)
  const farm = new THREE.Group()
  farm.name = "WindmillFarm"
  const farmRotation = farmPosition.x * farmPosition.z > 0 ? -0.35 : 0.35
  const farmHeight = sherwoodHeightAt(farmPosition.x, farmPosition.z)
  const farmFrame: TerrainFrame = { x: farmPosition.x, z: farmPosition.z, y: farmHeight, rotation: farmRotation }
  farm.position.set(farmPosition.x, farmHeight, farmPosition.z)
  farm.rotation.y = farmRotation

  const soil = createDrapedFarmSoil(farmFrame)
  const { group: wheat, count: wheatCount } = createWheatField(farmFrame, options.natureCatalog)
  const { group: windmill, rotor } = createWindmill()
  setOnTerrainInFrame(windmill, farmFrame, 8.4, -1.2)
  const farmhouse = createFarmhouse()
  setOnTerrainInFrame(farmhouse, farmFrame, 1.7, 7.1)
  farmhouse.rotation.y = Math.PI
  farm.add(soil, wheat, windmill, farmhouse)
  addFence(farm, farmFrame, -1, -5.3, 15, 0)
  addFence(farm, farmFrame, -8.5, -0.2, 10.2, Math.PI / 2)
  addFence(farm, farmFrame, 6.5, -0.2, 10.2, Math.PI / 2)
  group.add(farm)

  const stoneCircle = new THREE.Group()
  stoneCircle.name = "AncientStoneCircle"
  const stoneCirclePosition = chooseStoneCirclePosition(layout, options.world, farmPosition)
  const stoneCircleHeight = sherwoodHeightAt(stoneCirclePosition.x, stoneCirclePosition.z)
  stoneCircle.position.set(stoneCirclePosition.x, stoneCircleHeight, stoneCirclePosition.z)
  for (let index = 0; index < 7; index += 1) {
    const stone = mesh("StandingStone", new THREE.DodecahedronGeometry(0.7, 0), 0x777b6d)
    const angle = index / 7 * Math.PI * 2
    stone.scale.set(0.65, 1.8 + (index % 3) * 0.25, 0.55)
    const x = Math.cos(angle) * 3.1
    const z = Math.sin(angle) * 3.1
    stone.position.set(
      x,
      sherwoodHeightAt(stoneCirclePosition.x + x, stoneCirclePosition.z + z)
        - stoneCircleHeight
        + stone.scale.y * 0.34,
      z,
    )
    stone.rotation.y = angle + 0.4
    stoneCircle.add(stone)
  }
  group.add(stoneCircle)

  let disposed = false
  return {
    group,
    windmillRotor: rotor,
    objectiveGate: objectiveStockade?.gate ?? null,
    objectiveKey: objectiveStockade?.key ?? null,
    farmPosition,
    stoneCirclePosition,
    wheatCount,
    dispose: () => {
      if (disposed) return
      disposed = true
      disposeStylizedBuildingVisuals(farmhouse)

      const farmhouseObjects = new Set<THREE.Object3D>()
      farmhouse.traverse((object) => farmhouseObjects.add(object))
      const ownedGeometries = new Set<THREE.BufferGeometry>()
      group.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || farmhouseObjects.has(object)) return
        if (object.userData.sherwoodSharedGeometry !== true) ownedGeometries.add(object.geometry)
        if (object instanceof THREE.InstancedMesh) object.dispose()
      })
      ownedGeometries.forEach((geometry) => geometry.dispose())
    },
  }
}
