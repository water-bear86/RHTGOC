import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import {
  cloneObjectMaterialsForInstance,
  convertObjectToToon,
  createToonMaterial,
  disposeObjectInstanceMaterials,
  setMeshColor,
  setObjectOpacityFactor,
} from "./toon-materials"

function meshMaterials(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

describe("storybook toon materials", () => {
  it("reuses one correctly configured four-step neutral gradient", () => {
    const first = createToonMaterial({ color: 0x43643d })
    const second = createToonMaterial({ color: 0x9f7438 })
    const ramp = first.gradientMap as THREE.DataTexture

    expect(second.gradientMap).toBe(ramp)
    expect(ramp.image).toMatchObject({ width: 4, height: 1 })
    expect(Array.from(ramp.image.data as Uint8Array)).toEqual([
      96, 96, 96, 255,
      148, 148, 148, 255,
      204, 204, 204, 255,
      255, 255, 255, 255,
    ])
    expect(ramp.minFilter).toBe(THREE.NearestFilter)
    expect(ramp.magFilter).toBe(THREE.NearestFilter)
    expect(ramp.generateMipmaps).toBe(false)
    expect(ramp.wrapS).toBe(THREE.ClampToEdgeWrapping)
    expect(ramp.wrapT).toBe(THREE.ClampToEdgeWrapping)
    expect(ramp.colorSpace).toBe(THREE.NoColorSpace)
  })

  it("preserves toon-compatible appearance and render state from PBR sources", () => {
    const map = new THREE.Texture()
    const normalMap = new THREE.Texture()
    const alphaMap = new THREE.Texture()
    const source = new THREE.MeshPhysicalMaterial({
      color: 0x36583c,
      emissive: 0x24180e,
      emissiveIntensity: 0.4,
      map,
      normalMap,
      normalScale: new THREE.Vector2(0.6, -0.7),
      alphaMap,
      opacity: 0.72,
      transparent: true,
      alphaTest: 0.15,
      side: THREE.DoubleSide,
      vertexColors: true,
      depthWrite: false,
      toneMapped: false,
      flatShading: true,
    })
    source.name = "Robin tunic"
    source.userData = { family: "forest-cloth", nested: { swatch: 3 } }
    source.polygonOffset = true
    source.polygonOffsetFactor = -1
    source.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), -2)]

    const toon = createToonMaterial(source)

    expect(toon).toBeInstanceOf(THREE.MeshToonMaterial)
    expect(toon.name).toBe(source.name)
    expect(toon.color.getHex()).toBe(source.color.getHex())
    expect(toon.emissive.getHex()).toBe(source.emissive.getHex())
    expect(toon.emissiveIntensity).toBe(source.emissiveIntensity)
    expect(toon.map).toBe(map)
    expect(toon.normalMap).toBe(normalMap)
    expect(toon.normalScale).not.toBe(source.normalScale)
    expect(toon.normalScale.equals(source.normalScale)).toBe(true)
    expect(toon.alphaMap).toBe(alphaMap)
    expect(toon.opacity).toBe(source.opacity)
    expect(toon.transparent).toBe(source.transparent)
    expect(toon.alphaTest).toBe(source.alphaTest)
    expect(toon.side).toBe(source.side)
    expect(toon.vertexColors).toBe(source.vertexColors)
    expect(toon.depthWrite).toBe(source.depthWrite)
    expect(toon.toneMapped).toBe(source.toneMapped)
    expect(toon.flatShading).toBe(true)
    expect(toon.polygonOffset).toBe(true)
    expect(toon.polygonOffsetFactor).toBe(-1)
    expect(toon.clippingPlanes?.[0]).not.toBe(source.clippingPlanes?.[0])
    expect(toon.clippingPlanes?.[0].equals(source.clippingPlanes![0])).toBe(true)
    expect(toon.userData).toEqual(source.userData)
    expect(toon.userData).not.toBe(source.userData)
  })

  it("converts only standard and physical mesh materials while preserving arrays", () => {
    const root = new THREE.Group()
    const standard = new THREE.MeshStandardMaterial({ color: 0x334422 })
    const physical = new THREE.MeshPhysicalMaterial({ color: 0x665544 })
    const basic = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const materials = [standard, basic, physical]
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), materials)
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 })
    const line = new THREE.Line(new THREE.BufferGeometry(), lineMaterial)
    const spriteMaterial = new THREE.SpriteMaterial({ color: 0x00ff00 })
    const sprite = new THREE.Sprite(spriteMaterial)
    root.add(mesh, line, sprite)

    expect(convertObjectToToon(root)).toBe(root)

    const converted = meshMaterials(mesh)
    expect(converted).toHaveLength(3)
    expect(converted[0]).toBeInstanceOf(THREE.MeshToonMaterial)
    expect(converted[1]).toBe(basic)
    expect(converted[2]).toBeInstanceOf(THREE.MeshToonMaterial)
    expect(line.material).toBe(lineMaterial)
    expect(sprite.material).toBe(spriteMaterial)
  })

  it("preserves shared material identity when converting a hierarchy", () => {
    const shared = new THREE.MeshStandardMaterial({ color: 0x324a31 })
    const first = new THREE.Mesh(new THREE.BoxGeometry(), shared)
    const second = new THREE.Mesh(new THREE.BoxGeometry(), [shared, shared])
    const root = new THREE.Group().add(first, second)

    convertObjectToToon(root)

    const firstToon = first.material as unknown as THREE.MeshToonMaterial
    const secondToon = second.material as THREE.Material[]
    expect(secondToon[0]).toBe(firstToon)
    expect(secondToon[1]).toBe(firstToon)
  })

  it("isolates instance materials while retaining shared texture resources", () => {
    const map = new THREE.Texture()
    const sourceMaterial = createToonMaterial({ color: 0x42613c, map })
    const root = new THREE.Group()
    const first = new THREE.Mesh(new THREE.BoxGeometry(), sourceMaterial)
    const second = new THREE.Mesh(new THREE.BoxGeometry(), [sourceMaterial, sourceMaterial])
    root.add(first, second)

    expect(cloneObjectMaterialsForInstance(root)).toBe(root)

    const firstClone = first.material as THREE.MeshToonMaterial
    const secondClones = second.material as THREE.MeshToonMaterial[]
    expect(firstClone).not.toBe(sourceMaterial)
    expect(secondClones[0]).toBe(firstClone)
    expect(secondClones[1]).toBe(firstClone)
    expect(firstClone.map).toBe(map)
    expect(firstClone.gradientMap).toBe(sourceMaterial.gradientMap)
    firstClone.color.set(0xffffff)
    expect(sourceMaterial.color.getHex()).toBe(0x42613c)
  })

  it("changes skinned mesh materials without disturbing rig state", () => {
    const rootBone = new THREE.Bone()
    const childBone = new THREE.Bone()
    rootBone.add(childBone)
    const skeleton = new THREE.Skeleton([rootBone, childBone])
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3))
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4))
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute([1, 0, 0, 0], 4))
    const source = new THREE.MeshStandardMaterial({ color: 0x425d37 })
    const skinned = new THREE.SkinnedMesh(geometry, source)
    skinned.add(rootBone)
    skinned.bind(skeleton)
    const bindMatrix = skinned.bindMatrix.clone()

    convertObjectToToon(skinned)
    const converted = skinned.material
    cloneObjectMaterialsForInstance(skinned)

    expect(converted).toBeInstanceOf(THREE.MeshToonMaterial)
    expect(skinned.material).not.toBe(converted)
    expect(skinned.skeleton).toBe(skeleton)
    expect(skinned.skeleton.bones).toEqual([rootBone, childBone])
    expect(skinned.bindMatrix.equals(bindMatrix)).toBe(true)
    expect(skinned.geometry).toBe(geometry)
  })

  it("applies and restores opacity from each material's own baseline", () => {
    const opaque = createToonMaterial({ opacity: 1, transparent: false })
    const translucent = new THREE.MeshBasicMaterial({ opacity: 0.6, transparent: true })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [opaque, translucent, opaque])

    expect(setObjectOpacityFactor(mesh, 0.5)).toBe(mesh)
    expect(opaque.opacity).toBe(0.5)
    expect(opaque.transparent).toBe(true)
    expect(translucent.opacity).toBe(0.3)
    expect(translucent.transparent).toBe(true)

    setObjectOpacityFactor(mesh, 0.2)
    expect(opaque.opacity).toBe(0.2)
    expect(translucent.opacity).toBeCloseTo(0.12)

    setObjectOpacityFactor(mesh, 1)
    expect(opaque.opacity).toBe(1)
    expect(opaque.transparent).toBe(false)
    expect(translucent.opacity).toBe(0.6)
    expect(translucent.transparent).toBe(true)
  })

  it("restores an intentionally non-transparent baseline even below full opacity", () => {
    const material = createToonMaterial({ opacity: 0.65, transparent: false })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material)

    setObjectOpacityFactor(mesh, 0.5)
    expect(material.opacity).toBe(0.325)
    expect(material.transparent).toBe(true)

    setObjectOpacityFactor(mesh, 1)
    expect(material.opacity).toBe(0.65)
    expect(material.transparent).toBe(false)
  })

  it("carries the original opacity baseline into later material clones", () => {
    const material = createToonMaterial({ opacity: 0.8, transparent: true })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material)
    setObjectOpacityFactor(mesh, 0.5)
    cloneObjectMaterialsForInstance(mesh)
    const clone = mesh.material as THREE.MeshToonMaterial

    setObjectOpacityFactor(mesh, 1)

    expect(clone.opacity).toBe(0.8)
    expect(clone.transparent).toBe(true)
  })

  it("rejects non-finite opacity factors", () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), createToonMaterial())
    expect(() => setObjectOpacityFactor(mesh, Number.NaN)).toThrow(TypeError)
    expect(() => setObjectOpacityFactor(mesh, Number.POSITIVE_INFINITY)).toThrow(TypeError)
  })

  it("sets every color-bearing entry in a mesh material array", () => {
    const toon = createToonMaterial({ color: 0x000000 })
    const basic = new THREE.MeshBasicMaterial({ color: 0x111111 })
    const depth = new THREE.MeshDepthMaterial()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [toon, basic, depth, toon])

    expect(setMeshColor(mesh, 0x7d9a54)).toBe(mesh)

    expect(toon.color.getHex()).toBe(0x7d9a54)
    expect(basic.color.getHex()).toBe(0x7d9a54)
    expect("color" in depth).toBe(false)
  })

  it("disposes each unique instance material once without disposing shared resources", () => {
    const map = new THREE.Texture()
    const gradient = createToonMaterial().gradientMap!
    const shared = createToonMaterial({ map })
    const second = new THREE.MeshBasicMaterial({ map })
    const geometry = new THREE.BoxGeometry()
    const root = new THREE.Group()
    root.add(
      new THREE.Mesh(geometry, [shared, shared, second]),
      new THREE.Mesh(geometry, shared),
    )
    const sharedDisposed = vi.fn()
    const secondDisposed = vi.fn()
    const mapDisposed = vi.fn()
    const gradientDisposed = vi.fn()
    const geometryDisposed = vi.fn()
    shared.addEventListener("dispose", sharedDisposed)
    second.addEventListener("dispose", secondDisposed)
    map.addEventListener("dispose", mapDisposed)
    gradient.addEventListener("dispose", gradientDisposed)
    geometry.addEventListener("dispose", geometryDisposed)

    expect(disposeObjectInstanceMaterials(root)).toBe(root)

    expect(sharedDisposed).toHaveBeenCalledTimes(1)
    expect(secondDisposed).toHaveBeenCalledTimes(1)
    expect(mapDisposed).not.toHaveBeenCalled()
    expect(gradientDisposed).not.toHaveBeenCalled()
    expect(geometryDisposed).not.toHaveBeenCalled()
  })
})
