import * as THREE from "three"

const TOON_RAMP_VALUES = [
  96, 96, 96, 255,
  148, 148, 148, 255,
  204, 204, 204, 255,
  255, 255, 255, 255,
] as const

interface OpacityBaseline {
  opacity: number
  transparent: boolean
}

export type StorybookToonMaterial = THREE.MeshToonMaterial & { flatShading: boolean }

let sharedToonGradientMap: THREE.DataTexture | undefined
const opacityBaselines = new WeakMap<THREE.Material, OpacityBaseline>()

function getSharedToonGradientMap(): THREE.DataTexture {
  if (sharedToonGradientMap) return sharedToonGradientMap

  const texture = new THREE.DataTexture(
    new Uint8Array(TOON_RAMP_VALUES),
    4,
    1,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  texture.name = "Sherwood storybook toon ramp"
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.colorSpace = THREE.NoColorSpace
  texture.needsUpdate = true
  sharedToonGradientMap = texture
  return texture
}

function isConvertibleMaterial(
  material: THREE.Material,
): material is THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial {
  return material instanceof THREE.MeshStandardMaterial
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true
}

function mapMaterials(
  material: THREE.Material | THREE.Material[],
  transform: (item: THREE.Material) => THREE.Material,
): THREE.Material | THREE.Material[] {
  if (!Array.isArray(material)) return transform(material)
  return material.map(transform)
}

function forEachUniqueMeshMaterial(
  root: THREE.Object3D,
  callback: (material: THREE.Material) => void,
): void {
  const visited = new Set<THREE.Material>()
  root.traverse((object) => {
    if (!isMesh(object)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      if (visited.has(material)) continue
      visited.add(material)
      callback(material)
    }
  })
}

/**
 * Creates a restrained storybook toon material. Standard and physical sources
 * retain the state supported by MeshToonMaterial; parameter objects are useful
 * for procedural geometry. Every result shares the same immutable gradient map.
 */
export function createToonMaterial(
  sourceOrParameters:
    | THREE.MeshStandardMaterial
    | THREE.MeshPhysicalMaterial
    | THREE.MeshToonMaterialParameters = {},
): StorybookToonMaterial {
  const gradientMap = getSharedToonGradientMap()

  if (sourceOrParameters instanceof THREE.MeshStandardMaterial) {
    const material = new THREE.MeshToonMaterial() as StorybookToonMaterial
    // MeshStandardMaterial and MeshPhysicalMaterial contain every source field
    // read by MeshToonMaterial.copy(). Unsupported PBR-only fields are dropped.
    material.copy(sourceOrParameters)
    material.gradientMap = gradientMap
    material.flatShading = sourceOrParameters.flatShading
    return material
  }

  const material = new THREE.MeshToonMaterial(sourceOrParameters) as StorybookToonMaterial
  material.gradientMap = gradientMap
  material.flatShading = false
  return material
}

/** Converts only lit standard/physical mesh materials, in place. */
export function convertObjectToToon<T extends THREE.Object3D>(root: T): T {
  const conversions = new Map<THREE.Material, THREE.Material>()

  root.traverse((object) => {
    if (!isMesh(object)) return

    object.material = mapMaterials(object.material, (material) => {
      if (!isConvertibleMaterial(material)) return material
      const cached = conversions.get(material)
      if (cached) return cached
      const converted = createToonMaterial(material)
      conversions.set(material, converted)
      return converted
    })
  })

  return root
}

/**
 * Clones mesh materials for a scene instance without duplicating textures,
 * geometry, skeletons, or bones. Sharing within the instance is preserved.
 */
export function cloneObjectMaterialsForInstance<T extends THREE.Object3D>(root: T): T {
  const clones = new Map<THREE.Material, THREE.Material>()

  root.traverse((object) => {
    if (!isMesh(object)) return

    object.material = mapMaterials(object.material, (material) => {
      const cached = clones.get(material)
      if (cached) return cached

      const cloned = material.clone()
      if ("flatShading" in material && typeof material.flatShading === "boolean") {
        const flatShadedClone = cloned as THREE.Material & { flatShading: boolean }
        flatShadedClone.flatShading = material.flatShading
      }
      const baseline = opacityBaselines.get(material)
      if (baseline) opacityBaselines.set(cloned, { ...baseline })
      clones.set(material, cloned)
      return cloned
    })
  })

  return root
}

/** Applies a reversible multiplier to every unique mesh material under root. */
export function setObjectOpacityFactor<T extends THREE.Object3D>(root: T, factor: number): T {
  if (!Number.isFinite(factor)) throw new TypeError("Opacity factor must be finite")
  const clampedFactor = THREE.MathUtils.clamp(factor, 0, 1)

  forEachUniqueMeshMaterial(root, (material) => {
    let baseline = opacityBaselines.get(material)
    if (!baseline) {
      baseline = { opacity: material.opacity, transparent: material.transparent }
      opacityBaselines.set(material, baseline)
    }

    const opacity = baseline.opacity * clampedFactor
    const transparent = clampedFactor === 1
      ? baseline.transparent
      : baseline.transparent || opacity < 1
    const transparencyChanged = material.transparent !== transparent
    material.opacity = opacity
    material.transparent = transparent
    if (transparencyChanged) material.needsUpdate = true
  })

  return root
}

/** Sets every color-bearing material on a mesh, including material arrays. */
export function setMeshColor<T extends THREE.Mesh>(mesh: T, color: THREE.ColorRepresentation): T {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const visited = new Set<THREE.Material>()

  for (const material of materials) {
    if (visited.has(material)) continue
    visited.add(material)
    const candidate = material as THREE.Material & { color?: THREE.Color }
    if (candidate.color?.isColor) candidate.color.set(color)
  }

  return mesh
}

/**
 * Releases only the unique mesh materials owned by an instance. Textures,
 * gradient maps, geometry, skeletons, and other shared resources remain live.
 */
export function disposeObjectInstanceMaterials<T extends THREE.Object3D>(root: T): T {
  forEachUniqueMeshMaterial(root, (material) => material.dispose())
  return root
}
