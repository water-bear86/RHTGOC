import * as THREE from "three"
import { describe, expect, it, vi } from "vitest"
import { createCampfireVisuals } from "./campfire-visuals"

function namedObject(root: THREE.Object3D, name: string): THREE.Object3D {
  const object = root.getObjectByName(name)
  if (!object) throw new Error(`Missing ${name}`)
  return object
}

describe("campfire visuals", () => {
  it("builds a readable hearth, layered flame, embers, smoke, and bounded light", () => {
    const fire = createCampfireVisuals()

    expect(namedObject(fire.group, "CampfireStones")).toBeInstanceOf(THREE.InstancedMesh)
    expect(namedObject(fire.group, "CampfireLogs")).toBeInstanceOf(THREE.InstancedMesh)
    expect(namedObject(fire.group, "CampfireFlameOuter")).toBeInstanceOf(THREE.Mesh)
    expect(namedObject(fire.group, "CampfireFlameMiddle")).toBeInstanceOf(THREE.Mesh)
    expect(namedObject(fire.group, "CampfireFlameCore")).toBeInstanceOf(THREE.Mesh)
    expect(namedObject(fire.group, "CampfireEmbers")).toBeInstanceOf(THREE.Points)
    const smoke = namedObject(fire.group, "CampfireSmoke") as THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>
    expect(smoke).toBeInstanceOf(THREE.Points)
    expect(smoke.material.map).toBeInstanceOf(THREE.DataTexture)
    expect((smoke.geometry.getAttribute("position") as THREE.BufferAttribute).usage).toBe(THREE.DynamicDrawUsage)
    expect(smoke.geometry.boundingSphere?.radius).toBeGreaterThan(2)
    expect(fire.light.castShadow).toBe(false)
    expect(fire.light.distance).toBe(14)
  })

  it("animates deterministically without moving in reduced-motion mode", () => {
    const first = createCampfireVisuals()
    const second = createCampfireVisuals()
    first.update(3.25, 1)
    second.update(3.25, 1)

    const firstOuter = namedObject(first.group, "CampfireFlameOuter")
    const secondOuter = namedObject(second.group, "CampfireFlameOuter")
    expect(firstOuter.position.toArray()).toEqual(secondOuter.position.toArray())
    expect(first.light.intensity).toBe(second.light.intensity)

    first.update(0, 0)
    const staticPosition = firstOuter.position.clone()
    const staticIntensity = first.light.intensity
    const emberAttribute = (namedObject(first.group, "CampfireEmbers") as THREE.Points).geometry.getAttribute("position") as THREE.BufferAttribute
    const staticBufferVersion = emberAttribute.version
    first.update(99, 0)
    expect(firstOuter.position.toArray()).toEqual(staticPosition.toArray())
    expect(first.light.intensity).toBe(staticIntensity)
    expect(emberAttribute.version).toBe(staticBufferVersion)
  })

  it("fails closed to a finite static pose for invalid motion input", () => {
    const fire = createCampfireVisuals()
    fire.update(12, Number.NaN)

    const outer = namedObject(fire.group, "CampfireFlameOuter")
    expect([...outer.position.toArray(), ...outer.scale.toArray(), fire.light.intensity].every(Number.isFinite)).toBe(true)
    const embers = namedObject(fire.group, "CampfireEmbers") as THREE.Points
    expect([...embers.geometry.getAttribute("position").array].every(Number.isFinite)).toBe(true)
  })

  it("removes smoke and trims embers for the degraded profile", () => {
    const fire = createCampfireVisuals({ degraded: true })
    const embers = namedObject(fire.group, "CampfireEmbers") as THREE.Points

    expect(fire.group.getObjectByName("CampfireSmoke")).toBeUndefined()
    expect(embers.geometry.getAttribute("position").count).toBe(5)
    expect(fire.light.distance).toBe(10)
  })

  it("disposes owned resources exactly once", () => {
    const fire = createCampfireVisuals()
    const outer = namedObject(fire.group, "CampfireFlameOuter") as THREE.Mesh
    const stones = namedObject(fire.group, "CampfireStones") as THREE.InstancedMesh
    const geometryDispose = vi.spyOn(outer.geometry, "dispose")
    const materialDispose = vi.spyOn(outer.material as THREE.Material, "dispose")
    const instanceDispose = vi.fn()
    stones.addEventListener("dispose", instanceDispose)

    fire.dispose()
    fire.dispose()

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(instanceDispose).toHaveBeenCalledTimes(1)
  })
})
