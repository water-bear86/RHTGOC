import * as THREE from "three"
import type { ComposedBuilding, ComposedWorld, SettlementKind } from "../shared/world-composer"
import { sherwoodHeightAt } from "./sherwood-terrain"
import { createToonMaterial } from "./toon-materials"

const materials = new Map<number, THREE.MeshToonMaterial>()
function material(color: number): THREE.MeshToonMaterial {
  let value = materials.get(color)
  if (!value) {
    value = createToonMaterial({ color })
    materials.set(color, value)
  }
  return value
}

function mesh(name: string, geometry: THREE.BufferGeometry, color: number): THREE.Mesh {
  const value = new THREE.Mesh(geometry, material(color))
  value.name = name
  value.castShadow = true
  value.receiveShadow = true
  return value
}

function createBuilding(building: ComposedBuilding, settlementKind: SettlementKind): THREE.Group {
  const group = new THREE.Group()
  group.name = building.id
  group.position.set(building.position.x, sherwoodHeightAt(building.position.x, building.position.z), building.position.z)
  group.rotation.y = building.rotation
  const hostile = settlementKind === "sheriff-post"
  if (building.kind === "watchtower") {
    const tower = mesh("WatchtowerBody", new THREE.CylinderGeometry(1.25, 1.5, 4.6, 8), hostile ? 0x78594a : 0x786341)
    tower.position.y = 2.3
    const roof = mesh("WatchtowerRoof", new THREE.ConeGeometry(2, 1.5, 8), hostile ? 0x5e2825 : 0x513827)
    roof.position.y = 5.28
    group.add(tower, roof)
    return group
  }
  const width = building.halfExtents.x * 2
  const depth = building.halfExtents.z * 2
  const height = building.kind === "barn" ? 2.7 : 2.15
  const walls = mesh("BuildingWalls", new THREE.BoxGeometry(width, height, depth), hostile ? 0xb29673 : 0xc6ad79)
  walls.position.y = height / 2
  const roof = mesh("BuildingRoof", new THREE.ConeGeometry(Math.max(width, depth) * 0.72, building.kind === "barn" ? 2.1 : 1.55, 4), hostile ? 0x6d302b : 0x653f2a)
  roof.position.y = height + (building.kind === "barn" ? 0.95 : 0.72)
  roof.rotation.y = Math.PI / 4
  roof.scale.z = depth / width
  const door = mesh("BuildingDoor", new THREE.BoxGeometry(0.7, 1.3, 0.12), hostile ? 0x3d2924 : 0x513622)
  door.position.set(0, 0.65, depth / 2 + 0.07)
  const beam = mesh("BuildingBeam", new THREE.BoxGeometry(width + 0.1, 0.16, 0.16), 0x59402a)
  beam.position.set(0, height * 0.62, depth / 2 + 0.08)
  group.add(walls, roof, door, beam)
  return group
}

function createBlindSpots(): THREE.Group {
  const group = new THREE.Group()
  group.name = "SherwoodBlindSpots"
  const ridgeGeometry = new THREE.DodecahedronGeometry(1, 0)
  for (let index = 0; index < 22; index += 1) {
    const angle = index * 1.71
    const radius = 25 + (index % 5) * 7
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle * 0.87) * radius
    const rock = mesh("RidgeRock", ridgeGeometry, index % 3 === 0 ? 0x5c6458 : 0x697063)
    rock.position.set(x, sherwoodHeightAt(x, z) + 0.8, z)
    rock.scale.set(1.4 + index % 3, 1.25 + index % 4 * 0.35, 1.2 + index % 2)
    rock.rotation.y = angle
    group.add(rock)
  }
  for (let index = 0; index < 18; index += 1) {
    const x = -48 + index * 5.5
    const z = 20 + Math.sin(index * 0.85) * 7
    const hedge = mesh("Hedgerow", new THREE.IcosahedronGeometry(1, 0), 0x274e2e)
    hedge.scale.set(2.1, 1.4, 0.9)
    hedge.position.set(x, sherwoodHeightAt(x, z) + 1.05, z)
    hedge.rotation.y = 0.25 + Math.sin(index) * 0.2
    group.add(hedge)
  }
  return group
}

export function createSettlementWorld(world: ComposedWorld): THREE.Group {
  const group = new THREE.Group()
  group.name = "SherwoodSettlementWorld"
  for (const settlement of world.settlements) {
    const cluster = new THREE.Group()
    cluster.name = settlement.id
    for (const building of settlement.buildings) cluster.add(createBuilding(building, settlement.kind))
    const square = mesh("SettlementSquare", new THREE.CircleGeometry(5.5, 16), settlement.kind === "sheriff-post" ? 0x806448 : 0x8e744e)
    square.rotation.x = -Math.PI / 2
    square.position.set(settlement.center.x, sherwoodHeightAt(settlement.center.x, settlement.center.z) + 0.035, settlement.center.z)
    square.castShadow = false
    cluster.add(square)
    group.add(cluster)
  }
  group.add(createBlindSpots())
  return group
}

