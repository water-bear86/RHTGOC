import { AUDIO_CUES, type AudioCueId } from "./audio-cues"
import {
  AUDIO_BUS_IDS,
  copyAudioSettings,
  type AudioBusId,
  type AudioSettings,
  type DynamicRangePreset,
} from "./audio-settings"

type ContextFactory = () => AudioContext
type MediaElementFactory = (url: string) => HTMLAudioElement
type CueSource = OscillatorNode | AudioBufferSourceNode

interface MusicTrack {
  id: string
  element: HTMLAudioElement
  source: MediaElementAudioSourceNode
  gain: GainNode
}

interface ForestAmbienceBed {
  wind: AudioBufferSourceNode
  leaves: AudioBufferSourceNode
  windFilter: BiquadFilterNode
  leavesFilter: BiquadFilterNode
  windGain: GainNode
  leavesGain: GainNode
}

export interface ForestAmbienceProfile {
  active: boolean
  inHub: boolean
  threatLevel: number
}

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
  private readonly musicTracks = new Set<MusicTrack>()
  private readonly activeCueSources = new Set<CueSource>()
  private readonly cuePlayCounts = new Map<AudioCueId, number>()
  private currentMusic: MusicTrack | null = null
  private forestAmbience: ForestAmbienceBed | null = null
  private ambienceProfileKey = ""
  private noiseBuffer: AudioBuffer | null = null
  private settings: AudioSettings
  private unlocked = false

  constructor(
    settings: AudioSettings,
    private readonly createContext: ContextFactory = () => new AudioContext(),
    private readonly createMediaElement: MediaElementFactory = (url) => new Audio(url),
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
    if (!bus || this.activeCueSources.size >= 40) return false
    const base = context.currentTime + 0.005
    const playCount = (this.cuePlayCounts.get(id) ?? 0) + 1
    this.cuePlayCounts.set(id, playCount)
    const variationUnit = ((Math.imul(playCount, 1103515245) + 12345) >>> 8) / 0x01000000
    const pitchVariation = definition.pitchVariation ?? 0
    const pitchScale = 1 + (variationUnit * 2 - 1) * pitchVariation
    let scheduled = false
    for (const note of definition.notes) {
      if (this.activeCueSources.size >= 40) break
      const oscillator = context.createOscillator()
      const envelope = context.createGain()
      const start = base + note.delay
      const end = start + note.duration
      oscillator.type = note.wave
      oscillator.frequency.setValueAtTime(note.frequency * pitchScale, start)
      if (note.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(note.endFrequency * pitchScale, end)
      envelope.gain.setValueAtTime(0.0001, start)
      envelope.gain.exponentialRampToValueAtTime(note.level, start + Math.min(0.012, note.duration * 0.25))
      envelope.gain.exponentialRampToValueAtTime(0.0001, end)
      oscillator.connect(envelope)
      envelope.connect(bus)
      this.activeCueSources.add(oscillator)
      oscillator.addEventListener("ended", () => {
        this.activeCueSources.delete(oscillator)
        oscillator.disconnect()
        envelope.disconnect()
      }, { once: true })
      oscillator.start(start)
      oscillator.stop(end + 0.02)
      scheduled = true
    }
    for (const noise of definition.noise ?? []) {
      if (this.activeCueSources.size >= 40) break
      const source = context.createBufferSource()
      const filter = context.createBiquadFilter()
      const envelope = context.createGain()
      const start = base + noise.delay
      const end = start + noise.duration
      source.buffer = this.ensureNoiseBuffer(context)
      source.playbackRate.setValueAtTime(pitchScale, start)
      filter.type = noise.filter
      filter.frequency.setValueAtTime(noise.frequency * pitchScale, start)
      filter.Q.setValueAtTime(noise.q ?? 0.7, start)
      envelope.gain.setValueAtTime(0.0001, start)
      envelope.gain.exponentialRampToValueAtTime(noise.level, start + Math.min(0.008, noise.duration * 0.2))
      envelope.gain.exponentialRampToValueAtTime(0.0001, end)
      source.connect(filter)
      filter.connect(envelope)
      envelope.connect(bus)
      this.activeCueSources.add(source)
      source.addEventListener("ended", () => {
        this.activeCueSources.delete(source)
        source.disconnect()
        filter.disconnect()
        envelope.disconnect()
      }, { once: true })
      source.start(start)
      source.stop(end + 0.02)
      scheduled = true
    }
    return scheduled
  }

  async preview(): Promise<boolean> {
    if (!await this.unlock()) return false
    this.playCue("ui.confirm")
    return true
  }

  async playMusic(id: string, url: string, fadeSeconds = 1.4): Promise<boolean> {
    if (this.currentMusic?.id === id) return true
    if (!await this.unlock()) return false
    const context = this.context
    const bus = this.buses.get("music")
    if (!context || !bus) return false

    const element = this.createMediaElement(url)
    element.loop = true
    element.preload = "auto"
    const source = context.createMediaElementSource(element)
    const gain = context.createGain()
    const track: MusicTrack = { id, element, source, gain }
    const now = context.currentTime
    const fade = Math.max(0.08, fadeSeconds)
    gain.gain.setValueAtTime(0.0001, now)
    source.connect(gain)
    gain.connect(bus)

    try {
      await element.play()
    } catch {
      source.disconnect()
      gain.disconnect()
      return false
    }

    this.musicTracks.add(track)
    gain.gain.exponentialRampToValueAtTime(1, now + fade)
    const previous = this.currentMusic
    this.currentMusic = track
    if (previous) this.retireMusicTrack(previous, fade)
    return true
  }

  stopMusic(fadeSeconds = 0.8): void {
    if (!this.currentMusic) return
    const previous = this.currentMusic
    this.currentMusic = null
    this.retireMusicTrack(previous, fadeSeconds)
  }

  updateForestAmbience(profile: ForestAmbienceProfile): boolean {
    const context = this.context
    const bus = this.buses.get("ambience")
    if (!context || context.state !== "running" || !bus) return false
    if (!this.forestAmbience) this.forestAmbience = this.createForestAmbience(context, bus)
    const key = `${profile.active}:${profile.inHub}:${Math.max(0, Math.floor(profile.threatLevel))}`
    if (key === this.ambienceProfileKey) return true
    this.ambienceProfileKey = key
    const now = context.currentTime
    const active = profile.active
    const threat = Math.max(0, profile.threatLevel)
    const windLevel = !active ? 0.0001 : profile.inHub ? 0.032 : threat >= 2 ? 0.014 : 0.026
    const leavesLevel = !active ? 0.0001 : profile.inHub ? 0.011 : threat >= 2 ? 0.006 : 0.015
    this.forestAmbience.windGain.gain.setTargetAtTime(windLevel, now, 0.8)
    this.forestAmbience.leavesGain.gain.setTargetAtTime(leavesLevel, now, 0.6)
    this.forestAmbience.windFilter.frequency.setTargetAtTime(
      profile.inHub ? 620 : threat >= 2 ? 410 : 760,
      now,
      0.8,
    )
    return true
  }

  async destroy(): Promise<void> {
    if (!this.context || this.context.state === "closed") return
    this.disposeForestAmbience()
    for (const track of this.musicTracks) this.disposeMusicTrack(track)
    this.musicTracks.clear()
    this.currentMusic = null
    await this.context.close()
    this.context = null
    this.master = null
    this.compressor = null
    this.buses.clear()
    this.activeCueSources.clear()
    this.cuePlayCounts.clear()
    this.ambienceProfileKey = ""
    this.noiseBuffer = null
    this.unlocked = false
  }

  private retireMusicTrack(track: MusicTrack, fadeSeconds: number): void {
    const context = this.context
    if (!context) {
      this.disposeMusicTrack(track)
      return
    }
    const fade = Math.max(0.08, fadeSeconds)
    const now = context.currentTime
    track.gain.gain.cancelScheduledValues(now)
    track.gain.gain.setValueAtTime(Math.max(0.0001, track.gain.gain.value), now)
    track.gain.gain.exponentialRampToValueAtTime(0.0001, now + fade)
    globalThis.setTimeout(() => this.disposeMusicTrack(track), Math.ceil((fade + 0.08) * 1000))
  }

  private disposeMusicTrack(track: MusicTrack): void {
    track.element.pause()
    track.element.removeAttribute("src")
    track.element.load()
    track.source.disconnect()
    track.gain.disconnect()
    this.musicTracks.delete(track)
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

  private ensureNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer
    const sampleRate = Math.max(8_000, context.sampleRate || 44_100)
    const buffer = context.createBuffer(1, sampleRate * 4, sampleRate)
    const channel = buffer.getChannelData(0)
    let seed = 0x53484552
    for (let index = 0; index < channel.length; index += 1) {
      seed = Math.imul(seed ^ (seed >>> 15), 2246822519)
      seed = Math.imul(seed ^ (seed >>> 13), 3266489917)
      channel[index] = ((seed >>> 0) / 0xffffffff) * 2 - 1
    }
    this.noiseBuffer = buffer
    return buffer
  }

  private createForestAmbience(context: AudioContext, bus: GainNode): ForestAmbienceBed {
    const wind = context.createBufferSource()
    const leaves = context.createBufferSource()
    const windFilter = context.createBiquadFilter()
    const leavesFilter = context.createBiquadFilter()
    const windGain = context.createGain()
    const leavesGain = context.createGain()
    wind.buffer = this.ensureNoiseBuffer(context)
    leaves.buffer = this.ensureNoiseBuffer(context)
    wind.loop = true
    leaves.loop = true
    wind.playbackRate.value = 0.19
    leaves.playbackRate.value = 0.31
    windFilter.type = "lowpass"
    windFilter.frequency.value = 760
    windFilter.Q.value = 0.35
    leavesFilter.type = "bandpass"
    leavesFilter.frequency.value = 2_450
    leavesFilter.Q.value = 0.7
    windGain.gain.value = 0.0001
    leavesGain.gain.value = 0.0001
    wind.connect(windFilter)
    windFilter.connect(windGain)
    windGain.connect(bus)
    leaves.connect(leavesFilter)
    leavesFilter.connect(leavesGain)
    leavesGain.connect(bus)
    wind.start()
    leaves.start()
    return { wind, leaves, windFilter, leavesFilter, windGain, leavesGain }
  }

  private disposeForestAmbience(): void {
    const ambience = this.forestAmbience
    if (!ambience) return
    ambience.wind.stop()
    ambience.leaves.stop()
    ambience.wind.disconnect()
    ambience.leaves.disconnect()
    ambience.windFilter.disconnect()
    ambience.leavesFilter.disconnect()
    ambience.windGain.disconnect()
    ambience.leavesGain.disconnect()
    this.forestAmbience = null
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
