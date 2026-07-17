import type { MissionSnapshot } from "../shared/protocol"

export const MUSIC_TRACKS = {
  exploration: "/assets/audio/ancient-oaks-exploration.m4a",
  stealth: "/assets/audio/sherwood-surf-spy-stealth.m4a",
  "enemy-near": "/assets/audio/thicket-pursuit-enemy-near.m4a",
  pursuit: "/assets/audio/sherwood-pursuit-acoustic-metal.m4a",
  duel: "/assets/audio/outlaws-duel-flamenco.m4a",
  victory: "/assets/audio/whistle-stop-win-victory.m4a",
} as const

export type MusicState = keyof typeof MUSIC_TRACKS

export interface MusicSituation {
  running: boolean
  inHub: boolean
  outcome?: "active" | "succeeded" | "failed"
  phase: MissionSnapshot["phase"]
  threatLevel: number
}

export function musicStateForSituation(situation: MusicSituation): MusicState {
  if (situation.outcome === "succeeded") return "victory"
  if (situation.outcome === "failed") return "duel"
  if (!situation.running || situation.inHub) return "exploration"
  if (situation.phase === "pursuit" || situation.phase === "escape" || situation.threatLevel >= 3) return "pursuit"
  if (situation.threatLevel >= 2) return "enemy-near"
  if (situation.phase === "ambush" || situation.phase === "robbery" || situation.phase === "extraction") return "duel"
  if (situation.phase === "scout") return "stealth"
  return "exploration"
}
