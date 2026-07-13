import { describe, expect, it } from "vitest"
import type { MissionObjectiveState } from "./mission-objective"
import { missionObjectivePosition } from "./mission-objective"

function missionState(missionKind: MissionObjectiveState["missionKind"]): MissionObjectiveState {
  return {
    missionKind,
    layout: { objectivePosition: { x: 12, z: -8 } },
    cartPosition: { x: -31, z: 24 },
  }
}

describe("mission objective position", () => {
  it("tracks the moving prison wagon", () => {
    expect(missionObjectivePosition(missionState("prison-wagon"))).toEqual({ x: -31, z: 24 })
  })

  it.each(["tax-cart", "storehouse"] as const)("keeps the %s objective at its regional anchor", (missionKind) => {
    expect(missionObjectivePosition(missionState(missionKind))).toEqual({ x: 12, z: -8 })
  })
})
