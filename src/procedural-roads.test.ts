import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { createProceduralRoads } from "./procedural-roads"

describe("procedural road renderer", () => {
  it("creates a readable shoulder and terrain-following ribbon per composed road", () => {
    const group = createProceduralRoads([{ id: "test", width: 3, points: [{ x: -5, z: 0 }, { x: 0, z: 4 }, { x: 5, z: 1 }] }])
    expect(group.children).toHaveLength(2)
    expect(group.children.map(({ name }) => name)).toEqual(["RoadShoulder_test", "Road_test"])
    const road = group.getObjectByName("Road_test") as THREE.Mesh
    const normals = road.geometry.getAttribute("normal")
    expect(Array.from({ length: normals.count }, (_, index) => normals.getY(index))
      .every((normalY) => normalY > 0)).toBe(true)
    expect(road.geometry.userData.roadCrossSections).toBeGreaterThan(20)
    expect(road.geometry.userData.roadVerticesPerCrossSection).toBeGreaterThan(4)
  })

  it("tapers authored trailheads instead of ending in a blunt rectangle", () => {
    const group = createProceduralRoads([{
      id: "trailhead",
      width: 3,
      taperStart: true,
      points: [{ x: 0, z: 0 }, { x: 2, z: 0 }, { x: 4, z: 0 }, { x: 6, z: 0 }],
    }])
    const road = group.getObjectByName("Road_trailhead") as THREE.Mesh
    const positions = road.geometry.getAttribute("position")
    const verticesPerRow = road.geometry.userData.roadVerticesPerCrossSection as number
    const crossSections = road.geometry.userData.roadCrossSections as number
    const widthAt = (pointIndex: number): number => Math.hypot(
      positions.getX(pointIndex * verticesPerRow + verticesPerRow - 1) - positions.getX(pointIndex * verticesPerRow),
      positions.getZ(pointIndex * verticesPerRow + verticesPerRow - 1) - positions.getZ(pointIndex * verticesPerRow),
    )
    expect(widthAt(0)).toBeGreaterThan(1.2)
    expect(widthAt(0)).toBeLessThan(widthAt(Math.floor(crossSections / 2)))
    expect(widthAt(crossSections - 1)).toBeCloseTo(3)
  })

  it("joins the opening road to an irregular camp clearing", () => {
    const group = createProceduralRoads(
      [{ id: "opening", width: 3, points: [{ x: 3, z: 0 }, { x: 7, z: 0 }] }],
      { trailheadClearing: { x: 0, z: 0 } },
    )
    expect(group.children.map(({ name }) => name)).toEqual([
      "TrailheadClearingShoulder",
      "TrailheadClearing",
      "RoadShoulder_opening",
      "Road_opening",
    ])
    const clearing = group.getObjectByName("TrailheadClearing") as THREE.Mesh
    const normals = clearing.geometry.getAttribute("normal")
    expect(Array.from({ length: normals.count }, (_, index) => normals.getY(index))
      .every((normalY) => normalY > 0)).toBe(true)
    expect(clearing.geometry.getAttribute("position").count).toBeGreaterThan(150)
    expect(clearing.geometry.getAttribute("uv").count).toBe(clearing.geometry.getAttribute("position").count)
  })
})
