import { describe, expect, it } from "vitest"
import { SHERWOOD_PASSES, SHERWOOD_RIDGE_SEGMENTS, SHERWOOD_SETTLEMENT_SITES } from "../shared/world-topology"
import {
  SHERWOOD_BRIDGE_DECK_Y,
  SHERWOOD_BRIDGE_ROTATION,
  SHERWOOD_BRIDGE_WIDTH,
  createSherwoodTerrain,
  sherwoodHeightAt,
  sherwoodWalkableHeightAt,
} from "./sherwood-terrain"

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

  it("uses the bridge deck as the visual standing surface only inside its rotated footprint", () => {
    const crossing = { x: 1, z: 0 }
    const layout = { crossingPositions: [crossing, { x: -2, z: 30 }] as const }
    const cosine = Math.cos(SHERWOOD_BRIDGE_ROTATION)
    const sine = Math.sin(SHERWOOD_BRIDGE_ROTATION)
    const onDeck = {
      x: crossing.x + cosine * 3,
      z: crossing.z - sine * 3,
    }
    const beyondSide = {
      x: crossing.x + sine * (SHERWOOD_BRIDGE_WIDTH / 2 + 0.1),
      z: crossing.z + cosine * (SHERWOOD_BRIDGE_WIDTH / 2 + 0.1),
    }

    expect(sherwoodWalkableHeightAt(crossing.x, crossing.z, layout)).toBe(SHERWOOD_BRIDGE_DECK_Y)
    expect(sherwoodWalkableHeightAt(onDeck.x, onDeck.z, layout)).toBe(SHERWOOD_BRIDGE_DECK_Y)
    expect(sherwoodWalkableHeightAt(beyondSide.x, beyondSide.z, layout)).toBe(
      sherwoodHeightAt(beyondSide.x, beyondSide.z),
    )
  })

  it("renders steep shared ridges, cut passes, and level settlement terraces", () => {
    const ridge = SHERWOOD_RIDGE_SEGMENTS.find((candidate) => candidate.id === "oak-ridge-middle")!
    const ridgeCenter = { x: (ridge.start.x + ridge.end.x) / 2, z: (ridge.start.z + ridge.end.z) / 2 }
    const ridgeHeight = sherwoodHeightAt(ridgeCenter.x, ridgeCenter.z)
    const lowSideHeight = sherwoodHeightAt(ridgeCenter.x + 12, ridgeCenter.z)
    const pass = SHERWOOD_PASSES.find((candidate) => candidate.id === "oak-south-pass")!
    const terrace = SHERWOOD_SETTLEMENT_SITES[0]

    expect(ridgeHeight - lowSideHeight).toBeGreaterThan(3)
    expect(sherwoodHeightAt(pass.position.x, pass.position.z)).toBeLessThan(ridgeHeight - 3)
    expect(sherwoodHeightAt(terrace.center.x + 7, terrace.center.z)).toBeCloseTo(
      sherwoodHeightAt(terrace.center.x, terrace.center.z),
      5,
    )
  })
})
