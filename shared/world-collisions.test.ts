import { describe, expect, it } from "vitest"
import {
  PUBLIC_HUB_WORLD_BOUNDS,
  SHERWOOD_CROSSING_HALF_LENGTH,
  SHERWOOD_PLAYER_RADIUS,
  SHERWOOD_RIDGE_ROCK_COLLIDERS,
  SHERWOOD_TREE_COLLIDERS,
  VILLAGE_COTTAGE_COLLIDER,
  createSherwoodSettlementColliders,
  createSherwoodTopologyColliders,
  isSherwoodPlayerPositionBlocked,
  resolveSherwoodCombinedMovement,
  resolveSherwoodPlayerMovement,
} from "./world-collisions"
import { PEOPLES_PURSE_MISSION } from "./mission-catalog"
import { regionalizeMissionDefinition, riverPointAt } from "./regional-layout"
import { composeSherwoodWorld } from "./world-composer"
import { SHERWOOD_RIDGE_SEGMENTS } from "./world-topology"

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
    const tree = SHERWOOD_TREE_COLLIDERS[0]
    expect(isSherwoodPlayerPositionBlocked(tree.center)).toBe(true)

    const start = { x: tree.center.x - 2, z: tree.center.z }
    const resolved = resolveSherwoodPlayerMovement(start, { x: 4, z: 0 }, 64)
    expect(resolved.x).toBeLessThan(tree.center.x)
    expect(isSherwoodPlayerPositionBlocked(resolved)).toBe(false)
  })

  it("makes every large rendered ridge boulder authoritative and solid", () => {
    expect(SHERWOOD_RIDGE_ROCK_COLLIDERS).toHaveLength(18)
    for (const rock of SHERWOOD_RIDGE_ROCK_COLLIDERS) {
      expect(isSherwoodPlayerPositionBlocked(rock.center)).toBe(true)
    }

    const rock = SHERWOOD_RIDGE_ROCK_COLLIDERS[0]
    const start = { x: rock.center.x - 5, z: rock.center.z }
    const resolved = resolveSherwoodPlayerMovement(start, { x: 10, z: 0 }, 64)
    expect(resolved.x).toBeLessThan(rock.center.x)
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

  it("keeps circle sliding from pushing a valid result back inside a building", () => {
    const start = { x: -15, z: 8 }
    const guard = { x: -14, z: 10.5 }
    const resolved = resolveSherwoodCombinedMovement(start, { x: 6, z: 5 }, {
      worldBounds: 22,
      circleBlockers: [guard],
      circleSeparation: 1,
    })

    expect(isSherwoodPlayerPositionBlocked(resolved)).toBe(false)
    expect(Math.hypot(resolved.x - guard.x, resolved.z - guard.z)).toBeGreaterThanOrEqual(1)
    expect(Math.hypot(resolved.x - start.x, resolved.z - start.z)).toBeGreaterThan(0.5)
  })

  it("keeps the seed-zero crossing guard from sliding a player into the river bank", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 0).layout
    const start = { x: 9.373601996327949, z: -37.13394306944951 }
    const displacement = { x: -0.688392923813165, z: 0.08255269235650076 }
    const guard = { x: 9.678431707424417, z: -37.51852131274919 }
    const resolved = resolveSherwoodCombinedMovement(start, displacement, {
      worldBounds: layout.worldBounds,
      layout,
      circleBlockers: [guard],
      circleSeparation: 1,
    })

    expect(isSherwoodPlayerPositionBlocked(resolved, SHERWOOD_PLAYER_RADIUS, layout)).toBe(false)
    expect(Math.hypot(resolved.x - guard.x, resolved.z - guard.z)).toBeGreaterThanOrEqual(1)
  })

  it("evaluates the footprint in its authored rotation rather than as an axis-aligned box", () => {
    const rotatedInside = localPoint(0, -(VILLAGE_COTTAGE_COLLIDER.halfExtents.z + SHERWOOD_PLAYER_RADIUS - 0.05))
    const rotatedOutside = localPoint(0, -(VILLAGE_COTTAGE_COLLIDER.halfExtents.z + SHERWOOD_PLAYER_RADIUS + 0.05))

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

  it("keeps every rendered road corridor traversable across representative world seeds", () => {
    for (const seed of [1, 1937, 4219, 7777, 99991]) {
      const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, seed).layout
      const world = composeSherwoodWorld(layout)
      for (const road of world.roads) {
        for (let pointIndex = 1; pointIndex < road.points.length; pointIndex += 1) {
          const start = road.points[pointIndex - 1]
          const end = road.points[pointIndex]
          const dx = end.x - start.x
          const dz = end.z - start.z
          const length = Math.max(0.001, Math.hypot(dx, dz))
          const samples = Math.max(1, Math.ceil(length / 0.35))
          for (const lateralOffset of [-road.width / 2, 0, road.width / 2]) {
            for (let sample = 0; sample <= samples; sample += 1) {
              const amount = sample / samples
              const position = {
                x: start.x + dx * amount - dz / length * lateralOffset,
                z: start.z + dz * amount + dx / length * lateralOffset,
              }
              expect(
                isSherwoodPlayerPositionBlocked(position, SHERWOOD_PLAYER_RADIUS, layout),
                `seed ${seed}, ${road.id}, segment ${pointIndex}, offset ${lateralOffset}, sample ${sample}`,
              ).toBe(false)
            }
          }
        }

        for (let pointIndex = 1; pointIndex < road.points.length; pointIndex += 1) {
          const start = road.points[pointIndex - 1]
          const end = road.points[pointIndex]
          const startSide = start.x + 0.1 * start.z - 1
          const endSide = end.x + 0.1 * end.z - 1
          if (startSide * endSide > 0) continue
          const amount = Math.abs(startSide - endSide) < 1e-9 ? 0 : startSide / (startSide - endSide)
          const crossingZ = start.z + (end.z - start.z) * Math.max(0, Math.min(1, amount))
          expect(
            layout.crossingPositions.some((crossing) => Math.abs(crossing.z - crossingZ) <= SHERWOOD_CROSSING_HALF_LENGTH),
            `seed ${seed}, ${road.id} crossed the river away from a named gap`,
          ).toBe(true)
        }
      }
    }
  })

  it("keeps authored ridge crests walkable without weakening visible obstacles", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 4219).layout
    const topology = createSherwoodTopologyColliders(layout)
    const secondRead = createSherwoodTopologyColliders(layout)
    expect(topology).toBe(secondRead)
    expect(topology).toEqual([])

    const walkableCrests = SHERWOOD_RIDGE_SEGMENTS.map((ridge) => {
      const crest = {
        x: (ridge.start.x + ridge.end.x) / 2,
        z: (ridge.start.z + ridge.end.z) / 2,
      }
      return isSherwoodPlayerPositionBlocked(crest, SHERWOOD_PLAYER_RADIUS, layout) ? null : crest
    }).filter((crest): crest is { x: number; z: number } => crest !== null)
    expect(walkableCrests.length).toBeGreaterThanOrEqual(4)

    expect(isSherwoodPlayerPositionBlocked(SHERWOOD_TREE_COLLIDERS[0].center, SHERWOOD_PLAYER_RADIUS, layout)).toBe(true)
    expect(isSherwoodPlayerPositionBlocked(riverPointAt(0), SHERWOOD_PLAYER_RADIUS, layout)).toBe(true)
    expect(isSherwoodPlayerPositionBlocked(createSherwoodSettlementColliders(layout)[0].center, SHERWOOD_PLAYER_RADIUS, layout)).toBe(true)
  })
})
