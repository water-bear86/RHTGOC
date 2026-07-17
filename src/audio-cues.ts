import type { AudioBusId } from "./audio-settings"

export const AUDIO_CUE_IDS = [
  "ui.confirm",
  "ui.notice",
  "ui.warning",
  "ping.danger",
  "ping.target",
  "ping.route",
  "ping.loot",
  "ping.regroup",
] as const

export type AudioCueId = typeof AUDIO_CUE_IDS[number]

export interface CueNote {
  frequency: number
  delay: number
  duration: number
  level: number
  wave: OscillatorType
}

export interface AudioCueDefinition {
  bus: Exclude<AudioBusId, "master">
  notes: readonly CueNote[]
}

export const AUDIO_CUES: Record<AudioCueId, AudioCueDefinition> = {
  "ui.confirm": {
    bus: "ui",
    notes: [
      { frequency: 659.25, delay: 0, duration: 0.08, level: 0.12, wave: "sine" },
      { frequency: 880, delay: 0.07, duration: 0.11, level: 0.1, wave: "sine" },
    ],
  },
  "ui.notice": {
    bus: "ui",
    notes: [{ frequency: 523.25, delay: 0, duration: 0.12, level: 0.09, wave: "triangle" }],
  },
  "ui.warning": {
    bus: "ui",
    notes: [
      { frequency: 293.66, delay: 0, duration: 0.1, level: 0.12, wave: "triangle" },
      { frequency: 220, delay: 0.1, duration: 0.16, level: 0.11, wave: "triangle" },
    ],
  },
  "ping.danger": {
    bus: "sfx",
    notes: [
      { frequency: 523.25, delay: 0, duration: 0.09, level: 0.14, wave: "square" },
      { frequency: 349.23, delay: 0.09, duration: 0.13, level: 0.12, wave: "square" },
    ],
  },
  "ping.target": {
    bus: "sfx",
    notes: [{ frequency: 783.99, delay: 0, duration: 0.16, level: 0.12, wave: "triangle" }],
  },
  "ping.route": {
    bus: "sfx",
    notes: [
      { frequency: 392, delay: 0, duration: 0.1, level: 0.1, wave: "sine" },
      { frequency: 587.33, delay: 0.08, duration: 0.14, level: 0.11, wave: "sine" },
    ],
  },
  "ping.loot": {
    bus: "sfx",
    notes: [
      { frequency: 987.77, delay: 0, duration: 0.07, level: 0.09, wave: "triangle" },
      { frequency: 1318.51, delay: 0.06, duration: 0.1, level: 0.08, wave: "triangle" },
    ],
  },
  "ping.regroup": {
    bus: "sfx",
    notes: [
      { frequency: 392, delay: 0, duration: 0.1, level: 0.09, wave: "sine" },
      { frequency: 493.88, delay: 0.09, duration: 0.1, level: 0.09, wave: "sine" },
      { frequency: 587.33, delay: 0.18, duration: 0.16, level: 0.1, wave: "sine" },
    ],
  },
}

