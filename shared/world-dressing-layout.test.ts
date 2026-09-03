import { describe, expect, it } from "vitest"
import { PEOPLES_PURSE_MISSION } from "./mission-catalog"
import { regionalizeFeasibleMissionDefinition } from "./regional-map-generator"
import {
  createSherwoodMissionDressingExclusions,
  createSherwoodMissionForestRockLayout,
} from "./world-dressing-layout"

describe("shared forest dressing layout", () => {
  it("creates a stable population of substantial rocks for rendering and collision", () => {
    const layout = regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, 4219).layout
    const first = createSherwoodMissionForestRockLayout(layout)
    const second = createSherwoodMissionForestRockLayout(layout)
    expect(first).toEqual(second)
    expect(first).toHaveLength(14)
    expect(first.every((rock) => rock.scaleX >= 0.7 && rock.scaleX <= 1.25)).toBe(true)
  })

  it("keeps shared rocks outside protected landmarks and road corridors", () => {
    const layout = regionalizeFeasibleMissionDefinition(PEOPLES_PURSE_MISSION, 1937).layout
    const rocks = createSherwoodMissionForestRockLayout(layout)
    const { exclusions, roads } = createSherwoodMissionDressingExclusions(layout)
    for (const rock of rocks) {
      expect(exclusions.every((area) => Math.hypot(rock.x - area.x, rock.z - area.z) >= area.radius)).toBe(true)
      expect(roads.every((road) => road.points.slice(1).every((point, index) => {
        const start = road.points[index]
        const dx = point.x - start.x
        const dz = point.z - start.z
        const lengthSquared = dx * dx + dz * dz
        const amount = lengthSquared < 1e-9 ? 0 : Math.max(0, Math.min(1, ((rock.x - start.x) * dx + (rock.z - start.z) * dz) / lengthSquared))
        return Math.hypot(rock.x - (start.x + dx * amount), rock.z - (start.z + dz * amount)) >= road.width / 2 + 2.4
      }))).toBe(true)
    }
  })
})
