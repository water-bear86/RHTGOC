import { describe, expect, it } from "vitest"
import * as THREE from "three"
import {
  APRON_HALF_EXTENT,
  HORIZON_COLOR,
  WALL_INNER_MIN,
  createHorizonBackdrop,
  generateWallTreePlacements,
  skyColorAtElevation,
} from "./horizon-backdrop"
import { countVillageDrawCalls } from "./village-assets"
import { sherwoodHeightAt } from "./sherwood-terrain"
import { createSherwoodGroundMaterial } from "./ground-materials"

// Camera geometry constants from the task brief (docs/agent-loops/04-horizon-backdrop.md):
// camera |x|,|z| never exceed 82.5; worst-case top-of-frame ray reaches 85u further out at an
// 11.8-degree top-corner half angle, with a 14.5 + 2.57 + 0.66 total vertical drop to clear.
const CAMERA_MAX_COORD = 82.5
const WORST_CASE_VERTICAL_DROP = 14.5 + 2.57 + 0.66
const TOP_CORNER_HALF_ANGLE_RAD = (11.8 * Math.PI) / 180

describe("horizon backdrop", () => {
  it("maps every non-positive elevation to the horizon colour", () => {
    for (const elevation of [-90, -30, -1, 0]) {
      expect(skyColorAtElevation(elevation).getHex()).toBe(HORIZON_COLOR)
    }
  })

  it("keeps every wall tree within the required ring band, height range, and count", () => {
    const placements = generateWallTreePlacements()
    expect(placements.length).toBeGreaterThanOrEqual(240)
    expect(placements.length).toBeLessThanOrEqual(280)
    for (const placement of placements) {
      const ring = Math.max(Math.abs(placement.x), Math.abs(placement.z))
      expect(ring).toBeGreaterThanOrEqual(96)
      expect(ring).toBeLessThanOrEqual(113)
      expect(placement.height).toBeGreaterThanOrEqual(13)
      expect(placement.height).toBeLessThanOrEqual(21)
    }
  })

  it("welds the apron to the terrain edge with no crack, and bounds the outer loop at 180", () => {
    const groundMaterial = createSherwoodGroundMaterial("meadow", { color: 0xd2dfbd, repeat: { x: 38, y: 38 } })
    const backdrop = createHorizonBackdrop({ groundMaterial })
    const apron = backdrop.group.children.find((child) => child.name === "SherwoodHorizonApron") as THREE.Mesh
    expect(apron).toBeTruthy()
    const position = apron.geometry.getAttribute("position")

    let sawInnerLoopVertex = false
    let sawOuterLoopVertex = false
    for (let index = 0; index < position.count; index += 1) {
      const x = position.getX(index)
      const y = position.getY(index)
      const z = position.getZ(index)
      const maxCoord = Math.max(Math.abs(x), Math.abs(z))
      if (Math.abs(x) === 92 || Math.abs(z) === 92) {
        sawInnerLoopVertex = true
        expect(Math.abs(y - sherwoodHeightAt(x, z))).toBeLessThan(1e-6)
      }
      if (maxCoord === APRON_HALF_EXTENT) sawOuterLoopVertex = true
      expect(maxCoord).toBeLessThanOrEqual(APRON_HALF_EXTENT)
    }
    expect(sawInnerLoopVertex).toBe(true)
    expect(sawOuterLoopVertex).toBe(true)
  })

  it("sizes the apron and wall to clear the worst-case camera geometry", () => {
    const requiredHalfExtent = CAMERA_MAX_COORD + WORST_CASE_VERTICAL_DROP / Math.tan(TOP_CORNER_HALF_ANGLE_RAD)
    expect(APRON_HALF_EXTENT).toBeGreaterThanOrEqual(requiredHalfExtent)
    expect(WALL_INNER_MIN).toBeGreaterThanOrEqual(CAMERA_MAX_COORD + 10)
  })

  it("is exactly 3 draw calls, with the dome unlit/unfogged and the rest fogged", () => {
    const groundMaterial = createSherwoodGroundMaterial("meadow", { color: 0xd2dfbd, repeat: { x: 38, y: 38 } })
    const backdrop = createHorizonBackdrop({ groundMaterial })
    expect(countVillageDrawCalls(backdrop.group)).toBe(3)

    const apron = backdrop.group.children.find((child) => child.name === "SherwoodHorizonApron") as THREE.Mesh
    const wall = backdrop.group.children.find((child) => child.name === "SherwoodHorizonTreeline") as THREE.Mesh
    const dome = backdrop.group.children.find((child) => child.name === "SherwoodSkyDome") as THREE.Mesh

    expect((dome.material as THREE.MeshBasicMaterial).fog).toBe(false)
    expect((dome.material as THREE.MeshBasicMaterial).toneMapped).toBe(false)
    expect((apron.material as THREE.MeshToonMaterial).fog).toBe(true)
    expect((wall.material as THREE.MeshToonMaterial).fog).toBe(true)
  })

  it("update() only moves the dome and never allocates new geometry or children", () => {
    const groundMaterial = createSherwoodGroundMaterial("meadow", { color: 0xd2dfbd, repeat: { x: 38, y: 38 } })
    const backdrop = createHorizonBackdrop({ groundMaterial })
    const dome = backdrop.group.children.find((child) => child.name === "SherwoodSkyDome") as THREE.Mesh
    const childCount = backdrop.group.children.length
    const vertexCounts = backdrop.group.children.map((child) => (child as THREE.Mesh).geometry.getAttribute("position").count)

    const camera = new THREE.PerspectiveCamera()
    for (let i = 0; i < 500; i += 1) {
      camera.position.set(Math.sin(i), i * 0.01, Math.cos(i))
      backdrop.update(camera)
    }

    expect(backdrop.group.children.length).toBe(childCount)
    backdrop.group.children.forEach((child, index) => {
      expect((child as THREE.Mesh).geometry.getAttribute("position").count).toBe(vertexCounts[index])
    })
    expect(dome.position.equals(camera.position)).toBe(true)
  })
})
