import * as THREE from "three"
import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import { regionalizeMissionDefinition, stableSeed } from "../shared/regional-layout"
import { SHERWOOD_TREE_LAYOUT } from "../shared/world-layout"
import { composeSherwoodWorld } from "../shared/world-composer"
import { createCampfireVisuals, type CampfireVisuals } from "./campfire-visuals"
import { createHeroCharacter, disposeHeroCharacter, poseHeroCharacter } from "./character-visuals"
import { createForestDressing } from "./forest-dressing"
import { createGuardVisual, poseGuardVisual } from "./guard-visuals"
import { createProceduralRoads } from "./procedural-roads"
import { createSettlementWorld, disposeSettlementWorld } from "./settlement-renderer"
import { createSherwoodTerrain, sherwoodHeightAt } from "./sherwood-terrain"
import type { CharacterId } from "./simulation"
import { TREE_VARIANT_NAMES, createAuthoredTreePlacements } from "./tree-placements"
import { createToonMaterial } from "./toon-materials"

export const FAMILY_PHOTO_SEED = stableSeed("sherwood-family-photo-v1")
export const FAMILY_PHOTO_WIDTH = 1920
export const FAMILY_PHOTO_HEIGHT = 1080
export const FAMILY_PHOTO_ASPECT = FAMILY_PHOTO_WIDTH / FAMILY_PHOTO_HEIGHT
export const FAMILY_PHOTO_CAPTURE_TIME_SECONDS = 4.75
export const FAMILY_PHOTO_CHARACTER_IDS = ["robin", "marian", "little-john", "much"] as const satisfies readonly CharacterId[]
export const FAMILY_PHOTO_GUARD_IDS = [0, 1, 2] as const

export interface FamilyPhotoAssets {
  villageCatalog?: THREE.Object3D
  treeCatalog?: THREE.Object3D
}

export interface FamilyPhotoMetadata {
  seed: number
  width: number
  height: number
  characters: readonly CharacterId[]
  guardIds: readonly number[]
  villageAsset: "authored" | "procedural-fallback"
  treeAsset: "authored" | "procedural-fallback"
}

export interface FamilyPhotoScene {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  heroes: ReadonlyMap<CharacterId, THREE.Group>
  guards: readonly THREE.Group[]
  metadata: FamilyPhotoMetadata
  renderFrame: (elapsed?: number) => void
  dispose: () => void
}

interface LocalPlacement {
  x: number
  z: number
  rotation: number
}

const PORTRAIT_TREE_RADIUS = 38

function placeOnTerrain(
  object: THREE.Object3D,
  center: Readonly<{ x: number; z: number }>,
  placement: LocalPlacement,
): void {
  const x = center.x + placement.x
  const z = center.z + placement.z
  object.position.set(x, sherwoodHeightAt(x, z), z)
  object.rotation.y = placement.rotation
}

function addLighting(scene: THREE.Scene, center: Readonly<{ x: number; z: number }>): void {
  const sky = new THREE.HemisphereLight(0xf6f0cf, 0x294230, 1.7)
  sky.name = "FamilyPhotoSkyLight"

  const sun = new THREE.DirectionalLight(0xffe4b1, 3.35)
  sun.name = "FamilyPhotoKeyLight"
  sun.position.set(center.x - 12, 24, center.z + 16)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -13
  sun.shadow.camera.right = 13
  sun.shadow.camera.top = 12
  sun.shadow.camera.bottom = -7
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 60
  sun.shadow.bias = -0.00035
  sun.shadow.normalBias = 0.025
  sun.target.position.set(center.x, 1.4, center.z - 0.8)

  const rim = new THREE.DirectionalLight(0xb8d7ad, 1.05)
  rim.name = "FamilyPhotoRimLight"
  rim.position.set(center.x + 10, 10, center.z - 12)
  rim.target.position.copy(sun.target.position)

  scene.add(sky, sun, sun.target, rim, rim.target)
}

function createAuthoredTreeBackdrop(
  treeCatalog: THREE.Object3D,
  center: Readonly<{ x: number; z: number }>,
): THREE.Group {
  const group = new THREE.Group()
  group.name = "FamilyPhotoAuthoredTrees"
  const placements = createAuthoredTreePlacements(SHERWOOD_TREE_LAYOUT).filter((placement) => (
    Math.hypot(placement.x - center.x, placement.z - center.z) <= PORTRAIT_TREE_RADIUS
  ))
  treeCatalog.updateMatrixWorld(true)

  for (const variantName of TREE_VARIANT_NAMES) {
    const source = treeCatalog.getObjectByName(variantName)
    if (!source) throw new Error(`Tree catalog is missing ${variantName}`)
    const sourceMeshes: THREE.Mesh[] = []
    source.traverse((child) => {
      if (child instanceof THREE.Mesh) sourceMeshes.push(child)
    })
    if (sourceMeshes.length === 0) throw new Error(`Tree catalog variant has no mesh: ${variantName}`)

    const variantPlacements = placements.filter((placement) => placement.variantName === variantName)
    for (const [partIndex, sourceMesh] of sourceMeshes.entries()) {
      const batch = new THREE.InstancedMesh(sourceMesh.geometry, sourceMesh.material, variantPlacements.length)
      batch.name = `FamilyPhotoTree:${variantName}:Part${partIndex + 1}`
      batch.userData.sherwoodSharedResources = true
      batch.castShadow = true
      batch.receiveShadow = true
      variantPlacements.forEach((placement, index) => {
        batch.setMatrixAt(index, new THREE.Matrix4().compose(
          new THREE.Vector3(placement.x, sherwoodHeightAt(placement.x, placement.z), placement.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.rotation),
          new THREE.Vector3(placement.height, placement.height, placement.height),
        ).multiply(sourceMesh.matrixWorld))
      })
      batch.instanceMatrix.needsUpdate = true
      batch.computeBoundingBox()
      batch.computeBoundingSphere()
      group.add(batch)
    }
  }

  group.userData.sherwoodTreeCount = placements.length
  return group
}

function createFallbackTreeBackdrop(center: Readonly<{ x: number; z: number }>): THREE.Group {
  const group = new THREE.Group()
  group.name = "FamilyPhotoFallbackTrees"
  const trunkGeometry = new THREE.CylinderGeometry(0.24, 0.36, 2.7, 7)
  const crownGeometry = new THREE.IcosahedronGeometry(1.1, 1)
  const trunkMaterial = createToonMaterial({ color: 0x563c28 })
  const crownMaterials = [
    createToonMaterial({ color: 0x244b2f }),
    createToonMaterial({ color: 0x315d37 }),
    createToonMaterial({ color: 0x3c693c }),
  ]
  const positions = [
    [-12, -6], [-10, 2], [-9, 10], [-6, -13], [-2, -16], [4, -15], [8, -11],
    [11, -5], [12, 4], [9, 10], [-13, 8], [14, 11],
  ] as const

  positions.forEach(([offsetX, offsetZ], index) => {
    const tree = new THREE.Group()
    tree.name = `FamilyPhotoFallbackTree:${index}`
    const scale = 0.9 + (index % 4) * 0.12
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial)
    trunk.position.y = 1.35
    trunk.castShadow = true
    trunk.receiveShadow = true
    const crown = new THREE.Mesh(crownGeometry, crownMaterials[index % crownMaterials.length])
    crown.position.set((index % 2) * 0.28 - 0.14, 3.25, 0)
    crown.scale.set(1.08, 1.48, 1.08)
    crown.castShadow = true
    crown.receiveShadow = true
    tree.add(trunk, crown)
    tree.scale.setScalar(scale)
    placeOnTerrain(tree, center, { x: offsetX, z: offsetZ, rotation: index * 2.399963 })
    group.add(tree)
  })
  return group
}

function disposeOwnedResources(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Points)) return
    if (object.userData.sherwoodSharedResources === true && object instanceof THREE.InstancedMesh) {
      object.dispose()
      return
    }
    geometries.add(object.geometry)
    const entries = Array.isArray(object.material) ? object.material : [object.material]
    entries.forEach((material) => materials.add(material))
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
}

/**
 * Builds the exact scene used for the Merry Band's village portrait. It has no
 * gameplay state or browser dependency, so capture tooling and tests can both
 * render the same immutable arrangement.
 */
export function createFamilyPhotoScene(assets: FamilyPhotoAssets = {}): FamilyPhotoScene {
  const regional = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, FAMILY_PHOTO_SEED)
  const world = composeSherwoodWorld(regional.layout)
  const village = world.settlements.find((settlement) => settlement.kind === "forest-village")
    ?? world.settlements[0]
  if (!village) throw new Error("The family photo requires a composed Sherwood village")
  const center = village.center

  const scene = new THREE.Scene()
  scene.name = "SherwoodMerryBandFamilyPhoto"
  scene.background = new THREE.Color(0xa8c4a0)
  scene.fog = new THREE.Fog(0xa8c4a0, 30, 78)

  const camera = new THREE.PerspectiveCamera(30, FAMILY_PHOTO_ASPECT, 0.1, 180)
  camera.name = "FamilyPhotoCamera"
  const centerHeight = sherwoodHeightAt(center.x, center.z)
  camera.position.set(center.x, centerHeight + 4.9, center.z + 15.4)
  const cameraTarget = new THREE.Vector3(center.x, centerHeight + 1.4, center.z - 0.65)
  camera.lookAt(cameraTarget)
  camera.userData.familyPhotoTarget = cameraTarget.toArray()
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)

  addLighting(scene, center)

  const terrain = createSherwoodTerrain()
  terrain.name = "FamilyPhotoTerrain"
  scene.add(terrain)

  const roads = createProceduralRoads(world.roads)
  roads.name = "FamilyPhotoRoads"
  const settlements = createSettlementWorld(world, {
    villageCatalog: assets.villageCatalog,
    castShadow: true,
  })
  settlements.name = "FamilyPhotoVillage"
  const dressing = createForestDressing({
    seed: FAMILY_PHOTO_SEED,
    exclusions: [{ x: center.x, z: center.z, radius: 8.5 }],
  }).group
  dressing.name = "FamilyPhotoForestFloor"
  scene.add(roads, settlements, dressing)

  let treeBackdrop: THREE.Group
  let treeAsset: FamilyPhotoMetadata["treeAsset"] = "procedural-fallback"
  if (assets.treeCatalog) {
    try {
      treeBackdrop = createAuthoredTreeBackdrop(assets.treeCatalog, center)
      treeAsset = "authored"
    } catch {
      treeBackdrop = createFallbackTreeBackdrop(center)
    }
  } else {
    treeBackdrop = createFallbackTreeBackdrop(center)
  }
  scene.add(treeBackdrop)

  const stage = new THREE.Group()
  stage.name = "FamilyPhotoCast"
  const heroPlacements: Readonly<Record<CharacterId, LocalPlacement>> = {
    "little-john": { x: -3.35, z: 0.05, rotation: 0.1 },
    robin: { x: -1.25, z: 0.75, rotation: 0.035 },
    marian: { x: 1.15, z: 0.75, rotation: -0.035 },
    much: { x: 3.2, z: 0.15, rotation: -0.11 },
  }
  const heroes = new Map<CharacterId, THREE.Group>()
  for (const characterId of FAMILY_PHOTO_CHARACTER_IDS) {
    const hero = createHeroCharacter(characterId)
    hero.name = `FamilyPhotoHero:${characterId}`
    poseHeroCharacter(hero, {
      elapsed: FAMILY_PHOTO_CAPTURE_TIME_SECONDS,
      moving: false,
      action: "idle",
      motionScale: 0,
    })
    placeOnTerrain(hero, center, heroPlacements[characterId])
    hero.userData.familyPhotoRole = "hero"
    heroes.set(characterId, hero)
    stage.add(hero)
  }

  const guardPlacements: readonly LocalPlacement[] = [
    { x: -3.15, z: -4.05, rotation: 0.07 },
    { x: 0, z: -4.55, rotation: 0 },
    { x: 3.15, z: -4.05, rotation: -0.07 },
  ]
  const guards = FAMILY_PHOTO_GUARD_IDS.map((guardId, index) => {
    const guard = createGuardVisual(guardId)
    guard.name = `FamilyPhotoGuard:${guardId}`
    poseGuardVisual(guard, {
      elapsed: FAMILY_PHOTO_CAPTURE_TIME_SECONDS,
      moving: false,
      alert: false,
      stunned: false,
      motionScale: 0,
    })
    placeOnTerrain(guard, center, guardPlacements[index])
    guard.userData.familyPhotoRole = "guard"
    stage.add(guard)
    return guard
  })

  const campfire: CampfireVisuals = createCampfireVisuals()
  campfire.group.name = "FamilyPhotoCampfire"
  placeOnTerrain(campfire.group, center, { x: 0, z: -2.35, rotation: 0 })
  campfire.update(FAMILY_PHOTO_CAPTURE_TIME_SECONDS, 1)
  stage.add(campfire.group)
  scene.add(stage)

  const metadata: FamilyPhotoMetadata = Object.freeze({
    seed: FAMILY_PHOTO_SEED,
    width: FAMILY_PHOTO_WIDTH,
    height: FAMILY_PHOTO_HEIGHT,
    characters: Object.freeze([...FAMILY_PHOTO_CHARACTER_IDS]),
    guardIds: Object.freeze([...FAMILY_PHOTO_GUARD_IDS]),
    villageAsset: assets.villageCatalog ? "authored" : "procedural-fallback",
    treeAsset,
  })
  scene.userData.familyPhoto = metadata

  const renderFrame = (elapsed = FAMILY_PHOTO_CAPTURE_TIME_SECONDS): void => {
    const stableElapsed = Number.isFinite(elapsed) ? elapsed : FAMILY_PHOTO_CAPTURE_TIME_SECONDS
    campfire.update(stableElapsed, 1)
    scene.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
  }
  renderFrame()

  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    campfire.dispose()
    heroes.forEach((hero) => disposeHeroCharacter(hero))
    guards.forEach((guard) => disposeOwnedResources(guard))
    disposeSettlementWorld(settlements)
    disposeOwnedResources(terrain)
    disposeOwnedResources(roads)
    disposeOwnedResources(dressing)
    disposeOwnedResources(treeBackdrop)
  }

  return {
    scene,
    camera,
    heroes,
    guards,
    metadata,
    renderFrame,
    dispose,
  }
}
