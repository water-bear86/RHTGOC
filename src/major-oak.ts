import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js"
import { SHERWOOD_MAJOR_OAK } from "../shared/world-landmarks-layout"
import { sherwoodFootprintGroundY } from "./sherwood-terrain"
import { createToonMaterial, convertObjectToToon } from "./toon-materials"

/**
 * The Major Oak: Sherwood's landmark, Robin Hood's hideout. An ancient, broad,
 * root-flared oak that stands on Oak Ridge west of the camp so its eastern boughs
 * overhang the hub.
 *
 * The authored asset (`public/assets/environment/sherwood-major-oak.glb`) is the
 * shipped tree. It is placed synchronously as a procedural stand-in so the world
 * is never empty while the GLB streams, then swapped in place once it loads. If
 * the asset is missing or fails to load, the procedural oak stays — the landmark
 * is never absent.
 *
 * Position and the trunk collider live in `shared/world-landmarks-layout.ts` /
 * `shared/world-obstacles.ts` so the server owns collision; this module is the
 * client view only.
 */

export const MAJOR_OAK_HEIGHT: number = SHERWOOD_MAJOR_OAK.height
export const MAJOR_OAK_POSITION = Object.freeze({ x: SHERWOOD_MAJOR_OAK.x, z: SHERWOOD_MAJOR_OAK.z })
export const MAJOR_OAK_ASSET_URL = "/assets/environment/sherwood-major-oak.glb"

const BARK_COLOR = 0x59422b
const LEAF_COLOR = 0x284f32
const LEAF_LIGHT = 0x3c6a3e

export type MajorOakSource = "procedural" | "authored"

export interface MajorOakHandle {
  /** Stable wrapper in the scene; its child swaps procedural -> authored. */
  readonly group: THREE.Group
  readonly source: MajorOakSource
}

export interface AttachMajorOakOptions {
  castShadow: boolean
  /** Absolute-or-versioned asset URL resolver (matches the game's loader). */
  resolveUrl?: (url: string) => string
  loader?: Pick<GLTFLoader, "loadAsync">
  onStatus?: (source: MajorOakSource) => void
}

/* ------------------------------------------------------------------ *
 * Box3 normalization — identical policy to the hero loader.
 * ------------------------------------------------------------------ */

/** Scale to MAJOR_OAK_HEIGHT, centre X/Z, ground the minimum Y at 0. */
export function normalizeMajorOak(model: THREE.Object3D, targetHeight: number = MAJOR_OAK_HEIGHT): void {
  model.position.set(0, 0, 0)
  model.scale.setScalar(1)
  model.updateMatrixWorld(true)
  const bounds = new THREE.Box3()
  const vertex = new THREE.Vector3()
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const positions = object.geometry.getAttribute("position")
    if (!positions) return
    for (let index = 0; index < positions.count; index += 1) {
      object.getVertexPosition(index, vertex)
      bounds.expandByPoint(vertex.applyMatrix4(object.matrixWorld))
    }
  })
  const size = bounds.getSize(new THREE.Vector3())
  if (!Number.isFinite(size.y) || size.y <= 0) throw new Error("Major Oak has invalid bounds")
  const scale = targetHeight / size.y
  const center = bounds.getCenter(new THREE.Vector3())
  model.scale.setScalar(scale)
  model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
  model.updateMatrixWorld(true)
}

/* ------------------------------------------------------------------ *
 * Procedural stand-in (also the permanent fallback).
 * ------------------------------------------------------------------ */

function paint(geometry: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const color = new THREE.Color(hex)
  const count = geometry.getAttribute("position").count
  const array = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    array[i * 3] = color.r
    array[i * 3 + 1] = color.g
    array[i * 3 + 2] = color.b
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(array, 3))
  return geometry
}

/**
 * A stylised oak sized for MAJOR_OAK_HEIGHT: a lathe-turned buttressed trunk, two
 * prop-supported low limbs, and a cluster of toon crown blobs. Two draw calls
 * (bark + leaves). Deliberately simpler than a hero asset — it is a fallback and
 * a while-loading stand-in, and the camera rarely frames the crown.
 */
export function createProceduralMajorOak(height: number = MAJOR_OAK_HEIGHT): THREE.Group {
  const group = new THREE.Group()
  group.name = "MajorOakProcedural"
  const h = height
  const bark: THREE.BufferGeometry[] = []
  const leaves: THREE.BufferGeometry[] = []

  // Trunk: lathe profile, wide root flare tapering up.
  const profile = [
    [0.092, 0.0],
    [0.073, 0.058],
    [0.062, 0.154],
    [0.056, 0.308],
    [0.046, 0.46],
  ].map(([r, y]) => new THREE.Vector2(r * h, y * h))
  const trunk = new THREE.LatheGeometry(profile, 12).toNonIndexed()
  bark.push(paint(trunk, BARK_COLOR))

  // Two low limbs toward +x/+z with props to the ground.
  const limbSpecs: Array<{ from: THREE.Vector3; to: THREE.Vector3 }> = [
    { from: new THREE.Vector3(0.4, 0.24 * h, 0), to: new THREE.Vector3(0.42 * h, 0.34 * h, 0.05 * h) },
    { from: new THREE.Vector3(0, 0.28 * h, 0.4), to: new THREE.Vector3(0.06 * h, 0.4 * h, 0.42 * h) },
  ]
  for (const limb of limbSpecs) {
    const curve = new THREE.CatmullRomCurve3([
      limb.from,
      new THREE.Vector3((limb.from.x + limb.to.x) / 2, limb.from.y + 0.06 * h, (limb.from.z + limb.to.z) / 2),
      limb.to,
    ])
    const tube = new THREE.TubeGeometry(curve, 8, 0.42, 5, false).toNonIndexed()
    bark.push(paint(tube, BARK_COLOR))
    // prop from limb end to ground
    const propHeight = limb.to.y
    const prop = new THREE.CylinderGeometry(0.14 * (h / 26), 0.16 * (h / 26), propHeight, 6).toNonIndexed()
    prop.translate(limb.to.x, propHeight / 2, limb.to.z)
    bark.push(paint(prop, BARK_COLOR))
  }

  // Crown: overlapping flattened blobs, two-tone, with gaps for dappled shadow.
  const blobs: Array<[number, number, number, number, boolean]> = [
    [0, 0.62 * h, 0, 0.26 * h, false],
    [0.16 * h, 0.56 * h, 0.05 * h, 0.2 * h, true],
    [-0.14 * h, 0.58 * h, 0.06 * h, 0.19 * h, false],
    [0.04 * h, 0.5 * h, -0.16 * h, 0.2 * h, true],
    [-0.05 * h, 0.72 * h, 0.02 * h, 0.21 * h, false],
    [0.2 * h, 0.68 * h, -0.06 * h, 0.17 * h, true],
    [-0.2 * h, 0.66 * h, -0.05 * h, 0.16 * h, false],
    [0.1 * h, 0.8 * h, 0.1 * h, 0.15 * h, true],
  ]
  for (const [x, y, z, r, light] of blobs) {
    const blob = new THREE.IcosahedronGeometry(r, 1)
    blob.scale(1, 0.62, 1)
    blob.translate(x, y, z)
    leaves.push(paint(blob.toNonIndexed(), light ? LEAF_LIGHT : LEAF_COLOR))
  }

  const barkMesh = new THREE.Mesh(mergeGeometries(bark, false)!, createToonMaterial({ vertexColors: true }))
  barkMesh.name = "MajorOakBark"
  const leafMesh = new THREE.Mesh(mergeGeometries(leaves, false)!, createToonMaterial({ vertexColors: true }))
  leafMesh.name = "MajorOakCrown"
  group.add(barkMesh, leafMesh)
  return group
}

/* ------------------------------------------------------------------ *
 * Authored asset.
 * ------------------------------------------------------------------ */

/** Normalize, toon-convert, ground shadows, and make leaf cards double-sided. */
export function prepareAuthoredMajorOak(model: THREE.Group, castShadow: boolean): THREE.Group {
  normalizeMajorOak(model)
  convertObjectToToon(model)
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.castShadow = castShadow
    object.receiveShadow = true
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      // Leaf cards are single-sided in the source; show both faces so the
      // canopy reads full from every angle. Opaque, so no sorting cost.
      material.side = THREE.DoubleSide
    }
  })
  model.name = "MajorOakAuthored"
  return model
}

/* ------------------------------------------------------------------ *
 * Attach
 * ------------------------------------------------------------------ */

const defaultLoader = new GLTFLoader()

/**
 * Add the Major Oak to the scene. Returns a handle whose `group` is the object
 * currently in the scene — procedural at first, replaced in place by the authored
 * asset once it loads. Never throws; a load failure leaves the procedural oak and
 * reports `"procedural"` through `onStatus`.
 */
export function attachMajorOak(scene: THREE.Object3D, options: AttachMajorOakOptions): MajorOakHandle {
  const { x, z } = MAJOR_OAK_POSITION
  const half = SHERWOOD_MAJOR_OAK.trunkHalfExtent
  const groundY = sherwoodFootprintGroundY(x, z, half, half, 0)

  // A stable wrapper positioned at the oak. The procedural stand-in and the
  // authored asset are swapped as its children, so a camera occluder or a
  // visibility toggle that holds the wrapper never sees a stale reference.
  const wrapper = new THREE.Group()
  wrapper.name = "MajorOak"
  wrapper.position.set(x, groundY, z)
  scene.add(wrapper)

  const procedural = createProceduralMajorOak()
  procedural.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = options.castShadow
      object.receiveShadow = true
    }
  })
  wrapper.add(procedural)

  const handle: { group: THREE.Group; source: MajorOakSource } = { group: wrapper, source: "procedural" }

  const loader = options.loader ?? defaultLoader
  const resolveUrl = options.resolveUrl ?? ((url: string) => url)
  void loader
    .loadAsync(resolveUrl(MAJOR_OAK_ASSET_URL))
    .then((gltf) => {
      const authored = prepareAuthoredMajorOak(gltf.scene, options.castShadow)
      wrapper.add(authored)
      wrapper.remove(procedural)
      disposeGroup(procedural)
      handle.source = "authored"
      options.onStatus?.("authored")
    })
    .catch(() => {
      // Keep the procedural oak; the landmark is never absent.
      options.onStatus?.("procedural")
    })

  return handle
}

function disposeGroup(group: THREE.Object3D): void {
  group.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) material.dispose()
  })
}
