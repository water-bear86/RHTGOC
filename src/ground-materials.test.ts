import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { createSherwoodGroundMaterial } from "./ground-materials"

describe("Sherwood ground materials", () => {
  it("configures repeating color and normal textures without abandoning toon lighting", () => {
    const requested: string[] = []
    const material = createSherwoodGroundMaterial("meadow", {
      repeat: { x: 32, y: 32 },
      loadTexture: (url) => {
        requested.push(url)
        return new THREE.Texture()
      },
    })

    expect(requested).toEqual([
      "/assets/environment/ground/wispy-grass-meadow-albedo.webp",
      "/assets/environment/ground/wispy-grass-meadow-normal.webp",
    ])
    expect(material).toBeInstanceOf(THREE.MeshToonMaterial)
    expect(material.map?.repeat.toArray()).toEqual([32, 32])
    expect(material.map?.colorSpace).toBe(THREE.SRGBColorSpace)
    expect(material.normalMap?.colorSpace).toBe(THREE.NoColorSpace)
    expect(material.map?.version).toBe(0)
    expect(material.normalMap?.version).toBe(0)
    expect(material.normalScale.toArray()).toEqual([0.14, 0.14])
    expect(material.emissiveIntensity).toBe(0.42)
    expect(material.gradientMap?.name).toBe("Sherwood soft ground toon ramp")
  })

  it("keeps server-side and unit-test material construction independent of the DOM", () => {
    const material = createSherwoodGroundMaterial("forest-floor")
    expect(material.name).toBe("SherwoodForestFloor")
    expect(material.map).toBeNull()
    expect(material.normalMap).toBeNull()
    expect(material.emissiveIntensity).toBe(0.22)
  })
})
