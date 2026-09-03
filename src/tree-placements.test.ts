import { describe, expect, it } from "vitest"
import { SHERWOOD_TREE_LAYOUT } from "../shared/world-layout"
import { createAuthoredTreePlacements, TREE_VARIANT_NAMES } from "./tree-placements"

describe("authored tree placements", () => {
  it("preserves the authoritative layout while adding deterministic variety", () => {
    const first = createAuthoredTreePlacements(SHERWOOD_TREE_LAYOUT)
    const second = createAuthoredTreePlacements(SHERWOOD_TREE_LAYOUT)

    expect(first).toEqual(second)
    expect(first).toHaveLength(SHERWOOD_TREE_LAYOUT.length)
    expect(first.length).toBeGreaterThanOrEqual(300)
    expect(first.length).toBeLessThanOrEqual(420)
    first.forEach((tree, index) => {
      expect(tree.x).toBe(SHERWOOD_TREE_LAYOUT[index].x)
      expect(tree.z).toBe(SHERWOOD_TREE_LAYOUT[index].z)
      expect(tree.scale).toBe(SHERWOOD_TREE_LAYOUT[index].scale)
      if (tree.variantName === "TreeVariant_Stump") {
        expect(tree.height).toBeGreaterThan(0.7)
        expect(tree.height).toBeLessThan(2.2)
      } else {
        expect(tree.height).toBeGreaterThan(7)
        expect(tree.height).toBeLessThan(16)
      }
      expect(tree.rotation).toBeGreaterThanOrEqual(0)
      expect(tree.rotation).toBeLessThan(Math.PI * 2)
    })
  })

  it("uses every curated catalog silhouette", () => {
    const trees = createAuthoredTreePlacements(SHERWOOD_TREE_LAYOUT)
    const used = new Set(trees.map((tree) => tree.variantName))
    expect(used).toEqual(new Set(TREE_VARIANT_NAMES))

    const livingBroadleafCount = trees.filter((tree) => tree.variantName.includes("Common")).length
    const pineCount = trees.filter((tree) => tree.variantName.includes("Pine")).length
    const twistedCount = trees.filter((tree) => tree.variantName.includes("Twisted")).length
    expect(livingBroadleafCount).toBeGreaterThan(pineCount)
    expect(pineCount).toBeGreaterThan(twistedCount * 2)
    expect(twistedCount).toBeGreaterThanOrEqual(10)
  })
})
