import { describe, expect, it } from "vitest"
import {
  PUBLIC_HUB_WORLD_BOUNDS,
  SHERWOOD_PLAYER_RADIUS,
  SHERWOOD_TREE_COLLIDERS,
  VILLAGE_COTTAGE_COLLIDER,
  createSherwoodSettlementColliders,
  isSherwoodPlayerPositionBlocked,
  resolveSherwoodPlayerMovement,
} from "./world-collisions"
import { PEOPLES_PURSE_MISSION } from "./mission-catalog"
import { regionalizeMissionDefinition, riverPointAt } from "./regional-layout"

function localPoint(x: number, z: number): { x: number; z: number } {
  const collider = VILLAGE_COTTAGE_COLLIDER
  const cosine = Math.cos(collider.rotation)
  const sine = Math.sin(collider.rotation)
  return {
    x: collider.center.x + cosine * x + sine * z,
    z: collider.center.z - sine * x + cosine * z,
  }
}

function localVector(x: number, z: number): { x: number; z: number } {
  const cosine = Math.cos(VILLAGE_COTTAGE_COLLIDER.rotation)
  const sine = Math.sin(VILLAGE_COTTAGE_COLLIDER.rotation)
  return { x: cosine * x + sine * z, z: -sine * x + cosine * z }
}

function worldPointToLocal(point: { x: number; z: number }): { x: number; z: number } {
  const collider = VILLAGE_COTTAGE_COLLIDER
  const cosine = Math.cos(collider.rotation)
  const sine = Math.sin(collider.rotation)
  const x = point.x - collider.center.x
  const z = point.z - collider.center.z
  return { x: cosine * x - sine * z, z: sine * x + cosine * z }
}

describe("shared Sherwood world collision contract", () => {
  it("publishes a stable rotated cottage footprint and player radius", () => {
    expect(VILLAGE_COTTAGE_COLLIDER).toMatchObject({
      id: "sherwood-village-cottage",
      center: { x: -10, z: 14 },
      halfExtents: { x: 2.75, z: 3 },
      rotation: -0.55,
    })
    expect(SHERWOOD_PLAYER_RADIUS).toBe(0.45)
  })

  it("makes every rendered procedural tree trunk authoritative and solid", () => {
    expect(SHERWOOD_TREE_COLLIDERS.length).toBeGreaterThan(20)
    const tree = SHERWOOD_TREE_COLLIDERS.find(({ center }) => Math.abs(center.x) < 18 && Math.abs(center.z) < 18)!
    expect(isSherwoodPlayerPositionBlocked(tree.center)).toBe(true)

    const start = { x: tree.center.x - 2, z: tree.center.z }
    const resolved = resolveSherwoodPlayerMovement(start, { x: 4, z: 0 }, 24)
    expect(resolved.x).toBeLessThan(tree.center.x)
    expect(isSherwoodPlayerPositionBlocked(resolved)).toBe(false)
  })

  it("sweeps against the full cottage so a long normal tick cannot tunnel through", () => {
    const start = localPoint(-5, 0)
    const displacement = localVector(10, 0)
    const resolved = resolveSherwoodPlayerMovement(start, displacement, 22)
    const local = worldPointToLocal(resolved)

    expect(isSherwoodPlayerPositionBlocked(resolved)).toBe(false)
    expect(local.x).toBeCloseTo(-(VILLAGE_COTTAGE_COLLIDER.halfExtents.x + SHERWOOD_PLAYER_RADIUS), 5)
    expect(local.z).toBeCloseTo(0, 5)
  })

  it("removes only the inward component and preserves edge sliding", () => {
    const start = localPoint(-4, -2)
    const displacement = localVector(2, 4)
    const resolved = resolveSherwoodPlayerMovement(start, displacement, 22)
    const local = worldPointToLocal(resolved)

    expect(isSherwoodPlayerPositionBlocked(resolved)).toBe(false)
    expect(local.x).toBeCloseTo(-(VILLAGE_COTTAGE_COLLIDER.halfExtents.x + SHERWOOD_PLAYER_RADIUS), 5)
    expect(local.z).toBeGreaterThan(1.9)
  })

  it("evaluates the footprint in its authored rotation rather than as an axis-aligned box", () => {
    const rotatedInside = localPoint(0, VILLAGE_COTTAGE_COLLIDER.halfExtents.z + SHERWOOD_PLAYER_RADIUS - 0.05)
    const rotatedOutside = localPoint(0, VILLAGE_COTTAGE_COLLIDER.halfExtents.z + SHERWOOD_PLAYER_RADIUS + 0.05)

    expect(isSherwoodPlayerPositionBlocked(rotatedInside)).toBe(true)
    expect(isSherwoodPlayerPositionBlocked(rotatedOutside)).toBe(false)
  })

  it("recovers finite positions, rejects inside starts, and preserves public-hub bounds", () => {
    const recovered = resolveSherwoodPlayerMovement(
      { x: Number.NaN, z: Number.POSITIVE_INFINITY },
      { x: Number.NaN, z: Number.NEGATIVE_INFINITY },
      PUBLIC_HUB_WORLD_BOUNDS,
    )
    const depenetrated = resolveSherwoodPlayerMovement(VILLAGE_COTTAGE_COLLIDER.center, { x: 0, z: 0 }, PUBLIC_HUB_WORLD_BOUNDS)

    expect(Number.isFinite(recovered.x) && Number.isFinite(recovered.z)).toBe(true)
    expect(recovered.x).toBeGreaterThanOrEqual(PUBLIC_HUB_WORLD_BOUNDS.minX)
    expect(recovered.x).toBeLessThanOrEqual(PUBLIC_HUB_WORLD_BOUNDS.maxX)
    expect(recovered.z).toBeGreaterThanOrEqual(PUBLIC_HUB_WORLD_BOUNDS.minZ)
    expect(recovered.z).toBeLessThanOrEqual(PUBLIC_HUB_WORLD_BOUNDS.maxZ)
    expect(isSherwoodPlayerPositionBlocked(depenetrated)).toBe(false)
    expect(depenetrated.x).toBeGreaterThanOrEqual(PUBLIC_HUB_WORLD_BOUNDS.minX)
    expect(depenetrated.x).toBeLessThanOrEqual(PUBLIC_HUB_WORLD_BOUNDS.maxX)
    expect(depenetrated.z).toBeGreaterThanOrEqual(PUBLIC_HUB_WORLD_BOUNDS.minZ)
    expect(depenetrated.z).toBeLessThanOrEqual(PUBLIC_HUB_WORLD_BOUNDS.maxZ)
  })

  it("blocks the river everywhere except the two seeded crossings", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 1937).layout
    expect(isSherwoodPlayerPositionBlocked(riverPointAt(0), SHERWOOD_PLAYER_RADIUS, layout)).toBe(true)
    for (const crossing of layout.crossingPositions) {
      expect(isSherwoodPlayerPositionBlocked(crossing, SHERWOOD_PLAYER_RADIUS, layout)).toBe(false)
      const start = { x: crossing.x + 6, z: crossing.z + 0.6 }
      const crossed = resolveSherwoodPlayerMovement(start, { x: -12, z: -1.2 }, layout.worldBounds, SHERWOOD_PLAYER_RADIUS, layout)
      expect(crossed.x + 0.1 * crossed.z - 1).toBeLessThan(0)
    }
    const blocked = resolveSherwoodPlayerMovement({ x: 7, z: 0.6 }, { x: -12, z: -1.2 }, layout.worldBounds, SHERWOOD_PLAYER_RADIUS, layout)
    expect(blocked.x + 0.1 * blocked.z - 1).toBeGreaterThan(0)
  })

  it("publishes solid deterministic building footprints for composed towns", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 1937).layout
    const buildings = createSherwoodSettlementColliders(layout)
    expect(buildings.length).toBeGreaterThanOrEqual(10)
    expect(isSherwoodPlayerPositionBlocked(buildings[0].center, SHERWOOD_PLAYER_RADIUS, layout)).toBe(true)
  })
})
