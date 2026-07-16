import { describe, expect, it } from "vitest"
import type { MissionKind } from "../shared/protocol"
import type { CharacterId } from "./simulation"
import { ALL_TUTORIAL_LESSONS, CHARACTER_LESSONS, FIELDCRAFT_LESSON, MISSION_LESSONS, TACTICAL_TIPS, buildTutorialPlan } from "./tutorial-content"

const characters: CharacterId[] = ["robin", "marian", "little-john", "much"]
const missions: MissionKind[] = ["tax-cart", "prison-wagon", "storehouse"]

describe("tutorial content planning", () => {
  it("covers every character and mission pairing with a tactical tip", () => {
    for (const character of characters) for (const mission of missions) {
      expect(TACTICAL_TIPS[`${character}:${mission}`]).toBeDefined()
      expect(buildTutorialPlan(character, mission)?.tacticalTip.id).toBe(`${character}:${mission}`)
    }
    expect(Object.keys(TACTICAL_TIPS)).toHaveLength(12)
    expect(new Set(ALL_TUTORIAL_LESSONS.map((lesson) => lesson.moduleId)).size).toBe(8)
  })

  it("returns only independently missing modules", () => {
    const plan = buildTutorialPlan("marian", "storehouse", {
      fieldcraft: FIELDCRAFT_LESSON.revision,
      "character:marian": CHARACTER_LESSONS.marian.revision,
    })
    expect(plan?.moduleIds).toEqual(["mission:storehouse"])
    expect(plan?.lessons).toEqual([MISSION_LESSONS.storehouse])
  })

  it("returns no plan once the current axes are complete", () => {
    expect(buildTutorialPlan("robin", "tax-cart", {
      fieldcraft: FIELDCRAFT_LESSON.revision,
      "character:robin": CHARACTER_LESSONS.robin.revision,
      "mission:tax-cart": MISSION_LESSONS["tax-cart"].revision,
    })).toBeNull()
  })

  it("teaches all five area signals in the universal fieldcraft lesson", () => {
    expect(FIELDCRAFT_LESSON.body).toMatch(/Dark sectors are unsearched/)
    expect(FIELDCRAFT_LESSON.body).toMatch(/Stand still while loading every bow shot/)
    expect(FIELDCRAFT_LESSON.points).toHaveLength(5)
    expect(FIELDCRAFT_LESSON.points.join(" ")).toMatch(/1 .*DANGER.*2 .*TARGET.*3 .*ROUTE.*4 .*LOOT.*5 .*REGROUP/)
  })
})
