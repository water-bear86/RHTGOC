import { describe, expect, it } from "vitest"
import {
  DEFAULT_AUDIO_SETTINGS,
  copyAudioSettings,
  loadAudioSettings,
  saveAudioSettings,
} from "./audio-settings"

function memoryStorage(seed: string | null = null) {
  let value = seed
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next },
    value: () => value,
  }
}

describe("audio settings", () => {
  it("uses independent safe defaults for corrupt storage", () => {
    const settings = loadAudioSettings(memoryStorage("not-json"))
    expect(settings).toEqual(DEFAULT_AUDIO_SETTINGS)
    settings.levels.music = 0
    expect(DEFAULT_AUDIO_SETTINGS.levels.music).toBe(0.72)
  })

  it("sanitizes levels, output preset, and mono preference", () => {
    const settings = loadAudioSettings(memoryStorage(JSON.stringify({
      levels: { master: 4, music: -2, ambience: Number.NaN, sfx: 0.45 },
      dynamicRange: "night",
      mono: true,
    })))
    expect(settings.levels.master).toBe(1)
    expect(settings.levels.music).toBe(0)
    expect(settings.levels.ambience).toBe(DEFAULT_AUDIO_SETTINGS.levels.ambience)
    expect(settings.levels.sfx).toBe(0.45)
    expect(settings.dynamicRange).toBe("night")
    expect(settings.mono).toBe(true)
  })

  it("round-trips a defensive copy", () => {
    const storage = memoryStorage()
    const settings = copyAudioSettings()
    settings.levels.ui = 0.2
    settings.dynamicRange = "tv"
    saveAudioSettings(storage, settings)
    expect(loadAudioSettings(storage)).toEqual(settings)
  })
})

