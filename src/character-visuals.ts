import * as THREE from "three"
import type { CharacterId } from "./simulation"
import { createArcheryEquipment, type BowVariant } from "./archery-equipment"
import { createToonMaterial } from "./toon-materials"

interface CharacterRig {
  torso: THREE.Group
  head: THREE.Group
  leftArm: THREE.Group
  rightArm: THREE.Group
  leftLeg: THREE.Group
  rightLeg: THREE.Group
  bow: THREE.Group | null
  cape: THREE.Object3D | null
}

export interface CharacterPose {
  elapsed: number
  moving: boolean
  attacking?: boolean
  downed?: boolean
  motionScale?: number
}

const SKIN = 0xd9ad83
const SKIN_SHADOW = 0xb77d59
const LEATHER = 0x4a3022
const DARK_LEATHER = 0x2e211c
const LINEN = 0xd6c7a2
const IRON = 0x858b86

function createCharacterFactory() {
  const materials = new Map<number, THREE.MeshToonMaterial>()
  const material = (color: number): THREE.MeshToonMaterial => {
    let result = materials.get(color)
    if (!result) {
      result = createToonMaterial({ color })
      materials.set(color, result)
    }
    return result
  }
  const mesh = (name: string, geometry: THREE.BufferGeometry, color: number): THREE.Mesh => {
    const result = new THREE.Mesh(geometry, material(color))
    result.name = name
    result.castShadow = true
    result.receiveShadow = true
    return result
  }
  return { mesh }
}

function addFace(head: THREE.Group, mesh: ReturnType<typeof createCharacterFactory>["mesh"], eyeColor: number, hairColor: number, beard = false): void {
  const leftEye = mesh("FaceLeftEye", new THREE.SphereGeometry(0.038, 6, 5), eyeColor)
  leftEye.position.set(-0.105, 0.035, 0.292)
  const rightEye = leftEye.clone()
  rightEye.name = "FaceRightEye"
  rightEye.position.x = 0.105
  const browLeft = mesh("FaceLeftBrow", new THREE.BoxGeometry(0.13, 0.025, 0.025), hairColor)
  browLeft.position.set(-0.105, 0.115, 0.294)
  browLeft.rotation.z = -0.08
  const browRight = browLeft.clone()
  browRight.name = "FaceRightBrow"
  browRight.position.x = 0.105
  browRight.rotation.z = 0.08
  const nose = mesh("FaceNose", new THREE.ConeGeometry(0.055, 0.16, 5), SKIN_SHADOW)
  nose.position.set(0, -0.01, 0.335)
  nose.rotation.x = Math.PI / 2
  const mouth = mesh("FaceMouth", new THREE.BoxGeometry(0.13, 0.024, 0.018), 0x7c433b)
  mouth.position.set(0, -0.13, 0.304)
  head.add(leftEye, rightEye, browLeft, browRight, nose, mouth)
  if (beard) {
    const beardMesh = mesh("FaceBeard", new THREE.ConeGeometry(0.25, 0.45, 8), hairColor)
    beardMesh.position.set(0, -0.24, 0.08)
    beardMesh.rotation.x = -0.08
    head.add(beardMesh)
  }
}

function createLimb(
  name: string,
  mesh: ReturnType<typeof createCharacterFactory>["mesh"],
  color: number,
  length: number,
  radius: number,
  handOrBootColor: number,
  endScale = 1,
): THREE.Group {
  const pivot = new THREE.Group()
  pivot.name = name
  const limb = mesh(`${name}Shape`, new THREE.CylinderGeometry(radius * 0.88, radius, length, 7), color)
  limb.position.y = -length / 2
  const end = mesh(`${name}End`, new THREE.SphereGeometry(radius * 1.12 * endScale, 8, 6), handOrBootColor)
  end.position.y = -length
  pivot.add(limb, end)
  return pivot
}

function addRobinDetails(root: THREE.Group, rig: CharacterRig, mesh: ReturnType<typeof createCharacterFactory>["mesh"]): void {
  const hood = mesh("RobinHood", new THREE.SphereGeometry(0.37, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.72), 0x244b2d)
  hood.position.set(0, 0.07, -0.035)
  const cap = mesh("RobinBycocket", new THREE.ConeGeometry(0.42, 0.62, 7), 0x2d6038)
  cap.position.set(0, 0.3, -0.02)
  cap.rotation.z = -0.42
  cap.scale.set(1.15, 0.92, 0.82)
  const brim = mesh("RobinHatBrim", new THREE.TorusGeometry(0.31, 0.045, 6, 12, Math.PI * 1.55), 0x1d3f27)
  brim.position.set(0, 0.12, 0.06)
  brim.rotation.set(Math.PI / 2, 0, 0.25)
  const feather = mesh("RobinFeather", new THREE.ConeGeometry(0.055, 0.62, 6), 0xc74635)
  feather.position.set(0.26, 0.42, 0)
  feather.rotation.z = -0.58
  rig.head.add(hood, cap, brim, feather)

  const cape = mesh("RobinCape", new THREE.ConeGeometry(0.54, 1.25, 8, 1, true), 0x1f3d28)
  cape.position.set(0, 1.27, -0.19)
  cape.rotation.x = -0.1
  cape.scale.z = 0.45
  root.add(cape)
  rig.cape = cape
}

function addMarianDetails(root: THREE.Group, rig: CharacterRig, mesh: ReturnType<typeof createCharacterFactory>["mesh"]): void {
  const hairBack = mesh("MarianHairBack", new THREE.CapsuleGeometry(0.3, 0.54, 4, 8), 0x4a2a1e)
  hairBack.position.set(0, -0.18, -0.13)
  rig.head.add(hairBack)
  for (const side of [-1, 1]) {
    const braid = mesh(`MarianBraid${side}`, new THREE.CylinderGeometry(0.055, 0.035, 0.62, 7), 0x5a3423)
    braid.position.set(side * 0.27, -0.2, 0)
    braid.rotation.z = side * 0.12
    rig.head.add(braid)
  }
  const circlet = mesh("MarianCirclet", new THREE.TorusGeometry(0.31, 0.022, 5, 16, Math.PI * 1.45), 0xb99b52)
  circlet.position.set(0, 0.13, 0.02)
  circlet.rotation.set(Math.PI / 2, 0, -0.72)
  rig.head.add(circlet)
  const mantle = mesh("MarianMantle", new THREE.ConeGeometry(0.61, 1.42, 9, 1, true), 0x39465d)
  mantle.position.set(0, 1.29, -0.16)
  mantle.scale.z = 0.48
  root.add(mantle)
  rig.cape = mantle
  const brooch = mesh("MarianBrooch", new THREE.SphereGeometry(0.09, 8, 6), 0xc5a65b)
  brooch.position.set(0, 1.75, 0.42)
  root.add(brooch)
}

function addLittleJohnDetails(root: THREE.Group, rig: CharacterRig, mesh: ReturnType<typeof createCharacterFactory>["mesh"]): void {
  const hair = mesh("JohnHair", new THREE.SphereGeometry(0.35, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.62), 0x553523)
  hair.position.set(0, 0.08, -0.03)
  rig.head.add(hair)
  const shoulderLeft = mesh("JohnShoulderLeft", new THREE.SphereGeometry(0.26, 8, 6), LEATHER)
  shoulderLeft.scale.set(1.25, 0.7, 1)
  shoulderLeft.position.set(-0.5, 1.7, 0)
  const shoulderRight = shoulderLeft.clone()
  shoulderRight.name = "JohnShoulderRight"
  shoulderRight.position.x = 0.5
  const chestStrap = mesh("JohnChestStrap", new THREE.BoxGeometry(0.13, 1.35, 0.08), DARK_LEATHER)
  chestStrap.position.set(0, 1.34, 0.42)
  chestStrap.rotation.z = -0.48
  const staff = mesh("JohnQuarterstaff", new THREE.CylinderGeometry(0.055, 0.068, 2.75, 8), 0x664326)
  staff.position.set(0.17, -0.88, 0.1)
  staff.rotation.z = -0.16
  const staffBand = mesh("JohnStaffBand", new THREE.CylinderGeometry(0.082, 0.082, 0.2, 8), IRON)
  staffBand.position.y = 1.22
  staff.add(staffBand)
  rig.rightArm.add(staff)
  root.add(shoulderLeft, shoulderRight, chestStrap)
}

function addMuchDetails(root: THREE.Group, rig: CharacterRig, mesh: ReturnType<typeof createCharacterFactory>["mesh"]): void {
  const hair = mesh("MuchHair", new THREE.SphereGeometry(0.32, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.58), 0x8a5b32)
  hair.position.set(0, 0.1, -0.03)
  const cap = mesh("MuchCap", new THREE.SphereGeometry(0.36, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0x53603b)
  cap.position.y = 0.17
  const capTail = mesh("MuchCapTail", new THREE.ConeGeometry(0.11, 0.5, 7), 0x53603b)
  capTail.position.set(0.25, 0.18, -0.08)
  capTail.rotation.z = -0.75
  rig.head.add(hair, cap, capTail)
  const satchel = mesh("MuchSatchel", new THREE.BoxGeometry(0.46, 0.48, 0.25), 0x8b6234)
  satchel.position.set(0.48, 1.02, 0.16)
  satchel.rotation.z = -0.16
  const satchelFlap = mesh("MuchSatchelFlap", new THREE.BoxGeometry(0.48, 0.18, 0.28), 0x684425)
  satchelFlap.position.set(0, 0.18, 0.02)
  satchel.add(satchelFlap)
  const rope = mesh("MuchRope", new THREE.TorusGeometry(0.24, 0.035, 6, 16), 0xb58a4b)
  rope.position.set(-0.38, 1.02, -0.22)
  rope.rotation.y = Math.PI / 2
  const patch = mesh("MuchTunicPatch", new THREE.BoxGeometry(0.25, 0.22, 0.025), 0x7b4934)
  patch.position.set(-0.2, 1.25, 0.43)
  patch.rotation.z = 0.14
  root.add(satchel, rope, patch)
}

export function createHeroCharacter(characterId: CharacterId): THREE.Group {
  const { mesh } = createCharacterFactory()
  const root = new THREE.Group()
  root.name = `character.${characterId}.procedural`
  root.userData.characterId = characterId

  const isJohn = characterId === "little-john"
  const isMarian = characterId === "marian"
  const isMuch = characterId === "much"
  const bodyScale = isJohn ? 1.13 : isMarian ? 0.94 : isMuch ? 0.9 : 1
  const tunicColor = characterId === "robin" ? 0x2f6337 : isMarian ? 0x4e5878 : isJohn ? 0x765332 : 0x6b5a39
  const sleeveColor = characterId === "robin" ? 0x31593a : isMarian ? 0x68708b : isJohn ? 0x634328 : 0x7a6842
  const hairColor = characterId === "robin" ? 0x4d2d1d : isMarian ? 0x4a2a1e : isJohn ? 0x553523 : 0x8a5b32

  const torso = new THREE.Group()
  torso.name = "RigTorso"
  const chest = mesh("TunicChest", new THREE.CylinderGeometry(0.38 * bodyScale, 0.52 * bodyScale, 1.04 * bodyScale, 8), tunicColor)
  chest.position.y = 1.3 * bodyScale
  const skirt = mesh("TunicSkirt", new THREE.ConeGeometry(0.54 * bodyScale, 0.72 * bodyScale, 8, 1, true), tunicColor)
  skirt.position.y = 0.88 * bodyScale
  const undershirt = mesh("TunicCollar", new THREE.TorusGeometry(0.25 * bodyScale, 0.045, 6, 12), LINEN)
  undershirt.position.set(0, 1.78 * bodyScale, 0)
  undershirt.rotation.x = Math.PI / 2
  const belt = mesh("LeatherBelt", new THREE.CylinderGeometry(0.45 * bodyScale, 0.45 * bodyScale, 0.13, 8), LEATHER)
  belt.position.y = 1.05 * bodyScale
  const buckle = mesh("BeltBuckle", new THREE.BoxGeometry(0.15, 0.13, 0.08), 0xb39755)
  buckle.position.set(0, 1.05 * bodyScale, 0.46 * bodyScale)
  torso.add(chest, skirt, undershirt, belt, buckle)
  root.add(torso)

  const head = new THREE.Group()
  head.name = "RigHead"
  head.position.y = (isJohn ? 2.2 : isMuch ? 1.91 : 2.03)
  const face = mesh("Face", new THREE.SphereGeometry(isJohn ? 0.35 : 0.32, 12, 8), SKIN)
  face.scale.set(0.92, 1.08, 0.94)
  head.add(face)
  addFace(head, mesh, 0x25302b, hairColor, isJohn)
  root.add(head)

  const shoulderY = isJohn ? 1.72 : isMuch ? 1.48 : 1.59
  const shoulderX = isJohn ? 0.51 : isMarian ? 0.36 : 0.4
  const armLength = isJohn ? 0.88 : isMuch ? 0.72 : 0.8
  const armRadius = isJohn ? 0.15 : 0.12
  const leftArm = createLimb("RigLeftArm", mesh, sleeveColor, armLength, armRadius, SKIN)
  leftArm.position.set(-shoulderX, shoulderY, 0)
  const rightArm = createLimb("RigRightArm", mesh, sleeveColor, armLength, armRadius, SKIN)
  rightArm.position.set(shoulderX, shoulderY, 0)
  root.add(leftArm, rightArm)

  const hipY = isJohn ? 0.93 : isMuch ? 0.73 : 0.82
  const legLength = isJohn ? 0.9 : isMuch ? 0.67 : 0.76
  const legRadius = isJohn ? 0.145 : 0.115
  const leftLeg = createLimb("RigLeftLeg", mesh, 0x4a4031, legLength, legRadius, DARK_LEATHER, 1.2)
  leftLeg.position.set(-(isJohn ? 0.23 : 0.19), hipY, 0)
  const rightLeg = createLimb("RigRightLeg", mesh, 0x4a4031, legLength, legRadius, DARK_LEATHER, 1.2)
  rightLeg.position.set(isJohn ? 0.23 : 0.19, hipY, 0)
  root.add(leftLeg, rightLeg)

  const rig: CharacterRig = { torso, head, leftArm, rightArm, leftLeg, rightLeg, bow: null, cape: null }
  if (!isJohn) {
    const bowVariant: BowVariant = characterId === "robin" ? "longbow" : isMarian ? "recurve" : "shortbow"
    const { bow, quiver } = createArcheryEquipment(bowVariant, isMuch ? 0.82 : isMarian ? 0.9 : 1)
    bow.position.set(-0.12, -0.63, 0.13)
    bow.rotation.set(0, 0, 0.08)
    leftArm.add(bow)
    quiver.position.set(0.27, 1.36, -0.26)
    quiver.rotation.set(-0.18, 0, -0.2)
    root.add(quiver)
    rig.bow = bow
  }

  if (characterId === "robin") addRobinDetails(root, rig, mesh)
  else if (isMarian) addMarianDetails(root, rig, mesh)
  else if (isJohn) addLittleJohnDetails(root, rig, mesh)
  else addMuchDetails(root, rig, mesh)

  root.userData.rig = rig
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
    child.frustumCulled = true
  })
  return root
}

export function poseHeroCharacter(root: THREE.Group, pose: CharacterPose): void {
  const rig = root.userData.rig as CharacterRig | undefined
  if (!rig) return
  const motionScale = pose.motionScale ?? 1
  const walk = pose.moving && !pose.downed ? Math.sin(pose.elapsed * 10) * 0.62 * motionScale : 0
  const breathe = Math.sin(pose.elapsed * 2.6) * 0.025 * motionScale

  rig.leftLeg.rotation.x = walk
  rig.rightLeg.rotation.x = -walk
  rig.leftArm.rotation.x = pose.attacking ? -1.22 : -walk * 0.72
  rig.rightArm.rotation.x = pose.attacking ? -1.02 : walk * 0.72
  rig.leftArm.rotation.z = pose.attacking ? 0.3 : 0.06
  rig.rightArm.rotation.z = pose.attacking ? -0.42 : -0.06
  rig.rightArm.rotation.y = pose.attacking ? -0.35 : 0
  rig.torso.position.y = Math.abs(walk) * 0.035 + breathe
  rig.torso.rotation.z = pose.moving ? walk * 0.035 : 0
  rig.head.rotation.y = pose.attacking ? 0.16 : Math.sin(pose.elapsed * 0.85) * 0.035 * motionScale
  rig.head.rotation.z = pose.moving ? -walk * 0.025 : 0
  if (rig.bow) rig.bow.rotation.y = pose.attacking ? -0.18 : 0
  if (rig.cape) rig.cape.rotation.x = -0.1 - Math.abs(walk) * 0.08
}
