export const AUDIO_BUS_IDS = ["master", "music", "ambience", "sfx", "ui", "voice"] as const

export type AudioBusId = typeof AUDIO_BUS_IDS[number]
export type DynamicRangePreset = "headphones" | "tv" | "night"

export interface AudioSettings {
  levels: Record<AudioBusId, number>
  dynamicRange: DynamicRangePreset
  mono: boolean
}

export const AUDIO_BUS_LABELS: Record<AudioBusId, string> = {
  master: "Master",
  music: "Music",
  ambience: "Ambience",
  sfx: "Sound effects",
  ui: "Interface",
  voice: "Voices and barks",
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  levels: {
    master: 0.85,
    music: 0.72,
    ambience: 0.78,
    sfx: 0.9,
    ui: 0.72,
    voice: 0.85,
  },
  dynamicRange: "headphones",
  mono: false,
}

const STORAGE_KEY = "sherwood:audio-settings:v1"
const DYNAMIC_RANGE_PRESETS = new Set<DynamicRangePreset>(["headphones", "tv", "night"])

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function level(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : fallback
}

export function copyAudioSettings(settings: AudioSettings = DEFAULT_AUDIO_SETTINGS): AudioSettings {
  return { ...settings, levels: { ...settings.levels } }
}

export function loadAudioSettings(storage: StorageLike): AudioSettings {
  const settings = copyAudioSettings()
  let raw: unknown
  try { raw = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") }
  catch { return settings }
  if (!raw || typeof raw !== "object") return settings
  const value = raw as Partial<AudioSettings>
  if (value.levels && typeof value.levels === "object") {
    for (const bus of AUDIO_BUS_IDS) settings.levels[bus] = level(value.levels[bus], settings.levels[bus])
  }
  if (DYNAMIC_RANGE_PRESETS.has(value.dynamicRange as DynamicRangePreset)) {
    settings.dynamicRange = value.dynamicRange as DynamicRangePreset
  }
  if (typeof value.mono === "boolean") settings.mono = value.mono
  return settings
}

export function saveAudioSettings(storage: StorageLike, settings: AudioSettings): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

