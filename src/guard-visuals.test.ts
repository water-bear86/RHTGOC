import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import {
  GUARD_VISUAL_VARIANTS,
  createGuardVisual,
  guardVisualVariant,
  poseGuardVisual,
  synchronizeGuardVisualsById,
} from "./guard-visuals"

function ancestorNames(object: THREE.Object3D | undefined): string[] {
  const names: string[] = []
  let current = object?.parent ?? null
  while (current) {
    names.push(current.name)
    current = current.parent
  }
  return names
}

describe("procedural Sheriff guards", () => {
  it("assigns all three appearances deterministically from stable ids", () => {
    expect([0, 1, 2].map(guardVisualVariant)).toEqual(GUARD_VISUAL_VARIANTS)
    expect(guardVisualVariant(7)).toBe(guardVisualVariant(7))
    expect(guardVisualVariant(-7)).toBe(guardVisualVariant(7))
  })

  it("builds a jointed, connected low-poly rig within the render budget", () => {
    for (const id of [0, 1, 2]) {
      const guard = createGuardVisual(id)
      const meshes: THREE.Mesh[] = []
      guard.traverse((object) => {
        if (object instanceof THREE.Mesh) meshes.push(object)
      })

      expect(guard.userData.guardId).toBe(id)
      expect(guard.userData.guardVariant).toBe(guardVisualVariant(id))
      expect(guard.getObjectByName("GuardRigTorso")).toBeTruthy()
      expect(guard.getObjectByName("GuardRigLeftArm")).toBeTruthy()
      expect(guard.getObjectByName("GuardRigRightLeg")).toBeTruthy()
      expect(ancestorNames(guard.getObjectByName("GuardWeaponSocket"))).toContain("GuardRigRightArm")
      expect(meshes.length).toBeLessThanOrEqual(12)
      expect(meshes.filter((mesh) => mesh.castShadow)).toHaveLength(4)
    }
  })

  it("poses walking, alert, and stunned states without mutating world facing", () => {
    const guard = createGuardVisual(1)
    guard.rotation.y = 1.25
    poseGuardVisual(guard, { elapsed: 0.2, moving: true, alert: false, stunned: false })
    const leftLeg = guard.getObjectByName("GuardRigLeftLeg")!
    const rightLeg = guard.getObjectByName("GuardRigRightLeg")!
    expect(leftLeg.rotation.x).toBeCloseTo(-rightLeg.rotation.x)

    poseGuardVisual(guard, { elapsed: 0.2, moving: false, alert: true, stunned: false })
    expect(guard.getObjectByName("GuardRigRightArm")!.rotation.x).toBeLessThan(-0.4)
    expect(guard.getObjectByName("GuardAlertMarker")?.visible).toBe(true)
    expect(guard.getObjectByName("GuardRecoveryRing")?.visible).toBe(false)

    poseGuardVisual(guard, { elapsed: 0.2, moving: false, alert: true, stunned: true, stunnedFor: 1.5 })
    expect(guard.getObjectByName("GuardRigBodyRoot")!.rotation.z).toBeGreaterThan(1)
    expect(guard.getObjectByName("GuardAlertMarker")?.visible).toBe(false)
    expect(guard.getObjectByName("GuardRecoveryRing")?.visible).toBe(true)
    expect(guard.getObjectByName("GuardRecoveryRing")?.scale.x).not.toBe(1)
    expect(guard.rotation.y).toBe(1.25)
  })

  it("reorders views by guard id and disposes only identities removed by snapshots", () => {
    const zero = createGuardVisual(0)
    const one = createGuardVisual(1)
    const removed = createGuardVisual(8)
    const views = [zero, one, removed]
    const attach = vi.fn()
    const detach = vi.fn()

    synchronizeGuardVisualsById(views, [{ id: 1 }, { id: 0 }, { id: 5 }], attach, detach)

    expect(views[0]).toBe(one)
    expect(views[1]).toBe(zero)
    expect(views[2].userData.guardId).toBe(5)
    expect(attach).toHaveBeenCalledWith(views[2])
    expect(detach).toHaveBeenCalledWith(removed)
  })
})
