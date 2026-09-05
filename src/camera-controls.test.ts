import { describe, expect, it } from "vitest"
import {
  cameraQuarterTurnsForRoute,
  cameraRelativeMove,
  characterCoveredByScenery,
  rotateCameraOffset,
} from "./camera-controls"

function expectVector(actual: { x: number; z: number }, expected: { x: number; z: number }): void {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.z).toBeCloseTo(expected.z, 6)
}

describe("camera controls", () => {
  it("rotates the camera offset in exact quarter turns", () => {
    const offset = { x: 12, z: 16 }
    expectVector(rotateCameraOffset(offset, 0), { x: 12, z: 16 })
    expectVector(rotateCameraOffset(offset, 1), { x: 16, z: -12 })
    expectVector(rotateCameraOffset(offset, 2), { x: -12, z: -16 })
    expectVector(rotateCameraOffset(offset, 3), { x: -16, z: 12 })
    expectVector(rotateCameraOffset(offset, 4), offset)
  })

  it("keeps W toward the top of the view at every camera heading", () => {
    const focus = { x: 0, z: 0 }
    for (let heading = 0; heading < 4; heading += 1) {
      const camera = rotateCameraOffset({ x: 12, z: 16 }, heading)
      const movement = cameraRelativeMove({ x: 0, z: -1 }, camera, focus)
      const cameraForward = { x: -camera.x / 20, z: -camera.z / 20 }
      expectVector(movement, cameraForward)
    }
  })

  it("keeps D to the right of the view and preserves diagonal magnitude", () => {
    expectVector(cameraRelativeMove({ x: 1, z: 0 }, { x: 0, z: 10 }, { x: 0, z: 0 }), { x: 1, z: 0 })
    const diagonal = cameraRelativeMove({ x: 1, z: -1 }, { x: 0, z: 10 }, { x: 0, z: 0 })
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(Math.SQRT2, 6)
  })

  it("opens each generated mission with its first route ahead of the player", () => {
    const offset = { x: 12, z: 16 }
    for (const route of [
      { x: 1, z: 0 },
      { x: -1, z: 0 },
      { x: 0, z: 1 },
      { x: 0, z: -1 },
    ]) {
      const heading = cameraQuarterTurnsForRoute(offset, route)
      const camera = rotateCameraOffset(offset, heading)
      expect((-camera.x * route.x - camera.z * route.z) / Math.hypot(camera.x, camera.z))
        .toBeGreaterThan(0.7)
    }
  })

  it("silhouettes a character when nearby cover crosses the sightline", () => {
    const base = {
      camera: { x: 0, z: 10 },
      focus: { x: 0, z: 0 },
      radius: 0.8,
    }
    expect(characterCoveredByScenery({ ...base, occluder: { x: 0.3, z: 0.4 } })).toBe(true)
    expect(characterCoveredByScenery({ ...base, occluder: { x: 1.0, z: 1.0 } })).toBe(false)
  })

  it("does not silhouette when a distant wide crown only clips the sightline", () => {
    expect(characterCoveredByScenery({
      camera: { x: 0, z: 10 },
      focus: { x: 0, z: 0 },
      occluder: { x: 0.5, z: 5 },
      radius: 1.2,
    })).toBe(false)
  })

  it("does not silhouette a character standing inside a canopy they have reached", () => {
    expect(characterCoveredByScenery({
      camera: { x: 0, z: 10 },
      focus: { x: 0, z: 0 },
      occluder: { x: 0.4, z: -1.4 },
      radius: 2,
    })).toBe(false)
  })

  it("does not silhouette for scenery beside the character or behind the camera", () => {
    expect(characterCoveredByScenery({
      camera: { x: 0, z: 10 },
      focus: { x: 0, z: 0 },
      occluder: { x: 2.2, z: 0.5 },
      radius: 1.5,
    })).toBe(false)
    expect(characterCoveredByScenery({
      camera: { x: 0, z: 10 },
      focus: { x: 0, z: 0 },
      occluder: { x: 0, z: 12 },
      radius: 3,
    })).toBe(false)
  })

  it("counts a crown that overhangs the character's body from the camera side", () => {
    expect(characterCoveredByScenery({
      camera: { x: 0, z: 10 },
      focus: { x: 0, z: 0 },
      occluder: { x: 0, z: 0.4 },
      radius: 0.6,
    })).toBe(true)
  })

  it("does not silhouette when the occluder disc is offset laterally past its radius", () => {
    expect(characterCoveredByScenery({
      camera: { x: 0, z: 10 },
      focus: { x: 0, z: 0 },
      occluder: { x: 0.9, z: 1.2 },
      radius: 0.8,
    })).toBe(false)
  })

  it("does not occlude when the camera and focus coincide", () => {
    expect(characterCoveredByScenery({
      camera: { x: 2, z: 2 },
      focus: { x: 2, z: 2 },
      occluder: { x: 2, z: 2 },
      radius: 4,
    })).toBe(false)
  })

  it("does not silhouette when the 3D sightline passes above the occluder", () => {
    expect(characterCoveredByScenery({
      camera: { x: 0, z: 10 },
      focus: { x: 0, z: 0 },
      occluder: { x: 0, z: 5 },
      radius: 1.5,
      cameraHeight: 14.5,
      focusHeight: 0.9,
      occluderBaseHeight: 0,
      occluderHeight: 5,
    })).toBe(false)
  })

  it("silhouettes when the 3D sightline passes through the occluder's vertical extent", () => {
    expect(characterCoveredByScenery({
      camera: { x: 0, z: 10 },
      focus: { x: 0, z: 0 },
      occluder: { x: 0, z: 0.8 },
      radius: 1.5,
      cameraHeight: 14.5,
      focusHeight: 0.9,
      occluderBaseHeight: 0,
      occluderHeight: 5,
    })).toBe(true)
  })
})
