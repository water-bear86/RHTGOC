import type { SherwoodTreePlacement } from "../shared/world-layout"

export const TREE_VARIANT_NAMES = [
  "TreeVariant_Common_1",
  "TreeVariant_Common_2",
  "TreeVariant_Common_3",
  "TreeVariant_Common_4",
  "TreeVariant_Pine_2",
  "TreeVariant_Pine_5",
  "TreeVariant_Dead_3",
  "TreeVariant_Twisted_1",
  "TreeVariant_Twisted_5",
  "TreeVariant_Pine_3",
  "TreeVariant_Stump",
] as const

export type TreeVariantName = (typeof TREE_VARIANT_NAMES)[number]

export interface AuthoredTreePlacement extends SherwoodTreePlacement {
  variantName: TreeVariantName
  rotation: number
  height: number
  visualRadius: number
}

const COMMON_VARIANTS = TREE_VARIANT_NAMES.slice(0, 4)
const PINE_VARIANTS = [
  "TreeVariant_Pine_2",
  "TreeVariant_Pine_3",
  "TreeVariant_Pine_5",
] as const satisfies readonly TreeVariantName[]
const TWISTED_VARIANTS = [
  "TreeVariant_Twisted_1",
  "TreeVariant_Twisted_5",
] as const satisfies readonly TreeVariantName[]
const TAU = Math.PI * 2

function variantForPlacement(placement: SherwoodTreePlacement, index: number): TreeVariantName {
  if (index % 47 === 0) return "TreeVariant_Stump"
  if (index % 31 === 0) return "TreeVariant_Dead_3"

  // Broad cells make related silhouettes gather into groves while the second
  // hash prevents a grove from reading as cloned rows.
  const groveX = Math.floor((placement.x + 120) / 18)
  const groveZ = Math.floor((placement.z + 120) / 18)
  const groveHash = positiveModulo(Math.imul(groveX, 73_856_093) ^ Math.imul(groveZ, 19_349_663), 100)
  const memberHash = positiveModulo(Math.imul(index + 1, 83_492_791) ^ Math.imul(groveHash + 11, 2_971_215_073), 1000)

  if (groveHash < 12) return TWISTED_VARIANTS[memberHash % TWISTED_VARIANTS.length]
  if (groveHash < 45) return PINE_VARIANTS[memberHash % PINE_VARIANTS.length]
  return COMMON_VARIANTS[memberHash % COMMON_VARIANTS.length]
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus
}

/** Adds stable visual variety without changing authoritative tree positions. */
export function createAuthoredTreePlacements(
  placements: readonly SherwoodTreePlacement[],
): readonly AuthoredTreePlacement[] {
  return placements.map((placement, index) => {
    const variantName = variantForPlacement(placement, index)
    const heightFactor = variantName.includes("Stump")
      ? 1.25
      : variantName.includes("Pine")
        ? 10.8
        : variantName.includes("Dead")
          ? 9.6
          : variantName.includes("Twisted")
            ? 9.8
            : 10.4
    return Object.freeze({
      ...placement,
      variantName,
      rotation: positiveModulo(index * 2.399963 + placement.x * 0.173 + placement.z * 0.127, TAU),
      height: placement.scale * heightFactor,
      visualRadius: placement.scale * (variantName.includes("Stump") ? 0.7 : 1.35),
    })
  })
}
