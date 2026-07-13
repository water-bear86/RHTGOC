export const EXPERIMENT_BUCKETS = 10_000

const SAFE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const SAFE_CONFIG_KEY = /^[a-z][a-zA-Z0-9]{0,39}$/
const DEFINITION_KEYS = ["id", "revision", "salt", "allocationBps", "variants"] as const
const VARIANT_KEYS = ["id", "weightBps", "config"] as const

export type ExperimentConfigValue = string | number | boolean
export type ExperimentConfig = Readonly<Record<string, ExperimentConfigValue>>

export interface ExperimentVariant {
  id: string
  weightBps: number
  config: ExperimentConfig
}

export interface GameplayExperimentDefinition {
  id: string
  revision: number
  salt: string
  allocationBps: number
  variants: ExperimentVariant[]
}

export interface RoomExperimentAssignment {
  experimentId: string
  experimentRevision: number
  variantId: string
  enrollmentBucket: number
  variantBucket: number
  config: ExperimentConfig
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  const extra = Object.keys(record).filter((key) => !keys.includes(key))
  const missing = keys.filter((key) => !(key in record))
  if (extra.length > 0) throw new Error(`${label} contains unsupported fields: ${extra.sort().join(", ")}`)
  if (missing.length > 0) throw new Error(`${label} is missing fields: ${missing.join(", ")}`)
}

function safeId(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || !SAFE_ID.test(value)) throw new Error(`${label} is invalid`)
  return value
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}

function parseConfig(value: unknown): ExperimentConfig {
  const record = plainRecord(value, "experiment variant config")
  const entries = Object.entries(record)
  if (entries.length > 16) throw new Error("experiment variant config cannot exceed 16 fields")
  const parsed: Record<string, ExperimentConfigValue> = {}
  for (const [key, child] of entries) {
    if (!SAFE_CONFIG_KEY.test(key)) throw new Error(`experiment config key is invalid: ${key}`)
    if (typeof child === "string") {
      if (child.length > 120) throw new Error(`experiment config value is too long: ${key}`)
      parsed[key] = child
    } else if (typeof child === "number") {
      if (!Number.isFinite(child) || Math.abs(child) > 1_000_000) throw new Error(`experiment config number is invalid: ${key}`)
      parsed[key] = child
    } else if (typeof child === "boolean") parsed[key] = child
    else throw new Error(`experiment config values must be scalar: ${key}`)
  }
  return Object.freeze(parsed)
}

export function parseGameplayExperimentDefinition(value: unknown): GameplayExperimentDefinition {
  const record = plainRecord(value, "gameplay experiment definition")
  exactKeys(record, DEFINITION_KEYS, "gameplay experiment definition")
  const id = safeId(record.id, "experiment id", 60)
  const revision = integer(record.revision, "experiment revision", 1, 1_000_000)
  const salt = safeId(record.salt, "experiment salt", 80)
  const allocationBps = integer(record.allocationBps, "experiment allocationBps", 1, EXPERIMENT_BUCKETS)
  if (!Array.isArray(record.variants) || record.variants.length < 2 || record.variants.length > 8) {
    throw new Error("an experiment must define 2-8 variants")
  }
  const variants = record.variants.map((value, index): ExperimentVariant => {
    const variant = plainRecord(value, `experiment variant ${index}`)
    exactKeys(variant, VARIANT_KEYS, `experiment variant ${index}`)
    return {
      id: safeId(variant.id, `experiment variant ${index} id`, 40),
      weightBps: integer(variant.weightBps, `experiment variant ${index} weightBps`, 1, EXPERIMENT_BUCKETS),
      config: parseConfig(variant.config),
    }
  })
  if (new Set(variants.map((variant) => variant.id)).size !== variants.length) throw new Error("experiment variant ids must be unique")
  if (variants.reduce((sum, variant) => sum + variant.weightBps, 0) !== EXPERIMENT_BUCKETS) {
    throw new Error(`experiment variant weights must total ${EXPERIMENT_BUCKETS}`)
  }
  return { id, revision, salt, allocationBps, variants }
}

function stableHash(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function bucketFor(definition: GameplayExperimentDefinition, roomScope: string, purpose: "enrollment" | "variant"): number {
  return stableHash(`${definition.salt}\u0000${definition.id}\u0000${definition.revision}\u0000${purpose}\u0000${roomScope}`) % EXPERIMENT_BUCKETS
}

/**
 * Assigns one opaque room scope to an experiment. The scope is used only as
 * hash input and is deliberately absent from the returned/persisted result.
 */
export function assignRoomExperiment(value: unknown, roomScope: string): RoomExperimentAssignment | null {
  const definition = parseGameplayExperimentDefinition(value)
  if (typeof roomScope !== "string" || roomScope.length < 1 || roomScope.length > 128) throw new Error("roomScope must be a bounded opaque runtime key")
  const enrollmentBucket = bucketFor(definition, roomScope, "enrollment")
  if (enrollmentBucket >= definition.allocationBps) return null
  const variantBucket = bucketFor(definition, roomScope, "variant")
  let boundary = 0
  const selected = definition.variants.find((variant) => {
    boundary += variant.weightBps
    return variantBucket < boundary
  }) ?? definition.variants[definition.variants.length - 1]
  return {
    experimentId: definition.id,
    experimentRevision: definition.revision,
    variantId: selected.id,
    enrollmentBucket,
    variantBucket,
    config: Object.freeze({ ...selected.config }),
  }
}
