import type { ContributionType, VoteChoice } from "./protocol"
import type { SheriffRotationWindow } from "./sheriff-rotation"
import { MISSION_CATALOG } from "./mission-catalog"

export const SEASON_PROJECT_THRESHOLDS = [600, 1_800, 3_600] as const

export type SeasonPhase = "active" | "paused" | "finale" | "succeeded" | "failed" | "archived"

export interface SeasonProject {
  id: VoteChoice
  label: string
  total: number
  tier: 0 | 1 | 2 | 3
  nextThreshold: number | null
}

export interface SeasonRecognition {
  generosity: number
  rescues: number
  cleanEscapes: number
  tactical: number
}

export interface SherwoodSeasonSnapshot {
  id: string
  slug: string
  name: string
  phase: SeasonPhase
  startsAt: number
  endsAt: number
  pressure: number
  projects: Record<VoteChoice, SeasonProject>
  finale: { attempts: number; successes: number; target: number; maxAttempts: number }
  recognition: SeasonRecognition
  revision: number
  archivedAt: number | null
}

export interface SeasonalMissionOutcome {
  eventId: string
  occurredAt: number
  status: "succeeded" | "failed"
  project: VoteChoice | null
  communityCoin: number
  rescues: number
  cleanEscape: boolean
  tacticalScore: number
  rotationId: string | null
}

export interface SeasonalContributionOutcome {
  eventId: string
  occurredAt: number
  type: ContributionType
}

export function projectTier(total: number): 0 | 1 | 2 | 3 {
  if (total >= SEASON_PROJECT_THRESHOLDS[2]) return 3
  if (total >= SEASON_PROJECT_THRESHOLDS[1]) return 2
  if (total >= SEASON_PROJECT_THRESHOLDS[0]) return 1
  return 0
}

export function campaignRotationWindow(base: SheriffRotationWindow, season: SherwoodSeasonSnapshot): SheriffRotationWindow {
  if (season.phase !== "active" && season.phase !== "finale") return base
  return {
    ...base,
    current: base.current.map((rotation) => {
      const mission = MISSION_CATALOG.get(rotation.missionSlug)!
      const modifierIds = [...rotation.modifierIds]
      const pressureModifiers = season.pressure >= 70 ? ["watchful-sheriff", "armored-escort"] : season.pressure >= 35 ? ["armored-escort"] : []
      for (const modifierId of pressureModifiers) {
        if (modifierIds.length >= 3) break
        if (!modifierIds.includes(modifierId) && mission.modifiers.some((modifier) => modifier.id === modifierId)) modifierIds.push(modifierId)
      }
      return {
        ...rotation,
        modifierIds,
        rewardLabel: season.phase === "finale" ? `Finale mark · ${rotation.rewardLabel}` : rotation.rewardLabel,
      }
    }),
  }
}
