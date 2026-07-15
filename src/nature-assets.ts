import * as THREE from "three"

export const NATURE_VARIANT_NAMES = [
  "Nature_Grass_Wispy_Short",
  "Nature_Grass_Common_Tall",
  "Nature_Wheat_Tall",
  "Nature_Fern_1",
  "Nature_Bush_Common",
  "Nature_Flower_3_Group",
  "Nature_Mushroom_Common",
  "Nature_Rock_Medium_2",
  "Nature_Pebble_Round_3",
] as const

export type NatureVariantName = (typeof NATURE_VARIANT_NAMES)[number]
export type NatureCatalog = Readonly<Record<NatureVariantName, THREE.Object3D>>

export function indexNatureCatalog(source: THREE.Object3D): NatureCatalog {
  const direct = new Map(source.children.map((child) => [child.name, child]))
  const missing = NATURE_VARIANT_NAMES.filter((name) => !direct.has(name))
  if (missing.length > 0) throw new Error(`Invalid nature catalog (missing: ${missing.join(", ")})`)
  const catalog = {} as Record<NatureVariantName, THREE.Object3D>
  for (const name of NATURE_VARIANT_NAMES) catalog[name] = direct.get(name)!
  return Object.freeze(catalog)
}

/** Builds one instanced draw per source primitive while sharing immutable GLB resources. */
export function createNatureVariantInstances(
  catalog: NatureCatalog,
  name: NatureVariantName,
  matrices: readonly THREE.Matrix4[],
  options: { castShadow?: boolean; receiveShadow?: boolean } = {},
): THREE.Group {
  const group = new THREE.Group()
  group.name = `${name}Instances`
  const source = catalog[name]
  source.updateMatrixWorld(true)
  const inverseRoot = source.matrixWorld.clone().invert()
  source.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const sourceOffset = inverseRoot.clone().multiply(object.matrixWorld)
    const batch = new THREE.InstancedMesh(object.geometry, object.material, matrices.length)
    batch.name = `${name}:${object.name || "Primitive"}`
    batch.castShadow = options.castShadow ?? false
    batch.receiveShadow = options.receiveShadow ?? true
    matrices.forEach((matrix, index) => batch.setMatrixAt(index, matrix.clone().multiply(sourceOffset)))
    batch.instanceMatrix.needsUpdate = true
    batch.computeBoundingSphere()
    batch.userData.sherwoodSharedGeometry = true
    batch.userData.sherwoodNatureVariant = name
    group.add(batch)
  })
  if (group.children.length === 0) throw new Error(`Nature variant has no mesh primitives: ${name}`)
  return group
}
