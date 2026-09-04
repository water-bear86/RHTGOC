import * as THREE from "three"
import { VANITY_CATALOG, type VanityItemId } from "../shared/vanity-catalog"
import { createToonMaterial } from "./toon-materials"
import type { CharacterId } from "./simulation"

/**
 * Procedural Sherwood Finery cosmetics for the local character. Everything is
 * generated from primitives — no textures, no external art, no new assets —
 * and carries zero gameplay state. Remote multiplayer display is deferred in
 * this basic pass; only the local character wears these.
 */

export interface VanityUpdateContext {
  elapsed: number
  dt: number
  motionScale: number
  /** Local player's world-space position for trail spawning. */
  position: { x: number; y: number; z: number } | null
  moving: boolean
}

/** Where the plume accent rides on each outlaw (root-space height). */
const PLUME_ANCHOR_Y: Record<CharacterId, number> = {
  robin: 1.96,
  marian: 1.84,
  "little-john": 2.14,
  much: 1.6,
}

const FALLBACK_PLUME_ANCHOR_Y = 1.8
const PLUME_ANCHOR_Z = -0.08
const PLUME_ANCHOR_X = 0.22

function hexToColor(hex: string): number {
  const parsed = Number.parseInt(hex.slice(1), 16)
  return Number.isFinite(parsed) ? parsed : 0xe2af43
}

function catalogColor(itemId: VanityItemId, field: "primary" | "secondary", fallback: string): number {
  const color = VANITY_CATALOG.find((item) => item.id === itemId)?.colors[field]
  return color ? hexToColor(color) : hexToColor(fallback)
}

function markCosmetic(root: THREE.Object3D): void {
  root.traverse((object) => {
    object.userData.sherwoodCosmeticOnly = true
  })
}

/** The fox plume: a feathered accent built from two crossed toon planes. */
function buildPlume(characterId: CharacterId): THREE.Group {
  const primary = catalogColor("fox-plume", "primary", "#cf7a2e")
  const secondary = catalogColor("fox-plume", "secondary", "#8f4a1e")

  const shape = new THREE.Shape()
  shape.moveTo(0, 0)
  shape.quadraticCurveTo(0.13, 0.3, 0, 0.6)
  shape.quadraticCurveTo(-0.13, 0.3, 0, 0)
  const geometry = new THREE.ShapeGeometry(shape)
  geometry.rotateZ(-Math.PI / 2)

  const makeVane = (color: number, twist: number): THREE.Mesh => {
    const vane = new THREE.Mesh(geometry, createToonMaterial({ color, side: THREE.DoubleSide }))
    vane.rotation.y = twist
    vane.castShadow = false
    vane.receiveShadow = false
    return vane
  }

  const plume = new THREE.Group()
  plume.name = "VanityFoxPlume"
  plume.add(makeVane(primary, -0.42), makeVane(secondary, 0.42))
  plume.scale.setScalar(0.5)
  plume.position.set(PLUME_ANCHOR_X, PLUME_ANCHOR_Y[characterId] ?? FALLBACK_PLUME_ANCHOR_Y, PLUME_ANCHOR_Z)
  plume.rotation.set(0.36, -0.5, 0.14)
  markCosmetic(plume)
  return plume
}

interface FireflyMote {
  mesh: THREE.Mesh
  phaseX: number
  phaseY: number
  radiusX: number
  radiusZ: number
  centerY: number
  bob: number
}

/** Sherwood Fireflies: a ring of additive green-gold motes around the torso. */
function buildFireflies(): { group: THREE.Group; motes: FireflyMote[] } {
  const motes: FireflyMote[] = []
  const count = 10
  const group = new THREE.Group()
  group.name = "VanitySherwoodFireflies"
  const gold = catalogColor("sherwood-fireflies", "primary", "#ecd357")
  const green = catalogColor("sherwood-fireflies", "secondary", "#8fce5a")
  const geometry = new THREE.IcosahedronGeometry(0.05, 1)

  for (let index = 0; index < count; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: index % 2 === 0 ? gold : green,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.castShadow = false
    mesh.receiveShadow = false
    group.add(mesh)
    motes.push({
      mesh,
      phaseX: index * 0.93 + 0.7,
      phaseY: index * 1.7,
      radiusX: 0.62 + (index % 3) * 0.07,
      radiusZ: 0.5 + (index % 4) * 0.05,
      centerY: 0.92 + (index % 4) * 0.13,
      bob: 0.16 + (index % 3) * 0.05,
    })
  }
  markCosmetic(group)
  return { group, motes }
}

interface TrailPuff {
  mesh: THREE.Mesh
  age: number
  life: number
  baseOpacity: number
}

interface KingTrail {
  root: THREE.Group
  puffs: TrailPuff[]
  spawnAccumulator: number
  spawn(x: number, y: number, z: number): void
  dispose(): void
}

const TRAIL_PUFF_LIMIT = 22

/** King's Ransom Trail: fading gold dust motes left behind while moving. */
function buildTrail(): KingTrail {
  const gold = catalogColor("kings-ransom-trail", "primary", "#e2af43")
  const root = new THREE.Group()
  root.name = "VanityKingsRansomTrail"
  const puffs: TrailPuff[] = []
  let spawnAccumulator = 0
  let sharedGeometry: THREE.SphereGeometry | null = null

  const spawn = (x: number, y: number, z: number): void => {
    if (puffs.length >= TRAIL_PUFF_LIMIT) {
      const oldest = puffs.shift()
      if (oldest) {
        root.remove(oldest.mesh)
        ;(oldest.mesh.material as THREE.Material).dispose()
      }
    }
    sharedGeometry ??= new THREE.SphereGeometry(0.055, 5, 4)
    const material = new THREE.MeshBasicMaterial({
      color: gold,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    const mesh = new THREE.Mesh(sharedGeometry, material)
    mesh.userData.sherwoodCosmeticOnly = true
    mesh.castShadow = false
    mesh.receiveShadow = false
    mesh.position.set(x, y + 0.12, z)
    root.add(mesh)
    puffs.push({ mesh, age: 0, life: 0.6 + Math.random() * 0.3, baseOpacity: 0.4 + Math.random() * 0.2 })
  }

  const dispose = (): void => {
    for (const puff of puffs) {
      root.remove(puff.mesh)
      ;(puff.mesh.material as THREE.Material).dispose()
    }
    puffs.length = 0
    sharedGeometry?.dispose()
    sharedGeometry = null
  }

  return { root, puffs, spawnAccumulator, spawn, dispose }
}

export interface VanityPresenter {
  attach(view: THREE.Object3D | null): void
  setEquipped(itemIds: readonly string[]): void
  equipped(): readonly string[]
  update(context: VanityUpdateContext): void
  dispose(): void
}

export function createVanityPresenter(scene: THREE.Scene): VanityPresenter {
  let attachedView: THREE.Object3D | null = null
  let equipped: VanityItemId[] = []
  let plumeGroup: THREE.Group | null = null
  let fireflies: { group: THREE.Group; motes: FireflyMote[] } | null = null
  let trail: KingTrail | null = null
  let trailLastPosition: { x: number; y: number; z: number } | null = null
  let lastCharacterId: CharacterId = "robin"

  const disposeGroupResources = (root: THREE.Object3D): void => {
    const geometries = new Set<THREE.BufferGeometry>()
    const materials = new Set<THREE.Material>()
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      geometries.add(object.geometry)
      if (Array.isArray(object.material)) object.material.forEach((material) => materials.add(material))
      else materials.add(object.material)
    })
    geometries.forEach((geometry) => geometry.dispose())
    materials.forEach((material) => material.dispose())
  }

  const removeItemLayers = (): void => {
    if (attachedView) {
      if (plumeGroup) {
        attachedView.remove(plumeGroup)
        disposeGroupResources(plumeGroup)
      }
      if (fireflies) {
        attachedView.remove(fireflies.group)
        disposeGroupResources(fireflies.group)
      }
    }
    plumeGroup = null
    fireflies = null
  }

  const releaseTrail = (): void => {
    if (!trail) return
    scene.remove(trail.root)
    trail.dispose()
    trail = null
    trailLastPosition = null
  }

  const rebuildLayers = (): void => {
    removeItemLayers()
    releaseTrail()
    if (!attachedView) return
    const characterId = attachedView.userData.characterId
    if (typeof characterId === "string") lastCharacterId = characterId as CharacterId
    for (const itemId of equipped) {
      if (itemId === "fox-plume") {
        plumeGroup = buildPlume(lastCharacterId)
        attachedView.add(plumeGroup)
      } else if (itemId === "sherwood-fireflies") {
        fireflies = buildFireflies()
        attachedView.add(fireflies.group)
      } else if (itemId === "kings-ransom-trail") {
        trail = buildTrail()
        scene.add(trail.root)
      }
    }
  }

  return {
    attach(view) {
      if (attachedView === view) return
      if (attachedView) {
        removeItemLayers()
        releaseTrail()
      }
      attachedView = view
      rebuildLayers()
    },
    setEquipped(itemIds) {
      const known = itemIds.filter((id): id is VanityItemId => VANITY_CATALOG.some((item) => item.id === id))
      const next = [...new Set(known)]
      if (next.length === equipped.length && next.every((id, index) => equipped[index] === id)) return
      equipped = next
      rebuildLayers()
    },
    equipped() {
      return equipped
    },
    update(context) {
      if (fireflies) {
        for (const mote of fireflies.motes) {
          if (!Number.isFinite(context.elapsed) || context.motionScale <= 0) continue
          const angle = context.elapsed * 1.1 + mote.phaseX
          mote.mesh.position.set(
            Math.cos(angle) * mote.radiusX,
            mote.centerY + Math.sin(context.elapsed * 1.7 + mote.phaseY) * mote.bob * context.motionScale,
            Math.sin(angle) * mote.radiusZ,
          )
        }
      }
      if (!trail) return
      if (!Number.isFinite(context.elapsed) || context.motionScale <= 0 || !context.position) return
      const { x, y, z } = context.position
      const last = trailLastPosition
      trailLastPosition = { x, y, z }
      if (context.moving && last && Math.hypot(x - last.x, z - last.z) > 0.001) {
        trail.spawnAccumulator += Math.min(context.dt, 0.1) * 9 * context.motionScale
        while (trail.spawnAccumulator >= 1) {
          trail.spawnAccumulator -= 1
          trail.spawn(last.x, last.y, last.z)
        }
      }
      for (let index = trail.puffs.length - 1; index >= 0; index -= 1) {
        const puff = trail.puffs[index]
        puff.age += Math.min(context.dt, 0.1)
        const fade = Math.max(0, 1 - puff.age / puff.life)
        ;(puff.mesh.material as THREE.MeshBasicMaterial).opacity = puff.baseOpacity * fade
        puff.mesh.position.y += Math.min(context.dt, 0.1) * 0.12 * context.motionScale
        if (puff.age >= puff.life) {
          trail.root.remove(puff.mesh)
          ;(puff.mesh.material as THREE.Material).dispose()
          trail.puffs.splice(index, 1)
        }
      }
    },
    dispose() {
      removeItemLayers()
      releaseTrail()
      attachedView = null
      equipped = []
    },
  }
}

/** Exposed for tests: a cosmetic mesh carries the occlusion-exclusion marker. */
export function isVanityCosmetic(object: THREE.Object3D): boolean {
  return object.userData.sherwoodCosmeticOnly === true
}
