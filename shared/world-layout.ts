import { SHERWOOD_REGIONAL_BOUNDS, sherwoodRegionCells } from "./regional-layout"
import {
  SHERWOOD_PASSES,
  SHERWOOD_RIDGE_SEGMENTS,
  SHERWOOD_SETTLEMENT_SITES,
} from "./world-topology"
export {
  SHERWOOD_RIDGE_ROCK_LAYOUT,
  createSherwoodRidgeRockLayout,
  type SherwoodRidgeRockPlacement,
} from "./world-ridge-rock-layout"

export interface SherwoodTreePlacement {
  x: number
  z: number
  scale: number
}

/**
 * Stable seeded forest shared by rendering and authoritative collision.
 * Changing this layout is a world-data migration, not a view-only tweak.
 */
export function createSherwoodTreeLayout(): readonly SherwoodTreePlacement[] {
  let seed = 1937
  const random = (): number => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  const trees: SherwoodTreePlacement[] = []
  const cells = sherwoodRegionCells()

  const canPlant = (x: number, z: number): boolean => {
    if (Math.abs(x) > SHERWOOD_REGIONAL_BOUNDS - 1 || Math.abs(z) > SHERWOOD_REGIONAL_BOUNDS - 1) return false
    if (Math.abs(x - 1 + z * 0.1) < 9) return false
    if (cells.some((cell) => Math.hypot(x - cell.center.x, z - cell.center.z) < 9.2)) return false
    if (SHERWOOD_PASSES.some((pass) => Math.hypot(x - pass.position.x, z - pass.position.z) < pass.radius + 2.6)) return false
    if (SHERWOOD_SETTLEMENT_SITES.some((site) => Math.hypot(x - site.center.x, z - site.center.z) < site.radius + 1.8)) return false
    return !trees.some((tree) => Math.hypot(x - tree.x, z - tree.z) < 1.55)
  }

  for (const [segmentIndex, segment] of SHERWOOD_RIDGE_SEGMENTS.entries()) {
    const dx = segment.end.x - segment.start.x
    const dz = segment.end.z - segment.start.z
    const length = Math.max(0.001, Math.hypot(dx, dz))
    const normal = { x: -dz / length, z: dx / length }
    for (let sample = 0; sample < 42; sample += 1) {
      const amount = (sample + 0.35 + random() * 0.3) / 42
      const side = (sample + segmentIndex) % 2 === 0 ? -1 : 1
      const offset = side * (segment.visualHalfWidth * (0.48 + random() * 0.46))
      const x = segment.start.x + dx * amount + normal.x * offset + (random() - 0.5) * 2.8
      const z = segment.start.z + dz * amount + normal.z * offset + (random() - 0.5) * 2.8
      if (canPlant(x, z)) trees.push(Object.freeze({ x, z, scale: 0.72 + random() * 0.62 }))
    }
  }

  const boundaryGroves = [
    { x: -61, z: -32 }, { x: -61, z: 32 },
    { x: 61, z: -32 }, { x: 61, z: 32 },
    { x: -32, z: -61 }, { x: 32, z: -61 },
    { x: -32, z: 61 }, { x: 32, z: 61 },
  ]
  for (const grove of boundaryGroves) {
    for (let sample = 0; sample < 22; sample += 1) {
      const angle = random() * Math.PI * 2
      const radius = Math.sqrt(random()) * 9
      const x = grove.x + Math.cos(angle) * radius
      const z = grove.z + Math.sin(angle) * radius
      if (canPlant(x, z)) trees.push(Object.freeze({ x, z, scale: 0.76 + random() * 0.68 }))
    }
  }
  return Object.freeze(trees)
}

export const SHERWOOD_TREE_LAYOUT = createSherwoodTreeLayout()
