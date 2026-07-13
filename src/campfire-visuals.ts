import * as THREE from "three"
import { createToonMaterial } from "./toon-materials"

export interface CampfireVisuals {
  group: THREE.Group
  light: THREE.PointLight
  update: (elapsed: number, motionScale: number) => void
  dispose: () => void
}

export interface CampfireVisualOptions {
  degraded?: boolean
}

interface FlameLobe {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  baseX: number
  baseY: number
  baseScale: THREE.Vector3
  phase: number
}

interface ParticleBatch {
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
  positions: Float32Array
  attribute: THREE.BufferAttribute
  texture: THREE.DataTexture
}

const EMBER_HEIGHT = 1.65
const SMOKE_HEIGHT = 2.25

function setInstance(
  mesh: THREE.InstancedMesh,
  index: number,
  position: THREE.Vector3,
  rotation: THREE.Euler,
  scale: THREE.Vector3,
): void {
  const transform = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), scale)
  mesh.setMatrixAt(index, transform)
}

function createHearth(): THREE.Group {
  const hearth = new THREE.Group()
  hearth.name = "CampfireHearth"

  const stones = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(0.19, 0),
    createToonMaterial({ color: 0x6f6b5d }),
    10,
  )
  stones.name = "CampfireStones"
  stones.castShadow = true
  stones.receiveShadow = true
  for (let index = 0; index < stones.count; index += 1) {
    const angle = index / stones.count * Math.PI * 2
    setInstance(
      stones,
      index,
      new THREE.Vector3(Math.cos(angle) * 0.56, 0.14, Math.sin(angle) * 0.56),
      new THREE.Euler(index * 0.31, angle, index * 0.17),
      new THREE.Vector3(1.08, 0.72 + (index % 2) * 0.1, 0.9),
    )
  }
  stones.instanceMatrix.needsUpdate = true

  const logs = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.11, 0.14, 1.08, 7),
    createToonMaterial({ color: 0x4a281b }),
    3,
  )
  logs.name = "CampfireLogs"
  logs.castShadow = true
  logs.receiveShadow = true
  for (let index = 0; index < logs.count; index += 1) {
    setInstance(
      logs,
      index,
      new THREE.Vector3(0, 0.28 + index * 0.035, 0),
      new THREE.Euler(Math.PI / 2, index * Math.PI / 3 + Math.PI / 6, 0),
      new THREE.Vector3(1, 1, 1),
    )
  }
  logs.instanceMatrix.needsUpdate = true

  const coals = new THREE.Mesh(
    new THREE.CircleGeometry(0.45, 12),
    new THREE.MeshBasicMaterial({ color: 0x351813, side: THREE.DoubleSide }),
  )
  coals.name = "CampfireCoals"
  coals.rotation.x = -Math.PI / 2
  coals.position.y = 0.08
  coals.receiveShadow = true

  hearth.add(coals, stones, logs)
  return hearth
}

function createFlameLobe(
  name: string,
  color: number,
  opacity: number,
  baseX: number,
  baseY: number,
  baseScale: THREE.Vector3,
  phase: number,
): FlameLobe {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 7, 5), material)
  mesh.name = name
  mesh.position.set(baseX, baseY, 0)
  mesh.scale.copy(baseScale)
  mesh.castShadow = false
  mesh.receiveShadow = false
  return { mesh, baseX, baseY, baseScale, phase }
}

function createParticleBatch(
  name: string,
  count: number,
  color: number,
  size: number,
  opacity: number,
): ParticleBatch {
  const positions = new Float32Array(count * 3)
  const geometry = new THREE.BufferGeometry()
  const attribute = new THREE.BufferAttribute(positions, 3)
  attribute.setUsage(THREE.DynamicDrawUsage)
  geometry.setAttribute("position", attribute)
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.45, 0), 2.8)
  const textureSize = 16
  const textureData = new Uint8Array(textureSize * textureSize * 4)
  for (let y = 0; y < textureSize; y += 1) {
    for (let x = 0; x < textureSize; x += 1) {
      const dx = (x + 0.5) / textureSize * 2 - 1
      const dy = (y + 0.5) / textureSize * 2 - 1
      const alpha = Math.max(0, 1 - Math.hypot(dx, dy)) ** 1.7
      const offset = (y * textureSize + x) * 4
      textureData[offset] = 255
      textureData[offset + 1] = 255
      textureData[offset + 2] = 255
      textureData[offset + 3] = Math.round(alpha * 255)
    }
  }
  const texture = new THREE.DataTexture(textureData, textureSize, textureSize, THREE.RGBAFormat)
  texture.name = `${name}SoftParticle`
  texture.colorSpace = THREE.NoColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  const material = new THREE.PointsMaterial({
    color,
    map: texture,
    size,
    sizeAttenuation: true,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(geometry, material)
  points.name = name
  return { points, positions, attribute, texture }
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
  else material.dispose()
}

export function createCampfireVisuals(options: CampfireVisualOptions = {}): CampfireVisuals {
  const degraded = options.degraded ?? false
  const group = new THREE.Group()
  group.name = "CampfireVisuals"
  group.add(createHearth())

  const lobes = [
    createFlameLobe("CampfireFlameOuter", 0xe4471e, 0.56, -0.03, 0.58, new THREE.Vector3(0.78, 1.38, 0.7), 0.2),
    createFlameLobe("CampfireFlameMiddle", 0xff8b20, 0.72, 0.08, 0.55, new THREE.Vector3(0.58, 1.08, 0.52), 2.1),
    createFlameLobe("CampfireFlameCore", 0xffd66b, 0.86, -0.06, 0.48, new THREE.Vector3(0.34, 0.72, 0.3), 4.2),
  ]
  for (const lobe of lobes) group.add(lobe.mesh)

  const emberBatch = createParticleBatch("CampfireEmbers", degraded ? 5 : 12, 0xffb34c, degraded ? 0.075 : 0.09, 0.9)
  group.add(emberBatch.points)

  const smokeBatch = degraded ? null : createParticleBatch("CampfireSmoke", 8, 0x77756d, 0.3, 0.22)
  if (smokeBatch) {
    smokeBatch.points.material.blending = THREE.NormalBlending
    group.add(smokeBatch.points)
  }

  const light = new THREE.PointLight(0xff8a31, degraded ? 2.6 : 3.4, degraded ? 10 : 14, 2)
  light.name = "CampfireLight"
  light.position.set(0, 1.05, 0)
  light.castShadow = false
  group.add(light)

  const updateParticles = (
    positions: Float32Array,
    count: number,
    time: number,
    height: number,
    radius: number,
    drift: number,
  ): void => {
    for (let index = 0; index < count; index += 1) {
      const offset = index / count
      const progress = (time * (0.26 + index % 3 * 0.035) + offset) % 1
      const angle = index * 2.399963 + time * (0.34 + index % 2 * 0.08)
      const radial = radius * (0.35 + progress * 0.65)
      positions[index * 3] = Math.cos(angle) * radial + Math.sin(time * 1.7 + index) * drift
      positions[index * 3 + 1] = 0.48 + progress * height
      positions[index * 3 + 2] = Math.sin(angle) * radial + Math.cos(time * 1.3 + index * 0.7) * drift
    }
  }

  let lastParticleTime = Number.NaN
  const update = (elapsed: number, motionScale: number): void => {
    const safeMotionScale = Number.isFinite(motionScale) ? Math.max(0, Math.min(1, motionScale)) : 0
    const movingTime = Number.isFinite(elapsed) ? elapsed * safeMotionScale : 0
    for (let index = 0; index < lobes.length; index += 1) {
      const lobe = lobes[index]
      const sway = Math.sin(movingTime * (4.4 + index * 0.7) + lobe.phase)
      const flutter = Math.sin(movingTime * (7.1 + index * 0.8) + lobe.phase * 1.7)
      lobe.mesh.position.x = lobe.baseX + sway * 0.06
      lobe.mesh.position.y = lobe.baseY + flutter * 0.025
      lobe.mesh.rotation.z = sway * 0.1
      lobe.mesh.scale.set(
        lobe.baseScale.x * (1 - flutter * 0.055),
        lobe.baseScale.y * (1 + flutter * 0.09),
        lobe.baseScale.z * (1 - flutter * 0.04),
      )
    }

    if (movingTime !== lastParticleTime) {
      updateParticles(emberBatch.positions, emberBatch.attribute.count, movingTime, EMBER_HEIGHT, 0.2, 0.035)
      emberBatch.attribute.needsUpdate = true
      if (smokeBatch) {
        updateParticles(smokeBatch.positions, smokeBatch.attribute.count, movingTime * 0.58, SMOKE_HEIGHT, 0.32, 0.09)
        smokeBatch.attribute.needsUpdate = true
      }
      lastParticleTime = movingTime
    }

    const flicker = Math.sin(movingTime * 8.3) * 0.34 + Math.sin(movingTime * 13.7 + 1.4) * 0.18
    light.intensity = (degraded ? 2.6 : 3.4) + flicker
    light.position.x = Math.sin(movingTime * 5.1) * 0.055
    light.position.z = Math.cos(movingTime * 4.7) * 0.045
  }

  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.InstancedMesh)) return
      if (object instanceof THREE.InstancedMesh) object.dispose()
      object.geometry.dispose()
      disposeMaterial(object.material)
    })
    emberBatch.texture.dispose()
    smokeBatch?.texture.dispose()
  }

  update(0, 0)
  return { group, light, update, dispose }
}
