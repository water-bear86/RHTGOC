import * as THREE from "three"

const SILHOUETTE_RENDER_ORDER = 1_000

interface OriginalMeshAppearance {
  material: THREE.Material | THREE.Material[]
  renderOrder: number
}

const originalAppearances = new WeakMap<THREE.Mesh, OriginalMeshAppearance>()
const silhouetteMaterial = new THREE.MeshBasicMaterial({
  color: 0x10281d,
  depthTest: false,
  depthWrite: false,
  fog: false,
  opacity: 0.78,
  side: THREE.DoubleSide,
  toneMapped: false,
  transparent: true,
})
silhouetteMaterial.name = "Sherwood character occlusion silhouette"

/**
 * Cosmetic-only meshes (Sherwood Finery) are skipped so an occluded character
 * does not gain glowing silhouette fragments. This only changes which meshes
 * receive the cutout tint; the sightline test that decides occlusion is
 * untouched.
 */
function cosmeticMeshExcluded(object: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (current.userData.sherwoodCosmeticOnly === true) return true
    current = current.parent
  }
  return false
}

/**
 * Preserves the animated character mesh while presenting it as an unobtrusive
 * storybook cutout through foreground scenery. Call with false before applying
 * normal per-character material effects for the frame.
 */
export function setCharacterOcclusionSilhouette(root: THREE.Object3D, enabled: boolean): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || cosmeticMeshExcluded(object)) return

    const original = originalAppearances.get(object)
    if (!enabled) {
      if (!original || object.material !== silhouetteMaterial) return
      object.material = original.material
      object.renderOrder = original.renderOrder
      return
    }

    if (!original) {
      originalAppearances.set(object, {
        material: object.material,
        renderOrder: object.renderOrder,
      })
    }
    object.material = silhouetteMaterial
    object.renderOrder = SILHOUETTE_RENDER_ORDER
  })
}

export function isCharacterOcclusionSilhouetteMaterial(material: THREE.Material): boolean {
  return material === silhouetteMaterial
}
