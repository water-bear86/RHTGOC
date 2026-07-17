import { describe, expect, it } from "vitest"
import { MUSIC_TRACKS, musicStateForSituation } from "./music-state"

describe("adaptive music state", () => {
  it("moves from stealth into proximity and pursuit layers", () => {
    const base = { running: true, inHub: false, outcome: "active" as const, phase: "scout" as const }
    expect(musicStateForSituation({ ...base, threatLevel: 0 })).toBe("stealth")
    expect(musicStateForSituation({ ...base, threatLevel: 2 })).toBe("enemy-near")
    expect(musicStateForSituation({ ...base, threatLevel: 3 })).toBe("pursuit")
  })

  it("uses authored action and resolution cues for decisive phases", () => {
    expect(musicStateForSituation({
      running: true,
      inHub: false,
      outcome: "active",
      phase: "robbery",
      threatLevel: 0,
    })).toBe("duel")
    expect(musicStateForSituation({
      running: true,
      inHub: false,
      outcome: "succeeded",
      phase: "extraction",
      threatLevel: 3,
    })).toBe("victory")
  })

  it("ships a lazy-loadable browser asset for every state", () => {
    expect(Object.keys(MUSIC_TRACKS)).toEqual([
      "exploration",
      "stealth",
      "enemy-near",
      "pursuit",
      "duel",
      "victory",
    ])
    expect(Object.values(MUSIC_TRACKS).every((url) => url.endsWith(".m4a"))).toBe(true)
  })
})
