import { describe, expect, it } from "vitest"
import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import { regionalizeMissionDefinition } from "../shared/regional-layout"
import { composeSherwoodWorld } from "../shared/world-composer"
import { createSettlementWorld } from "./settlement-renderer"

describe("settlement renderer", () => {
  it("renders every composed building and blind-spot layer", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 818).layout
    const composed = composeSherwoodWorld(layout)
    const rendered = createSettlementWorld(composed)
    expect(rendered.getObjectByName("SherwoodBlindSpots")).toBeTruthy()
    for (const building of composed.settlements.flatMap((settlement) => settlement.buildings)) {
      expect(rendered.getObjectByName(building.id)).toBeTruthy()
    }
  })
})
