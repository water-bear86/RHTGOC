import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { sherwoodHeightAt } from "./sherwood-terrain"
import { placeObjectOnSherwoodTerrain, sherwoodTerrainNormalAt } from "./terrain-grounding"

describe("terrain prop grounding", () => {
  it("aligns broad props with the local slope and slightly beds their visible base", () => {
    const prop = new THREE.Mesh(new THREE.BoxGeometry(1.65, 1, 1.1))
    const x = -26
    const z = 18
    placeObjectOnSherwoodTerrain(prop, x, z, 0.7)

    const bounds = new THREE.Box3().setFromObject(prop)
    expect(bounds.min.y).toBeCloseTo(sherwoodHeightAt(x, z) - 0.04, 5)
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(prop.quaternion).angleTo(
      sherwoodTerrainNormalAt(x, z),
    )).toBeLessThan(0.00001)
  })
})
