import { z } from "zod"

const StableId = z.string().regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, "must be a stable lowercase dotted or dashed ID")
const Vec2 = z.object({ x: z.number().min(-100).max(100), z: z.number().min(-100).max(100) })
const Route = z.object({ id: z.enum(["forest", "river"]), label: z.string().min(1).max(40), position: Vec2 })

export const MissionDefinitionSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+@[0-9]+\.[0-9]+\.[0-9]+$/, "must use slug@semver"),
  slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
  missionVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  contentHash: z.string().regex(/^fnv1a32:[a-f0-9]{8}$/),
  name: z.string().min(3).max(80),
  environment: z.object({
    scene: StableId,
    characters: z.array(StableId).min(1),
    props: z.array(StableId).min(1),
    audio: z.array(StableId).min(1),
    effects: z.array(StableId).min(1),
  }),
  spawns: z.object({
    players: z.array(Vec2).length(4),
    cart: Vec2,
    village: Vec2,
    reinforcementSignal: Vec2,
    guards: z.array(z.object({ id: z.number().int().nonnegative(), position: Vec2 })).min(3),
  }),
  routes: z.object({ entry: z.array(Route).min(2), escape: z.array(Route).min(2) }),
  objectives: z.array(z.object({
    id: StableId,
    phase: z.enum(["scout", "ambush", "robbery", "pursuit", "escape", "extraction"]),
    label: z.string().min(3).max(100),
    trigger: z.string().min(3).max(100),
  })).min(6),
  modifiers: z.array(z.object({
    id: z.enum(["armored-escort", "scarce-quivers", "double-tithe", "watchful-sheriff"]),
    label: z.string().min(3).max(60),
    effect: z.string().min(3).max(120),
  })).length(4),
  mastery: z.object({
    parSeconds: z.number().int().positive(),
    thresholds: z.object({ S: z.literal(9000), A: z.literal(7500), B: z.literal(6000), C: z.literal(0) }),
    weights: z.object({ speed: z.number(), stealth: z.number(), precision: z.number(), survival: z.number(), rescues: z.number(), generosity: z.number() }),
  }),
  rewards: z.object({
    deliveryTarget: z.number().int().positive(),
    doubleTitheTarget: z.number().int().positive(),
    baseCartValue: z.number().int().positive(),
    doubleTitheCartValue: z.number().int().positive(),
  }),
  rules: z.object({
    worldBounds: z.number().positive().max(100),
    baseAmbushStuns: z.number().int().positive(),
    armoredAmbushStuns: z.number().int().positive(),
    trapLifetimeTicks: z.number().int().positive(),
  }),
}).superRefine((mission, context) => {
  const objectiveIds = mission.objectives.map((objective) => objective.id)
  if (new Set(objectiveIds).size !== objectiveIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["objectives"], message: "objective IDs must be unique" })
  for (const kind of ["entry", "escape"] as const) {
    const routeIds = mission.routes[kind].map((route) => route.id)
    if (new Set(routeIds).size !== routeIds.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ["routes", kind], message: "route IDs must be unique" })
  }
  const weights = Object.values(mission.mastery.weights).reduce((sum, value) => sum + value, 0)
  if (Math.abs(weights - 1) > 0.0001) context.addIssue({ code: z.ZodIssueCode.custom, path: ["mastery", "weights"], message: "mastery weights must sum to 1" })
})

export type MissionDefinition = z.infer<typeof MissionDefinitionSchema>

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "contentHash")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

export function missionContentHash(value: unknown): string {
  const input = canonicalize(value)
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`
}

export interface MissionValidationResult {
  success: boolean
  errors: string[]
  data?: MissionDefinition
}

export function validateMissionDefinition(value: unknown): MissionValidationResult {
  const parsed = MissionDefinitionSchema.safeParse(value)
  if (!parsed.success) {
    return { success: false, errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "mission"}: ${issue.message}`) }
  }
  const actualHash = missionContentHash(parsed.data)
  if (parsed.data.contentHash !== actualHash) {
    return { success: false, errors: [`contentHash: expected ${actualHash}, received ${parsed.data.contentHash}`] }
  }
  return { success: true, errors: [], data: parsed.data }
}

export function parseMissionDefinition(value: unknown): MissionDefinition {
  const result = validateMissionDefinition(value)
  if (!result.success || !result.data) throw new Error(`Mission package invalid:\n${result.errors.join("\n")}`)
  return result.data
}
