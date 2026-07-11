import * as THREE from "three"
import { createToonMaterial } from "./toon-materials"

export type BowVariant = "longbow" | "recurve" | "shortbow"

const material = (color: number) => createToonMaterial({ color })

function tube(points: THREE.Vector3[], radius: number, color: number, segments = 18): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, 5, false), material(color))
}

export function createBow(variant: BowVariant): THREE.Group {
  const bow = new THREE.Group()
  bow.name = `equipment.bow.${variant}`
  const height = variant === "longbow" ? 1.2 : variant === "recurve" ? 1.0 : 0.82
  const belly = variant === "recurve" ? 0.25 : variant === "longbow" ? 0.2 : 0.17
  const limb = tube([
    new THREE.Vector3(-0.04, -height / 2, 0),
    new THREE.Vector3(belly, -height * 0.23, 0),
    new THREE.Vector3(belly * 0.78, 0, 0),
    new THREE.Vector3(belly, height * 0.23, 0),
    new THREE.Vector3(-0.04, height / 2, 0),
  ], variant === "longbow" ? 0.025 : 0.022, 0x7e512f)
  limb.name = "BowWood"
  const string = tube([
    new THREE.Vector3(-0.04, -height / 2, 0),
    new THREE.Vector3(0.035, 0, 0),
    new THREE.Vector3(-0.04, height / 2, 0),
  ], 0.006, 0xd8cda8, 4)
  string.name = "BowString"
  bow.add(limb, string)
  return bow
}

export function createQuiver(scale = 1): THREE.Group {
  const quiver = new THREE.Group()
  quiver.name = "equipment.quiver.four-arrow"
  const caseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.075, 0.52, 10), material(0x55331f))
  caseMesh.name = "QuiverCase"
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.108, 0.018, 5, 12), material(0x897b58))
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

export function createArcheryEquipment(variant: BowVariant, scale = 1): { group: THREE.Group; bow: THREE.Group; quiver: THREE.Group } {
  const group = new THREE.Group()
  group.name = `equipment.archery.${variant}`
  const bow = createBow(variant)
  const quiver = createQuiver(variant === "shortbow" ? 0.88 : 1)
  bow.scale.setScalar(scale)
  quiver.scale.multiplyScalar(scale)
  group.add(bow, quiver)
  return { group, bow, quiver }
}
