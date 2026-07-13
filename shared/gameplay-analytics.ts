export const GAMEPLAY_ANALYTICS_SCHEMA_VERSION = 1 as const
export const GAMEPLAY_SAMPLE_INTERVAL_MS = 1_000
export const GAMEPLAY_AGGREGATION_WINDOW_MS = 5 * 60 * 1_000
export const GAMEPLAY_SPATIAL_CELL_METERS = 8
export const GAMEPLAY_ANALYTICS_MAX_BATCH_ROWS = 1_000

const SAFE_SLUG = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const SAFE_VERSION = /^[a-z0-9][a-z0-9._:-]*$/
const SAFE_BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const SAFE_BATCH_ID = /^ga_[a-f0-9]{32,64}$/
const MAX_COUNTER = 1_000_000_000
const AGGREGATE_KEYS = [
  "windowStart",
  "missionSlug",
  "mapVersion",
  "buildId",
  "phase",
  "experimentId",
  "experimentRevision",
  "variantId",
  "cellX",
  "cellZ",
  "sampleCount",
  "entryCount",
  "dangerSampleCount",
  "objectiveInteractionCount",
  "downedCount",
  "stuckRecoveryCount",
  "clientErrorCount",
  "webglContextLostCount",
  "assetLoadFailedCount",
  "uncaughtErrorCount",
  "unhandledRejectionCount",
  "frameStallCount",
  "snapshotDesyncCount",
  "missionStartCount",
  "missionSuccessCount",
  "missionFailureCount",
] as const
const METRIC_KEYS = [
  "sampleCount",
  "entryCount",
  "dangerSampleCount",
  "objectiveInteractionCount",
  "downedCount",
  "stuckRecoveryCount",
  "clientErrorCount",
  "webglContextLostCount",
  "assetLoadFailedCount",
  "uncaughtErrorCount",
  "unhandledRejectionCount",
  "frameStallCount",
  "snapshotDesyncCount",
  "missionStartCount",
  "missionSuccessCount",
  "missionFailureCount",
] as const
const BATCH_KEYS = ["schemaVersion", "batchId", "createdAt", "aggregates"] as const

export interface GameplayExperimentDimension {
  experimentId: string | null
  experimentRevision: number | null
  variantId: string | null
}

export interface GameplayAnalyticsDimension extends GameplayExperimentDimension {
  missionSlug: string
  mapVersion: string
  buildId: string
  phase: string
}

export interface GameplayAnalyticsAggregate extends GameplayAnalyticsDimension {
  windowStart: string
  cellX: number
  cellZ: number
  sampleCount: number
  entryCount: number
  dangerSampleCount: number
  objectiveInteractionCount: number
  downedCount: number
  stuckRecoveryCount: number
  clientErrorCount: number
  webglContextLostCount: number
  assetLoadFailedCount: number
  uncaughtErrorCount: number
  unhandledRejectionCount: number
  frameStallCount: number
  snapshotDesyncCount: number
  missionStartCount: number
  missionSuccessCount: number
  missionFailureCount: number
}

export interface GameplayAnalyticsBatch {
  schemaVersion: typeof GAMEPLAY_ANALYTICS_SCHEMA_VERSION
  batchId: string
  createdAt: string
  aggregates: GameplayAnalyticsAggregate[]
}

export type GameplayAnalyticsEvent =
  | "objective-interaction"
  | "player-downed"
  | "stuck-recovery"
  | "client-error"
  | "mission-start"
  | "mission-success"
  | "mission-failure"

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(record).filter((key) => !allowed.includes(key))
  const missing = allowed.filter((key) => !(key in record))
  if (unexpected.length > 0) throw new Error(`${label} contains unsupported fields: ${unexpected.sort().join(", ")}`)
  if (missing.length > 0) throw new Error(`${label} is missing fields: ${missing.join(", ")}`)
}

function safeString(value: unknown, label: string, pattern: RegExp, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || !pattern.test(value)) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function boundedInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

function canonicalIso(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be an ISO timestamp`)
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error(`${label} must be a canonical ISO timestamp`)
  }
  return value
}

export function analyticsWindowStart(observedAtMs: number): number {
  if (!Number.isFinite(observedAtMs) || observedAtMs < 0) throw new Error("observedAtMs must be a positive timestamp")
  return Math.floor(observedAtMs / GAMEPLAY_AGGREGATION_WINDOW_MS) * GAMEPLAY_AGGREGATION_WINDOW_MS
}

export function analyticsCellAt(x: number, z: number): Readonly<{ cellX: number; cellZ: number }> {
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 1_024 || Math.abs(z) > 1_024) {
    throw new Error("gameplay position is outside the analytics envelope")
  }
  return Object.freeze({
    cellX: Math.floor(x / GAMEPLAY_SPATIAL_CELL_METERS),
    cellZ: Math.floor(z / GAMEPLAY_SPATIAL_CELL_METERS),
  })
}

export function parseGameplayAnalyticsDimension(value: unknown): GameplayAnalyticsDimension {
  const record = plainRecord(value, "gameplay analytics dimension")
  exactKeys(record, ["missionSlug", "mapVersion", "buildId", "phase", "experimentId", "experimentRevision", "variantId"], "gameplay analytics dimension")
  const missionSlug = safeString(record.missionSlug, "missionSlug", SAFE_SLUG, 60)
  const mapVersion = safeString(record.mapVersion, "mapVersion", SAFE_VERSION, 64)
  const buildId = safeString(record.buildId, "buildId", SAFE_BUILD_ID, 80)
  const phase = safeString(record.phase, "phase", SAFE_SLUG, 32)
  const experimentId = record.experimentId === null ? null : safeString(record.experimentId, "experimentId", SAFE_SLUG, 60)
  const experimentRevision = record.experimentRevision === null ? null : boundedInteger(record.experimentRevision, "experimentRevision", 1, 1_000_000)
  const variantId = record.variantId === null ? null : safeString(record.variantId, "variantId", SAFE_SLUG, 40)
  const experimentFields = [experimentId, experimentRevision, variantId]
  if (experimentFields.some((entry) => entry === null) && experimentFields.some((entry) => entry !== null)) {
    throw new Error("experiment analytics fields must be all null or all populated")
  }
  return { missionSlug, mapVersion, buildId, phase, experimentId, experimentRevision, variantId }
}

export function parseGameplayAnalyticsAggregate(value: unknown): GameplayAnalyticsAggregate {
  const record = plainRecord(value, "gameplay analytics aggregate")
  exactKeys(record, AGGREGATE_KEYS, "gameplay analytics aggregate")
  const dimension = parseGameplayAnalyticsDimension({
    missionSlug: record.missionSlug,
    mapVersion: record.mapVersion,
    buildId: record.buildId,
    phase: record.phase,
    experimentId: record.experimentId,
    experimentRevision: record.experimentRevision,
    variantId: record.variantId,
  })
  const windowStart = canonicalIso(record.windowStart, "windowStart")
  if (Date.parse(windowStart) % GAMEPLAY_AGGREGATION_WINDOW_MS !== 0) throw new Error("windowStart must align to a five-minute boundary")
  const aggregate: GameplayAnalyticsAggregate = {
    windowStart,
    ...dimension,
    cellX: boundedInteger(record.cellX, "cellX", -128, 128),
    cellZ: boundedInteger(record.cellZ, "cellZ", -128, 128),
    sampleCount: boundedInteger(record.sampleCount, "sampleCount", 0, MAX_COUNTER),
    entryCount: boundedInteger(record.entryCount, "entryCount", 0, MAX_COUNTER),
    dangerSampleCount: boundedInteger(record.dangerSampleCount, "dangerSampleCount", 0, MAX_COUNTER),
    objectiveInteractionCount: boundedInteger(record.objectiveInteractionCount, "objectiveInteractionCount", 0, MAX_COUNTER),
    downedCount: boundedInteger(record.downedCount, "downedCount", 0, MAX_COUNTER),
    stuckRecoveryCount: boundedInteger(record.stuckRecoveryCount, "stuckRecoveryCount", 0, MAX_COUNTER),
    clientErrorCount: boundedInteger(record.clientErrorCount, "clientErrorCount", 0, MAX_COUNTER),
    webglContextLostCount: boundedInteger(record.webglContextLostCount, "webglContextLostCount", 0, MAX_COUNTER),
    assetLoadFailedCount: boundedInteger(record.assetLoadFailedCount, "assetLoadFailedCount", 0, MAX_COUNTER),
    uncaughtErrorCount: boundedInteger(record.uncaughtErrorCount, "uncaughtErrorCount", 0, MAX_COUNTER),
    unhandledRejectionCount: boundedInteger(record.unhandledRejectionCount, "unhandledRejectionCount", 0, MAX_COUNTER),
    frameStallCount: boundedInteger(record.frameStallCount, "frameStallCount", 0, MAX_COUNTER),
    snapshotDesyncCount: boundedInteger(record.snapshotDesyncCount, "snapshotDesyncCount", 0, MAX_COUNTER),
    missionStartCount: boundedInteger(record.missionStartCount, "missionStartCount", 0, MAX_COUNTER),
    missionSuccessCount: boundedInteger(record.missionSuccessCount, "missionSuccessCount", 0, MAX_COUNTER),
    missionFailureCount: boundedInteger(record.missionFailureCount, "missionFailureCount", 0, MAX_COUNTER),
  }
  const metricTotal = METRIC_KEYS.reduce((sum, key) => sum + aggregate[key], 0)
  if (metricTotal === 0) throw new Error("gameplay analytics aggregate must contain at least one metric")
  if (aggregate.dangerSampleCount > aggregate.sampleCount) throw new Error("dangerSampleCount cannot exceed sampleCount")
  return aggregate
}

export function parseGameplayAnalyticsBatch(value: unknown): GameplayAnalyticsBatch {
  const record = plainRecord(value, "gameplay analytics batch")
  exactKeys(record, BATCH_KEYS, "gameplay analytics batch")
  if (record.schemaVersion !== GAMEPLAY_ANALYTICS_SCHEMA_VERSION) throw new Error("unsupported gameplay analytics schema version")
  const batchId = safeString(record.batchId, "batchId", SAFE_BATCH_ID, 67)
  const createdAt = canonicalIso(record.createdAt, "createdAt")
  if (!Array.isArray(record.aggregates) || record.aggregates.length < 1 || record.aggregates.length > GAMEPLAY_ANALYTICS_MAX_BATCH_ROWS) {
    throw new Error(`aggregates must contain 1-${GAMEPLAY_ANALYTICS_MAX_BATCH_ROWS} rows`)
  }
  return {
    schemaVersion: GAMEPLAY_ANALYTICS_SCHEMA_VERSION,
    batchId,
    createdAt,
    aggregates: record.aggregates.map(parseGameplayAnalyticsAggregate),
  }
}

export function gameplayAggregateKey(aggregate: Pick<GameplayAnalyticsAggregate,
  "windowStart" | "missionSlug" | "mapVersion" | "buildId" | "phase" | "experimentId" | "experimentRevision" | "variantId" | "cellX" | "cellZ"
>): string {
  return [
    aggregate.windowStart,
    aggregate.missionSlug,
    aggregate.mapVersion,
    aggregate.buildId,
    aggregate.phase,
    aggregate.experimentId ?? "",
    aggregate.experimentRevision ?? 0,
    aggregate.variantId ?? "",
    aggregate.cellX,
    aggregate.cellZ,
  ].join("|")
}

export function emptyGameplayAggregate(
  windowStartMs: number,
  dimension: GameplayAnalyticsDimension,
  cell: Readonly<{ cellX: number; cellZ: number }>,
): GameplayAnalyticsAggregate {
  const parsedDimension = parseGameplayAnalyticsDimension(dimension)
  if (analyticsWindowStart(windowStartMs) !== windowStartMs) throw new Error("windowStartMs must align to a five-minute boundary")
  return {
    windowStart: new Date(windowStartMs).toISOString(),
    ...parsedDimension,
    ...cell,
    sampleCount: 0,
    entryCount: 0,
    dangerSampleCount: 0,
    objectiveInteractionCount: 0,
    downedCount: 0,
    stuckRecoveryCount: 0,
    clientErrorCount: 0,
    webglContextLostCount: 0,
    assetLoadFailedCount: 0,
    uncaughtErrorCount: 0,
    unhandledRejectionCount: 0,
    frameStallCount: 0,
    snapshotDesyncCount: 0,
    missionStartCount: 0,
    missionSuccessCount: 0,
    missionFailureCount: 0,
  }
}
