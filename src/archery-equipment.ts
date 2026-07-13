import * as THREE from "three"
import { createToonMaterial } from "./toon-materials"

export type BowVariant = "longbow" | "recurve" | "shortbow"

interface BowRigData {
  upperString: THREE.Mesh
  lowerString: THREE.Mesh
  nockedArrow: THREE.Group
  upperTip: THREE.Vector3
  lowerTip: THREE.Vector3
  restNockX: number
}

export interface ArcheryEquipment {
  group: THREE.Group
  bow: THREE.Group
  quiver: THREE.Group
  nockedArrow: THREE.Group
}

type MaterialFactory = (color: number) => THREE.MeshToonMaterial

const segmentDirection = new THREE.Vector3()
const segmentUp = new THREE.Vector3(0, 1, 0)
const bowNock = new THREE.Vector3()

function createMaterialFactory(): MaterialFactory {
  const materials = new Map<number, THREE.MeshToonMaterial>()
  return (color: number) => {
    const cached = materials.get(color)
    if (cached) return cached
    const material = createToonMaterial({ color })
    material.flatShading = true
    material.needsUpdate = true
    materials.set(color, material)
    return material
  }
}

function tube(points: THREE.Vector3[], radius: number, color: number, material: MaterialFactory, segments = 18): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, 5, false), material(color))
}

function orientSegment(segment: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3): void {
  segmentDirection.copy(end).sub(start)
  const length = Math.max(0.0001, segmentDirection.length())
  segment.position.copy(start).add(end).multiplyScalar(0.5)
  segment.scale.set(1, length, 1)
  segment.quaternion.setFromUnitVectors(segmentUp, segmentDirection.normalize())
}

function createNockedArrow(material: MaterialFactory): THREE.Group {
  const arrow = new THREE.Group()
  arrow.name = "BowNockedArrow"
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.72, 5), material(0x8b6337))
  shaft.name = "NockedArrowShaft"
  shaft.rotation.z = Math.PI / 2
  shaft.position.x = 0.05
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.075, 5), material(0xa7aaa3))
  tip.name = "NockedArrowTip"
  tip.rotation.z = -Math.PI / 2
  tip.position.x = 0.445
  const fletching = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.045, 0.018), material(0x55331f))
  fletching.name = "NockedArrowFletching"
  fletching.position.x = -0.3
  fletching.rotation.x = Math.PI / 4
  arrow.add(shaft, tip, fletching)
  arrow.visible = false
  return arrow
}

function createBowWithMaterial(variant: BowVariant, material: MaterialFactory): THREE.Group {
  const bow = new THREE.Group()
  bow.name = `equipment.bow.${variant}`
  const height = variant === "longbow" ? 1.2 : variant === "recurve" ? 1 : 0.82
  const belly = variant === "recurve" ? 0.25 : variant === "longbow" ? 0.2 : 0.17
  const upperTip = new THREE.Vector3(-0.04, height / 2, 0)
  const lowerTip = new THREE.Vector3(-0.04, -height / 2, 0)
  const restNockX = 0.035
  const limb = tube([
    lowerTip,
    new THREE.Vector3(belly, -height * 0.23, 0),
    new THREE.Vector3(belly * 0.78, 0, 0),
    new THREE.Vector3(belly, height * 0.23, 0),
    upperTip,
  ], variant === "longbow" ? 0.025 : 0.022, 0x7e512f, material)
  limb.name = "BowWood"
  limb.castShadow = true

  const stringGroup = new THREE.Group()
  stringGroup.name = "BowString"
  const upperString = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 5), material(0xd8cda8))
  upperString.name = "BowStringUpper"
  const lowerString = upperString.clone()
  lowerString.name = "BowStringLower"
  stringGroup.add(upperString, lowerString)
  const nockedArrow = createNockedArrow(material)
  bow.add(limb, stringGroup, nockedArrow)
  bow.userData.bowRig = { upperString, lowerString, nockedArrow, upperTip, lowerTip, restNockX } satisfies BowRigData
  setBowDraw(bow, 0, false)
  return bow
}

function createQuiverWithMaterial(scale: number, material: MaterialFactory): THREE.Group {
  const quiver = new THREE.Group()
  quiver.name = "equipment.quiver.four-arrow"
  const caseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.075, 0.52, 10), material(0x55331f))
  caseMesh.name = "QuiverCase"
  caseMesh.castShadow = true
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.018, 5, 12), material(0x7e512f))
  rim.name = "QuiverRim"
  rim.rotation.x = Math.PI / 2
  rim.position.y = 0.26
  quiver.add(caseMesh, rim)
  for (let index = 0; index < 4; index += 1) {
    const arrow = new THREE.Group()
    arrow.name = `QuiverArrow${index + 1}`
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.68, 5), material(0x8b6337))
    shaft.position.y = 0.25
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 5), material(0xa7aaa3))
    tip.position.y = 0.62
    arrow.position.x = (index - 1.5) * 0.035
    arrow.rotation.z = (index - 1.5) * 0.035
    arrow.add(shaft, tip)
    quiver.add(arrow)
  }
  quiver.scale.setScalar(scale)
  return quiver
}

export function createBow(variant: BowVariant): THREE.Group {
  return createBowWithMaterial(variant, createMaterialFactory())
}

export function createQuiver(scale = 1): THREE.Group {
  return createQuiverWithMaterial(scale, createMaterialFactory())
}

export function setBowDraw(bow: THREE.Group, amount: number, showArrow = amount > 0.05): void {
  const rig = bow.userData.bowRig as BowRigData | undefined
  if (!rig) return
  const draw = THREE.MathUtils.clamp(Number.isFinite(amount) ? amount : 0, 0, 1)
  bowNock.set(rig.restNockX - draw * 0.2, 0, 0)
  orientSegment(rig.upperString, rig.upperTip, bowNock)
  orientSegment(rig.lowerString, rig.lowerTip, bowNock)
  rig.nockedArrow.position.x = bowNock.x
  rig.nockedArrow.visible = showArrow && draw > 0.04
}

export function createArcheryEquipment(variant: BowVariant, scale = 1): ArcheryEquipment {
  const material = createMaterialFactory()
  const group = new THREE.Group()
  group.name = `equipment.archery.${variant}`
  const bow = createBowWithMaterial(variant, material)
  const quiver = createQuiverWithMaterial(variant === "shortbow" ? 0.88 : 1, material)
  bow.scale.setScalar(scale)
  quiver.scale.multiplyScalar(scale)
  const nockedArrow = bow.getObjectByName("BowNockedArrow") as THREE.Group
  group.add(bow, quiver)
  return { group, bow, quiver, nockedArrow }
}
