import * as THREE from "three"
import { createToonMaterial } from "./toon-materials"

export type StylizedBuildingKind = "cottage" | "barn" | "watchtower" | "farmhouse"
export type StylizedBuildingPalette = "outlaw" | "village" | "sheriff" | "farm"

export interface StylizedBuildingDescriptor {
  id: string
  kind: StylizedBuildingKind
  palette: StylizedBuildingPalette
  position: Readonly<{ x: number; y: number; z: number }>
  rotation: number
  width: number
  depth: number
}

export interface StylizedBuildingOptions {
  castShadow?: boolean
}

interface BuildingPalette {
  walls: readonly [number, number]
  roof: readonly [number, number]
  timber: number
  stone: number
  door: number
  window: readonly [number, number]
  accent: number
}

interface Component {
  matrix: THREE.Matrix4
  color: number
}

const PALETTES: Readonly<Record<StylizedBuildingPalette, BuildingPalette>> = Object.freeze({
  outlaw: {
    walls: [0xb7aa7d, 0xa99972],
    roof: [0x4f3b2a, 0x5c452f],
    timber: 0x483725,
    stone: 0x68685b,
    door: 0x3d2d20,
    window: [0xc69a48, 0x7893a0],
    accent: 0x4a673f,
  },
  village: {
    walls: [0xd0bd91, 0xc3ab7a],
    roof: [0x70442f, 0x65402d],
    timber: 0x513824,
    stone: 0x777264,
    door: 0x493021,
    window: [0xe0b75e, 0x7797a1],
    accent: 0x315f37,
  },
  sheriff: {
    walls: [0xbca981, 0xac9673],
    roof: [0x6b302d, 0x783832],
    timber: 0x42302a,
    stone: 0x6e6c65,
    door: 0x392723,
    window: [0xd7aa51, 0x6f8791],
    accent: 0x9a3c32,
  },
  farm: {
    walls: [0xd1bd8b, 0xc5ae78],
    roof: [0x68412d, 0x765036],
    timber: 0x513823,
    stone: 0x747166,
    door: 0x493020,
    window: [0xe2b85c, 0x7896a0],
    accent: 0x6d7d3d,
  },
})

const unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1)
const sharedBuildingMaterial = createToonMaterial({ color: 0xffffff })

function createGableGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.5, 0, 0.5,
    0.5, 0, 0.5,
    0, 1, 0.5,
    -0.5, 0, -0.5,
    0.5, 0, -0.5,
    0, 1, -0.5,
  ], 3))
  geometry.setIndex([
    0, 1, 2,
    3, 5, 4,
    0, 2, 5, 0, 5, 3,
    1, 4, 5, 1, 5, 2,
    0, 3, 4, 0, 4, 1,
  ])
  const faceted = geometry.toNonIndexed()
  faceted.computeVertexNormals()
  faceted.computeBoundingBox()
  faceted.computeBoundingSphere()
  return faceted
}

const gableGeometry = createGableGeometry()

export function stylizedBuildingVariant(id: string): number {
  let hash = 2166136261
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function componentMatrix(
  building: StylizedBuildingDescriptor,
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0],
): THREE.Matrix4 {
  const buildingMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(building.position.x, building.position.y, building.position.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), building.rotation),
    new THREE.Vector3(1, 1, 1),
  )
  const localMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),
    new THREE.Vector3(...scale),
  )
  return buildingMatrix.multiply(localMatrix)
}

function box(
  target: Component[],
  building: StylizedBuildingDescriptor,
  color: number,
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
  rotation?: readonly [number, number, number],
): void {
  target.push({ matrix: componentMatrix(building, position, scale, rotation), color })
}

function gable(
  target: Component[],
  building: StylizedBuildingDescriptor,
  color: number,
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
  rotation?: readonly [number, number, number],
): void {
  target.push({ matrix: componentMatrix(building, position, scale, rotation), color })
}

function addFrontBackTimber(
  boxes: Component[],
  building: StylizedBuildingDescriptor,
  timber: number,
  width: number,
  depth: number,
  base: number,
  wallHeight: number,
  dense: boolean,
): void {
  const faceZ = depth / 2 - 0.035
  const uprightHeight = wallHeight - 0.18
  for (const z of [-faceZ, faceZ]) {
    box(boxes, building, timber, [0, base + wallHeight * 0.58, z], [width * 0.94, 0.13, 0.09])
    for (const x of [-width * 0.43, width * 0.43]) {
      box(boxes, building, timber, [x, base + wallHeight / 2, z], [0.12, uprightHeight, 0.09])
    }
    if (dense) {
      const braceLength = Math.hypot(width * 0.38, wallHeight * 0.52)
      const braceAngle = Math.atan2(wallHeight * 0.52, width * 0.38)
      box(boxes, building, timber, [-width * 0.2, base + wallHeight * 0.32, z], [braceLength, 0.09, 0.08], [0, 0, braceAngle])
      box(boxes, building, timber, [width * 0.2, base + wallHeight * 0.32, z], [braceLength, 0.09, 0.08], [0, 0, -braceAngle])
    }
  }
}

function addWindow(
  boxes: Component[],
  building: StylizedBuildingDescriptor,
  palette: BuildingPalette,
  variant: number,
  face: "front" | "back" | "left" | "right",
  offset: number,
  height: number,
): void {
  const paneColor = palette.window[(variant >>> 2) % palette.window.length]
  const frame = 0.07
  if (face === "front" || face === "back") {
    const z = (face === "front" ? 1 : -1) * (building.depth / 2 - 0.028)
    box(boxes, building, paneColor, [offset, height, z], [0.5, 0.44, 0.055])
    for (const x of [offset - 0.29, offset + 0.29]) box(boxes, building, palette.timber, [x, height, z], [frame, 0.58, 0.075])
    for (const y of [height - 0.25, height + 0.25]) box(boxes, building, palette.timber, [offset, y, z], [0.65, frame, 0.075])
    box(boxes, building, palette.timber, [offset, height, z], [frame, 0.5, 0.08])
    return
  }
  const x = (face === "right" ? 1 : -1) * (building.width / 2 - 0.028)
  box(boxes, building, paneColor, [x, height, offset], [0.055, 0.44, 0.5])
  for (const z of [offset - 0.29, offset + 0.29]) box(boxes, building, palette.timber, [x, height, z], [0.075, 0.58, frame])
  for (const y of [height - 0.25, height + 0.25]) box(boxes, building, palette.timber, [x, y, offset], [0.075, frame, 0.65])
  box(boxes, building, palette.timber, [x, height, offset], [0.08, 0.5, frame])
}

function addCottage(
  building: StylizedBuildingDescriptor,
  boxes: Component[],
  roofs: Component[],
  farmhouse: boolean,
): void {
  const palette = PALETTES[building.palette]
  const variant = stylizedBuildingVariant(building.id)
  const foundationHeight = farmhouse ? 0.3 : 0.24
  const wallHeight = farmhouse ? 2.55 : 2.12
  const roofHeight = farmhouse ? 1.65 : 1.25 + (variant % 3) * 0.08
  const wallColor = palette.walls[variant % palette.walls.length]
  const roofColor = palette.roof[(variant >>> 1) % palette.roof.length]
  const width = building.width
  const depth = building.depth
  const doorSide = (variant & 1) === 0 ? -1 : 1

  box(boxes, building, palette.stone, [0, foundationHeight / 2, 0], [width, foundationHeight, depth])
  box(boxes, building, wallColor, [0, foundationHeight + wallHeight / 2, 0], [width * 0.96, wallHeight, depth * 0.96])
  gable(roofs, building, roofColor, [0, foundationHeight + wallHeight, 0], [width + 0.34, roofHeight, depth + 0.42])
  box(boxes, building, roofColor, [0, foundationHeight + wallHeight + roofHeight + 0.035, 0], [0.16, 0.12, depth + 0.48])

  addFrontBackTimber(boxes, building, palette.timber, width, depth, foundationHeight, wallHeight, farmhouse || (variant & 2) !== 0)
  for (const x of [-width * 0.45, width * 0.45]) {
    for (const z of [-depth * 0.45, depth * 0.45]) {
      box(boxes, building, palette.timber, [x, foundationHeight + wallHeight / 2, z], [0.12, wallHeight, 0.12])
    }
  }

  const doorX = doorSide * width * 0.22
  const frontZ = depth / 2 - 0.045
  box(boxes, building, palette.door, [doorX, foundationHeight + 0.67, frontZ], [0.72, 1.34, 0.09])
  box(boxes, building, palette.timber, [doorX, foundationHeight + 1.38, frontZ], [0.82, 0.11, 0.105])
  box(boxes, building, palette.accent, [doorX + 0.21 * doorSide, foundationHeight + 0.67, frontZ + 0.052], [0.055, 0.055, 0.035])

  addWindow(boxes, building, palette, variant, "front", -doorX, foundationHeight + 1.25)
  addWindow(boxes, building, palette, variant, "back", doorX * 0.65, foundationHeight + 1.2)
  addWindow(boxes, building, palette, variant, "left", 0, foundationHeight + 1.22)
  if (farmhouse || (variant & 4) !== 0) addWindow(boxes, building, palette, variant, "right", 0, foundationHeight + 1.22)

  if (farmhouse || (variant & 8) !== 0) {
    const chimneyX = doorSide * width * 0.28
    box(boxes, building, palette.stone, [chimneyX, foundationHeight + wallHeight + roofHeight * 0.72, -depth * 0.16], [0.42, roofHeight * 1.08, 0.42])
    box(boxes, building, palette.timber, [chimneyX, foundationHeight + wallHeight + roofHeight * 1.28, -depth * 0.16], [0.52, 0.11, 0.52])
  }

  if (farmhouse) {
    addWindow(boxes, building, palette, variant + 1, "front", 0, foundationHeight + wallHeight * 0.78)
    addWindow(boxes, building, palette, variant + 1, "back", -doorX, foundationHeight + wallHeight * 0.78)
  }
}

function addBarn(building: StylizedBuildingDescriptor, boxes: Component[], roofs: Component[]): void {
  const palette = PALETTES[building.palette]
  const variant = stylizedBuildingVariant(building.id)
  const foundationHeight = 0.28
  const wallHeight = 2.7
  const roofHeight = 1.85 + (variant % 2) * 0.15
  const width = building.width
  const depth = building.depth
  box(boxes, building, palette.stone, [0, foundationHeight / 2, 0], [width, foundationHeight, depth])
  box(boxes, building, palette.walls[variant % 2], [0, foundationHeight + wallHeight / 2, 0], [width * 0.97, wallHeight, depth * 0.97])
  gable(roofs, building, palette.roof[(variant >>> 1) % 2], [0, foundationHeight + wallHeight, 0], [width + 0.42, roofHeight, depth + 0.5])
  box(boxes, building, palette.roof[(variant >>> 1) % 2], [0, foundationHeight + wallHeight + roofHeight + 0.04, 0], [0.18, 0.14, depth + 0.58])
  addFrontBackTimber(boxes, building, palette.timber, width, depth, foundationHeight, wallHeight, true)

  const frontZ = depth / 2 - 0.045
  for (const x of [-0.58, 0.58]) box(boxes, building, palette.door, [x, foundationHeight + 0.92, frontZ], [1.08, 1.84, 0.1])
  box(boxes, building, palette.timber, [0, foundationHeight + 1.88, frontZ], [2.35, 0.14, 0.12])
  for (const direction of [-1, 1]) {
    box(boxes, building, palette.timber, [direction * 0.58, foundationHeight + 0.92, frontZ + 0.055], [1.18, 0.12, 0.075], [0, 0, direction * 0.72])
  }
  addWindow(boxes, building, palette, variant, "back", 0, foundationHeight + 1.52)
  addWindow(boxes, building, palette, variant, "left", 0, foundationHeight + 1.42)
  addWindow(boxes, building, palette, variant, "right", 0, foundationHeight + 1.42)
  for (const x of [-width * 0.45, width * 0.45]) {
    for (const z of [-depth * 0.45, depth * 0.45]) box(boxes, building, palette.timber, [x, foundationHeight + wallHeight / 2, z], [0.15, wallHeight, 0.15])
  }
}

function addWatchtower(building: StylizedBuildingDescriptor, boxes: Component[], roofs: Component[]): void {
  const palette = PALETTES[building.palette]
  const platformY = 3.65
  const legOffset = Math.min(building.width, building.depth) * 0.29
  for (const x of [-legOffset, legOffset]) {
    for (const z of [-legOffset, legOffset]) {
      box(boxes, building, palette.timber, [x, 1.85, z], [0.22, 3.7, 0.22])
      box(boxes, building, palette.stone, [x, 0.12, z], [0.4, 0.24, 0.4])
    }
  }
  box(boxes, building, palette.timber, [0, platformY, 0], [building.width * 0.86, 0.24, building.depth * 0.86])

  const braceLength = Math.hypot(legOffset * 2, 2.5)
  const braceAngle = Math.atan2(2.5, legOffset * 2)
  for (const z of [-legOffset, legOffset]) {
    box(boxes, building, palette.timber, [0, 1.85, z], [braceLength, 0.1, 0.1], [0, 0, braceAngle])
    box(boxes, building, palette.timber, [0, 1.85, z], [braceLength, 0.1, 0.1], [0, 0, -braceAngle])
  }

  const railY = platformY + 0.68
  for (const x of [-legOffset * 1.12, legOffset * 1.12]) {
    box(boxes, building, palette.timber, [x, railY, 0], [0.12, 1.2, building.depth * 0.82])
  }
  for (const z of [-legOffset * 1.12, legOffset * 1.12]) {
    box(boxes, building, palette.timber, [0, railY, z], [building.width * 0.82, 0.12, 0.12])
  }
  gable(roofs, building, palette.roof[0], [0, platformY + 1.15, 0], [building.width * 0.96, 1.05, building.depth * 0.96])

  const ladderZ = building.depth * 0.43
  for (const x of [-0.28, 0.28]) box(boxes, building, palette.timber, [x, 1.8, ladderZ], [0.09, 3.45, 0.09])
  for (let rung = 0; rung < 7; rung += 1) box(boxes, building, palette.timber, [0, 0.45 + rung * 0.48, ladderZ + 0.015], [0.68, 0.08, 0.08])
  box(boxes, building, palette.accent, [0, platformY + 0.72, ladderZ + 0.07], [0.9, 0.62, 0.06])
  box(boxes, building, 0xd1b46a, [0, platformY + 0.72, ladderZ + 0.105], [0.08, 0.48, 0.025])
}

function createInstances(
  name: string,
  geometry: THREE.BufferGeometry,
  components: readonly Component[],
  castShadow: boolean,
): THREE.InstancedMesh | null {
  if (components.length === 0) return null
  const instances = new THREE.InstancedMesh(geometry, sharedBuildingMaterial, components.length)
  instances.name = name
  instances.userData.sherwoodOwnedInstanceBuffer = true
  instances.castShadow = castShadow
  instances.receiveShadow = true
  components.forEach((component, index) => {
    instances.setMatrixAt(index, component.matrix)
    instances.setColorAt(index, new THREE.Color(component.color))
  })
  instances.instanceMatrix.needsUpdate = true
  if (instances.instanceColor) instances.instanceColor.needsUpdate = true
  instances.computeBoundingBox()
  instances.computeBoundingSphere()
  return instances
}

/**
 * Builds richly detailed buildings in two opaque submissions regardless of
 * building count. Empty marker groups remain the renderer's collision-aligned
 * identity layer; the meshes are deliberately view-only batches.
 */
export function createStylizedBuildingBatch(
  buildings: readonly StylizedBuildingDescriptor[],
  options: StylizedBuildingOptions = {},
): THREE.Group {
  const group = new THREE.Group()
  group.name = "SherwoodStylizedBuildingBatch"
  group.userData = {
    sherwoodBuildingIds: buildings.map((building) => building.id),
    sherwoodBuildingCount: buildings.length,
    sherwoodSharedGeometry: true,
  }
  const boxes: Component[] = []
  const roofs: Component[] = []
  for (const building of buildings) {
    if (building.kind === "watchtower") addWatchtower(building, boxes, roofs)
    else if (building.kind === "barn") addBarn(building, boxes, roofs)
    else addCottage(building, boxes, roofs, building.kind === "farmhouse")
  }
  const castShadow = options.castShadow ?? true
  const boxInstances = createInstances("StylizedBuildingDetails", unitBoxGeometry, boxes, castShadow)
  const roofInstances = createInstances("StylizedBuildingGables", gableGeometry, roofs, castShadow)
  if (boxInstances) group.add(boxInstances)
  if (roofInstances) group.add(roofInstances)
  group.userData.sherwoodBuildingDrawCalls = group.children.length
  group.userData.sherwoodBuildingDetailInstances = boxes.length
  group.userData.sherwoodBuildingRoofInstances = roofs.length
  return group
}

export function createStylizedBuildingVisual(
  building: Omit<StylizedBuildingDescriptor, "position" | "rotation">,
  options: StylizedBuildingOptions = {},
): THREE.Group {
  const group = createStylizedBuildingBatch([{
    ...building,
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
  }], options)
  group.name = building.id
  group.userData.sherwoodBuildingKind = building.kind
  group.userData.sherwoodVisualHalfExtents = { x: building.width / 2, z: building.depth / 2 }
  return group
}

/** Releases per-view instance buffers without disposing shared geometry/materials. */
export function disposeStylizedBuildingVisuals(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.userData.sherwoodOwnedInstanceBuffer === true) object.dispose()
  })
}
