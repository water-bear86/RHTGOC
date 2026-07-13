import * as THREE from "three"
import { createToonMaterial } from "./toon-materials"

export interface ForestDressing {
  group: THREE.Group
  instanceCount: number
}

interface DressingOptions {
  seed?: number
  degraded?: boolean
  exclusions?: ReadonlyArray<{ x: number; z: number; radius: number }>
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

function scatterMatrices(
  count: number,
  random: () => number,
  exclusions: DressingOptions["exclusions"],
  scaleRange: readonly [number, number],
): THREE.Matrix4[] {
  const matrices: THREE.Matrix4[] = []
  let attempts = 0
  while (matrices.length < count && attempts < count * 12) {
    attempts += 1
    const x = random() * 126 - 63
    const z = random() * 126 - 63
    const nearRiver = Math.abs(x - 1 + z * 0.1) < 3.7
    const nearMainTrail = Math.abs(z - x) < 2.8
    if (nearRiver || nearMainTrail || !outsideExclusions(x, z, exclusions)) continue
    const scale = scaleRange[0] + random() * (scaleRange[1] - scaleRange[0])
    matrices.push(new THREE.Matrix4().compose(
      new THREE.Vector3(x, 0, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI * 2),
      new THREE.Vector3(scale, scale * (0.84 + random() * 0.35), scale),
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
  const density = options.degraded ? 0.48 : 1
  const count = (value: number): number => Math.round(value * density)
  const group = new THREE.Group()
  group.name = "SherwoodForestDressing"

  const grass = scatterMatrices(count(260), random, options.exclusions, [0.55, 1.25])
  const ferns = scatterMatrices(count(105), random, options.exclusions, [0.65, 1.35])
  const shrubs = scatterMatrices(count(72), random, options.exclusions, [0.65, 1.3])
  const flowers = scatterMatrices(count(48), random, options.exclusions, [0.65, 1.05])
  const stones = scatterMatrices(count(34), random, options.exclusions, [0.45, 1.25])

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
  return { group, instanceCount: grass.length + ferns.length + shrubs.length + flowers.length + stones.length }
}

