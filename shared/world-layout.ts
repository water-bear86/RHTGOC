import { PEOPLES_PURSE_MISSION } from "./mission-catalog"

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
  const village = PEOPLES_PURSE_MISSION.spawns.village
  const cart = PEOPLES_PURSE_MISSION.spawns.cart

  for (let i = 0; i < 58; i += 1) {
    const x = random() * 48 - 24
    const z = random() * 48 - 24
    const nearVillage = Math.hypot(x - village.x, z - village.z) < 6.5
    const nearCart = Math.hypot(x - cart.x, z - cart.z) < 6
    const nearRiver = Math.abs(x - 1 - z * 0.1) < 3.8
    const nearRoad = Math.abs(z - x) < 3
    if (!nearVillage && !nearCart && !nearRiver && !nearRoad) {
      trees.push(Object.freeze({ x, z, scale: 0.7 + random() * 0.7 }))
    }
  }
  return Object.freeze(trees)
}

export const SHERWOOD_TREE_LAYOUT = createSherwoodTreeLayout()
