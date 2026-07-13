import { describe, expect, it } from "vitest"
import { createSherwoodWater } from "./water"

describe("Sherwood water surface", () => {
  it("layers an opaque river bed below a transparent animated surface", () => {
    const water = createSherwoodWater()
    expect(water.group.name).toBe("SherwoodRiver")
    expect(water.group.children.map((child) => child.name)).toEqual(["RiverBed", "AnimatedWaterSurface"])
    expect(water.surface.material.transparent).toBe(true)
    expect(water.surface.material.depthWrite).toBe(false)
    expect(water.surface.geometry.getAttribute("position").count).toBeGreaterThan(1_000)
  })

  it("updates time while clamping reduced-motion intensity", () => {
    const water = createSherwoodWater()
    water.update(12.5, 4)
    expect(water.surface.material.uniforms.uTime.value).toBe(12.5)
    expect(water.surface.material.uniforms.uMotion.value).toBe(1)
    water.update(13, -2)
    expect(water.surface.material.uniforms.uMotion.value).toBe(0)
  })
})
