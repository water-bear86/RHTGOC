import type { MissionDefinition } from "./mission-definition"
import {
  regionalizeMissionDefinition,
  stableSeed,
  type RegionalizedMission,
} from "./regional-layout"
import {
  validateRegionalMissionFeasibility,
  type MapFeasibilityDiagnostic,
  type MapFeasibilityResult,
} from "./map-feasibility"

export interface RejectedRegionalMapCandidate {
  layoutSeed: number
  diagnostics: MapFeasibilityDiagnostic[]
}

export interface RegionalMapGenerationReport {
  requestedSeed: number
  layoutSeed: number
  attempts: number
  rejectedCandidates: RejectedRegionalMapCandidate[]
}

export interface FeasibleRegionalizedMission extends RegionalizedMission {
  feasibility: MapFeasibilityResult
  generation: RegionalMapGenerationReport
}

export class RegionalMapGenerationError extends Error {
  readonly code = "NO_FEASIBLE_REGIONAL_LAYOUT"

  constructor(
    readonly requestedSeed: number,
    readonly rejectedCandidates: RejectedRegionalMapCandidate[],
  ) {
    const codes = [...new Set(rejectedCandidates.flatMap((candidate) => (
      candidate.diagnostics.map((diagnostic) => diagnostic.code)
    )))].sort()
    super(`${codes.length > 0 ? codes.join(",") : "unknown"} after ${rejectedCandidates.length} candidates for seed ${requestedSeed}`)
    this.name = "RegionalMapGenerationError"
  }
}

function candidateSeed(requestedSeed: number, attempt: number): number {
  return attempt === 0 ? requestedSeed : stableSeed(`regional-map:${requestedSeed}:${attempt}`)
}

/**
 * Promotes only candidates that pass the shared hard-feasibility contract.
 * Rejected seeds remain visible in the generation report for build tooling and
 * never become an implicit, untracked runtime reroll.
 */
export function regionalizeFeasibleMissionDefinition(
  base: MissionDefinition,
  requestedSeed: number,
  maximumAttempts = 32,
): FeasibleRegionalizedMission {
  const attemptLimit = Math.max(1, Math.min(128, Math.floor(maximumAttempts)))
  const rejectedCandidates: RejectedRegionalMapCandidate[] = []
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const layoutSeed = candidateSeed(requestedSeed, attempt)
    const regional = regionalizeMissionDefinition(base, layoutSeed)
    const feasibility = validateRegionalMissionFeasibility(regional)
    if (feasibility.feasible) {
      return {
        ...regional,
        feasibility,
        generation: {
          requestedSeed,
          layoutSeed,
          attempts: attempt + 1,
          rejectedCandidates,
        },
      }
    }
    rejectedCandidates.push({
      layoutSeed,
      diagnostics: feasibility.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        position: diagnostic.position ? { ...diagnostic.position } : undefined,
      })),
    })
  }
  throw new RegionalMapGenerationError(requestedSeed, rejectedCandidates)
}
