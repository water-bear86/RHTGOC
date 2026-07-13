import * as THREE from "three"
import { createToonMaterial } from "./toon-materials"

export const GUARD_VISUAL_VARIANTS = ["levy", "man-at-arms", "sergeant"] as const
export type GuardVisualVariant = typeof GUARD_VISUAL_VARIANTS[number]

export interface GuardPose {
  elapsed: number
  moving: boolean
  alert: boolean
  stunned: boolean
  motionScale?: number
}

interface GuardRig {
  guardId: number
  bodyRoot: THREE.Group
  torso: THREE.Group
  head: THREE.Group
  leftArm: THREE.Group
  rightArm: THREE.Group
  leftLeg: THREE.Group
  rightLeg: THREE.Group
  weapon: THREE.Group
}

interface GuardIdentity {
  id: number
}

function stableGuardId(id: number): number {
  return Number.isFinite(id) ? Math.abs(Math.trunc(id)) : 0
}

export function guardVisualVariant(id: number): GuardVisualVariant {
  return GUARD_VISUAL_VARIANTS[stableGuardId(id) % GUARD_VISUAL_VARIANTS.length]
}

function createGuardFactory() {
  const materials = new Map<number, THREE.MeshToonMaterial>()
  const material = (color: number): THREE.MeshToonMaterial => {
    const cached = materials.get(color)
    if (cached) return cached
    const next = createToonMaterial({ color })
    next.flatShading = true
    next.needsUpdate = true
    materials.set(color, next)
    return next
  }
  const mesh = (name: string, geometry: THREE.BufferGeometry, color: number, castShadow = false): THREE.Mesh => {
    const next = new THREE.Mesh(geometry, material(color))
    next.name = name
    next.castShadow = castShadow
    next.receiveShadow = true
    return next
  }
  return { mesh }
}

function namedGroup(name: string): THREE.Group {
  const group = new THREE.Group()
  group.name = name
  return group
}

export function createGuardVisual(guardId: number): THREE.Group {
  const variant = guardVisualVariant(guardId)
  const { mesh } = createGuardFactory()
  const root = namedGroup(`character.sheriff.guard.${variant}`)
  const bodyRoot = namedGroup("GuardRigBodyRoot")
  const torso = namedGroup("GuardRigTorso")
  const head = namedGroup("GuardRigHead")
  const leftArm = namedGroup("GuardRigLeftArm")
  const rightArm = namedGroup("GuardRigRightArm")
  const leftLeg = namedGroup("GuardRigLeftLeg")
  const rightLeg = namedGroup("GuardRigRightLeg")
  const weapon = namedGroup("GuardWeaponSocket")

  const colors = variant === "levy"
    ? { tunic: 0x8a4b35, sleeve: 0x9b6748, trousers: 0x4a4236, metal: 0x8c918d, accent: 0x5c3c27 }
    : variant === "man-at-arms"
      ? { tunic: 0x6b3030, sleeve: 0x686864, trousers: 0x383c3b, metal: 0x9ba19d, accent: 0x514132 }
      : { tunic: 0x4d2628, sleeve: 0x56383a, trousers: 0x303536, metal: 0xb3a777, accent: 0x261f1c }

  const torsoWidth = variant === "levy" ? 0.39 : variant === "man-at-arms" ? 0.44 : 0.47
  const torsoMesh = mesh(
    "GuardTunic",
    new THREE.CylinderGeometry(torsoWidth * 0.82, torsoWidth, 0.92, 7),
    colors.tunic,
    true,
  )
  torso.add(torsoMesh)
  torso.position.y = 1.28

  const headMesh = mesh("GuardHead", new THREE.SphereGeometry(0.29, 9, 6), 0xc89770, true)
  head.add(headMesh)
  head.position.y = 0.68
  torso.add(head)

  const headgearGeometry = variant === "levy"
    ? new THREE.ConeGeometry(0.37, 0.34, 7)
    : variant === "man-at-arms"
      ? new THREE.SphereGeometry(0.34, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2)
      : new THREE.CylinderGeometry(0.25, 0.38, 0.3, 7)
  const headgear = mesh("GuardHeadgear", headgearGeometry, variant === "levy" ? colors.accent : colors.metal, true)
  headgear.position.y = variant === "man-at-arms" ? 0.08 : 0.27
  head.add(headgear)

  const armGeometry = new THREE.CylinderGeometry(0.095, 0.115, 0.7, 6)
  const leftArmMesh = mesh("GuardLeftArm", armGeometry, colors.sleeve)
  const rightArmMesh = mesh("GuardRightArm", armGeometry.clone(), colors.sleeve)
  leftArmMesh.position.y = -0.34
  rightArmMesh.position.y = -0.34
  leftArm.add(leftArmMesh)
  rightArm.add(rightArmMesh)
  leftArm.position.set(-torsoWidth - 0.06, 0.31, 0)
  rightArm.position.set(torsoWidth + 0.06, 0.31, 0)
  torso.add(leftArm, rightArm)

  const legGeometry = new THREE.CylinderGeometry(0.105, 0.13, 0.74, 6)
  const leftLegMesh = mesh("GuardLeftLeg", legGeometry, colors.trousers)
  const rightLegMesh = mesh("GuardRightLeg", legGeometry.clone(), colors.trousers)
  leftLegMesh.position.y = -0.36
  rightLegMesh.position.y = -0.36
  leftLeg.add(leftLegMesh)
  rightLeg.add(rightLegMesh)
  leftLeg.position.set(-0.18, 0.74, 0)
  rightLeg.position.set(0.18, 0.74, 0)
  bodyRoot.add(leftLeg, rightLeg)

  weapon.position.set(0, -0.64, 0.02)
  rightArm.add(weapon)
  if (variant === "man-at-arms") {
    const blade = mesh("GuardSwordBlade", new THREE.BoxGeometry(0.09, 1.08, 0.045), colors.metal, true)
    blade.position.y = 0.5
    const hilt = mesh("GuardSwordHilt", new THREE.BoxGeometry(0.34, 0.07, 0.08), colors.accent)
    hilt.position.y = -0.02
    weapon.add(blade, hilt)

    const shield = mesh("GuardShield", new THREE.CircleGeometry(0.38, 8), colors.tunic)
    shield.position.set(0, -0.38, 0.13)
    leftArm.add(shield)
  } else {
    const shaftHeight = variant === "sergeant" ? 2.05 : 2.18
    const shaft = mesh("GuardPolearmShaft", new THREE.CylinderGeometry(0.027, 0.032, shaftHeight, 5), colors.accent, true)
    shaft.position.y = 0.65
    const tip = mesh(
      variant === "sergeant" ? "GuardHalberdHead" : "GuardSpearHead",
      variant === "sergeant" ? new THREE.ConeGeometry(0.17, 0.5, 5) : new THREE.ConeGeometry(0.105, 0.38, 5),
      colors.metal,
    )
    tip.position.y = shaftHeight * 0.5 + 0.72
    weapon.add(shaft, tip)
  }

  bodyRoot.add(torso)
  root.add(bodyRoot)
  const rig: GuardRig = { guardId, bodyRoot, torso, head, leftArm, rightArm, leftLeg, rightLeg, weapon }
  root.userData.guardId = guardId
  root.userData.guardVariant = variant
  root.userData.guardRig = rig
  poseGuardVisual(root, { elapsed: 0, moving: false, alert: false, stunned: false })
  return root
}

function guardRig(root: THREE.Group): GuardRig | null {
  const candidate = root.userData.guardRig as GuardRig | undefined
  return candidate?.bodyRoot instanceof THREE.Group ? candidate : null
}

export function poseGuardVisual(root: THREE.Group, pose: GuardPose): void {
  const rig = guardRig(root)
  if (!rig) return
  const motionScale = THREE.MathUtils.clamp(pose.motionScale ?? 1, 0, 1)
  const phase = pose.elapsed * (pose.alert ? 8.2 : 6.4) + stableGuardId(rig.guardId) * 0.73
  const stride = pose.moving ? Math.sin(phase) * motionScale : 0

  rig.bodyRoot.position.set(0, 0, 0)
  rig.bodyRoot.rotation.set(0, 0, 0)
  rig.torso.rotation.set(0, 0, 0)
  rig.head.rotation.set(0, 0, 0)
  rig.leftArm.rotation.set(0, 0, -0.08)
  rig.rightArm.rotation.set(0, 0, 0.08)
  rig.leftLeg.rotation.set(0, 0, 0)
  rig.rightLeg.rotation.set(0, 0, 0)
  rig.weapon.rotation.set(0, 0, 0)

  if (pose.stunned) {
    rig.bodyRoot.position.y = 0.08
    rig.bodyRoot.rotation.z = 1.12
    rig.torso.rotation.x = 0.18
    rig.head.rotation.z = 0.42
    rig.leftArm.rotation.x = -1.18
    rig.rightArm.rotation.x = 0.92
    rig.leftLeg.rotation.x = 0.56
    rig.rightLeg.rotation.x = -0.38
    return
  }

  if (pose.moving) {
    rig.bodyRoot.position.y = Math.abs(Math.sin(phase)) * 0.035 * motionScale
    rig.torso.rotation.z = stride * 0.035
    rig.leftLeg.rotation.x = stride * 0.58
    rig.rightLeg.rotation.x = -stride * 0.58
    rig.leftArm.rotation.x = -stride * 0.42
    rig.rightArm.rotation.x = stride * 0.42
  }

  if (pose.alert) {
    rig.torso.rotation.x = -0.08 * motionScale
    rig.head.rotation.y = pose.moving ? 0 : Math.sin(pose.elapsed * 2.2 + rig.guardId) * 0.12 * motionScale
    rig.leftArm.rotation.x += 0.28 * motionScale
    rig.rightArm.rotation.x -= 0.46 * motionScale
    rig.weapon.rotation.z = -0.09 * motionScale
  }
}

/** Reorders render views by stable guard id, preserving identity across snapshots. */
export function synchronizeGuardVisualsById(
  views: THREE.Group[],
  guards: readonly GuardIdentity[],
  attach: (view: THREE.Group) => void,
  detach: (view: THREE.Group) => void,
): void {
  if (views.length === guards.length && views.every((view, index) => view.userData.guardId === guards[index].id)) return

  const available = new Map<number, THREE.Group[]>()
  for (const view of views) {
    const id = Number(view.userData.guardId)
    const bucket = available.get(id) ?? []
    bucket.push(view)
    available.set(id, bucket)
  }

  const nextViews = guards.map((guard) => {
    const bucket = available.get(guard.id)
    const existing = bucket?.shift()
    if (bucket?.length === 0) available.delete(guard.id)
    if (existing) return existing
    const created = createGuardVisual(guard.id)
    attach(created)
    return created
  })
  for (const bucket of available.values()) for (const view of bucket) detach(view)
  views.splice(0, views.length, ...nextViews)
}
