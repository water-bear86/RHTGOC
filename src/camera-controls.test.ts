import { describe, expect, it } from "vitest"
import { blocksCameraSightline, cameraRelativeMove, rotateCameraOffset } from "./camera-controls"

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

  it("identifies scenery inside the padded camera-to-player corridor", () => {
    const base = {
      camera: { x: 0, z: 10 },
      focus: { x: 0, z: 0 },
      radius: 0.8,
    }
    expect(blocksCameraSightline({ ...base, occluder: { x: 1.3, z: 4 } })).toBe(true)
    expect(blocksCameraSightline({ ...base, occluder: { x: 1.6, z: 4 } })).toBe(false)
  })

  it("catches crowns just behind the player but preserves distant scenery", () => {
    const base = {
      camera: { x: 0, z: 10 },
      focus: { x: 0, z: 0 },
      radius: 0.9,
    }
    expect(blocksCameraSightline({ ...base, occluder: { x: 0.4, z: -0.5 } })).toBe(true)
    expect(blocksCameraSightline({ ...base, occluder: { x: 0, z: -2 } })).toBe(false)
    expect(blocksCameraSightline({ ...base, occluder: { x: 0, z: 11 } })).toBe(false)
  })

  it("does not occlude when the camera and focus coincide", () => {
    expect(blocksCameraSightline({
      camera: { x: 2, z: 2 },
      focus: { x: 2, z: 2 },
      occluder: { x: 2, z: 2 },
      radius: 4,
    })).toBe(false)
  })
})
