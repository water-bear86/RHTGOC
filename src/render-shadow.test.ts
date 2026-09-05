import { describe, it, expect } from "vitest"
import * as THREE from "three"
import { fitShadowFrustum, applyShadowFrustum } from "./render-shadow"

describe("fitShadowFrustum", () => {
  it("returns a box that contains the player position", () => {
    const playerPos = { x: 12.5, z: -7.3 }
    const result = fitShadowFrustum(playerPos, 2048)

    const dx = Math.abs(result.centre.x - playerPos.x)
    const dz = Math.abs(result.centre.z - playerPos.z)
    expect(dx).toBeLessThanOrEqual(result.halfSize)
    expect(dz).toBeLessThanOrEqual(result.halfSize)
  })

  it("snaps the centre to shadow-map texels", () => {
    const mapSize = 2048
    const halfSize = 40
    const worldUnitsPerTexel = (2 * halfSize) / mapSize

    const playerPos = { x: 12.5, z: -7.3 }
    const result = fitShadowFrustum(playerPos, mapSize)

    // Centre.x and z should be integer multiples of worldUnitsPerTexel
    const snappedX = Math.round(playerPos.x / worldUnitsPerTexel) * worldUnitsPerTexel
    const snappedZ = Math.round(playerPos.z / worldUnitsPerTexel) * worldUnitsPerTexel

    expect(result.centre.x).toBeCloseTo(snappedX, 6)
    expect(result.centre.z).toBeCloseTo(snappedZ, 6)
  })

  it("produces a tight near/far range", () => {
    const result = fitShadowFrustum({ x: 0, z: 0 }, 2048)
    expect(result.near).toBe(0.5)
    expect(result.far).toBeGreaterThan(50)
    expect(result.far).toBeLessThan(120)
  })

  it("halfSize is ~40 units", () => {
    const result = fitShadowFrustum({ x: 0, z: 0 }, 2048)
    expect(result.halfSize).toBeCloseTo(40, 1)
  })
})

describe("applyShadowFrustum", () => {
  it("positions the sun relative to the player centre", () => {
    const sun = new THREE.DirectionalLight(0xffffff, 1)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.left = -75
    sun.shadow.camera.right = 75
    sun.shadow.camera.top = 75
    sun.shadow.camera.bottom = -75
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 150
    sun.target.position.set(0, 0, 0)
    sun.target.updateMatrixWorld()

    const playerPos = { x: 10, z: -5 }
    applyShadowFrustum(sun, playerPos)

    // Sun position should be offset from the player centre
    const fit = fitShadowFrustum(playerPos, 2048)
    expect(sun.position.x).toBeCloseTo(fit.centre.x + -18, 4)
    expect(sun.position.y).toBeCloseTo(fit.centre.y + 28, 4)
    expect(sun.position.z).toBeCloseTo(fit.centre.z + 14, 4)

    // Target should be at the centre
    expect(sun.target.position.x).toBeCloseTo(fit.centre.x, 4)
    expect(sun.target.position.z).toBeCloseTo(fit.centre.z, 4)

    // Camera frustum should be updated
    expect(sun.shadow.camera.left).toBeCloseTo(-fit.halfSize, 4)
    expect(sun.shadow.camera.right).toBeCloseTo(fit.halfSize, 4)
    expect(sun.shadow.camera.near).toBeCloseTo(0.5, 4)
  })
})
