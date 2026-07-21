import * as THREE from "three"
import type { CharacterId } from "./simulation"
import { createArcheryEquipment, setBowDraw, type BowVariant } from "./archery-equipment"
import { sampleHeroAnimation, type HeroAction, type JointRotation } from "./character-animation"
import { createToonMaterial } from "./toon-materials"

export type { HeroAction } from "./character-animation"

interface CharacterProfile {
  shoulderWidth: number
  waistWidth: number
  torsoDepth: number
  torsoHeight: number
  skirtLength: number
  upperArmLength: number
  lowerArmLength: number
  armRadius: number
  upperLegLength: number
  lowerLegLength: number
  legRadius: number
  headRadius: number
  tunic: number
  sleeve: number
  trousers: number
  hair: number
}

interface CharacterRig {
  characterId: CharacterId
  bodyRoot: THREE.Group
  pelvis: THREE.Group
  torso: THREE.Group
  head: THREE.Group
  leftArm: THREE.Group
  rightArm: THREE.Group
  leftForearm: THREE.Group
  rightForearm: THREE.Group
  leftHand: THREE.Group
  rightHand: THREE.Group
  leftLeg: THREE.Group
  rightLeg: THREE.Group
  leftShin: THREE.Group
  rightShin: THREE.Group
  bow: THREE.Group
  quiver: THREE.Group
  capeHinge: THREE.Group | null
  staffHand: THREE.Group | null
  staffBack: THREE.Group | null
  signatureProp: THREE.Object3D | null
  volleyArrow: THREE.Object3D | null
  groundOffset: number
}

export interface CharacterPose {
  elapsed: number
  moving: boolean
  action?: HeroAction
  actionProgress?: number
  downed?: boolean
  stealth?: boolean
  motionScale?: number
}

const SKIN = 0xd9ad83
const SKIN_SHADOW = 0xb77d59
const LEATHER = 0x4a3022
const DARK_LEATHER = 0x2e211c
const LINEN = 0xd6c7a2
const IRON = 0x858b86

const CHARACTER_PROFILES: Readonly<Record<CharacterId, CharacterProfile>> = Object.freeze({
  robin: {
    shoulderWidth: 0.82, waistWidth: 0.57, torsoDepth: 0.52, torsoHeight: 0.94, skirtLength: 0.42,
    upperArmLength: 0.44, lowerArmLength: 0.42, armRadius: 0.112,
    upperLegLength: 0.45, lowerLegLength: 0.43, legRadius: 0.11, headRadius: 0.3,
    tunic: 0x2f6337, sleeve: 0x31593a, trousers: 0x423a2f, hair: 0x4d2d1d,
  },
  marian: {
    shoulderWidth: 0.75, waistWidth: 0.53, torsoDepth: 0.47, torsoHeight: 0.97, skirtLength: 0.52,
    upperArmLength: 0.42, lowerArmLength: 0.4, armRadius: 0.103,
    upperLegLength: 0.48, lowerLegLength: 0.46, legRadius: 0.102, headRadius: 0.286,
    tunic: 0x3f7050, sleeve: 0x5f8764, trousers: 0x37463c, hair: 0x5a3526,
  },
  "little-john": {
    shoulderWidth: 1.08, waistWidth: 0.76, torsoDepth: 0.65, torsoHeight: 1.04, skirtLength: 0.38,
    upperArmLength: 0.54, lowerArmLength: 0.52, armRadius: 0.155,
    upperLegLength: 0.49, lowerLegLength: 0.47, legRadius: 0.15, headRadius: 0.34,
    tunic: 0x435c32, sleeve: 0x4e6738, trousers: 0x333b30, hair: 0x553523,
  },
  much: {
    shoulderWidth: 0.65, waistWidth: 0.49, torsoDepth: 0.46, torsoHeight: 0.78, skirtLength: 0.34,
    upperArmLength: 0.36, lowerArmLength: 0.34, armRadius: 0.1,
    upperLegLength: 0.34, lowerLegLength: 0.33, legRadius: 0.098, headRadius: 0.285,
    tunic: 0x617548, sleeve: 0x718955, trousers: 0x3d4435, hair: 0x8a5b32,
  },
})

interface MeshOptions {
  castShadow?: boolean
  receiveShadow?: boolean
}

function createCharacterFactory() {
  const materials = new Map<number, THREE.MeshToonMaterial>()
  const material = (color: number): THREE.MeshToonMaterial => {
    const cached = materials.get(color)
    if (cached) return cached
    const result = createToonMaterial({ color })
    result.flatShading = true
    result.needsUpdate = true
    materials.set(color, result)
    return result
  }
  const mesh = (name: string, geometry: THREE.BufferGeometry, color: number, options: MeshOptions = {}): THREE.Mesh => {
    const result = new THREE.Mesh(geometry, material(color))
    result.name = name
    result.castShadow = options.castShadow ?? true
    result.receiveShadow = options.receiveShadow ?? result.castShadow
    return result
  }
  return { mesh }
}

type MeshFactory = ReturnType<typeof createCharacterFactory>["mesh"]

function addFace(head: THREE.Group, mesh: MeshFactory, profile: CharacterProfile, characterId: CharacterId): void {
  const radius = profile.headRadius
  const featureOptions = { castShadow: false, receiveShadow: false }
  if (characterId === "marian") {
    const eyeGeometry = new THREE.CircleGeometry(radius * 0.105, 8)
    const pupilGeometry = new THREE.CircleGeometry(radius * 0.048, 8)
    const eyeZ = radius * 0.912
    const eyeX = radius * 0.31
    const leftEye = mesh("FaceLeftEye", eyeGeometry, LINEN, featureOptions)
    leftEye.position.set(-eyeX, radius * 0.12, eyeZ)
    leftEye.scale.y = 0.72
    const rightEye = leftEye.clone()
    rightEye.name = "FaceRightEye"
    rightEye.position.x = eyeX
    const leftPupil = mesh("FaceLeftPupil", pupilGeometry, profile.hair, featureOptions)
    leftPupil.position.set(-eyeX, radius * 0.115, eyeZ + radius * 0.012)
    leftPupil.scale.y = 0.86
    const rightPupil = leftPupil.clone()
    rightPupil.name = "FaceRightPupil"
    rightPupil.position.x = eyeX
    const browLeft = mesh("FaceLeftBrow", new THREE.BoxGeometry(radius * 0.34, radius * 0.035, radius * 0.025), profile.hair, featureOptions)
    browLeft.position.set(-eyeX, radius * 0.34, eyeZ - radius * 0.008)
    browLeft.rotation.z = -0.05
    const browRight = browLeft.clone()
    browRight.name = "FaceRightBrow"
    browRight.position.x = eyeX
    browRight.rotation.z = 0.05
    const nose = mesh("FaceNose", new THREE.SphereGeometry(radius * 0.11, 7, 5), SKIN_SHADOW, featureOptions)
    nose.position.set(0, -radius * 0.035, radius * 0.955)
    nose.scale.set(0.68, 0.9, 0.45)
    const mouth = mesh("FaceMouth", new THREE.TorusGeometry(radius * 0.11, radius * 0.018, 4, 10, Math.PI), 0x8b4e4b, featureOptions)
    mouth.position.set(0, -radius * 0.31, radius * 0.9)
    mouth.rotation.z = Math.PI
    mouth.scale.y = 0.36
    head.add(leftEye, rightEye, leftPupil, rightPupil, browLeft, browRight, nose, mouth)
    return
  }
  const eyeZ = radius * 0.94
  const eyeX = radius * 0.35
  const leftEye = mesh("FaceLeftEye", new THREE.SphereGeometry(radius * 0.13, 6, 5), 0x25302b, featureOptions)
  leftEye.position.set(-eyeX, radius * 0.12, eyeZ)
  const rightEye = leftEye.clone()
  rightEye.name = "FaceRightEye"
  rightEye.position.x = eyeX
  const browLeft = mesh("FaceLeftBrow", new THREE.BoxGeometry(radius * 0.44, radius * 0.08, radius * 0.08), profile.hair, featureOptions)
  browLeft.position.set(-eyeX, radius * 0.38, eyeZ + radius * 0.015)
  browLeft.rotation.z = -0.08
  const browRight = browLeft.clone()
  browRight.name = "FaceRightBrow"
  browRight.position.x = eyeX
  browRight.rotation.z = 0.08
  const nose = mesh("FaceNose", new THREE.ConeGeometry(radius * 0.19, radius * 0.53, 5), SKIN_SHADOW, featureOptions)
  nose.position.set(0, -radius * 0.04, radius * 1.08)
  nose.rotation.x = Math.PI / 2
  const mouth = mesh("FaceMouth", new THREE.BoxGeometry(radius * 0.45, radius * 0.08, radius * 0.06), 0x7c433b, featureOptions)
  mouth.position.set(0, -radius * 0.43, eyeZ + radius * 0.04)
  head.add(leftEye, rightEye, browLeft, browRight, nose, mouth)
}

function createArm(name: string, mesh: MeshFactory, profile: CharacterProfile): { upper: THREE.Group; lower: THREE.Group; hand: THREE.Group } {
  const { upperArmLength, lowerArmLength, armRadius } = profile
  const upper = new THREE.Group()
  upper.name = name
  const shoulder = mesh(`${name}Shoulder`, new THREE.SphereGeometry(armRadius * 1.08, 7, 5), profile.sleeve)
  const sleeve = mesh(`${name}Upper`, new THREE.CylinderGeometry(armRadius * 0.86, armRadius, upperArmLength, 7), profile.sleeve)
  sleeve.position.y = -upperArmLength / 2
  const lower = new THREE.Group()
  lower.name = `${name}Forearm`
  lower.position.y = -upperArmLength
  const elbow = mesh(`${name}Elbow`, new THREE.SphereGeometry(armRadius * 0.98, 7, 5), profile.sleeve, { castShadow: false })
  const forearm = mesh(`${name}Lower`, new THREE.CylinderGeometry(armRadius * 0.72, armRadius * 0.86, lowerArmLength, 7), profile.sleeve)
  forearm.position.y = -lowerArmLength / 2
  const cuff = mesh(`${name}Cuff`, new THREE.CylinderGeometry(armRadius * 0.82, armRadius * 0.82, armRadius * 0.68, 7), DARK_LEATHER, { castShadow: false })
  cuff.position.y = -lowerArmLength + armRadius * 0.22
  const hand = new THREE.Group()
  hand.name = `${name}Hand`
  hand.position.y = -lowerArmLength
  const palm = mesh(`${name}Palm`, new THREE.BoxGeometry(armRadius * 1.18, armRadius * 1.38, armRadius * 0.82), SKIN)
  palm.position.z = armRadius * 0.18
  hand.add(palm)
  lower.add(elbow, forearm, cuff, hand)
  upper.add(shoulder, sleeve, lower)
  return { upper, lower, hand }
}

function createLeg(name: string, mesh: MeshFactory, profile: CharacterProfile): { upper: THREE.Group; lower: THREE.Group } {
  const { upperLegLength, lowerLegLength, legRadius } = profile
  const upper = new THREE.Group()
  upper.name = name
  const thigh = mesh(`${name}Upper`, new THREE.CylinderGeometry(legRadius * 0.88, legRadius, upperLegLength, 7), profile.trousers)
  thigh.position.y = -upperLegLength / 2
  const lower = new THREE.Group()
  lower.name = `${name}Shin`
  lower.position.y = -upperLegLength
  const knee = mesh(`${name}Knee`, new THREE.SphereGeometry(legRadius, 7, 5), profile.trousers, { castShadow: false })
  const shin = mesh(`${name}Lower`, new THREE.CylinderGeometry(legRadius * 0.72, legRadius * 0.88, lowerLegLength, 7), profile.trousers)
  shin.position.y = -lowerLegLength / 2
  const bootCuff = mesh(`${name}BootCuff`, new THREE.CylinderGeometry(legRadius * 0.98, legRadius * 0.92, legRadius, 7), LEATHER, { castShadow: false })
  bootCuff.position.y = -lowerLegLength + legRadius
  const boot = mesh(`${name}Boot`, new THREE.BoxGeometry(legRadius * 1.55, legRadius * 1.2, legRadius * 2.7), DARK_LEATHER)
  boot.position.set(0, -lowerLegLength, legRadius * 0.66)
  boot.rotation.x = -0.08
  lower.add(knee, shin, bootCuff, boot)
  upper.add(thigh, lower)
  return { upper, lower }
}

function createCape(rig: CharacterRig, mesh: MeshFactory, name: string, color: number, length: number, width: number): void {
  const hinge = new THREE.Group()
  hinge.name = `${name}Hinge`
  hinge.position.set(0, CHARACTER_PROFILES[rig.characterId].torsoHeight * 0.84, -CHARACTER_PROFILES[rig.characterId].torsoDepth * 0.45)
  for (const side of [-1, 0, 1]) {
    const panelWidth = width * (side === 0 ? 0.38 : 0.31)
    const panel = mesh(`${name}Panel${side + 2}`, new THREE.BoxGeometry(panelWidth, length, 0.045), color)
    panel.position.set(side * width * 0.31, -length / 2 + 0.02, -0.02)
    panel.rotation.z = side * -0.08
    hinge.add(panel)
  }
  rig.torso.add(hinge)
  rig.capeHinge = hinge
}

function createMarianMantle(rig: CharacterRig, mesh: MeshFactory): void {
  const hinge = new THREE.Group()
  hinge.name = "MarianMantleHinge"
  hinge.position.set(0, CHARACTER_PROFILES.marian.torsoHeight * 0.84, -CHARACTER_PROFILES.marian.torsoDepth * 0.45)
  const shape = new THREE.Shape()
  shape.moveTo(-0.3, 0)
  shape.lineTo(0.3, 0)
  shape.lineTo(0.45, -0.78)
  shape.lineTo(0.38, -0.96)
  shape.lineTo(0, -0.89)
  shape.lineTo(-0.38, -0.96)
  shape.lineTo(-0.45, -0.78)
  shape.closePath()
  const panel = mesh("MarianMantlePanel2", new THREE.ExtrudeGeometry(shape, {
    depth: 0.035,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.012,
    bevelThickness: 0.01,
    steps: 1,
  }), 0x2f5c43)
  panel.position.z = -0.045
  hinge.add(panel)
  rig.torso.add(hinge)
  rig.capeHinge = hinge
}

function createStaff(mesh: MeshFactory, name: string): THREE.Group {
  const staff = new THREE.Group()
  staff.name = name
  const shaft = mesh(`${name}Shaft`, new THREE.CylinderGeometry(0.055, 0.068, 2.45, 8), 0x664326)
  const upperBand = mesh(`${name}UpperBand`, new THREE.CylinderGeometry(0.08, 0.08, 0.18, 8), IRON, { castShadow: false })
  upperBand.position.y = 0.94
  const lowerBand = upperBand.clone()
  lowerBand.name = `${name}LowerBand`
  lowerBand.position.y = -0.94
  staff.add(shaft, upperBand, lowerBand)
  return staff
}

function addRobinDetails(rig: CharacterRig, mesh: MeshFactory): void {
  const hoodCollar = mesh("RobinHood", new THREE.TorusGeometry(0.32, 0.09, 6, 12), 0x244b2d)
  hoodCollar.rotation.x = Math.PI / 2
  hoodCollar.position.y = -0.14
  const crown = mesh("RobinBycocketCrown", new THREE.SphereGeometry(0.33, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), 0x2d6038)
  crown.position.y = 0.08
  const point = mesh("RobinBycocket", new THREE.ConeGeometry(0.15, 0.62, 7), 0x2d6038)
  point.position.set(0.25, 0.25, -0.06)
  point.rotation.z = -1.03
  point.scale.z = 0.72
  const brim = mesh("RobinHatBrim", new THREE.TorusGeometry(0.3, 0.04, 6, 12, Math.PI * 1.55), 0x1d3f27, { castShadow: false })
  brim.position.set(0, 0.08, 0.03)
  brim.rotation.set(Math.PI / 2, 0, 0.25)
  const feather = mesh("RobinFeather", new THREE.ConeGeometry(0.052, 0.58, 6), 0xc74635)
  feather.position.set(0.29, 0.38, 0)
  feather.rotation.z = -0.58
  rig.head.add(hoodCollar, crown, point, brim, feather)
  createCape(rig, mesh, "RobinCape", 0x1f3d28, 0.82, 0.86)

  for (const [side, forearm] of [["Left", rig.leftForearm], ["Right", rig.rightForearm]] as const) {
    const bracer = mesh(`Robin${side}Bracer`, new THREE.CylinderGeometry(0.13, 0.115, 0.28, 7), 0x70492d)
    bracer.position.y = -CHARACTER_PROFILES.robin.lowerArmLength * 0.58
    forearm.add(bracer)
  }
  const volleyArrow = rig.bow.getObjectByName("BowNockedArrow")?.clone(true) ?? null
  if (volleyArrow) {
    volleyArrow.name = "RobinVolleyArrow"
    volleyArrow.position.z = 0.045
    volleyArrow.visible = false
    rig.bow.add(volleyArrow)
    rig.volleyArrow = volleyArrow
  }
}

function addMarianDetails(rig: CharacterRig, mesh: MeshFactory): void {
  const radius = CHARACTER_PROFILES.marian.headRadius
  const hairCap = mesh("MarianHairCap", new THREE.SphereGeometry(radius * 1.025, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.49), CHARACTER_PROFILES.marian.hair)
  hairCap.position.set(0, radius * 0.08, -radius * 0.045)
  hairCap.scale.set(1, 0.94, 0.97)
  const leftLock = mesh("MarianHairLockLeft", new THREE.ConeGeometry(radius * 0.2, radius * 1.18, 7), CHARACTER_PROFILES.marian.hair, { castShadow: false })
  leftLock.position.set(-radius * 0.82, -radius * 0.21, radius * 0.02)
  leftLock.rotation.z = -0.12
  leftLock.scale.z = 0.62
  const rightLock = leftLock.clone()
  rightLock.name = "MarianHairLockRight"
  rightLock.position.x = radius * 0.82
  rightLock.rotation.z = 0.12
  const braidProfile = [
    new THREE.Vector2(0.025, -0.25), new THREE.Vector2(0.052, -0.2),
    new THREE.Vector2(0.039, -0.14), new THREE.Vector2(0.06, -0.08),
    new THREE.Vector2(0.043, -0.01), new THREE.Vector2(0.064, 0.06),
    new THREE.Vector2(0.046, 0.13), new THREE.Vector2(0.068, 0.2),
    new THREE.Vector2(0.05, 0.26),
  ]
  const braid = mesh("MarianBraid", new THREE.LatheGeometry(braidProfile, 7), CHARACTER_PROFILES.marian.hair, { castShadow: false })
  braid.position.set(radius * 0.62, -radius * 1.12, -radius * 0.55)
  braid.rotation.z = -0.12
  const circlet = mesh("MarianCirclet", new THREE.TorusGeometry(radius * 0.92, radius * 0.052, 5, 18, Math.PI), 0xc5a65b, { castShadow: false })
  circlet.position.set(0, radius * 0.37, radius * 0.87)
  circlet.scale.y = 0.28
  const circletJewel = mesh("MarianCircletJewel", new THREE.OctahedronGeometry(radius * 0.16, 0), 0x8fc4b7, { castShadow: false })
  circletJewel.position.set(0, radius * 0.64, radius * 0.91)
  rig.head.add(hairCap, leftLock, rightLock, braid, circlet, circletJewel)
  createMarianMantle(rig, mesh)

  const shoulderMantle = mesh("MarianShoulderMantle", new THREE.TorusGeometry(0.4, 0.082, 6, 16, Math.PI), 0x71905a, { castShadow: false })
  shoulderMantle.position.set(0, CHARACTER_PROFILES.marian.torsoHeight * 0.84, CHARACTER_PROFILES.marian.torsoDepth * 0.36)
  shoulderMantle.scale.y = 0.46
  const brooch = mesh("MarianBrooch", new THREE.SphereGeometry(0.085, 8, 6), 0xc5a65b, { castShadow: false })
  brooch.position.set(0, CHARACTER_PROFILES.marian.torsoHeight * 0.83, CHARACTER_PROFILES.marian.torsoDepth * 0.51)
  const sash = mesh("MarianSash", new THREE.BoxGeometry(0.09, 0.86, 0.04), 0x71905a)
  sash.name = "MarianSash"
  sash.position.set(0.06, 0.45, CHARACTER_PROFILES.marian.torsoDepth * 0.525)
  sash.rotation.z = 0.38
  rig.torso.add(shoulderMantle, brooch, sash)

  const overskirtShape = new THREE.Shape()
  overskirtShape.moveTo(-0.27, 0.02)
  overskirtShape.lineTo(-0.035, 0)
  overskirtShape.lineTo(-0.075, -0.5)
  overskirtShape.lineTo(-0.3, -0.4)
  overskirtShape.closePath()
  const overskirtGeometry = new THREE.ExtrudeGeometry(overskirtShape, { depth: 0.025, bevelEnabled: false })
  const overskirtLeft = mesh("MarianOverskirtLeft", overskirtGeometry, CHARACTER_PROFILES.marian.sleeve, { castShadow: false })
  overskirtLeft.position.z = CHARACTER_PROFILES.marian.torsoDepth * 0.49
  const overskirtRight = mesh("MarianOverskirtRight", overskirtGeometry, CHARACTER_PROFILES.marian.tunic, { castShadow: false })
  overskirtRight.position.z = CHARACTER_PROFILES.marian.torsoDepth * 0.49 + 0.002
  overskirtRight.scale.x = -1
  rig.pelvis.add(overskirtLeft, overskirtRight)
}

function addLittleJohnDetails(rig: CharacterRig, mesh: MeshFactory): void {
  const hair = mesh("JohnHair", new THREE.SphereGeometry(0.36, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.53), 0x553523)
  hair.position.set(0, 0.08, -0.04)
  const beard = mesh("JohnBeard", new THREE.CapsuleGeometry(0.18, 0.16, 3, 7), 0x553523)
  beard.position.set(0, -0.25, 0.13)
  beard.scale.set(1.18, 1, 0.52)
  rig.head.add(hair, beard)

  for (const [side, arm] of [["Left", rig.leftArm], ["Right", rig.rightArm]] as const) {
    const shoulder = mesh(`JohnShoulder${side}`, new THREE.SphereGeometry(0.24, 8, 6), LEATHER)
    shoulder.scale.set(1.25, 0.72, 1)
    shoulder.position.y = -0.02
    arm.add(shoulder)
  }
  const chestStrap = mesh("JohnChestStrap", new THREE.BoxGeometry(0.13, 1.25, 0.07), DARK_LEATHER)
  chestStrap.position.set(0, 0.55, CHARACTER_PROFILES["little-john"].torsoDepth * 0.52)
  chestStrap.rotation.z = -0.48
  const vestLeft = mesh("JohnVestLeft", new THREE.BoxGeometry(0.38, 0.84, 0.07), 0x30462d)
  vestLeft.position.set(-0.22, 0.53, CHARACTER_PROFILES["little-john"].torsoDepth * 0.53)
  vestLeft.rotation.z = -0.05
  const vestRight = vestLeft.clone()
  vestRight.name = "JohnVestRight"
  vestRight.position.x = 0.22
  vestRight.rotation.z = 0.05
  rig.torso.add(chestStrap, vestLeft, vestRight)

  const backStaff = createStaff(mesh, "JohnQuarterstaffBack")
  backStaff.position.set(-0.1, 0.18, -0.02)
  backStaff.rotation.set(0.08, 0, 0.28)
  rig.torso.getObjectByName("RigBackSocket")!.add(backStaff)
  const handStaff = createStaff(mesh, "JohnQuarterstaff")
  handStaff.position.set(0, 0.46, 0.14)
  handStaff.rotation.set(0.08, 0, -0.08)
  handStaff.visible = false
  rig.rightHand.add(handStaff)
  rig.staffBack = backStaff
  rig.staffHand = handStaff
}

function addMuchDetails(rig: CharacterRig, mesh: MeshFactory): void {
  const hair = mesh("MuchHair", new THREE.SphereGeometry(0.3, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.54), 0x8a5b32)
  hair.position.set(0, 0.08, -0.04)
  const cap = mesh("MuchCap", new THREE.SphereGeometry(0.34, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0x4e683c)
  cap.position.y = 0.16
  const capTail = mesh("MuchCapTail", new THREE.ConeGeometry(0.1, 0.48, 7), 0x4e683c)
  capTail.position.set(0.24, 0.18, -0.08)
  capTail.rotation.z = -0.82
  rig.head.add(hair, cap, capTail)

  const satchel = new THREE.Group()
  satchel.name = "MuchSatchel"
  satchel.position.set(0.42, 0.16, 0.08)
  satchel.rotation.z = -0.16
  const bag = mesh("MuchSatchelBag", new THREE.BoxGeometry(0.43, 0.44, 0.23), 0x8b6234)
  const flap = mesh("MuchSatchelFlap", new THREE.BoxGeometry(0.45, 0.16, 0.25), 0x684425, { castShadow: false })
  flap.position.set(0, 0.17, 0.02)
  satchel.add(bag, flap)
  const rope = mesh("MuchRope", new THREE.TorusGeometry(0.22, 0.033, 6, 16), 0xb58a4b)
  rope.position.set(-0.32, 0.12, -CHARACTER_PROFILES.much.torsoDepth * 0.48)
  rope.rotation.y = Math.PI / 2
  const patch = mesh("MuchTunicPatch", new THREE.BoxGeometry(0.24, 0.2, 0.024), 0x7b4934, { castShadow: false })
  patch.position.set(-0.18, 0.44, CHARACTER_PROFILES.much.torsoDepth * 0.53)
  patch.rotation.z = 0.14
  const neckerchief = mesh("MuchNeckerchief", new THREE.ConeGeometry(0.22, 0.38, 3), 0xa1503c)
  neckerchief.position.set(0, CHARACTER_PROFILES.much.torsoHeight * 0.83, CHARACTER_PROFILES.much.torsoDepth * 0.52)
  neckerchief.rotation.x = Math.PI / 2
  rig.torso.add(satchel, rope, patch, neckerchief)

  const sleevePatch = mesh("MuchPatchedSleeve", new THREE.BoxGeometry(0.19, 0.24, 0.04), 0x955b3c, { castShadow: false })
  sleevePatch.position.y = -CHARACTER_PROFILES.much.upperArmLength * 0.5
  sleevePatch.position.z = CHARACTER_PROFILES.much.armRadius
  rig.rightArm.add(sleevePatch)
  const snare = mesh("MuchHandSnare", new THREE.TorusGeometry(0.18, 0.028, 6, 14), 0xb58a4b)
  snare.rotation.x = Math.PI / 2
  snare.position.set(0, -0.03, 0.12)
  snare.visible = false
  rig.rightHand.add(snare)
  rig.signatureProp = snare
}

function isEffectivelyVisible(object: THREE.Object3D, root: THREE.Object3D): boolean {
  let current: THREE.Object3D | null = object
  while (current) {
    if (!current.visible) return false
    if (current === root) return true
    current = current.parent
  }
  return false
}

function visibleBounds(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3()
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !isEffectivelyVisible(object, root)) return
    bounds.expandByObject(object, true)
  })
  return bounds
}

export function createHeroCharacter(characterId: CharacterId): THREE.Group {
  const profile = CHARACTER_PROFILES[characterId]
  const { mesh } = createCharacterFactory()
  const root = new THREE.Group()
  root.name = `character.${characterId}.procedural`
  root.userData.characterId = characterId
  const bodyRoot = new THREE.Group()
  bodyRoot.name = "RigBodyRoot"
  root.add(bodyRoot)

  const pelvis = new THREE.Group()
  pelvis.name = "RigPelvis"
  const hipY = profile.upperLegLength + profile.lowerLegLength + profile.legRadius * 0.7
  pelvis.position.y = hipY
  bodyRoot.add(pelvis)

  const torso = new THREE.Group()
  torso.name = "RigTorso"
  pelvis.add(torso)
  const chest = mesh("TunicChest", new THREE.CylinderGeometry(profile.shoulderWidth / 2, profile.waistWidth / 2, profile.torsoHeight, 6), profile.tunic)
  chest.position.y = profile.torsoHeight / 2
  chest.scale.z = profile.torsoDepth / profile.shoulderWidth
  const belt = mesh("LeatherBelt", new THREE.CylinderGeometry(profile.waistWidth * 0.54, profile.waistWidth * 0.54, 0.12, 8), LEATHER)
  belt.position.y = 0.08
  belt.scale.z = profile.torsoDepth / profile.waistWidth
  const buckle = mesh("BeltBuckle", new THREE.BoxGeometry(0.15, 0.13, 0.075), 0xb39755, { castShadow: false })
  buckle.position.set(0, 0.08, profile.torsoDepth * 0.52)
  const jerkin = mesh("TunicJerkin", new THREE.BoxGeometry(profile.waistWidth * 0.72, profile.torsoHeight * 0.64, 0.06), profile.sleeve)
  jerkin.position.set(0, profile.torsoHeight * 0.56, profile.torsoDepth * 0.51)
  const collar = mesh("TunicCollar", new THREE.TorusGeometry(profile.headRadius * 0.78, 0.042, 6, 12), LINEN, { castShadow: false })
  collar.position.set(0, profile.torsoHeight, 0)
  collar.rotation.x = Math.PI / 2
  const neck = mesh("RigNeck", new THREE.CylinderGeometry(profile.headRadius * 0.34, profile.headRadius * 0.38, 0.18, 7), SKIN, { castShadow: false })
  neck.position.y = profile.torsoHeight + 0.06
  torso.add(chest, belt, buckle, jerkin, collar, neck)

  for (const side of [-1, 1]) {
    const front = mesh(`TunicFrontPanel${side < 0 ? "Left" : "Right"}`, new THREE.BoxGeometry(profile.waistWidth * 0.48, profile.skirtLength, 0.055), profile.tunic)
    front.position.set(side * profile.waistWidth * 0.24, -profile.skirtLength * 0.38, profile.torsoDepth * 0.45)
    front.rotation.z = side * -0.07
    pelvis.add(front)
  }
  const backPanel = mesh("TunicBackPanel", new THREE.BoxGeometry(profile.waistWidth * 0.9, profile.skirtLength * 0.9, 0.055), profile.tunic)
  backPanel.position.set(0, -profile.skirtLength * 0.34, -profile.torsoDepth * 0.43)
  pelvis.add(backPanel)

  const backSocket = new THREE.Group()
  backSocket.name = "RigBackSocket"
  backSocket.position.set(0, profile.torsoHeight * 0.55, -profile.torsoDepth * 0.48)
  torso.add(backSocket)

  const head = new THREE.Group()
  head.name = "RigHead"
  head.position.y = profile.torsoHeight + profile.headRadius * 1.12
  const face = mesh("Face", new THREE.SphereGeometry(profile.headRadius, 12, 8), SKIN)
  if (characterId === "marian") face.scale.set(0.96, 1.02, 0.96)
  else face.scale.set(characterId === "little-john" ? 0.96 : 0.9, 1.1, 0.93)
  head.add(face)
  addFace(head, mesh, profile, characterId)
  torso.add(head)

  const shoulderY = profile.torsoHeight * 0.82
  const shoulderX = profile.shoulderWidth * 0.48
  const leftArmRig = createArm("RigLeftArm", mesh, profile)
  leftArmRig.upper.position.set(-shoulderX, shoulderY, 0)
  const rightArmRig = createArm("RigRightArm", mesh, profile)
  rightArmRig.upper.position.set(shoulderX, shoulderY, 0)
  torso.add(leftArmRig.upper, rightArmRig.upper)

  const leftLegRig = createLeg("RigLeftLeg", mesh, profile)
  leftLegRig.upper.position.x = -profile.waistWidth * 0.28
  const rightLegRig = createLeg("RigRightLeg", mesh, profile)
  rightLegRig.upper.position.x = profile.waistWidth * 0.28
  pelvis.add(leftLegRig.upper, rightLegRig.upper)

  const rig: CharacterRig = {
    characterId,
    bodyRoot,
    pelvis,
    torso,
    head,
    leftArm: leftArmRig.upper,
    rightArm: rightArmRig.upper,
    leftForearm: leftArmRig.lower,
    rightForearm: rightArmRig.lower,
    leftHand: leftArmRig.hand,
    rightHand: rightArmRig.hand,
    leftLeg: leftLegRig.upper,
    rightLeg: rightLegRig.upper,
    leftShin: leftLegRig.lower,
    rightShin: rightLegRig.lower,
    bow: new THREE.Group(),
    quiver: new THREE.Group(),
    capeHinge: null,
    staffHand: null,
    staffBack: null,
    signatureProp: null,
    volleyArrow: null,
    groundOffset: 0,
  }

  const bowVariant: BowVariant = characterId === "robin" ? "longbow" : characterId === "marian" ? "recurve" : "shortbow"
  const equipmentScale = characterId === "much" ? 0.82 : characterId === "marian" ? 0.9 : characterId === "little-john" ? 1.02 : 1
  const { bow, quiver } = createArcheryEquipment(bowVariant, equipmentScale)
  bow.position.set(0, -0.04, 0.1)
  // The rig faces +Z; rotating the bow this way keeps its arrowhead aimed forward.
  bow.rotation.set(0, 0, -Math.PI / 2)
  leftArmRig.hand.add(bow)
  quiver.position.set(0.2, 0, -0.06)
  quiver.rotation.set(-0.18, 0, -0.2)
  backSocket.add(quiver)
  rig.bow = bow
  rig.quiver = quiver

  if (characterId === "robin") addRobinDetails(rig, mesh)
  else if (characterId === "marian") addMarianDetails(rig, mesh)
  else if (characterId === "little-john") addLittleJohnDetails(rig, mesh)
  else addMuchDetails(rig, mesh)

  root.userData.rig = rig
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) child.frustumCulled = true
  })
  const neutralBounds = visibleBounds(root)
  rig.groundOffset = neutralBounds.isEmpty() ? 0 : -neutralBounds.min.y
  bodyRoot.position.y = rig.groundOffset
  root.updateMatrixWorld(true)
  return root
}

function applyRotation(object: THREE.Object3D, value: JointRotation): void {
  object.rotation.set(value.x, value.y, value.z)
}

export function poseHeroCharacter(root: THREE.Group, pose: CharacterPose): void {
  const rig = root.userData.rig as CharacterRig | undefined
  if (!rig) return
  const sample = sampleHeroAnimation({
    characterId: rig.characterId,
    elapsed: pose.elapsed,
    moving: pose.moving,
    action: pose.action,
    actionProgress: pose.actionProgress,
    downed: pose.downed,
    stealth: pose.stealth,
    motionScale: pose.motionScale,
  })
  rig.bodyRoot.position.y = rig.groundOffset + sample.bodyY
  applyRotation(rig.bodyRoot, sample.body)
  applyRotation(rig.pelvis, sample.pelvis)
  applyRotation(rig.torso, sample.torso)
  applyRotation(rig.head, sample.head)
  applyRotation(rig.leftArm, sample.leftArm)
  applyRotation(rig.rightArm, sample.rightArm)
  applyRotation(rig.leftForearm, sample.leftForearm)
  applyRotation(rig.rightForearm, sample.rightForearm)
  applyRotation(rig.leftLeg, sample.leftLeg)
  applyRotation(rig.rightLeg, sample.rightLeg)
  applyRotation(rig.leftShin, sample.leftShin)
  applyRotation(rig.rightShin, sample.rightShin)
  if (rig.capeHinge) rig.capeHinge.rotation.set(sample.capePitch, 0, sample.capeRoll)
  rig.bow.visible = sample.showBow
  setBowDraw(rig.bow, sample.bowDraw, sample.showBow && sample.bowDraw > 0.04)
  if (rig.staffHand) rig.staffHand.visible = sample.showHandStaff
  if (rig.staffBack) rig.staffBack.visible = sample.showBackStaff
  if (rig.signatureProp) rig.signatureProp.visible = sample.showSignatureProp
  if (rig.volleyArrow) rig.volleyArrow.visible = sample.showVolleyArrow
}

/** Releases the procedural hero's owned geometry and materials exactly once. */
export function disposeHeroCharacter(root: THREE.Group): void {
  if (root.userData.heroResourcesDisposed === true) return
  root.userData.heroResourcesDisposed = true
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    geometries.add(object.geometry)
    const meshMaterials = Array.isArray(object.material) ? object.material : [object.material]
    meshMaterials.forEach((material) => materials.add(material))
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
}
