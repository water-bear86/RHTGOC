import { describe, expect, it } from "vitest"
import {
  SHERWOOD_PASSES,
  isSherwoodTopologySegmentBlocked,
  routeThroughSherwoodPasses,
  sherwoodTopologyHeightAt,
} from "./world-topology"

describe("shared Sherwood topography", () => {
  it("routes cross-ridge travel through a named clear pass", () => {
    const route = routeThroughSherwoodPasses({ x: -50, z: -40 }, { x: 4, z: -20 }, 2.1)
    expect(route.passIds).toContain("oak-south-pass")
    expect(route.points.length).toBeGreaterThan(2)
    expect(route.points.slice(1).every((point, index) => (
      !isSherwoodTopologySegmentBlocked(route.points[index], point, 2.1)
    ))).toBe(true)
  })

  it("keeps named passes visibly below their surrounding ridge crests", () => {
    const pass = SHERWOOD_PASSES.find((candidate) => candidate.id === "hart-south-pass")!
    const passHeight = sherwoodTopologyHeightAt(pass.position.x, pass.position.z)
    const crestHeight = sherwoodTopologyHeightAt(27.5, -30)
    expect(crestHeight - passHeight).toBeGreaterThan(2)
  })

  it("recovers a finite neutral height for invalid samples", () => {
    expect(sherwoodTopologyHeightAt(Number.NaN, Number.POSITIVE_INFINITY)).toBe(0)
  })
})
