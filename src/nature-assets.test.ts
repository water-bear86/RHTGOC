import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { NATURE_VARIANT_NAMES, createNatureVariantInstances, indexNatureCatalog } from "./nature-assets"

function catalogScene(): THREE.Group {
  const scene = new THREE.Group()
  for (const name of NATURE_VARIANT_NAMES) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x668844 }))
    mesh.name = name
    scene.add(mesh)
  }
  return scene
}

describe("nature assets", () => {
  it("rejects incomplete catalogs", () => {
    const scene = catalogScene()
    scene.remove(scene.getObjectByName("Nature_Wheat_Tall")!)
    expect(() => indexNatureCatalog(scene)).toThrow("missing: Nature_Wheat_Tall")
  })

  it("creates instanced textured primitives without cloning source resources", () => {
    const catalog = indexNatureCatalog(catalogScene())
    const matrices = [new THREE.Matrix4(), new THREE.Matrix4().makeTranslation(2, 0, 0)]
    const result = createNatureVariantInstances(catalog, "Nature_Fern_1", matrices)
    const batch = result.children[0] as THREE.InstancedMesh
    const source = catalog.Nature_Fern_1 as THREE.Mesh
    expect(batch).toBeInstanceOf(THREE.InstancedMesh)
    expect(batch.count).toBe(2)
    expect(batch.geometry).toBe(source.geometry)
    expect(batch.material).toBe(source.material)
  })
})
