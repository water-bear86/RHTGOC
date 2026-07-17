import { describe, expect, it } from "vitest"
import { cueForPing, presentationForMissionEvent } from "./gameplay-presentation"

describe("gameplay presentation", () => {
  it("reserves urgent warning cues for meaningful threats", () => {
    expect(presentationForMissionEvent("player_downed")).toMatchObject({
      channel: "threat",
      priority: "critical",
      cue: "ui.warning",
    })
    expect(presentationForMissionEvent("player_hit")).toMatchObject({
      channel: "threat",
      priority: "important",
      cue: "ui.warning",
    })
  })

  it("distinguishes objective progress, rewards, and routine action feedback", () => {
    expect(presentationForMissionEvent("cart_robbed")).toMatchObject({
      channel: "objective",
      priority: "important",
      cue: "ui.notice",
    })
    expect(presentationForMissionEvent("mission_succeeded")).toMatchObject({
      channel: "reward",
      priority: "critical",
      cue: "ui.confirm",
    })
    expect(presentationForMissionEvent("guard_stunned")).toEqual({
      channel: "action",
      priority: "routine",
    })
  })

  it("provides a distinct semantic cue for every co-op ping", () => {
    expect((["danger", "target", "route", "loot", "regroup"] as const).map(cueForPing)).toEqual([
      "ping.danger",
      "ping.target",
      "ping.route",
      "ping.loot",
      "ping.regroup",
    ])
  })
})
