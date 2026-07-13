import { SHERWOOD_REGIONAL_BOUNDS, sherwoodRegionCells } from "./regional-layout"

export interface SherwoodTreePlacement {
  x: number
  z: number
  scale: number
}

export interface SherwoodRidgeRockPlacement {
  x: number
  z: number
  rotation: number
  scale: Readonly<{ x: number; y: number; z: number }>
  color: number
}

/**
 * Stable large-boulder layout shared by rendering and authoritative collision.
 * Small forest-floor stones remain nonblocking dressing by design.
 */
export function createSherwoodRidgeRockLayout(): readonly SherwoodRidgeRockPlacement[] {
  return Object.freeze(Array.from({ length: 22 }, (_, index) => {
    const rotation = index * 1.71
    const radius = 25 + (index % 5) * 7
    return Object.freeze({
      x: Math.cos(rotation) * radius,
      z: Math.sin(rotation * 0.87) * radius,
      rotation,
      scale: Object.freeze({
        x: 1.4 + index % 3,
        y: 1.25 + index % 4 * 0.35,
        z: 1.2 + index % 2,
      }),
      color: index % 3 === 0 ? 0x5c6458 : 0x697063,
    })
  }))
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

  for (let i = 0; i < 420; i += 1) {
    const x = random() * SHERWOOD_REGIONAL_BOUNDS * 2 - SHERWOOD_REGIONAL_BOUNDS
    const z = random() * SHERWOOD_REGIONAL_BOUNDS * 2 - SHERWOOD_REGIONAL_BOUNDS
    const nearCellClearing = cells.some((cell) => Math.hypot(x - cell.center.x, z - cell.center.z) < 10)
    const nearRiver = Math.abs(x - 1 + z * 0.1) < 9
    const nearRoad = Math.abs(z - x) < 3
    const nearVillageCottage = Math.hypot(x + 10, z - 14) < 9
    const nearFarmCorner = [[-48, -48], [48, -48], [-48, 48], [48, 48]]
      .some(([farmX, farmZ]) => Math.hypot(x - farmX, z - farmZ) < 14)
    if (!nearCellClearing && !nearRiver && !nearRoad && !nearFarmCorner && !nearVillageCottage) {
      trees.push(Object.freeze({ x, z, scale: 0.7 + random() * 0.7 }))
    }
  }
  return Object.freeze(trees)
}

export const SHERWOOD_TREE_LAYOUT = createSherwoodTreeLayout()
export const SHERWOOD_RIDGE_ROCK_LAYOUT = createSherwoodRidgeRockLayout()
