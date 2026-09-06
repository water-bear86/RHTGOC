import * as THREE from "three"
import { describe, expect, it } from "vitest"
import { SHERWOOD_MAJOR_OAK } from "../shared/world-landmarks-layout"
import {
  createProceduralMajorOak,
  MAJOR_OAK_HEIGHT,
  MAJOR_OAK_POSITION,
  normalizeMajorOak,
  prepareAuthoredMajorOak,
} from "./major-oak"

describe("Major Oak constants", () => {
  it("matches the shared landmark spec", () => {
    expect(MAJOR_OAK_HEIGHT).toBe(SHERWOOD_MAJOR_OAK.height)
    expect(MAJOR_OAK_POSITION).toEqual({ x: SHERWOOD_MAJOR_OAK.x, z: SHERWOOD_MAJOR_OAK.z })
  })
})

describe("procedural oak", () => {
  it("is two draw calls (bark + crown)", () => {
    const oak = createProceduralMajorOak()
    const meshes: THREE.Mesh[] = []
    oak.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o) })
    expect(meshes).toHaveLength(2)
    expect(meshes.every((m) => m.geometry.getAttribute("color"))).toBe(true)
  })

  it("stands at roughly the landmark height", () => {
    const oak = createProceduralMajorOak()
    oak.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(oak)
    const height = box.max.y - box.min.y
    expect(height).toBeGreaterThan(MAJOR_OAK_HEIGHT * 0.7)
    expect(height).toBeLessThan(MAJOR_OAK_HEIGHT * 1.2)
  })

  it("scales with the requested height", () => {
    const small = new THREE.Box3().setFromObject(createProceduralMajorOak(10))
    const big = new THREE.Box3().setFromObject(createProceduralMajorOak(30))
    expect(big.max.y - big.min.y).toBeGreaterThan(small.max.y - small.min.y)
  })
})

describe("normalization (hero-parity)", () => {
  function boxModel(width: number, height: number, depth: number, offset: THREE.Vector3): THREE.Group {
    const geometry = new THREE.BoxGeometry(width, height, depth)
    geometry.translate(offset.x, offset.y, offset.z)
    const group = new THREE.Group()
    group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()))
    return group
  }

  it("scales to the target height and grounds min Y at zero", () => {
    const model = boxModel(2, 4, 2, new THREE.Vector3(5, 17, -3))
    normalizeMajorOak(model, 26)
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    expect(box.max.y - box.min.y).toBeCloseTo(26, 3)
    expect(box.min.y).toBeCloseTo(0, 3)
  })

  it("centres the model on X and Z regardless of source offset", () => {
    const model = boxModel(2, 4, 2, new THREE.Vector3(5, 17, -3))
    normalizeMajorOak(model, 26)
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 3)
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 3)
  })

  it("throws on degenerate bounds", () => {
    const empty = new THREE.Group()
    expect(() => normalizeMajorOak(empty, 26)).toThrow()
  })
})

describe("authored preparation", () => {
  it("normalizes, grounds shadows, and makes leaf materials double-sided", () => {
    const geometry = new THREE.BoxGeometry(2, 3, 2)
    geometry.translate(0, 5, 0)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial())
    const model = new THREE.Group()
    model.add(mesh)
    prepareAuthoredMajorOak(model, true)
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    expect(box.max.y - box.min.y).toBeCloseTo(MAJOR_OAK_HEIGHT, 2)
    expect(mesh.castShadow).toBe(true)
    const material = mesh.material as THREE.Material
    expect(material.side).toBe(THREE.DoubleSide)
  })
})
