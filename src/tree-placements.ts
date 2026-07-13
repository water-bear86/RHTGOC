import type { SherwoodTreePlacement } from "../shared/world-layout"

export const TREE_VARIANT_NAMES = [
  "TreeVariant_Common_1",
  "TreeVariant_Common_2",
  "TreeVariant_Common_3",
  "TreeVariant_Common_4",
  "TreeVariant_Common_5",
  "TreeVariant_Pine_2",
  "TreeVariant_Pine_5",
  "TreeVariant_Dead_3",
] as const

export type TreeVariantName = (typeof TREE_VARIANT_NAMES)[number]

export interface AuthoredTreePlacement extends SherwoodTreePlacement {
  variantName: TreeVariantName
  rotation: number
  height: number
  visualRadius: number
}

const COMMON_VARIANTS = TREE_VARIANT_NAMES.slice(0, 5)
const TAU = Math.PI * 2

function variantForIndex(index: number): TreeVariantName {
  if (index % 29 === 0) return "TreeVariant_Dead_3"
  if (index % 11 === 0) return "TreeVariant_Pine_2"
  if (index % 7 === 0) return "TreeVariant_Pine_5"
  return COMMON_VARIANTS[index % COMMON_VARIANTS.length]
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

/** Adds stable visual variety without changing authoritative tree positions. */
export function createAuthoredTreePlacements(
  placements: readonly SherwoodTreePlacement[],
): readonly AuthoredTreePlacement[] {
  return placements.map((placement, index) => {
    const variantName = variantForIndex(index)
    const heightFactor = variantName.includes("Pine") ? 5.8 : variantName.includes("Dead") ? 4.8 : 5.25
    return Object.freeze({
      ...placement,
      variantName,
      rotation: positiveModulo(index * 2.399963 + placement.x * 0.173 + placement.z * 0.127, TAU),
      height: placement.scale * heightFactor,
      visualRadius: placement.scale * 1.15,
    })
  })
}
