import { describe, expect, it } from "vitest"
import { createProceduralRoads } from "./procedural-roads"

describe("procedural road renderer", () => {
  it("creates one terrain-following ribbon per composed road", () => {
    const group = createProceduralRoads([{ id: "test", width: 3, points: [{ x: -5, z: 0 }, { x: 0, z: 4 }, { x: 5, z: 1 }] }])
    expect(group.children).toHaveLength(1)
    expect(group.children[0].name).toBe("Road_test")
  })
})

