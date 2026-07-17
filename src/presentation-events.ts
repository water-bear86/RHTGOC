import type { AudioCueId } from "./audio-cues"

export type PresentationChannel = "action" | "objective" | "threat" | "party" | "reward" | "system"
export type PresentationPriority = "routine" | "important" | "critical"

export interface PresentationEventInput {
  channel: PresentationChannel
  priority: PresentationPriority
  message: string
  cue?: AudioCueId
  dedupeKey?: string
  lifetimeSeconds?: number
}

export interface PresentationEvent extends PresentationEventInput {
  sequence: number
  createdAt: number
}

type Listener = (event: PresentationEvent) => void

export class PresentationEventBus {
  private readonly listeners = new Set<Listener>()
  private readonly lastByDedupeKey = new Map<string, number>()
  private sequence = 0

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly dedupeWindowMs = 350,
  ) {}

  publish(input: PresentationEventInput): PresentationEvent | null {
    const createdAt = this.now()
    if (input.dedupeKey) {
      const last = this.lastByDedupeKey.get(input.dedupeKey)
      if (last !== undefined && createdAt - last < this.dedupeWindowMs) return null
      this.lastByDedupeKey.set(input.dedupeKey, createdAt)
    }
    const event: PresentationEvent = {
      ...input,
      sequence: this.sequence += 1,
      createdAt,
    }
    for (const listener of this.listeners) listener(event)
    return event
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

