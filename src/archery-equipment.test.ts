import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { createArcheryEquipment, createBow, createQuiver, setBowDraw } from "./archery-equipment"

describe("shared archery equipment", () => {
  it("builds distinct named bow variants", () => {
    expect(createBow("longbow").name).toBe("equipment.bow.longbow")
    expect(createBow("recurve").name).toBe("equipment.bow.recurve")
    expect(createBow("shortbow").name).toBe("equipment.bow.shortbow")
  })

  it("builds a reusable four-arrow quiver", () => {
    const quiver = createQuiver()
    expect(quiver.children.filter((child) => child.name.startsWith("QuiverArrow"))).toHaveLength(4)
  })

  it("scales the bow and quiver as one character kit", () => {
    const { bow, quiver } = createArcheryEquipment("shortbow", 0.8)
    expect(bow.scale.x).toBeCloseTo(0.8)
    expect(quiver.scale.x).toBeCloseTo(0.704)
  })

  it("draws a two-segment string and exposes a nocked arrow", () => {
    const bow = createBow("longbow")
    const upper = bow.getObjectByName("BowStringUpper")!
    const restPosition = upper.position.clone()
    setBowDraw(bow, 1, true)
    expect(upper.position.equals(restPosition)).toBe(false)
    expect(bow.getObjectByName("BowNockedArrow")?.visible).toBe(true)
    setBowDraw(bow, 0, false)
    expect(bow.getObjectByName("BowNockedArrow")?.visible).toBe(false)
  })

  it("reuses a bounded palette and casts shadows only from major forms", () => {
    const { group } = createArcheryEquipment("recurve")
    const materials = new Set<THREE.Material>()
    let shadowCasters = 0
    group.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      materials.add(object.material as THREE.Material)
      if (object.castShadow) shadowCasters += 1
    })
    expect(materials.size).toBeLessThanOrEqual(7)
    expect(shadowCasters).toBeLessThanOrEqual(2)
  })
})
