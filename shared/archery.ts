export const ARCHERY_TICK_RATE = 20

export const BOW_DRAW_SECONDS = 0.6
export const BOW_RECOVERY_SECONDS = 0.4
export const BOW_TOTAL_SECONDS = BOW_DRAW_SECONDS + BOW_RECOVERY_SECONDS

export const BOW_DRAW_TICKS = Math.round(BOW_DRAW_SECONDS * ARCHERY_TICK_RATE)
export const BOW_RECOVERY_TICKS = Math.round(BOW_RECOVERY_SECONDS * ARCHERY_TICK_RATE)
export const BOW_TOTAL_TICKS = BOW_DRAW_TICKS + BOW_RECOVERY_TICKS

export const BOW_COOLDOWN_SECONDS = 0.7
export const BOW_RANGE = 9
export const BOW_MOVEMENT_EPSILON = 0.001
export const SIGNATURE_ACTION_SECONDS = 0.9
export const SIGNATURE_ACTION_TICKS = Math.round(SIGNATURE_ACTION_SECONDS * ARCHERY_TICK_RATE)

export type BowActionPhase = "drawing" | "recovery"

export interface BowActionSnapshot {
  phase: BowActionPhase
  startedAtTick: number
  releaseAtTick: number
  endsAtTick: number
}

export function createBowAction(startedAtTick: number): BowActionSnapshot {
  return {
    phase: "drawing",
    startedAtTick,
    releaseAtTick: startedAtTick + BOW_DRAW_TICKS,
    endsAtTick: startedAtTick + BOW_TOTAL_TICKS,
  }
}

export function bowActionAtTick(action: BowActionSnapshot, tick: number): BowActionSnapshot | null {
  if (tick >= action.endsAtTick) return null
  if (tick < action.releaseAtTick || action.phase === "recovery") return action
  return { ...action, phase: "recovery" }
}

export function hasBowMovement(move: { x: number; z: number }): boolean {
  return Math.hypot(move.x, move.z) > BOW_MOVEMENT_EPSILON
}
