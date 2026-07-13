import * as THREE from "three"
import type { RegionalMissionLayout } from "../shared/regional-layout"
import { createToonMaterial } from "./toon-materials"

export interface SherwoodLandmarks {
  group: THREE.Group
  windmillRotor: THREE.Group
  farmPosition: Readonly<{ x: number; z: number }>
  wheatCount: number
}

const materialCache = new Map<number, THREE.MeshToonMaterial>()
function material(color: number): THREE.MeshToonMaterial {
  let result = materialCache.get(color)
  if (!result) {
    result = createToonMaterial({ color })
    materialCache.set(color, result)
  }
  return result
}

function mesh(name: string, geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material(color))
  result.name = name
  result.castShadow = true
  result.receiveShadow = true
  return result
}

export function chooseFarmPosition(layout: RegionalMissionLayout): Readonly<{ x: number; z: number }> {
  const candidates = [
    { x: -48, z: -48 }, { x: 48, z: -48 }, { x: -48, z: 48 }, { x: 48, z: 48 },
  ]
  const hazards = [layout.campfirePosition, layout.objectivePosition, ...layout.crossingPositions]
  return candidates.sort((left, right) => {
    const score = (point: { x: number; z: number }): number => Math.min(...hazards.map((hazard) => Math.hypot(point.x - hazard.x, point.z - hazard.z)))
    return score(right) - score(left)
  })[0]
}

function addFence(parent: THREE.Group, x: number, z: number, length: number, rotation: number): void {
  const fence = new THREE.Group()
  fence.name = "FarmFence"
  fence.position.set(x, 0, z)
  fence.rotation.y = rotation
  for (const localX of [-length / 2, 0, length / 2]) {
    const post = mesh("FencePost", new THREE.BoxGeometry(0.16, 1.15, 0.16), 0x604329)
    post.position.set(localX, 0.57, 0)
    fence.add(post)
  }
  for (const y of [0.42, 0.85]) {
    const rail = mesh("FenceRail", new THREE.BoxGeometry(length, 0.12, 0.12), 0x765536)
    rail.position.y = y
    fence.add(rail)
  }
  parent.add(fence)
}

function createWheatField(): { group: THREE.Group; count: number } {
  const group = new THREE.Group()
  group.name = "GoldenWheatField"
  const geometry = new THREE.ConeGeometry(0.1, 0.82, 4)
  geometry.translate(0, 0.41, 0)
  const rows = 15
  const columns = 22
  const count = rows * columns
  const wheat = new THREE.InstancedMesh(geometry, material(0xd7a938), count)
  wheat.name = "WheatInstances"
  const matrix = new THREE.Matrix4()
  let index = 0
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = -6.4 + column * 0.58 + Math.sin(row * 2.3 + column) * 0.06
      const z = -4.1 + row * 0.56
      const height = 0.78 + ((row * 17 + column * 7) % 9) * 0.025
      matrix.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(1, height, 1))
      wheat.setMatrixAt(index++, matrix)
    }
  }
  wheat.castShadow = false
  wheat.receiveShadow = true
  wheat.instanceMatrix.needsUpdate = true
  group.add(wheat)
  return { group, count }
}

function createWindmill(): { group: THREE.Group; rotor: THREE.Group } {
  const group = new THREE.Group()
  group.name = "WindmillLandmark"
  const base = mesh("WindmillStoneBase", new THREE.CylinderGeometry(2.45, 2.9, 4.8, 10), 0xb9aa88)
  base.position.y = 2.4
  const timberBand = mesh("WindmillTimberBand", new THREE.CylinderGeometry(2.52, 2.72, 0.28, 10), 0x59402a)
  timberBand.position.y = 3.45
  const roof = mesh("WindmillRoof", new THREE.ConeGeometry(3.05, 2.05, 10), 0x5c3828)
  roof.position.y = 5.82
  const door = mesh("WindmillDoor", new THREE.BoxGeometry(0.9, 1.75, 0.16), 0x4a3022)
  door.position.set(0, 0.9, 2.61)
  const window = mesh("WindmillWindow", new THREE.BoxGeometry(0.72, 0.72, 0.18), 0x4a3022)
  window.position.set(0, 3.25, 2.47)
  group.add(base, timberBand, roof, door, window)

  const rotor = new THREE.Group()
  rotor.name = "WindmillRotor"
  rotor.position.set(0, 4.35, 2.72)
  for (let bladeIndex = 0; bladeIndex < 4; bladeIndex += 1) {
    const arm = new THREE.Group()
    arm.rotation.z = bladeIndex * Math.PI / 2
    const spar = mesh("WindmillBladeSpar", new THREE.BoxGeometry(0.16, 4.8, 0.16), 0x4a3022)
    spar.position.y = 2.15
    const sail = mesh("WindmillBladeSail", new THREE.BoxGeometry(0.78, 3.25, 0.08), 0xd8cba5)
    sail.position.set(0.42, 2.55, 0)
    arm.add(spar, sail)
    rotor.add(arm)
  }
  const axle = mesh("WindmillAxle", new THREE.CylinderGeometry(0.27, 0.27, 0.7, 8), 0x3c2b21)
  axle.rotation.x = Math.PI / 2
  rotor.add(axle)
  group.add(rotor)
  return { group, rotor }
}

function createFarmhouse(): THREE.Group {
  const house = new THREE.Group()
  house.name = "FarmhouseLandmark"
  const walls = mesh("FarmhouseWalls", new THREE.BoxGeometry(4.7, 2.35, 3.5), 0xc9b17f)
  walls.position.y = 1.18
  const beams = mesh("FarmhouseCrossbeam", new THREE.BoxGeometry(4.9, 0.2, 0.18), 0x583d28)
  beams.position.set(0, 1.55, 1.82)
  const roof = mesh("FarmhouseRoof", new THREE.ConeGeometry(3.65, 2.1, 4), 0x6a402c)
  roof.position.y = 3.25
  roof.rotation.y = Math.PI / 4
  house.add(walls, beams, roof)
  return house
}

export function createSherwoodLandmarks(layout: RegionalMissionLayout): SherwoodLandmarks {
  const group = new THREE.Group()
  group.name = "SherwoodLandmarks"
  const farmPosition = chooseFarmPosition(layout)
  const farm = new THREE.Group()
  farm.name = "WindmillFarm"
  farm.position.set(farmPosition.x, 0, farmPosition.z)
  farm.rotation.y = farmPosition.x * farmPosition.z > 0 ? -0.35 : 0.35

  const soil = mesh("FarmFieldSoil", new THREE.PlaneGeometry(15, 10), 0x80613d)
  soil.rotation.x = -Math.PI / 2
  soil.position.set(-1, 0.018, -0.2)
  soil.castShadow = false
  const { group: wheat, count: wheatCount } = createWheatField()
  wheat.position.set(-1, 0.03, 0)
  const { group: windmill, rotor } = createWindmill()
  windmill.position.set(8.4, 0, -1.2)
  const farmhouse = createFarmhouse()
  farmhouse.position.set(1.7, 0, 7.1)
  farmhouse.rotation.y = Math.PI
  farm.add(soil, wheat, windmill, farmhouse)
  addFence(farm, -1, -5.3, 15, 0)
  addFence(farm, -8.5, -0.2, 10.2, Math.PI / 2)
  addFence(farm, 6.5, -0.2, 10.2, Math.PI / 2)
  group.add(farm)

  const stoneCircle = new THREE.Group()
  stoneCircle.name = "AncientStoneCircle"
  stoneCircle.position.set(-38, 25, -8)
  for (let index = 0; index < 7; index += 1) {
    const stone = mesh("StandingStone", new THREE.DodecahedronGeometry(0.7, 0), 0x777b6d)
    const angle = index / 7 * Math.PI * 2
    stone.scale.set(0.65, 1.8 + (index % 3) * 0.25, 0.55)
    stone.position.set(Math.cos(angle) * 3.1, stone.scale.y * 0.34, Math.sin(angle) * 3.1)
    stone.rotation.y = angle + 0.4
    stoneCircle.add(stone)
  }
  group.add(stoneCircle)

  const logging = new THREE.Group()
  logging.name = "LoggingClearing"
  logging.position.set(34, 0, -25)
  for (let index = 0; index < 8; index += 1) {
    const log = mesh("FelldLog", new THREE.CylinderGeometry(0.28, 0.34, 3.1, 8), 0x65472d)
    log.rotation.z = Math.PI / 2
    log.position.set((index % 4) * 0.2, 0.32 + Math.floor(index / 4) * 0.48, (index % 4) * 0.58)
    logging.add(log)
  }
  group.add(logging)
  return { group, windmillRotor: rotor, farmPosition, wheatCount }
}

