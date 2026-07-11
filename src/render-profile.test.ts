import { describe, expect, it } from "vitest"
import { chooseRenderProfile } from "./render-profile"

describe("render profile", () => {
  it("caps high-density displays for stable browser cost", () => {
    expect(chooseRenderProfile({ maxTextureSize: 8192, maxTextures: 32, devicePixelRatio: 3, reducedMotion: false })).toEqual({
      tier: "standard", pixelRatio: 1.75, shadows: true, motionScale: 1,
    })
  })

  it("disables expensive shadows on degraded GPUs", () => {
    expect(chooseRenderProfile({ maxTextureSize: 2048, maxTextures: 8, devicePixelRatio: 2, reducedMotion: false })).toEqual({
      tier: "degraded", pixelRatio: 1, shadows: false, motionScale: 1,
    })
  })

  it("honors reduced motion independently of GPU tier", () => {
    expect(chooseRenderProfile({ maxTextureSize: 8192, maxTextures: 32, devicePixelRatio: 1, reducedMotion: true }).motionScale).toBe(0)
  })
})
