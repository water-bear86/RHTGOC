import peoplesPursePackage from "../missions/peoples-purse.v1.json"
import { parseMissionDefinition, type MissionDefinition } from "./mission-definition"

export const PEOPLES_PURSE_MISSION = parseMissionDefinition(peoplesPursePackage)
export const MISSION_CATALOG: ReadonlyMap<string, MissionDefinition> = new Map([[PEOPLES_PURSE_MISSION.slug, PEOPLES_PURSE_MISSION]])

export function getMissionDefinition(slug = "peoples-purse"): MissionDefinition {
  const mission = MISSION_CATALOG.get(slug)
  if (!mission) throw new Error(`MISSION_NOT_FOUND: ${slug}`)
  return mission
}
