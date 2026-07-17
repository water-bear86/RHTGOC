import { describe, expect, it } from "vitest"
import { cueForPing, presentationForMissionEvent } from "./gameplay-presentation"

describe("gameplay presentation", () => {
  it("reserves urgent warning cues for meaningful threats", () => {
    expect(presentationForMissionEvent("player_seized")).toMatchObject({
      channel: "threat",
      priority: "critical",
      cue: "action.player-hit",
    })
  })

  it("distinguishes objective progress, rewards, and routine action feedback", () => {
    expect(presentationForMissionEvent("cart_robbed")).toMatchObject({
      channel: "objective",
      priority: "important",
      cue: "world.cart-robbed",
    })
    expect(presentationForMissionEvent("mission_succeeded")).toMatchObject({
      channel: "reward",
      priority: "critical",
      cue: "world.victory",
    })
    expect(presentationForMissionEvent("guard_stunned")).toEqual({
      channel: "action",
      priority: "routine",
      cue: "action.guard-stunned",
    })
  })

  it("uses world-specific cues for mission-critical interactions", () => {
    expect(presentationForMissionEvent("alarm_triggered").cue).toBe("world.alarm")
    expect(presentationForMissionEvent("reinforcement_arrived").cue).toBe("world.reinforcement")
    expect(presentationForMissionEvent("lock_breached").cue).toBe("world.lock-break")
    expect(presentationForMissionEvent("cache_looted").cue).toBe("world.cache-open")
    expect(presentationForMissionEvent("loot_delivered").cue).toBe("world.coin-delivered")
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
