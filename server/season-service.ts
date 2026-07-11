import { randomUUID } from "node:crypto"
import { SEASON_PROJECT_THRESHOLDS, projectTier, type SeasonalContributionOutcome, type SeasonalMissionOutcome, type SherwoodSeasonSnapshot } from "../shared/sherwood-season"
import type { ContributionType, VoteChoice } from "../shared/protocol"

export interface SeasonTransition {
  sequence: number
  at: number
  eventId: string
  eventType: "mission" | "contribution" | "operator"
  snapshot: SherwoodSeasonSnapshot
  payload: Record<string, unknown>
}

interface Checkpoint {
  snapshot: SherwoodSeasonSnapshot
  processedEventIds: Set<string>
}

function project(id: VoteChoice, label: string) {
  return { id, label, total: 0, tier: 0 as const, nextThreshold: SEASON_PROJECT_THRESHOLDS[0] }
}

function cloneSnapshot(snapshot: SherwoodSeasonSnapshot): SherwoodSeasonSnapshot {
  return structuredClone(snapshot)
}

export class SherwoodSeasonService {
  private state: SherwoodSeasonSnapshot
  private processedEventIds = new Set<string>()
  private history: Checkpoint[] = []
  private transitions: SeasonTransition[] = []
  private sequence = 0
  private revisionClock = 1

  constructor(now = Date.now()) {
    this.state = {
      id: randomUUID(),
      slug: "season-zero",
      name: "Season of the Green Bough",
      phase: "active",
      startsAt: now,
      endsAt: now + 90 * 86_400_000,
      pressure: 20,
      projects: {
        granary: project("granary", "Greenwood Granary"),
        infirmary: project("infirmary", "St. Mary's Shelter"),
        watchtower: project("watchtower", "Oakwatch Beacon"),
      },
      finale: { attempts: 0, successes: 0, target: 3, maxAttempts: 5 },
      recognition: { generosity: 0, rescues: 0, cleanEscapes: 0, tactical: 0 },
      revision: 1,
      archivedAt: null,
    }
    this.recordTransition(now, `system:start:${this.state.id}`, "operator", { operation: "start" })
  }

  snapshot(now = Date.now()): SherwoodSeasonSnapshot {
    this.tick(now)
    return cloneSnapshot(this.state)
  }

  hydrate(snapshot: SherwoodSeasonSnapshot, processedEventIds: string[]): void {
    if (!snapshot.id || snapshot.revision < 1 || !["active", "paused", "finale", "succeeded", "failed", "archived"].includes(snapshot.phase)) throw new Error("INVALID_SEASON_RECOVERY")
    this.state = cloneSnapshot(snapshot)
    this.processedEventIds = new Set(processedEventIds)
    this.revisionClock = snapshot.revision
    this.history = []
    this.transitions = []
  }

  recordMission(outcome: SeasonalMissionOutcome): boolean {
    if (this.processedEventIds.has(outcome.eventId) || !["active", "paused", "finale"].includes(this.state.phase)) return false
    this.checkpoint()
    this.processedEventIds.add(outcome.eventId)
    const wasFinale = this.state.phase === "finale"
    if (outcome.status === "succeeded") {
      if (outcome.project && outcome.communityCoin > 0) this.addProject(outcome.project, outcome.communityCoin)
      this.state.pressure = Math.max(0, this.state.pressure - 4)
      this.state.recognition.generosity += Math.max(0, outcome.communityCoin)
      this.state.recognition.rescues += Math.max(0, outcome.rescues)
      if (outcome.cleanEscape) this.state.recognition.cleanEscapes += 1
      this.state.recognition.tactical += Math.max(0, outcome.tacticalScore)
    } else this.state.pressure = Math.min(100, this.state.pressure + 10)
    if (wasFinale) {
      this.state.finale.attempts += 1
      if (outcome.status === "succeeded" && outcome.rotationId) this.state.finale.successes += 1
      if (this.state.finale.successes >= this.state.finale.target) this.state.phase = "succeeded"
      else if (this.state.finale.attempts >= this.state.finale.maxAttempts) this.state.phase = "failed"
    }
    this.commit(outcome.occurredAt, outcome.eventId, "mission", { ...outcome })
    return true
  }

  recordContribution(outcome: SeasonalContributionOutcome): boolean {
    if (this.processedEventIds.has(outcome.eventId) || !["active", "paused", "finale"].includes(this.state.phase)) return false
    this.checkpoint()
    this.processedEventIds.add(outcome.eventId)
    const projects: Record<ContributionType, VoteChoice> = { supplies: "granary", intelligence: "watchtower", "snare-kit": "watchtower", "safe-house": "infirmary" }
    this.addProject(projects[outcome.type], 25)
    this.state.pressure = Math.max(0, this.state.pressure - 1)
    this.commit(outcome.occurredAt, outcome.eventId, "contribution", { ...outcome })
    return true
  }

  pause(now = Date.now()): void {
    if (this.state.phase !== "active" && this.state.phase !== "finale") throw new Error("SEASON_NOT_PAUSABLE")
    this.operatorMutation(now, "pause", () => { this.state.phase = "paused" })
  }

  resume(now = Date.now()): void {
    if (this.state.phase !== "paused") throw new Error("SEASON_NOT_PAUSED")
    this.operatorMutation(now, "resume", () => { this.state.phase = this.allProjectsComplete() ? "finale" : "active" })
  }

  extend(endsAt: number, now = Date.now()): void {
    if (!Number.isFinite(endsAt) || endsAt <= this.state.endsAt || endsAt > this.state.endsAt + 90 * 86_400_000) throw new Error("INVALID_SEASON_EXTENSION")
    this.operatorMutation(now, "extend", () => { this.state.endsAt = endsAt })
  }

  archive(now = Date.now()): void {
    if (this.state.phase !== "succeeded" && this.state.phase !== "failed") throw new Error("SEASON_NOT_TERMINAL")
    this.operatorMutation(now, "archive", () => { this.state.phase = "archived"; this.state.archivedAt = now })
  }

  start(input: { slug: string; name: string; startsAt: number; endsAt: number }, now = Date.now()): void {
    if (this.state.phase !== "archived") throw new Error("ACTIVE_SEASON_EXISTS")
    if (!input.slug.match(/^[a-z0-9-]{1,40}$/) || input.name.length < 1 || input.name.length > 60 || input.endsAt <= input.startsAt) throw new Error("INVALID_SEASON")
    this.checkpoint()
    const previousRecognition = { ...this.state.recognition }
    this.state = {
      id: randomUUID(), slug: input.slug, name: input.name, phase: "active", startsAt: input.startsAt, endsAt: input.endsAt,
      pressure: 20,
      projects: { granary: project("granary", "Greenwood Granary"), infirmary: project("infirmary", "St. Mary's Shelter"), watchtower: project("watchtower", "Oakwatch Beacon") },
      finale: { attempts: 0, successes: 0, target: 3, maxAttempts: 5 },
      recognition: previousRecognition,
      revision: ++this.revisionClock,
      archivedAt: null,
    }
    this.processedEventIds = new Set()
    this.recordTransition(now, `operator:start:${this.state.id}`, "operator", { operation: "start" })
  }

  rollback(now = Date.now()): void {
    const previous = this.history.pop()
    if (!previous) throw new Error("NO_SEASON_ROLLBACK")
    this.state = cloneSnapshot(previous.snapshot)
    this.processedEventIds = new Set(previous.processedEventIds)
    this.state.revision = ++this.revisionClock
    this.recordTransition(now, `operator:rollback:${randomUUID()}`, "operator", { operation: "rollback" })
  }

  drainTransitions(): SeasonTransition[] {
    return this.transitions.splice(0, this.transitions.length)
  }

  private tick(now: number): void {
    if (this.state.phase === "active" && now >= this.state.endsAt) {
      this.checkpoint()
      this.state.phase = "finale"
      this.commit(now, `system:finale:${this.state.id}`, "operator", { operation: "finale-window" })
    }
  }

  private addProject(id: VoteChoice, value: number): void {
    const target = this.state.projects[id]
    target.total += Math.max(0, Math.round(value))
    target.tier = projectTier(target.total)
    target.nextThreshold = target.tier === 0
      ? SEASON_PROJECT_THRESHOLDS[0]
      : target.tier === 1
        ? SEASON_PROJECT_THRESHOLDS[1]
        : target.tier === 2
          ? SEASON_PROJECT_THRESHOLDS[2]
          : null
    if (this.state.phase === "active" && this.allProjectsComplete()) this.state.phase = "finale"
  }

  private allProjectsComplete(): boolean {
    return Object.values(this.state.projects).every((candidate) => candidate.tier === 3)
  }

  private operatorMutation(now: number, operation: string, mutation: () => void): void {
    this.checkpoint()
    mutation()
    this.commit(now, `operator:${operation}:${randomUUID()}`, "operator", { operation })
  }

  private checkpoint(): void {
    this.history.push({ snapshot: cloneSnapshot(this.state), processedEventIds: new Set(this.processedEventIds) })
    if (this.history.length > 32) this.history.shift()
  }

  private commit(at: number, eventId: string, eventType: SeasonTransition["eventType"], payload: Record<string, unknown>): void {
    this.state.revision = ++this.revisionClock
    this.recordTransition(at, eventId, eventType, payload)
  }

  private recordTransition(at: number, eventId: string, eventType: SeasonTransition["eventType"], payload: Record<string, unknown>): void {
    this.transitions.push({ sequence: ++this.sequence, at, eventId, eventType, snapshot: cloneSnapshot(this.state), payload })
  }
}
