import { describe, expect, it } from "vitest"
import { createArcheryEquipment, createBow, createQuiver } from "./archery-equipment"

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
})
