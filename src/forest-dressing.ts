import * as THREE from "three"
import type { RegionalMissionLayout } from "../shared/regional-layout"
import { createSherwoodMissionForestRockLayout, type SherwoodForestRockPlacement } from "../shared/world-dressing-layout"
import { SHERWOOD_TREE_LAYOUT } from "../shared/world-layout"
import { createToonMaterial } from "./toon-materials"
import { sherwoodHeightAt } from "./sherwood-terrain"
import { createNatureVariantInstances, type NatureCatalog, type NatureVariantName } from "./nature-assets"

export interface ForestDressing {
  group: THREE.Group
  instanceCount: number
  clusterCount: number
}

export interface DressingRoad {
  width: number
  points: readonly { x: number; z: number }[]
}

export interface DressingOptions {
  seed?: number
  degraded?: boolean
  exclusions?: ReadonlyArray<{ x: number; z: number; radius: number }>
  roads?: readonly DressingRoad[]
  missionLayout?: RegionalMissionLayout
}

function rockPlacementMatrices(placements: readonly SherwoodForestRockPlacement[]): THREE.Matrix4[] {
  return placements.map((placement) => new THREE.Matrix4().compose(
    new THREE.Vector3(placement.x, sherwoodHeightAt(placement.x, placement.z), placement.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.rotation),
    new THREE.Vector3(placement.scaleX, placement.scaleY, placement.scaleZ),
  ))
}

function seededRandom(seed: number): () => number {
  let value = seed || 1
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

function outsideExclusions(x: number, z: number, exclusions: DressingOptions["exclusions"]): boolean {
  return !(exclusions ?? []).some((area) => Math.hypot(x - area.x, z - area.z) < area.radius)
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

function outsideRoads(
  x: number,
  z: number,
  roads: DressingOptions["roads"],
  margin: number,
): boolean {
  return !(roads ?? []).some((road) => road.points.slice(1).some((point, index) => (
    distanceToSegment({ x, z }, road.points[index], point) < road.width / 2 + margin
  )))
}

function createClusterCenters(
  count: number,
  random: () => number,
  exclusions: DressingOptions["exclusions"],
  roads: DressingOptions["roads"],
  roadMargin: number,
): ReadonlyArray<{ x: number; z: number }> {
  const centers: Array<{ x: number; z: number }> = []
  let attempts = 0
  while (centers.length < count && attempts < count * 80) {
    attempts += 1
    const x = random() * 116 - 58
    const z = random() * 116 - 58
    const nearRiver = Math.abs(x - 1 + z * 0.1) < 5.8
    if (nearRiver
      || !outsideExclusions(x, z, exclusions)
      || !outsideRoads(x, z, roads, roadMargin)
      || centers.some((center) => Math.hypot(x - center.x, z - center.z) < 8)) continue
    centers.push({ x, z })
  }
  return centers
}

function clusteredMatrices(
  count: number,
  random: () => number,
  exclusions: DressingOptions["exclusions"],
  roads: DressingOptions["roads"],
  centers: readonly { x: number; z: number }[],
  clusterRadius: number,
  roadMargin: number,
  scaleRange: readonly [number, number],
): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = []
  let attempts = 0
  while (matrices.length < count && attempts < count * 24 && centers.length > 0) {
    attempts += 1
    const center = centers[Math.floor(random() * centers.length)]
    const angle = random() * Math.PI * 2
    const radius = Math.sqrt(random()) * clusterRadius
    const x = center.x + Math.cos(angle) * radius
    const z = center.z + Math.sin(angle) * radius
    if (Math.abs(x) > 62 || Math.abs(z) > 62
      || !outsideExclusions(x, z, exclusions)
      || !outsideRoads(x, z, roads, roadMargin)) continue
    const scale = scaleRange[0] + random() * (scaleRange[1] - scaleRange[0])
    matrices.push(new THREE.Matrix4().compose(
      new THREE.Vector3(x, sherwoodHeightAt(x, z), z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2),
      new THREE.Vector3(scale, scale * (0.84 + random() * 0.35), scale),
    ))
  }
  return matrices
}

function scatteredMatrices(
  count: number,
  random: () => number,
  exclusions: DressingOptions["exclusions"],
  roads: DressingOptions["roads"],
  roadMargin: number,
  scaleRange: readonly [number, number],
): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = []
  let attempts = 0
  while (matrices.length < count && attempts < count * 30) {
    attempts += 1
    const x = random() * 120 - 60
    const z = random() * 120 - 60
    const nearRiver = Math.abs(x - 1 + z * 0.1) < 5.8
    if (nearRiver || !outsideExclusions(x, z, exclusions) || !outsideRoads(x, z, roads, roadMargin)) continue
    const scale = scaleRange[0] + random() * (scaleRange[1] - scaleRange[0])
    matrices.push(new THREE.Matrix4().compose(
      new THREE.Vector3(x, sherwoodHeightAt(x, z), z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2),
      new THREE.Vector3(scale, scale * (0.84 + random() * 0.35), scale),
    ))
  }
  return matrices
}

function clearingEdgeMatrices(
  count: number,
  random: () => number,
  exclusions: DressingOptions["exclusions"],
  roads: DressingOptions["roads"],
  roadMargin: number,
  scaleRange: readonly [number, number],
): THREE.Matrix4[] {
  const clearings = (exclusions ?? []).filter((area) => area.radius >= 6)
  const matrices: THREE.Matrix4[] = []
  let attempts = 0
  while (matrices.length < count && attempts < count * 36 && clearings.length > 0) {
    attempts += 1
    const clearing = clearings[Math.floor(random() * clearings.length)]
    const angle = random() * Math.PI * 2
    const radius = clearing.radius + 0.8 + random() * 2.8
    const x = clearing.x + Math.cos(angle) * radius
    const z = clearing.z + Math.sin(angle) * radius
    const nearRiver = Math.abs(x - 1 + z * 0.1) < 5.8
    if (Math.abs(x) > 62 || Math.abs(z) > 62 || nearRiver
      || !outsideExclusions(x, z, exclusions)
      || !outsideRoads(x, z, roads, roadMargin)) continue
    const scale = scaleRange[0] + random() * (scaleRange[1] - scaleRange[0])
    matrices.push(new THREE.Matrix4().compose(
      new THREE.Vector3(x, sherwoodHeightAt(x, z), z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2),
      new THREE.Vector3(scale, scale * (0.88 + random() * 0.28), scale),
    ))
  }
  return matrices
}

function roadsideMatrices(
  count: number,
  random: () => number,
  exclusions: DressingOptions["exclusions"],
  roads: DressingOptions["roads"],
  roadMargin: number,
  bandWidth: number,
  scaleRange: readonly [number, number],
): THREE.Matrix4[] {
  const segments = (roads ?? []).flatMap((road) => road.points.slice(1).map((end, index) => ({
    road,
    start: road.points[index],
    end,
  }))).filter(({ start, end }) => Math.hypot(end.x - start.x, end.z - start.z) > 0.5)
  const matrices: THREE.Matrix4[] = []
  let attempts = 0
  while (matrices.length < count && attempts < count * 40 && segments.length > 0) {
    attempts += 1
    const { road, start, end } = segments[Math.floor(random() * segments.length)]
    const dx = end.x - start.x
    const dz = end.z - start.z
    const length = Math.hypot(dx, dz)
    const amount = random()
    const side = random() < 0.5 ? -1 : 1
    const offset = road.width / 2 + roadMargin + 0.2 + random() * bandWidth
    const x = start.x + dx * amount + (-dz / length) * offset * side + (dx / length) * (random() - 0.5) * 1.2
    const z = start.z + dz * amount + (dx / length) * offset * side + (dz / length) * (random() - 0.5) * 1.2
    const nearRiver = Math.abs(x - 1 + z * 0.1) < 5.8
    if (Math.abs(x) > 62 || Math.abs(z) > 62 || nearRiver
      || !outsideExclusions(x, z, exclusions)
      || !outsideRoads(x, z, roads, roadMargin)) continue
    const scale = scaleRange[0] + random() * (scaleRange[1] - scaleRange[0])
    matrices.push(new THREE.Matrix4().compose(
      new THREE.Vector3(x, sherwoodHeightAt(x, z), z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2),
      new THREE.Vector3(scale, scale * (0.86 + random() * 0.3), scale),
    ))
  }
  return matrices
}

function instanced(
  name: string,
  geometry: THREE.BufferGeometry,
  color: number,
  matrices: readonly THREE.Matrix4[],
  shadows = false,
): THREE.InstancedMesh {
  const result = new THREE.InstancedMesh(geometry, createToonMaterial({ color }), matrices.length)
  result.name = name
  result.castShadow = shadows
  result.receiveShadow = true
  matrices.forEach((matrix, index) => result.setMatrixAt(index, matrix))
  result.instanceMatrix.needsUpdate = true
  result.computeBoundingSphere()
  return result
}

/** Dense, nonblocking forest-floor dressing. Gameplay collision remains authoritative elsewhere. */
export function createForestDressing(options: DressingOptions = {}): ForestDressing {
  const random = seededRandom(options.seed ?? 4815)
  const density = options.degraded ? 0.44 : 1
  const count = (value: number): number => Math.round(value * density)
  const group = new THREE.Group()
  group.name = "SherwoodForestDressing"

  const meadowCenters = createClusterCenters(18, random, options.exclusions, options.roads, 2.6)
  const woodlandCenters = createClusterCenters(16, random, options.exclusions, options.roads, 4.2)
  const treeCenters = SHERWOOD_TREE_LAYOUT.map(({ x, z }) => ({ x, z }))
  const grass = [
    ...clusteredMatrices(count(300), random, options.exclusions, options.roads, meadowCenters, 6.8, 1.3, [0.62, 1.35]),
    ...scatteredMatrices(count(700), random, options.exclusions, options.roads, 1.3, [0.52, 1]),
    ...roadsideMatrices(count(180), random, options.exclusions, options.roads, 1.3, 2.4, [0.62, 1.25]),
    ...clearingEdgeMatrices(count(120), random, options.exclusions, options.roads, 1.3, [0.68, 1.3]),
  ]
  const ferns = [
    ...clusteredMatrices(count(180), random, options.exclusions, options.roads, woodlandCenters, 5.5, 2.2, [0.72, 1.45]),
    ...scatteredMatrices(count(220), random, options.exclusions, options.roads, 2.2, [0.58, 1.05]),
    ...clusteredMatrices(count(220), random, options.exclusions, options.roads, treeCenters, 2.8, 2.2, [0.62, 1.2]),
  ]
  const shrubs = [
    ...clusteredMatrices(count(90), random, options.exclusions, options.roads, woodlandCenters, 4.8, 2.7, [0.72, 1.45]),
    ...scatteredMatrices(count(100), random, options.exclusions, options.roads, 2.7, [0.58, 0.98]),
    ...clusteredMatrices(count(120), random, options.exclusions, options.roads, treeCenters, 3.2, 2.7, [0.65, 1.2]),
  ]
  const flowers = [
    ...clusteredMatrices(count(120), random, options.exclusions, options.roads, meadowCenters.slice(0, 12), 4.1, 1.6, [0.72, 1.2]),
    ...roadsideMatrices(count(60), random, options.exclusions, options.roads, 1.6, 1.8, [0.7, 1.1]),
  ]
  const stones = options.missionLayout
    ? rockPlacementMatrices(createSherwoodMissionForestRockLayout(options.missionLayout))
    : clusteredMatrices(count(14), random, options.exclusions, options.roads, woodlandCenters.slice(0, 4), 3.5, 2.4, [0.45, 1.25])

  const grassBlade = new THREE.ConeGeometry(0.14, 0.62, 3)
  grassBlade.translate(0, 0.31, 0)
  const fernLeaf = new THREE.ConeGeometry(0.22, 0.76, 5)
  fernLeaf.translate(0, 0.34, 0)
  fernLeaf.rotateZ(0.38)
  const shrub = new THREE.IcosahedronGeometry(0.42, 0)
  shrub.translate(0, 0.34, 0)
  const flower = new THREE.OctahedronGeometry(0.12, 0)
  flower.translate(0, 0.42, 0)
  const stone = new THREE.DodecahedronGeometry(0.28, 0)
  stone.scale(1, 0.48, 0.82)
  stone.translate(0, 0.13, 0)

  group.add(
    instanced("ForestGrassInstances", grassBlade, 0x496d35, grass),
    instanced("ForestFernInstances", fernLeaf, 0x315f38, ferns),
    instanced("ForestShrubInstances", shrub, 0x244e31, shrubs, !options.degraded),
    instanced("ForestFlowerInstances", flower, 0xd9b75b, flowers),
    instanced("ForestStoneInstances", stone, 0x6e7164, stones),
  )
  return {
    group,
    instanceCount: grass.length + ferns.length + shrubs.length + flowers.length + stones.length,
    clusterCount: meadowCenters.length + woodlandCenters.length,
  }
}

/** Textured normal path using the curated MegaKit catalogue. */
export function createAuthoredForestDressing(catalog: NatureCatalog, options: DressingOptions = {}): ForestDressing {
  const random = seededRandom(options.seed ?? 4815)
  const density = options.degraded ? 0.44 : 1
  const count = (value: number): number => Math.round(value * density)
  const meadowCenters = createClusterCenters(18, random, options.exclusions, options.roads, 2.6)
  const woodlandCenters = createClusterCenters(16, random, options.exclusions, options.roads, 4.2)
  const treeCenters = SHERWOOD_TREE_LAYOUT.map(({ x, z }) => ({ x, z }))
  const missionRocks = options.missionLayout
    ? rockPlacementMatrices(createSherwoodMissionForestRockLayout(options.missionLayout))
    : clusteredMatrices(count(14), random, options.exclusions, options.roads, woodlandCenters.slice(0, 4), 3.5, 2.4, [0.45, 1.25])
  const placements: ReadonlyArray<[NatureVariantName, THREE.Matrix4[], boolean]> = [
    ["Nature_Grass_Wispy_Short", [
      ...clusteredMatrices(count(240), random, options.exclusions, options.roads, meadowCenters, 6.8, 1.3, [0.62, 1.35]),
      ...scatteredMatrices(count(620), random, options.exclusions, options.roads, 1.3, [0.52, 1]),
      ...roadsideMatrices(count(160), random, options.exclusions, options.roads, 1.3, 2.4, [0.62, 1.25]),
      ...clearingEdgeMatrices(count(100), random, options.exclusions, options.roads, 1.3, [0.68, 1.3]),
    ], false],
    ["Nature_Grass_Common_Tall", [
      ...clusteredMatrices(count(70), random, options.exclusions, options.roads, meadowCenters, 5.5, 1.7, [0.72, 1.25]),
      ...roadsideMatrices(count(70), random, options.exclusions, options.roads, 1.7, 2.1, [0.7, 1.2]),
    ], false],
    ["Nature_Fern_1", [
      ...clusteredMatrices(count(140), random, options.exclusions, options.roads, woodlandCenters, 5.5, 2.2, [0.72, 1.45]),
      ...scatteredMatrices(count(180), random, options.exclusions, options.roads, 2.2, [0.58, 1.05]),
      ...clusteredMatrices(count(180), random, options.exclusions, options.roads, treeCenters, 2.8, 2.2, [0.62, 1.2]),
    ], false],
    ["Nature_Bush_Common", [
      ...clusteredMatrices(count(70), random, options.exclusions, options.roads, woodlandCenters, 4.8, 2.7, [0.72, 1.45]),
      ...scatteredMatrices(count(70), random, options.exclusions, options.roads, 2.7, [0.58, 0.98]),
      ...clusteredMatrices(count(90), random, options.exclusions, options.roads, treeCenters, 3.2, 2.7, [0.65, 1.2]),
      ...clearingEdgeMatrices(count(50), random, options.exclusions, options.roads, 2.7, [0.68, 1.22]),
    ], !options.degraded],
    ["Nature_Flower_3_Group", [
      ...clusteredMatrices(count(90), random, options.exclusions, options.roads, meadowCenters.slice(0, 12), 4.1, 1.6, [0.72, 1.2]),
      ...roadsideMatrices(count(50), random, options.exclusions, options.roads, 1.6, 1.8, [0.7, 1.1]),
      ...clearingEdgeMatrices(count(40), random, options.exclusions, options.roads, 1.6, [0.72, 1.15]),
    ], false],
    ["Nature_Mushroom_Common", clusteredMatrices(count(36), random, options.exclusions, options.roads, treeCenters, 2.5, 2.4, [0.4, 0.88]), false],
    ["Nature_Rock_Medium_2", missionRocks, false],
    ["Nature_Pebble_Round_3", roadsideMatrices(count(40), random, options.exclusions, options.roads, 2.2, 1.8, [0.35, 0.85]), false],
  ]
  const group = new THREE.Group()
  group.name = "SherwoodForestDressing"
  for (const [name, matrices, castShadow] of placements) {
    group.add(createNatureVariantInstances(catalog, name, matrices, { castShadow }))
  }
  return {
    group,
    instanceCount: placements.reduce((total, [, matrices]) => total + matrices.length, 0),
    clusterCount: meadowCenters.length + woodlandCenters.length,
  }
}
