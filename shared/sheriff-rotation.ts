import { MISSION_CATALOG } from "./mission-catalog"

export const ROTATION_SCHEDULE_VERSION = "1.0.0"
export const ROTATION_DAY_MS = 86_400_000

export interface SheriffRotation {
  id: string
  scheduleVersion: string
  startsAt: number
  endsAt: number
  missionSlug: string
  missionVersion: string
  missionContentHash: string
  region: "greenwood" | "nottingham-road" | "trent-crossing"
  partySize: 2 | 3 | 4
  modifierIds: string[]
  optionalObjectiveIds: string[]
  rewardLabel: string
}

export interface SheriffRotationWindow {
  generatedAt: number
  paused: boolean
  current: SheriffRotation[]
  upcoming: SheriffRotation[]
}

function hash(input: string): number {
  let value = 2166136261
  for (const character of input) value = Math.imul(value ^ character.charCodeAt(0), 16777619)
  return value >>> 0
}

function utcDayStart(timestamp: number): number {
  const date = new Date(timestamp)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
}

function dateSlug(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function rotationsForUtcDay(timestamp: number): SheriffRotation[] {
  const startsAt = utcDayStart(timestamp)
  const endsAt = startsAt + ROTATION_DAY_MS
  const day = dateSlug(startsAt)
  const missions = [...MISSION_CATALOG.values()]
  const regions: SheriffRotation["region"][] = ["greenwood", "nottingham-road", "trent-crossing"]
  return ([2, 3, 4] as const).map((partySize) => {
    const seed = hash(`${ROTATION_SCHEDULE_VERSION}:${day}:p${partySize}`)
    const mission = missions[seed % missions.length]
    const first = seed % mission.modifiers.length
    const second = (first + 1 + (seed % (mission.modifiers.length - 1))) % mission.modifiers.length
    const objective = mission.objectives[(seed >>> 8) % mission.objectives.length]
    return {
      id: `sheriff-${day}-p${partySize}-v1`,
      scheduleVersion: ROTATION_SCHEDULE_VERSION,
      startsAt,
      endsAt,
      missionSlug: mission.slug,
      missionVersion: mission.missionVersion,
      missionContentHash: mission.contentHash,
      region: regions[(seed >>> 4) % regions.length],
      partySize,
      modifierIds: [mission.modifiers[first].id, mission.modifiers[second].id],
      optionalObjectiveIds: [objective.id],
      rewardLabel: partySize === 2 ? "Scout's writ" : partySize === 3 ? "Band bounty" : "Sheriff's grand mark",
    }
  })
}

export function rotationWindowAt(timestamp: number): SheriffRotationWindow {
  const start = utcDayStart(timestamp)
  return {
    generatedAt: timestamp,
    paused: false,
    current: rotationsForUtcDay(start),
    upcoming: rotationsForUtcDay(start + ROTATION_DAY_MS),
  }
}

export function isRotationActive(rotation: SheriffRotation, timestamp: number): boolean {
  return rotation.startsAt <= timestamp && timestamp < rotation.endsAt
}

export function validateSheriffRotation(rotation: SheriffRotation): string[] {
  const errors: string[] = []
  const mission = MISSION_CATALOG.get(rotation.missionSlug)
  if (!mission) return ["mission is not in the validated catalog"]
  if (rotation.missionVersion !== mission.missionVersion || rotation.missionContentHash !== mission.contentHash) errors.push("mission identity does not match the catalog")
  if (rotation.startsAt >= rotation.endsAt) errors.push("rotation window must have a positive duration")
  if (![2, 3, 4].includes(rotation.partySize)) errors.push("party size must be 2, 3, or 4")
  if (rotation.modifierIds.length < 1 || rotation.modifierIds.some((id) => !mission.modifiers.some((modifier) => modifier.id === id))) errors.push("rotation contains an unavailable modifier")
  if (new Set(rotation.modifierIds).size !== rotation.modifierIds.length) errors.push("rotation modifiers must be unique")
  if (rotation.optionalObjectiveIds.some((id) => !mission.objectives.some((objective) => objective.id === id))) errors.push("rotation contains an unavailable optional objective")
  return errors
}
