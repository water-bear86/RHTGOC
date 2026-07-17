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
        if (note.endFrequency !== undefined) {
          expect(note.endFrequency).toBeGreaterThanOrEqual(20)
          expect(note.endFrequency).toBeLessThanOrEqual(20_000)
        }
        expect(note.delay).toBeGreaterThanOrEqual(0)
        expect(note.duration).toBeGreaterThan(0)
        expect(note.level).toBeGreaterThan(0)
        expect(note.level).toBeLessThanOrEqual(0.2)
      }
      for (const noise of cue.noise ?? []) {
        expect(noise.frequency).toBeGreaterThanOrEqual(20)
        expect(noise.frequency).toBeLessThanOrEqual(20_000)
        expect(noise.delay).toBeGreaterThanOrEqual(0)
        expect(noise.duration).toBeGreaterThan(0)
        expect(noise.level).toBeGreaterThan(0)
        expect(noise.level).toBeLessThanOrEqual(0.2)
      }
      expect(cue.pitchVariation ?? 0).toBeGreaterThanOrEqual(0)
      expect(cue.pitchVariation ?? 0).toBeLessThanOrEqual(0.2)
    }
  })

  it("gives every declared mission action a unique layered signature", () => {
    const actionIds = AUDIO_CUE_IDS.filter((id) => id.startsWith("action.") || id.startsWith("world."))
    const signatures = actionIds.map((id) => JSON.stringify(AUDIO_CUES[id]))
    expect(actionIds.length).toBeGreaterThanOrEqual(10)
    expect(new Set(signatures).size).toBe(actionIds.length)
    expect(actionIds.every((id) => (AUDIO_CUES[id].noise?.length ?? 0) > 0 || AUDIO_CUES[id].notes.length > 1)).toBe(true)
  })

  it("keeps all five band signals perceptually distinct", () => {
    const signatures = AUDIO_CUE_IDS
      .filter((id) => id.startsWith("ping."))
      .map((id) => AUDIO_CUES[id].notes.map((note) => `${note.frequency}:${note.delay}:${note.duration}`).join("|"))
    expect(new Set(signatures).size).toBe(5)
  })
})
