import { describe, expect, it } from "vitest"
import { createSherwoodTerrain, sherwoodHeightAt } from "./sherwood-terrain"

describe("Sherwood terrain", () => {
  it("creates readable elevation while preserving a low river valley", () => {
    const samples = Array.from({ length: 11 }, (_, index) => sherwoodHeightAt(-50 + index * 10, 32))
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(2)
    expect(sherwoodHeightAt(1, 0)).toBeLessThan(0)
  })

  it("builds a bounded heightfield mesh", () => {
    const terrain = createSherwoodTerrain(134, 24)
    expect(terrain.name).toBe("SherwoodTopography")
    expect(terrain.geometry.boundingBox).toBeTruthy()
  })
})
