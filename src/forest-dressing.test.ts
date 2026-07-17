import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { createAuthoredForestDressing, createForestDressing } from "./forest-dressing"
import { NATURE_VARIANT_NAMES, indexNatureCatalog } from "./nature-assets"

describe("forest dressing", () => {
  it("creates clustered forest-floor pockets without hundreds of draw objects", () => {
    const dressing = createForestDressing({ seed: 7 })
    expect(dressing.instanceCount).toBeGreaterThanOrEqual(250)
    expect(dressing.instanceCount).toBeLessThan(350)
    expect(dressing.clusterCount).toBeGreaterThanOrEqual(12)
    expect(dressing.group.children).toHaveLength(5)
  })

  it("uses a smaller deterministic population for degraded rendering", () => {
    const full = createForestDressing({ seed: 7 })
    const degraded = createForestDressing({ seed: 7, degraded: true })
    expect(degraded.instanceCount).toBeLessThan(full.instanceCount)
    expect(degraded.instanceCount).toBeGreaterThan(120)
  })

  it("protects authored road corridors from decorative clutter", () => {
    const road = { width: 4, points: [{ x: -50, z: 0 }, { x: 50, z: 0 }] }
    const dressing = createForestDressing({ seed: 17, roads: [road] })
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    dressing.group.traverse((object) => {
      if (!(object instanceof THREE.InstancedMesh)) return
      for (let index = 0; index < object.count; index += 1) {
        object.getMatrixAt(index, matrix)
        position.setFromMatrixPosition(matrix)
        expect(Math.abs(position.z)).toBeGreaterThanOrEqual(3.3)
      }
    })
  })

  it("moves the forest-floor composition between regional seeds", () => {
    const first = createForestDressing({ seed: 7 })
    const second = createForestDressing({ seed: 8 })
    const firstGrass = first.group.getObjectByName("ForestGrassInstances")
    const secondGrass = second.group.getObjectByName("ForestGrassInstances")
    expect(firstGrass).toBeInstanceOf(THREE.InstancedMesh)
    expect(secondGrass).toBeInstanceOf(THREE.InstancedMesh)
    const firstMatrix = new THREE.Matrix4()
    const secondMatrix = new THREE.Matrix4()
    ;(firstGrass as THREE.InstancedMesh).getMatrixAt(0, firstMatrix)
    ;(secondGrass as THREE.InstancedMesh).getMatrixAt(0, secondMatrix)
    expect(secondMatrix.elements).not.toEqual(firstMatrix.elements)
  })

  it("uses textured catalogue meshes for the normal dressing path", () => {
    const source = new THREE.Group()
    for (const name of NATURE_VARIANT_NAMES) {
      const texture = new THREE.Texture()
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ map: texture }))
      mesh.name = name
      source.add(mesh)
    }
    const dressing = createAuthoredForestDressing(indexNatureCatalog(source), { seed: 7 })
    expect(dressing.instanceCount).toBeGreaterThan(250)
    expect(dressing.instanceCount).toBeLessThan(350)
    expect(dressing.group.children).toHaveLength(8)
    dressing.group.traverse((object) => {
      if (object instanceof THREE.InstancedMesh) expect((object.material as THREE.MeshStandardMaterial).map).toBeTruthy()
    })
  })
})
