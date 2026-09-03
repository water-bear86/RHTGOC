import { SHERWOOD_RIDGE_SEGMENTS } from "./world-topology"

export interface SherwoodRidgeRockPlacement {
  x: number
  z: number
  rotation: number
  scale: Readonly<{ x: number; y: number; z: number }>
  color: number
}

/** Stable large-boulder data shared by rendering, routing, and collision. */
export function createSherwoodRidgeRockLayout(): readonly SherwoodRidgeRockPlacement[] {
  return Object.freeze(SHERWOOD_RIDGE_SEGMENTS.flatMap((segment, segmentIndex) => {
    const dx = segment.end.x - segment.start.x
    const dz = segment.end.z - segment.start.z
    const length = Math.max(0.001, Math.hypot(dx, dz))
    const normal = { x: -dz / length, z: dx / length }
    return [0.22, 0.5, 0.78].map((amount, rockIndex) => {
      const side = (segmentIndex + rockIndex) % 2 === 0 ? -1 : 1
      const offset = side * (segment.collisionHalfWidth + 1.2 + rockIndex * 0.35)
      return Object.freeze({
        x: segment.start.x + dx * amount + normal.x * offset,
        z: segment.start.z + dz * amount + normal.z * offset,
        rotation: Math.atan2(dz, dx) + rockIndex * 0.7,
        scale: Object.freeze({
          x: 1.45 + (segmentIndex + rockIndex) % 3 * 0.55,
          y: 1.3 + (segmentIndex * 2 + rockIndex) % 4 * 0.28,
          z: 1.2 + (segmentIndex + rockIndex * 2) % 3 * 0.42,
        }),
        color: (segmentIndex + rockIndex) % 3 === 0 ? 0x5c6458 : 0x697063,
      })
    })
  }))
}

export const SHERWOOD_RIDGE_ROCK_LAYOUT = createSherwoodRidgeRockLayout()
