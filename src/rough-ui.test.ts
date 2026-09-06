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
  it("emits a closed rounded rectangle with arcs", () => {
    const d = roundedRectPath(4, 4, 200, 120, 16)
    expect(d.startsWith("M")).toBe(true)
    expect(d.trim().endsWith("Z")).toBe(true)
    expect((d.match(/A/g) ?? [])).toHaveLength(4)
  })

  it("clamps the radius to half the smaller side", () => {
    const d = roundedRectPath(0, 0, 40, 10, 999)
    // radius clamped to 5 (half of height); the arc radius appears as "A5,5"
    expect(d).toContain("A5,5")
  })

  it("degrades to a plain rectangle when the radius is zero", () => {
    const d = roundedRectPath(0, 0, 100, 50, 0)
    expect(d).not.toContain("A")
    expect(d.trim().endsWith("Z")).toBe(true)
  })
})
