import { describe, expect, it } from "vitest"
import * as THREE from "three"
import {
  isCharacterOcclusionSilhouetteMaterial,
  setCharacterOcclusionSilhouette,
} from "./character-occlusion"

describe("character scenery occlusion", () => {
  it("turns every character mesh into a visible-through-scenery silhouette", () => {
    const firstMaterial = new THREE.MeshStandardMaterial({ color: 0x496c3d })
    const secondMaterials = [
      new THREE.MeshStandardMaterial({ color: 0x6d432a }),
      new THREE.MeshBasicMaterial({ color: 0xd8c29b }),
    ]
    const first = new THREE.Mesh(new THREE.BoxGeometry(), firstMaterial)
    const second = new THREE.Mesh(new THREE.BoxGeometry(), secondMaterials)
    const root = new THREE.Group().add(first, second)

    setCharacterOcclusionSilhouette(root, true)

    expect(isCharacterOcclusionSilhouetteMaterial(first.material as THREE.Material)).toBe(true)
    expect(second.material).toBe(first.material)
    const silhouette = first.material as unknown as THREE.MeshBasicMaterial
    expect(silhouette.color.getHex()).toBe(0x10281d)
    expect(silhouette.opacity).toBe(0.78)
    expect(silhouette.depthTest).toBe(false)
    expect(silhouette.depthWrite).toBe(false)
    expect(first.renderOrder).toBe(1_000)
    expect(second.renderOrder).toBe(1_000)
  })

  it("restores original materials and render order without disturbing the rig", () => {
    const bone = new THREE.Bone()
    const skeleton = new THREE.Skeleton([bone])
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3))
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4))
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0], 4))
    const originalMaterial = new THREE.MeshToonMaterial({ color: 0x496c3d })
    const character = new THREE.SkinnedMesh(geometry, originalMaterial)
    character.add(bone)
    character.bind(skeleton)
    character.renderOrder = 7

    setCharacterOcclusionSilhouette(character, true)
    setCharacterOcclusionSilhouette(character, false)

    expect(character.material).toBe(originalMaterial)
    expect(character.renderOrder).toBe(7)
    expect(character.skeleton).toBe(skeleton)
    expect(character.geometry).toBe(geometry)
  })
})
