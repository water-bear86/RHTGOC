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
  "action.bow-draw",
  "action.bow-release",
  "action.arrow-impact",
  "action.guard-stunned",
  "action.player-hit",
  "action.trap-triggered",
  "world.alarm",
  "world.reinforcement",
  "world.lock-break",
  "world.cache-open",
  "world.cart-robbed",
  "world.coin-delivered",
  "world.victory",
  "movement.footstep-grass",
  "movement.footstep-road",
] as const

export type AudioCueId = typeof AUDIO_CUE_IDS[number]

export interface CueNote {
  frequency: number
  endFrequency?: number
  delay: number
  duration: number
  level: number
  wave: OscillatorType
}

export interface CueNoise {
  delay: number
  duration: number
  level: number
  filter: BiquadFilterType
  frequency: number
  q?: number
}

export interface AudioCueDefinition {
  bus: Exclude<AudioBusId, "master">
  notes: readonly CueNote[]
  noise?: readonly CueNoise[]
  pitchVariation?: number
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
  "action.bow-draw": {
    bus: "sfx",
    pitchVariation: 0.025,
    notes: [
      { frequency: 154, endFrequency: 238, delay: 0, duration: 0.24, level: 0.055, wave: "triangle" },
      { frequency: 308, endFrequency: 468, delay: 0.04, duration: 0.2, level: 0.025, wave: "sine" },
    ],
    noise: [
      { delay: 0.01, duration: 0.18, level: 0.018, filter: "bandpass", frequency: 1_450, q: 2.2 },
    ],
  },
  "action.bow-release": {
    bus: "sfx",
    pitchVariation: 0.045,
    notes: [
      { frequency: 420, endFrequency: 92, delay: 0, duration: 0.15, level: 0.09, wave: "sawtooth" },
      { frequency: 840, endFrequency: 180, delay: 0, duration: 0.09, level: 0.035, wave: "triangle" },
    ],
    noise: [
      { delay: 0, duration: 0.07, level: 0.055, filter: "highpass", frequency: 1_800 },
    ],
  },
  "action.arrow-impact": {
    bus: "sfx",
    pitchVariation: 0.08,
    notes: [
      { frequency: 145, endFrequency: 68, delay: 0, duration: 0.13, level: 0.08, wave: "triangle" },
    ],
    noise: [
      { delay: 0, duration: 0.065, level: 0.075, filter: "bandpass", frequency: 920, q: 1.1 },
      { delay: 0.035, duration: 0.11, level: 0.035, filter: "lowpass", frequency: 520 },
    ],
  },
  "action.guard-stunned": {
    bus: "sfx",
    pitchVariation: 0.05,
    notes: [
      { frequency: 112, endFrequency: 62, delay: 0, duration: 0.22, level: 0.085, wave: "sine" },
      { frequency: 246.94, delay: 0.045, duration: 0.11, level: 0.035, wave: "triangle" },
    ],
    noise: [
      { delay: 0, duration: 0.08, level: 0.055, filter: "lowpass", frequency: 640 },
    ],
  },
  "action.player-hit": {
    bus: "sfx",
    pitchVariation: 0.055,
    notes: [
      { frequency: 164.81, endFrequency: 73.42, delay: 0, duration: 0.24, level: 0.1, wave: "sawtooth" },
    ],
    noise: [
      { delay: 0, duration: 0.1, level: 0.09, filter: "bandpass", frequency: 430, q: 0.8 },
    ],
  },
  "action.trap-triggered": {
    bus: "sfx",
    pitchVariation: 0.04,
    notes: [
      { frequency: 196, endFrequency: 82.41, delay: 0, duration: 0.2, level: 0.08, wave: "square" },
    ],
    noise: [
      { delay: 0, duration: 0.13, level: 0.075, filter: "bandpass", frequency: 1_180, q: 1.6 },
    ],
  },
  "world.alarm": {
    bus: "sfx",
    notes: [
      { frequency: 783.99, endFrequency: 740, delay: 0, duration: 0.48, level: 0.11, wave: "sine" },
      { frequency: 783.99, endFrequency: 740, delay: 0.44, duration: 0.48, level: 0.1, wave: "sine" },
      { frequency: 392, delay: 0, duration: 0.95, level: 0.04, wave: "sine" },
    ],
    noise: [
      { delay: 0, duration: 0.14, level: 0.035, filter: "bandpass", frequency: 2_600, q: 3 },
      { delay: 0.44, duration: 0.14, level: 0.03, filter: "bandpass", frequency: 2_600, q: 3 },
    ],
  },
  "world.reinforcement": {
    bus: "sfx",
    notes: [
      { frequency: 110, endFrequency: 123.47, delay: 0, duration: 0.42, level: 0.09, wave: "sawtooth" },
      { frequency: 164.81, endFrequency: 185, delay: 0.3, duration: 0.52, level: 0.085, wave: "sawtooth" },
    ],
  },
  "world.lock-break": {
    bus: "sfx",
    pitchVariation: 0.04,
    notes: [
      { frequency: 174.61, endFrequency: 82.41, delay: 0, duration: 0.2, level: 0.08, wave: "triangle" },
      { frequency: 261.63, endFrequency: 110, delay: 0.08, duration: 0.18, level: 0.055, wave: "square" },
    ],
    noise: [
      { delay: 0, duration: 0.08, level: 0.08, filter: "highpass", frequency: 1_300 },
      { delay: 0.08, duration: 0.12, level: 0.065, filter: "bandpass", frequency: 720, q: 0.7 },
    ],
  },
  "world.cache-open": {
    bus: "sfx",
    pitchVariation: 0.035,
    notes: [
      { frequency: 130.81, endFrequency: 98, delay: 0, duration: 0.2, level: 0.05, wave: "triangle" },
      { frequency: 987.77, delay: 0.15, duration: 0.09, level: 0.055, wave: "sine" },
      { frequency: 1318.51, delay: 0.22, duration: 0.13, level: 0.045, wave: "sine" },
    ],
    noise: [
      { delay: 0, duration: 0.14, level: 0.04, filter: "bandpass", frequency: 540, q: 0.9 },
    ],
  },
  "world.cart-robbed": {
    bus: "sfx",
    pitchVariation: 0.045,
    notes: [
      { frequency: 880, delay: 0, duration: 0.08, level: 0.06, wave: "triangle" },
      { frequency: 1174.66, delay: 0.055, duration: 0.08, level: 0.055, wave: "triangle" },
      { frequency: 1567.98, delay: 0.11, duration: 0.12, level: 0.05, wave: "triangle" },
    ],
    noise: [
      { delay: 0, duration: 0.16, level: 0.035, filter: "highpass", frequency: 2_400 },
    ],
  },
  "world.coin-delivered": {
    bus: "sfx",
    notes: [
      { frequency: 392, delay: 0, duration: 0.18, level: 0.07, wave: "sine" },
      { frequency: 493.88, delay: 0.07, duration: 0.2, level: 0.065, wave: "sine" },
      { frequency: 659.25, delay: 0.14, duration: 0.28, level: 0.07, wave: "sine" },
    ],
  },
  "world.victory": {
    bus: "sfx",
    notes: [
      { frequency: 392, delay: 0, duration: 0.22, level: 0.07, wave: "triangle" },
      { frequency: 523.25, delay: 0.14, duration: 0.24, level: 0.075, wave: "triangle" },
      { frequency: 659.25, delay: 0.28, duration: 0.26, level: 0.075, wave: "triangle" },
      { frequency: 783.99, delay: 0.42, duration: 0.42, level: 0.08, wave: "sine" },
    ],
  },
  "movement.footstep-grass": {
    bus: "sfx",
    pitchVariation: 0.12,
    notes: [
      { frequency: 92, endFrequency: 62, delay: 0, duration: 0.07, level: 0.03, wave: "sine" },
    ],
    noise: [
      { delay: 0, duration: 0.075, level: 0.045, filter: "bandpass", frequency: 740, q: 0.7 },
    ],
  },
  "movement.footstep-road": {
    bus: "sfx",
    pitchVariation: 0.1,
    notes: [
      { frequency: 138.59, endFrequency: 82.41, delay: 0, duration: 0.065, level: 0.034, wave: "triangle" },
    ],
    noise: [
      { delay: 0, duration: 0.055, level: 0.04, filter: "highpass", frequency: 1_100 },
    ],
  },
}
