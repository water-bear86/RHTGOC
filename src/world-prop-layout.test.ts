import { describe, expect, it } from "vitest"
import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import { regionalizeFeasibleMissionDefinition } from "../shared/regional-map-generator"
import { composeSherwoodWorld } from "../shared/world-composer"
import { createMedievalPropLayout } from "./world-prop-layout"

describe("composed medieval prop layout", () => {
  it("creates one restrained vignette per settlement instead of global scatter", () => {
    const layout = regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, 4219).layout
    const world = composeSherwoodWorld(layout)
    const props = createMedievalPropLayout(world)

    expect(props).toHaveLength(world.settlements.length * 3)
    for (const settlement of world.settlements) {
      const local = props.filter((prop) => prop.settlementId === settlement.id)
      expect(local).toHaveLength(3)
      expect(local.every((prop) => (
        Math.hypot(
          prop.position.x - settlement.center.x,
          prop.position.z - settlement.center.z,
        ) < 6
      ))).toBe(true)
    }
  })

  it("moves every vignette with its generated settlement street", () => {
    const firstWorld = composeSherwoodWorld(
      regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, 4219).layout,
    )
    const secondWorld = composeSherwoodWorld(
      regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, 7919).layout,
    )
    expect(createMedievalPropLayout(secondWorld)).not.toEqual(createMedievalPropLayout(firstWorld))
  })
})
