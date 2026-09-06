import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { SHERWOOD_CAMP_HUT_LAYOUT } from "../shared/world-obstacles"
import { countVillageDrawCalls } from "./village-assets"
import {
  createStylizedBuildingBatch,
  createStylizedBuildingVisual,
  disposeStylizedBuildingVisuals,
  stylizedBuildingVariant,
  type StylizedBuildingDescriptor,
} from "./building-visuals"

function descriptor(
  id: string,
  kind: StylizedBuildingDescriptor["kind"],
  width: number,
  depth: number,
  x = 0,
): StylizedBuildingDescriptor {
  return {
    id,
    kind,
    palette: kind === "watchtower" ? "sheriff" : "village",
    position: { x, y: 0, z: 0 },
    rotation: x * 0.07,
    width,
    depth,
  }
}

function instanceMatrices(root: THREE.Object3D): number[][] {
  const values: number[][] = []
  root.traverse((object) => {
    if (!(object instanceof THREE.InstancedMesh)) return
    const matrix = new THREE.Matrix4()
    for (let index = 0; index < object.count; index += 1) {
      object.getMatrixAt(index, matrix)
      values.push(matrix.toArray())
    }
  })
  return values
}

describe("stylized building visuals", () => {
  it("renders many facade details for several silhouettes in two submissions", () => {
    const buildings = [
      descriptor("greenwood-cottage", "cottage", 3.8, 2.9, -6),
      descriptor("greenwood-barn", "barn", 5, 3.5),
      descriptor("sheriff-watchtower", "watchtower", 2.9, 2.9, 6),
    ]
    const rendered = createStylizedBuildingBatch(buildings)

    expect(countVillageDrawCalls(rendered)).toBe(2)
    expect(rendered.userData.sherwoodBuildingCount).toBe(3)
    expect(rendered.userData.sherwoodBuildingDetailInstances).toBeGreaterThan(90)
    expect(rendered.userData.sherwoodBuildingRoofInstances).toBe(3)
    expect(rendered.getObjectByName("StylizedBuildingDetails")).toBeInstanceOf(THREE.InstancedMesh)
    expect(rendered.getObjectByName("StylizedBuildingGables")).toBeInstanceOf(THREE.InstancedMesh)
  })

  it("is deterministic while giving different building IDs stable facade variants", () => {
    const first = createStylizedBuildingBatch([descriptor("cottage-a", "cottage", 3.8, 2.9)])
    const second = createStylizedBuildingBatch([descriptor("cottage-a", "cottage", 3.8, 2.9)])
    expect(instanceMatrices(first)).toEqual(instanceMatrices(second))
    expect(stylizedBuildingVariant("cottage-a")).toBe(stylizedBuildingVariant("cottage-a"))
    expect(stylizedBuildingVariant("cottage-a")).not.toBe(stylizedBuildingVariant("cottage-b"))
  })

  it.each([
    ["cottage", 3.8, 2.9],
    ["barn", 5, 3.5],
    ["watchtower", 2.9, 2.9],
    ["farmhouse", 4.7, 3.5],
  ] as const)("keeps the %s blocking body inside its declared footprint", (kind, width, depth) => {
    const rendered = createStylizedBuildingVisual({
      id: `footprint-${kind}`,
      kind,
      palette: kind === "watchtower" ? "sheriff" : "farm",
      width,
      depth,
    })
    rendered.updateMatrixWorld(true)
    const bounds = new THREE.Box3().setFromObject(rendered)

    // Roof eaves are decorative; every solid wall and post remains within the
    // collider, and the complete silhouette receives only a narrow overhang.
    expect(bounds.min.x).toBeGreaterThanOrEqual(-width / 2 - 0.26)
    expect(bounds.max.x).toBeLessThanOrEqual(width / 2 + 0.26)
    expect(bounds.min.z).toBeGreaterThanOrEqual(-depth / 2 - 0.3)
    expect(bounds.max.z).toBeLessThanOrEqual(depth / 2 + 0.3)
    expect(bounds.min.y).toBeGreaterThanOrEqual(-0.001)
  })

  const H = 2.35

  interface DecomposedBox {
    center: THREE.Vector3
    size: THREE.Vector3
  }

  function collectBoxes(root: THREE.Object3D): DecomposedBox[] {
    const details = root.getObjectByName("StylizedBuildingDetails") as THREE.InstancedMesh | null
    if (!details) return []
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const boxes: DecomposedBox[] = []
    for (let index = 0; index < details.count; index += 1) {
      details.getMatrixAt(index, matrix)
      matrix.decompose(position, quaternion, scale)
      boxes.push({ center: position.clone(), size: scale.clone() })
    }
    return boxes
  }

  function gableApexY(root: THREE.Object3D): number {
    const gables = root.getObjectByName("StylizedBuildingGables") as THREE.InstancedMesh
    const matrix = new THREE.Matrix4()
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    gables.getMatrixAt(0, matrix)
    matrix.decompose(position, quaternion, scale)
    // The gable prism's apex sits at local y = 1, so its world height is the
    // placement height plus the roof-height scale.
    return position.y + scale.y
  }

  function visual(kind: StylizedBuildingDescriptor["kind"], width: number, depth: number, id: string): THREE.Group {
    const rendered = createStylizedBuildingVisual({
      id,
      kind,
      palette: kind === "watchtower" ? "sheriff" : "village",
      width,
      depth,
    })
    rendered.updateMatrixWorld(true)
    return rendered
  }

  function nonDenseCottageId(): string {
    for (let index = 0; index < 500; index += 1) {
      const id = `cottage-scale-probe-${index}`
      if ((stylizedBuildingVariant(id) & 2) === 0) return id
    }
    throw new Error("no non-dense cottage variant found")
  }

  describe("hero-relative object scale (task 05)", () => {
    it("gives a 5.3 x 5.7 cottage a hero-relative wall, ridge, door, window and footprint", () => {
      const id = nonDenseCottageId()
      const cottage = visual("cottage", 5.3, 5.7, id)
      const boxes = collectBoxes(cottage)

      const wall = boxes.find((b) => Math.abs(b.size.x - 5.3 * 0.96) < 0.02)!
      const wallTop = wall.center.y + wall.size.y / 2
      expect(wallTop / H).toBeGreaterThanOrEqual(1.55)
      expect(wallTop / H).toBeLessThanOrEqual(1.65)

      const ridgeTop = gableApexY(cottage)
      expect(ridgeTop / H).toBeGreaterThanOrEqual(2.4)
      expect(ridgeTop / H).toBeLessThanOrEqual(2.6)

      const door = boxes.find((b) => Math.abs(b.size.y - 2.7) < 0.05)!
      expect(door.size.y).toBeCloseTo(2.7, 2)
      expect(door.size.x).toBeCloseTo(1.18, 2)

      const pane = boxes.find((b) => Math.abs(b.size.x - 1.06) < 0.02 && Math.abs(b.size.y - 1.18) < 0.02 && b.size.z < 0.1)!
      expect(pane.size.x).toBeCloseTo(1.06, 2)
      expect(pane.size.y).toBeCloseTo(1.18, 2)

      const foundation = boxes.find((b) => b.center.y < 0.2 && Math.abs(b.size.x - 5.3) < 0.02)!
      expect(foundation.size.x).toBeCloseTo(5.3, 2)
      expect(foundation.size.z).toBeCloseTo(5.7, 2)

      // No timber crosses the door opening on the front face: the header band
      // was raised to 0.86 of the wall so the clear opening is unobstructed.
      const foundationHeight = 0.26
      const doorLeft = door.center.x - door.size.x / 2
      const doorRight = door.center.x + door.size.x / 2
      const openingBottom = foundationHeight
      const openingTop = foundationHeight + 2.7 - 0.06
      const frontZ = door.center.z
      const timbers = boxes.filter((b) => (
        b !== door && b !== pane
        && Math.abs(b.center.z - frontZ) < 0.2 && b.center.z > 0
        && Math.abs(b.size.z - 0.09) < 0.05
      ))
      for (const timber of timbers) {
        const overlapsX = timber.center.x + timber.size.x / 2 > doorLeft && timber.center.x - timber.size.x / 2 < doorRight
        const overlapsY = timber.center.y + timber.size.y / 2 > openingBottom && timber.center.y - timber.size.y / 2 < openingTop
        expect(overlapsX && overlapsY).toBe(false)
      }
    })

    it("steps farmhouse, barn and watchtower up one size tier", () => {
      const farmhouse = collectBoxes(visual("farmhouse", 7.5, 5.6, "farmhouse-scale"))
      const farmWall = farmhouse.find((b) => Math.abs(b.size.x - 7.5 * 0.96) < 0.05)!
      const farmEaves = farmWall.center.y + farmWall.size.y / 2
      expect(farmEaves / H).toBeGreaterThanOrEqual(1.75)
      expect(farmEaves / H).toBeLessThanOrEqual(1.85)

      const barn = collectBoxes(visual("barn", 8, 5.6, "barn-scale"))
      const barnWall = barn.find((b) => Math.abs(b.size.x - 8 * 0.97) < 0.05)!
      const barnEaves = barnWall.center.y + barnWall.size.y / 2
      expect(barnEaves / H).toBeGreaterThanOrEqual(1.85)
      expect(barnEaves / H).toBeLessThanOrEqual(1.95)

      const watchtower = collectBoxes(visual("watchtower", 3.6, 3.6, "watchtower-scale"))
      const platform = watchtower.find((b) => Math.abs(b.size.y - 0.24) < 0.02 && b.size.x > 2)!
      expect(platform.center.y / H).toBeGreaterThanOrEqual(2.15)
      expect(platform.center.y / H).toBeLessThanOrEqual(2.25)
    })

    it("renders each camp hut at its shared collider footprint", () => {
      for (const hut of SHERWOOD_CAMP_HUT_LAYOUT) {
        const rendered = createStylizedBuildingVisual({
          id: `CampCottage:${hut.id}`,
          kind: "cottage",
          palette: "village",
          width: hut.halfExtents.x * 2,
          depth: hut.halfExtents.z * 2,
        })
        const visualHalf = rendered.userData.sherwoodVisualHalfExtents as { x: number; z: number }
        expect(Math.abs(visualHalf.x - hut.halfExtents.x)).toBeLessThanOrEqual(0.05)
        expect(Math.abs(visualHalf.z - hut.halfExtents.z)).toBeLessThanOrEqual(0.05)
      }
    })
  })

  it("disposes view-owned instance buffers without disposing shared resources", () => {
    const rendered = createStylizedBuildingBatch([descriptor("dispose-cottage", "cottage", 3.8, 2.9)])
    const instances = rendered.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh)
    const disposed = instances.map(() => vi.fn())
    instances.forEach((mesh, index) => mesh.addEventListener("dispose", disposed[index]))

    disposeStylizedBuildingVisuals(rendered)

    disposed.forEach((listener) => expect(listener).toHaveBeenCalledOnce())
  })
})
