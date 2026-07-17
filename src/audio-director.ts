import { AUDIO_CUES, type AudioCueId } from "./audio-cues"
import {
  AUDIO_BUS_IDS,
  copyAudioSettings,
  type AudioBusId,
  type AudioSettings,
  type DynamicRangePreset,
} from "./audio-settings"

type ContextFactory = () => AudioContext

interface DynamicRangeProfile {
  threshold: number
  knee: number
  ratio: number
  attack: number
  release: number
}

export function dynamicRangeProfile(preset: DynamicRangePreset): DynamicRangeProfile {
  if (preset === "night") return { threshold: -30, knee: 18, ratio: 10, attack: 0.004, release: 0.22 }
  if (preset === "tv") return { threshold: -22, knee: 14, ratio: 5, attack: 0.006, release: 0.28 }
  return { threshold: -14, knee: 8, ratio: 2.5, attack: 0.008, release: 0.34 }
}

export class AudioDirector {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private readonly buses = new Map<Exclude<AudioBusId, "master">, GainNode>()
  private settings: AudioSettings
  private unlocked = false

  constructor(
    settings: AudioSettings,
    private readonly createContext: ContextFactory = () => new AudioContext(),
  ) {
    this.settings = copyAudioSettings(settings)
  }

  get state(): AudioContextState | "uninitialized" {
    return this.context?.state ?? "uninitialized"
  }

  async unlock(): Promise<boolean> {
    this.ensureGraph()
    if (!this.context) return false
    if (this.context.state !== "running") await this.context.resume()
    this.unlocked = this.context.state === "running"
    return this.unlocked
  }

  async suspend(): Promise<void> {
    if (this.context?.state === "running") await this.context.suspend()
  }

  async resume(): Promise<void> {
    if (this.unlocked && this.context?.state === "suspended") await this.context.resume()
  }

  updateSettings(settings: AudioSettings): void {
    this.settings = copyAudioSettings(settings)
    this.applySettings()
  }

  playCue(id: AudioCueId): boolean {
    const context = this.context
    if (!context || context.state !== "running") return false
    const definition = AUDIO_CUES[id]
    const bus = this.buses.get(definition.bus)
    if (!bus) return false
    const base = context.currentTime + 0.005
    for (const note of definition.notes) {
      const oscillator = context.createOscillator()
      const envelope = context.createGain()
      const start = base + note.delay
      const end = start + note.duration
      oscillator.type = note.wave
      oscillator.frequency.setValueAtTime(note.frequency, start)
      envelope.gain.setValueAtTime(0.0001, start)
      envelope.gain.exponentialRampToValueAtTime(note.level, start + Math.min(0.012, note.duration * 0.25))
      envelope.gain.exponentialRampToValueAtTime(0.0001, end)
      oscillator.connect(envelope)
      envelope.connect(bus)
      oscillator.addEventListener("ended", () => {
        oscillator.disconnect()
        envelope.disconnect()
      }, { once: true })
      oscillator.start(start)
      oscillator.stop(end + 0.02)
    }
    return true
  }

  async preview(): Promise<boolean> {
    if (!await this.unlock()) return false
    this.playCue("ui.confirm")
    return true
  }

  async destroy(): Promise<void> {
    if (!this.context || this.context.state === "closed") return
    await this.context.close()
    this.context = null
    this.master = null
    this.compressor = null
    this.buses.clear()
    this.unlocked = false
  }

  private ensureGraph(): void {
    if (this.context) return
    const context = this.createContext()
    const master = context.createGain()
    const compressor = context.createDynamicsCompressor()
    master.connect(compressor)
    compressor.connect(context.destination)
    this.context = context
    this.master = master
    this.compressor = compressor
    for (const id of AUDIO_BUS_IDS) {
      if (id === "master") continue
      const bus = context.createGain()
      bus.connect(master)
      this.buses.set(id, bus)
    }
    this.applySettings()
  }

  private applySettings(): void {
    const context = this.context
    const master = this.master
    const compressor = this.compressor
    if (!context || !master || !compressor) return
    const when = context.currentTime
    master.gain.setTargetAtTime(this.settings.levels.master, when, 0.015)
    master.channelCount = this.settings.mono ? 1 : 2
    master.channelCountMode = "explicit"
    for (const [id, bus] of this.buses) {
      bus.gain.setTargetAtTime(this.settings.levels[id], when, 0.015)
    }
    const profile = dynamicRangeProfile(this.settings.dynamicRange)
    compressor.threshold.setTargetAtTime(profile.threshold, when, 0.02)
    compressor.knee.setTargetAtTime(profile.knee, when, 0.02)
    compressor.ratio.setTargetAtTime(profile.ratio, when, 0.02)
    compressor.attack.setTargetAtTime(profile.attack, when, 0.02)
    compressor.release.setTargetAtTime(profile.release, when, 0.02)
  }
}

