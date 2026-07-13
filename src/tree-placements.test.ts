import { describe, expect, it } from "vitest"
import { SHERWOOD_TREE_LAYOUT } from "../shared/world-layout"
import { createAuthoredTreePlacements, TREE_VARIANT_NAMES } from "./tree-placements"

describe("authored tree placements", () => {
  it("preserves the authoritative layout while adding deterministic variety", () => {
    const first = createAuthoredTreePlacements(SHERWOOD_TREE_LAYOUT)
    const second = createAuthoredTreePlacements(SHERWOOD_TREE_LAYOUT)

    expect(first).toEqual(second)
    expect(first).toHaveLength(SHERWOOD_TREE_LAYOUT.length)
    first.forEach((tree, index) => {
      expect(tree.x).toBe(SHERWOOD_TREE_LAYOUT[index].x)
      expect(tree.z).toBe(SHERWOOD_TREE_LAYOUT[index].z)
      expect(tree.scale).toBe(SHERWOOD_TREE_LAYOUT[index].scale)
      expect(tree.height).toBeGreaterThan(3)
      expect(tree.rotation).toBeGreaterThanOrEqual(0)
      expect(tree.rotation).toBeLessThan(Math.PI * 2)
    })
  })

  it("uses every curated catalog silhouette", () => {
    const used = new Set(createAuthoredTreePlacements(SHERWOOD_TREE_LAYOUT).map((tree) => tree.variantName))
    expect(used).toEqual(new Set(TREE_VARIANT_NAMES))
  })
})
