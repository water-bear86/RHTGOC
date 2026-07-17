import { describe, expect, it } from "vitest"
import { AUDIO_CUES, AUDIO_CUE_IDS } from "./audio-cues"

describe("semantic audio cues", () => {
  it("defines every stable cue id with safe procedural notes", () => {
    expect(Object.keys(AUDIO_CUES).sort()).toEqual([...AUDIO_CUE_IDS].sort())
    for (const cue of Object.values(AUDIO_CUES)) {
      expect(["music", "ambience", "sfx", "ui", "voice"]).toContain(cue.bus)
      expect(cue.notes.length).toBeGreaterThan(0)
      for (const note of cue.notes) {
        expect(note.frequency).toBeGreaterThanOrEqual(20)
        expect(note.frequency).toBeLessThanOrEqual(20_000)
        expect(note.delay).toBeGreaterThanOrEqual(0)
        expect(note.duration).toBeGreaterThan(0)
        expect(note.level).toBeGreaterThan(0)
        expect(note.level).toBeLessThanOrEqual(0.2)
      }
    }
  })

  it("keeps all five band signals perceptually distinct", () => {
    const signatures = AUDIO_CUE_IDS
      .filter((id) => id.startsWith("ping."))
      .map((id) => AUDIO_CUES[id].notes.map((note) => `${note.frequency}:${note.delay}:${note.duration}`).join("|"))
    expect(new Set(signatures).size).toBe(5)
  })
})

