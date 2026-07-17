import { describe, expect, it } from "vitest"
import { AudioDirector, dynamicRangeProfile } from "./audio-director"
import { DEFAULT_AUDIO_SETTINGS } from "./audio-settings"

describe("audio director", () => {
  it("makes dynamic range progressively tighter for TV and Night modes", () => {
    const headphones = dynamicRangeProfile("headphones")
    const tv = dynamicRangeProfile("tv")
    const night = dynamicRangeProfile("night")
    expect(tv.threshold).toBeLessThan(headphones.threshold)
    expect(tv.ratio).toBeGreaterThan(headphones.ratio)
    expect(night.threshold).toBeLessThan(tv.threshold)
    expect(night.ratio).toBeGreaterThan(tv.ratio)
  })

  it("does not construct an AudioContext before a user unlock", () => {
    let calls = 0
    const director = new AudioDirector(DEFAULT_AUDIO_SETTINGS, () => {
      calls += 1
      throw new Error("should not construct")
    })
    expect(director.state).toBe("uninitialized")
    expect(director.playCue("ui.notice")).toBe(false)
    expect(calls).toBe(0)
  })
})

