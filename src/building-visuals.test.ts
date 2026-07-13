import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"
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

  it("disposes view-owned instance buffers without disposing shared resources", () => {
    const rendered = createStylizedBuildingBatch([descriptor("dispose-cottage", "cottage", 3.8, 2.9)])
    const instances = rendered.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh)
    const disposed = instances.map(() => vi.fn())
    instances.forEach((mesh, index) => mesh.addEventListener("dispose", disposed[index]))

    disposeStylizedBuildingVisuals(rendered)

    disposed.forEach((listener) => expect(listener).toHaveBeenCalledOnce())
  })
})
