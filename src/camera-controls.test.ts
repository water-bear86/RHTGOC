import { describe, expect, it } from "vitest"
import { cameraRelativeMove, rotateCameraOffset } from "./camera-controls"

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
})
