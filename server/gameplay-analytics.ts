import { createHash, randomUUID } from "node:crypto"
import type { ClientDiagnosticCode } from "../shared/protocol"
import {
  GAMEPLAY_AGGREGATION_WINDOW_MS,
  GAMEPLAY_ANALYTICS_MAX_BATCH_ROWS,
  GAMEPLAY_ANALYTICS_SCHEMA_VERSION,
  GAMEPLAY_SAMPLE_INTERVAL_MS,
  analyticsCellAt,
  analyticsWindowStart,
  emptyGameplayAggregate,
  gameplayAggregateKey,
  parseGameplayAnalyticsBatch,
  parseGameplayAnalyticsDimension,
  type GameplayAnalyticsAggregate,
  type GameplayAnalyticsBatch,
  type GameplayAnalyticsDimension,
  type GameplayAnalyticsEvent,
} from "../shared/gameplay-analytics"

export interface GameplayObservation {
  observedAtMs: number
  x: number
  z: number
  dangerNearby: boolean
  dimension: GameplayAnalyticsDimension
}

export interface GameplayEventObservation {
  observedAtMs: number
  x: number
  z: number
  event: GameplayAnalyticsEvent
  dimension: GameplayAnalyticsDimension
}

export interface GameplayDiagnosticObservation {
  observedAtMs: number
  x: number
  z: number
  code: ClientDiagnosticCode
  dimension: GameplayAnalyticsDimension
}

export interface GameplayAnalyticsAggregatorOptions {
  batchNamespace?: string
  maxTrackedSubjects?: number
  maxAggregateRows?: number
  subjectRetentionMs?: number
}

interface SubjectState {
  lastAcceptedAt: number
  lastAggregateKey: string
  lastSeenAt: number
}

const DEFAULT_MAX_TRACKED_SUBJECTS = 20_000
const DEFAULT_MAX_AGGREGATE_ROWS = 50_000
const DEFAULT_SUBJECT_RETENTION_MS = GAMEPLAY_AGGREGATION_WINDOW_MS * 2

function boundedRoomScope(roomScope: string): string {
  if (typeof roomScope !== "string" || roomScope.length < 1 || roomScope.length > 128) {
    throw new Error("roomScope must be a bounded opaque runtime key")
  }
  return roomScope
}

function boundedPlayerSlot(playerSlot: number): number {
  if (!Number.isSafeInteger(playerSlot) || playerSlot < 0 || playerSlot > 3) throw new Error("playerSlot must be between 0 and 3")
  return playerSlot
}

function subjectKey(roomScope: string, playerSlot: number): string {
  return `${roomScope.length}:${roomScope}:${playerSlot}`
}

function incrementEvent(aggregate: GameplayAnalyticsAggregate, event: GameplayAnalyticsEvent): void {
  if (event === "objective-interaction") aggregate.objectiveInteractionCount += 1
  else if (event === "player-downed") aggregate.downedCount += 1
  else if (event === "stuck-recovery") aggregate.stuckRecoveryCount += 1
  else if (event === "client-error") aggregate.clientErrorCount += 1
  else if (event === "mission-start") aggregate.missionStartCount += 1
  else if (event === "mission-success") aggregate.missionSuccessCount += 1
  else aggregate.missionFailureCount += 1
}

function incrementDiagnostic(aggregate: GameplayAnalyticsAggregate, code: ClientDiagnosticCode): void {
  aggregate.clientErrorCount += 1
  if (code === "webgl_context_lost") aggregate.webglContextLostCount += 1
  else if (code === "asset_load_failed") aggregate.assetLoadFailedCount += 1
  else if (code === "uncaught_error") aggregate.uncaughtErrorCount += 1
  else if (code === "unhandled_rejection") aggregate.unhandledRejectionCount += 1
  else if (code === "frame_stall") aggregate.frameStallCount += 1
  else aggregate.snapshotDesyncCount += 1
}

export class GameplayAnalyticsAggregator {
  private readonly batchNamespace: string
  private readonly maxTrackedSubjects: number
  private readonly maxAggregateRows: number
  private readonly subjectRetentionMs: number
  private readonly subjects = new Map<string, SubjectState>()
  private readonly windows = new Map<number, Map<string, GameplayAnalyticsAggregate>>()
  private aggregateRows = 0
  private nextPruneAt = 0

  constructor(options: GameplayAnalyticsAggregatorOptions = {}) {
    this.batchNamespace = options.batchNamespace ?? randomUUID()
    this.maxTrackedSubjects = options.maxTrackedSubjects ?? DEFAULT_MAX_TRACKED_SUBJECTS
    this.maxAggregateRows = options.maxAggregateRows ?? DEFAULT_MAX_AGGREGATE_ROWS
    this.subjectRetentionMs = options.subjectRetentionMs ?? DEFAULT_SUBJECT_RETENTION_MS
    if (this.batchNamespace.length < 1 || this.batchNamespace.length > 128) throw new Error("batchNamespace must be 1-128 characters")
    if (!Number.isSafeInteger(this.maxTrackedSubjects) || this.maxTrackedSubjects < 1) throw new Error("maxTrackedSubjects must be positive")
    if (!Number.isSafeInteger(this.maxAggregateRows) || this.maxAggregateRows < 1) throw new Error("maxAggregateRows must be positive")
    if (!Number.isSafeInteger(this.subjectRetentionMs) || this.subjectRetentionMs < GAMEPLAY_SAMPLE_INTERVAL_MS) throw new Error("subjectRetentionMs is too small")
  }

  observe(roomScopeValue: string, playerSlotValue: number, observation: GameplayObservation): boolean {
    const roomScope = boundedRoomScope(roomScopeValue)
    const playerSlot = boundedPlayerSlot(playerSlotValue)
    if (!Number.isFinite(observation.observedAtMs) || observation.observedAtMs < 0) throw new Error("observedAtMs must be a positive timestamp")
    this.pruneSubjects(observation.observedAtMs)
    const key = subjectKey(roomScope, playerSlot)
    const previous = this.subjects.get(key)
    if (previous && observation.observedAtMs - previous.lastAcceptedAt < GAMEPLAY_SAMPLE_INTERVAL_MS) return false

    const aggregate = this.aggregateFor(observation.observedAtMs, observation.dimension, observation.x, observation.z)
    const nextAggregateKey = gameplayAggregateKey(aggregate)
    aggregate.sampleCount += 1
    if (observation.dangerNearby) aggregate.dangerSampleCount += 1
    if (!previous || previous.lastAggregateKey !== nextAggregateKey) aggregate.entryCount += 1

    if (!previous && this.subjects.size >= this.maxTrackedSubjects) {
      const oldest = this.subjects.keys().next().value as string | undefined
      if (oldest) this.subjects.delete(oldest)
    }
    if (previous) this.subjects.delete(key)
    this.subjects.set(key, {
      lastAcceptedAt: observation.observedAtMs,
      lastAggregateKey: nextAggregateKey,
      lastSeenAt: observation.observedAtMs,
    })
    return true
  }

  recordEvent(observation: GameplayEventObservation): void {
    if (!Number.isFinite(observation.observedAtMs) || observation.observedAtMs < 0) throw new Error("observedAtMs must be a positive timestamp")
    incrementEvent(this.aggregateFor(observation.observedAtMs, observation.dimension, observation.x, observation.z), observation.event)
  }

  recordDiagnostic(observation: GameplayDiagnosticObservation): void {
    if (!Number.isFinite(observation.observedAtMs) || observation.observedAtMs < 0) throw new Error("observedAtMs must be a positive timestamp")
    incrementDiagnostic(this.aggregateFor(observation.observedAtMs, observation.dimension, observation.x, observation.z), observation.code)
  }

  flushReady(nowMs: number): GameplayAnalyticsBatch[] {
    const currentWindow = analyticsWindowStart(nowMs)
    return this.flushWindows([...this.windows.keys()].filter((windowStart) => windowStart < currentWindow), nowMs)
  }

  flushAll(nowMs: number): GameplayAnalyticsBatch[] {
    return this.flushWindows([...this.windows.keys()], nowMs)
  }

  pendingAggregateCount(): number {
    return this.aggregateRows
  }

  trackedSubjectCount(): number {
    return this.subjects.size
  }

  private aggregateFor(observedAtMs: number, dimensionValue: GameplayAnalyticsDimension, x: number, z: number): GameplayAnalyticsAggregate {
    const windowStart = analyticsWindowStart(observedAtMs)
    const dimension = parseGameplayAnalyticsDimension(dimensionValue)
    const cell = analyticsCellAt(x, z)
    const candidate = emptyGameplayAggregate(windowStart, dimension, cell)
    const key = gameplayAggregateKey(candidate)
    let window = this.windows.get(windowStart)
    if (!window) {
      window = new Map()
      this.windows.set(windowStart, window)
    }
    const existing = window.get(key)
    if (existing) return existing
    if (this.aggregateRows >= this.maxAggregateRows) throw new Error("gameplay analytics aggregate capacity exceeded")
    window.set(key, candidate)
    this.aggregateRows += 1
    return candidate
  }

  private flushWindows(windowStarts: number[], nowMs: number): GameplayAnalyticsBatch[] {
    if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error("nowMs must be a positive timestamp")
    const batches: GameplayAnalyticsBatch[] = []
    for (const windowStart of windowStarts.sort((left, right) => left - right)) {
      const window = this.windows.get(windowStart)
      if (!window) continue
      const rows = [...window.values()].sort((left, right) => gameplayAggregateKey(left).localeCompare(gameplayAggregateKey(right)))
      for (let offset = 0; offset < rows.length; offset += GAMEPLAY_ANALYTICS_MAX_BATCH_ROWS) {
        const aggregates = rows.slice(offset, offset + GAMEPLAY_ANALYTICS_MAX_BATCH_ROWS)
        const batchDigest = createHash("sha256")
          .update(this.batchNamespace)
          .update("\u0000")
          .update(String(windowStart))
          .update("\u0000")
          .update(String(offset / GAMEPLAY_ANALYTICS_MAX_BATCH_ROWS))
          .update("\u0000")
          .update(JSON.stringify(aggregates))
          .digest("hex")
        batches.push(parseGameplayAnalyticsBatch({
          schemaVersion: GAMEPLAY_ANALYTICS_SCHEMA_VERSION,
          batchId: `ga_${batchDigest.slice(0, 48)}`,
          createdAt: new Date(nowMs).toISOString(),
          aggregates,
        }))
      }
      this.aggregateRows -= window.size
      this.windows.delete(windowStart)
    }
    return batches
  }

  private pruneSubjects(nowMs: number): void {
    if (nowMs < this.nextPruneAt) return
    const cutoff = nowMs - this.subjectRetentionMs
    for (const [key, state] of this.subjects) if (state.lastSeenAt < cutoff) this.subjects.delete(key)
    this.nextPruneAt = nowMs + GAMEPLAY_SAMPLE_INTERVAL_MS * 30
  }
}
