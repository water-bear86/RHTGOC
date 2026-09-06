import { describe, expect, it } from "vitest"
import { hashSeed, roundedRectPath } from "./rough-ui"

describe("hashSeed", () => {
  it("is deterministic and stays in RoughJS's positive seed range", () => {
    for (const key of ["intro-card", "panel", "status", ""]) {
      const a = hashSeed(key)
      expect(a).toBe(hashSeed(key))
      expect(a).toBeGreaterThanOrEqual(1)
      expect(a).toBeLessThanOrEqual(65535)
    }
  })

  it("separates different keys", () => {
    expect(hashSeed("a")).not.toBe(hashSeed("b"))
  })
})

describe("roundedRectPath", () => {
  const uniform = (r: number) => [r, r] as const

  it("emits a closed rounded rectangle with one arc per corner", () => {
    const c = uniform(16)
    const d = roundedRectPath(4, 4, 200, 120, c, c, c, c)
    expect(d.startsWith("M")).toBe(true)
    expect(d.trim().endsWith("Z")).toBe(true)
    expect((d.match(/A/g) ?? [])).toHaveLength(4)
  })

  it("clamps each corner radius per axis (rx to half width, ry to half height)", () => {
    const c = uniform(999)
    const d = roundedRectPath(0, 0, 40, 10, c, c, c, c)
    // rx clamped to 20 (half width), ry to 5 (half height): "A20,5"
    expect(d).toContain("A20,5")
  })

  it("supports a different elliptical radius per corner", () => {
    const d = roundedRectPath(0, 0, 100, 50, [10, 8], [4, 4], [0, 0], [20, 6])
    expect(d).toContain("A10,8")
    expect(d).toContain("A4,4")
    expect(d.trim().endsWith("Z")).toBe(true)
  })
})
