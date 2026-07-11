import { SHERWOOD_REGIONAL_BOUNDS, sherwoodRegionCells } from "./regional-layout"

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

  for (let i = 0; i < 112; i += 1) {
    const x = random() * SHERWOOD_REGIONAL_BOUNDS * 2 - SHERWOOD_REGIONAL_BOUNDS
    const z = random() * SHERWOOD_REGIONAL_BOUNDS * 2 - SHERWOOD_REGIONAL_BOUNDS
    const nearCellClearing = cells.some((cell) => Math.hypot(x - cell.center.x, z - cell.center.z) < 10)
    const nearRiver = Math.abs(x - 1 + z * 0.1) < 4.5
    const nearRoad = Math.abs(z - x) < 3
    if (!nearCellClearing && !nearRiver && !nearRoad) {
      trees.push(Object.freeze({ x, z, scale: 0.7 + random() * 0.7 }))
    }
  }
  return Object.freeze(trees)
}

export const SHERWOOD_TREE_LAYOUT = createSherwoodTreeLayout()
