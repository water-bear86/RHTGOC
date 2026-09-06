import { describe, expect, it } from "vitest"
import {
  PUBLIC_HUB_WORLD_BOUNDS,
  SHERWOOD_CROSSING_HALF_LENGTH,
  SHERWOOD_PLAYER_RADIUS,
  SHERWOOD_RIDGE_ROCK_COLLIDERS,
  SHERWOOD_TREE_COLLIDERS,
  VILLAGE_COTTAGE_COLLIDER,
  createSherwoodFarmColliders,
  createSherwoodSettlementColliders,
  createSherwoodMissionRockColliders,
  createSherwoodTopologyColliders,
  isSherwoodPlayerPositionBlocked,
  resolveSherwoodCombinedMovement,
  resolveSherwoodPlayerMovement,
} from "./world-collisions"
import { SHERWOOD_FARM_LAYOUT } from "./world-landmarks-layout"
import { PEOPLES_PURSE_MISSION } from "./mission-catalog"
import { regionalizeMissionDefinition, riverPointAt } from "./regional-layout"
import { composeSherwoodWorld } from "./world-composer"
import { SHERWOOD_RIDGE_SEGMENTS } from "./world-topology"
import { SHERWOOD_CAMP_HUT_LAYOUT, SHERWOOD_CAMP_HUT_OBSTACLES, SHERWOOD_STATIC_OBSTACLES } from "./world-obstacles"

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
      halfExtents: { x: 2.65, z: 2.85 },
      rotation: -0.55,
    })
    // The cottage collider is exactly 1.25x the authored GLB envelope so the
    // GLB LOD0 and the procedural LOD1 share one footprint.
    expect(VILLAGE_COTTAGE_COLLIDER.halfExtents.x).toBeCloseTo(1.25 * 2.12, 3)
    expect(VILLAGE_COTTAGE_COLLIDER.halfExtents.z).toBeCloseTo(1.25 * 2.28, 3)
    expect(SHERWOOD_PLAYER_RADIUS).toBe(0.45)
  })

  it("keeps the three hero-scaled camp huts solid, disjoint and clear of spawn, trees and the board", () => {
    // Each obstacle mirrors the shared layout exactly (renderer reads the same).
    expect(SHERWOOD_CAMP_HUT_OBSTACLES).toHaveLength(3)
    SHERWOOD_CAMP_HUT_LAYOUT.forEach((hut, index) => {
      const obstacle = SHERWOOD_CAMP_HUT_OBSTACLES[index]
      expect(obstacle.center).toEqual({ x: hut.x, z: hut.z })
      expect(obstacle.halfExtents).toEqual(hut.halfExtents)
      expect(obstacle.rotation).toBe(hut.rotation)
      // Every hut is a solid hub collider.
      expect(SHERWOOD_STATIC_OBSTACLES.some((o) => o.id === hut.id)).toBe(true)
      expect(isSherwoodPlayerPositionBlocked({ x: hut.x, z: hut.z }, 0)).toBe(true)
    })

    const toLocal = (px: number, pz: number, h: typeof SHERWOOD_CAMP_HUT_LAYOUT[number]) => {
      const c = Math.cos(h.rotation)
      const s = Math.sin(h.rotation)
      const x = px - h.x
      const z = pz - h.z
      return { x: c * x - s * z, z: s * x + c * z }
    }
    const inside = (px: number, pz: number, h: typeof SHERWOOD_CAMP_HUT_LAYOUT[number]) => {
      const l = toLocal(px, pz, h)
      return Math.abs(l.x) <= h.halfExtents.x && Math.abs(l.z) <= h.halfExtents.z
    }
    const nearestEdge = (px: number, pz: number, h: typeof SHERWOOD_CAMP_HUT_LAYOUT[number]) => {
      const l = toLocal(px, pz, h)
      return Math.hypot(Math.max(0, Math.abs(l.x) - h.halfExtents.x), Math.max(0, Math.abs(l.z) - h.halfExtents.z))
    }
    const corners = (h: typeof SHERWOOD_CAMP_HUT_LAYOUT[number]) => {
      const c = Math.cos(h.rotation)
      const s = Math.sin(h.rotation)
      const pts: { x: number; z: number }[] = []
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const lx = sx * h.halfExtents.x
        const lz = sz * h.halfExtents.z
        pts.push({ x: h.x + c * lx + s * lz, z: h.z - s * lx + c * lz })
      }
      return pts
    }
    const overlaps = (a: typeof SHERWOOD_CAMP_HUT_LAYOUT[number], b: typeof SHERWOOD_CAMP_HUT_LAYOUT[number]) => {
      const axesOf = (h: typeof SHERWOOD_CAMP_HUT_LAYOUT[number]) => {
        const c = Math.cos(h.rotation)
        const s = Math.sin(h.rotation)
        return [{ x: c, z: -s }, { x: s, z: c }]
      }
      const ca = corners(a)
      const cb = corners(b)
      for (const ax of [...axesOf(a), ...axesOf(b)]) {
        let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity
        for (const p of ca) { const d = p.x * ax.x + p.z * ax.z; amin = Math.min(amin, d); amax = Math.max(amax, d) }
        for (const p of cb) { const d = p.x * ax.x + p.z * ax.z; bmin = Math.min(bmin, d); bmax = Math.max(bmax, d) }
        if (amax < bmin || bmax < amin) return false
      }
      return true
    }

    // No two huts overlap.
    for (let i = 0; i < SHERWOOD_CAMP_HUT_LAYOUT.length; i += 1) {
      for (let j = i + 1; j < SHERWOOD_CAMP_HUT_LAYOUT.length; j += 1) {
        expect(overlaps(SHERWOOD_CAMP_HUT_LAYOUT[i], SHERWOOD_CAMP_HUT_LAYOUT[j])).toBe(false)
      }
    }
    // The two newly collidered huts clear the 4.5 spawn ring around (-11, 9)
    // with the player radius to spare; the pre-existing front cottage is left
    // in place (spawn depenetration already handles it).
    for (const hut of SHERWOOD_CAMP_HUT_LAYOUT.filter((h) => h.id !== "sherwood-village-cottage")) {
      expect(nearestEdge(-11, 9, hut)).toBeGreaterThanOrEqual(5.5)
    }
    // Hub-box layout trees and the mission board are outside every hut.
    for (const [tx, tz] of [[-15.1, 5.9], [-17.2, 7.1], [-10.4, 4.0]] as const) {
      expect(SHERWOOD_CAMP_HUT_LAYOUT.some((h) => inside(tx, tz, h))).toBe(false)
    }
    expect(SHERWOOD_CAMP_HUT_LAYOUT.some((h) => inside(-7.6, 8.6, h))).toBe(false)
  })

  it("keeps the fixed cottage solid in the hub but removes it from generated missions", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 19).layout
    expect(isSherwoodPlayerPositionBlocked(VILLAGE_COTTAGE_COLLIDER.center, 0)).toBe(true)
    expect(isSherwoodPlayerPositionBlocked(VILLAGE_COTTAGE_COLLIDER.center, 0, layout)).toBe(false)
  })

  it("makes every rendered procedural tree trunk authoritative and solid", () => {
    expect(SHERWOOD_TREE_COLLIDERS.length).toBeGreaterThanOrEqual(300)
    expect(SHERWOOD_TREE_COLLIDERS.length).toBeLessThanOrEqual(420)
    const tree = SHERWOOD_TREE_COLLIDERS[0]
    expect(isSherwoodPlayerPositionBlocked(tree.center)).toBe(true)

    const start = { x: tree.center.x - 2, z: tree.center.z }
    const resolved = resolveSherwoodPlayerMovement(start, { x: 4, z: 0 }, 67)
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

  it("makes medium forest rocks and ancient standing stones authoritative", () => {
    const layout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, 4219).layout
    const rocks = createSherwoodMissionRockColliders(layout)
    expect(rocks.filter(({ id }) => id.startsWith("sherwood-forest-rock-"))).toHaveLength(14)
    expect(rocks.filter(({ id }) => id.startsWith("sherwood-standing-stone-"))).toHaveLength(7)
    for (const rock of rocks) {
      expect(isSherwoodPlayerPositionBlocked(rock.center, SHERWOOD_PLAYER_RADIUS, layout)).toBe(true)
    }

    const rock = rocks[0]
    const direction = { x: Math.cos(rock.rotation), z: -Math.sin(rock.rotation) }
    const start = { x: rock.center.x - direction.x * 3, z: rock.center.z - direction.z * 3 }
    const resolved = resolveSherwoodPlayerMovement(start, {
      x: direction.x * 6,
      z: direction.z * 6,
    }, layout.worldBounds, SHERWOOD_PLAYER_RADIUS, layout)
    expect(isSherwoodPlayerPositionBlocked(resolved, SHERWOOD_PLAYER_RADIUS, layout)).toBe(false)
    const resolvedAlongApproach = (resolved.x - rock.center.x) * direction.x
      + (resolved.z - rock.center.z) * direction.z
    expect(resolvedAlongApproach).toBeLessThan(0)
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

  it("gives the windmill and farmhouse solid footprints matching their rendered size (seeds 1..24)", () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      const seedLayout = regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, seed).layout
      const colliders = createSherwoodFarmColliders(seedLayout)
      expect(colliders).toHaveLength(2)
      const windmill = colliders.find((c) => c.id === "sherwood-farm-windmill")!
      const farmhouse = colliders.find((c) => c.id === "sherwood-farm-farmhouse")!

      // Windmill: base radius 3.9 boxed to ~3.9 * 0.87 half-square.
      expect(Math.abs(windmill.halfExtents.x - 3.9 * 0.87)).toBeLessThanOrEqual(0.05)
      expect(windmill.halfExtents.x).toBe(windmill.halfExtents.z)
      // Farmhouse: equals the rendered visual half extents (7.5 x 5.6).
      expect(Math.abs(farmhouse.halfExtents.x - SHERWOOD_FARM_LAYOUT.farmhouse.halfExtents.x)).toBeLessThanOrEqual(0.05)
      expect(Math.abs(farmhouse.halfExtents.z - SHERWOOD_FARM_LAYOUT.farmhouse.halfExtents.z)).toBeLessThanOrEqual(0.05)
      expect(farmhouse.halfExtents.x).toBeCloseTo(3.75, 5)
      expect(farmhouse.halfExtents.z).toBeCloseTo(2.8, 5)

      // Both are authoritative solids in their own mission layout.
      expect(isSherwoodPlayerPositionBlocked(windmill.center, SHERWOOD_PLAYER_RADIUS, seedLayout)).toBe(true)
      expect(isSherwoodPlayerPositionBlocked(farmhouse.center, SHERWOOD_PLAYER_RADIUS, seedLayout)).toBe(true)
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
