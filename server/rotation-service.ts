import { isRotationActive, rotationWindowAt, validateSheriffRotation, type SheriffRotation, type SheriffRotationWindow } from "../shared/sheriff-rotation"

export class SheriffRotationService {
  private replacement: SheriffRotation[] | null = null
  private pausedUntil = 0

  window(timestamp = Date.now()): SheriffRotationWindow {
    const generated = rotationWindowAt(timestamp)
    const paused = timestamp < this.pausedUntil
    const replacement = this.replacement?.filter((rotation) => isRotationActive(rotation, timestamp)) ?? []
    return {
      ...generated,
      paused,
      current: paused ? [] : replacement.length > 0 ? replacement.map((rotation) => ({ ...rotation })) : generated.current,
    }
  }

  pause(until: number, now = Date.now()): void {
    if (!Number.isFinite(until) || until <= now || until > now + 7 * 86_400_000) throw new Error("INVALID_PAUSE_WINDOW")
    this.pausedUntil = until
  }

  replace(rotations: SheriffRotation[], now = Date.now()): void {
    if (rotations.length === 0 || rotations.length > 3) throw new Error("INVALID_ROTATION_COUNT")
    for (const rotation of rotations) {
      const errors = validateSheriffRotation(rotation)
      if (errors.length > 0 || !isRotationActive(rotation, now)) throw new Error(`INVALID_ROTATION: ${errors.join(", ") || "window is not active"}`)
    }
    this.replacement = rotations.map((rotation) => ({ ...rotation, modifierIds: [...rotation.modifierIds], optionalObjectiveIds: [...rotation.optionalObjectiveIds] }))
    this.pausedUntil = 0
  }

  rollback(): void {
    this.replacement = null
    this.pausedUntil = 0
  }
}
