import { describe, expect, it } from "vitest"
import * as THREE from "three"
import {
  VILLAGE_COTTAGE_DRAW_CALL_BUDGET,
  VILLAGE_MODULE_NAMES,
  cloneVillageModule,
  countVillageDrawCalls,
  createVillageCottage,
  createVillageWagonShell,
  indexVillageModules,
  type VillageCottageRole,
  type VillageModuleName,
} from "./village-assets"

const MODULE_DRAWS: Readonly<Record<VillageModuleName, number>> = {
  Wall_Plaster_WoodGrid: 2,
  Wall_Plaster_Door_Round: 3,
  Wall_Plaster_Window_Wide_Round: 3,
  Roof_RoundTiles_4x4: 2,
  Door_1_Round: 2,
  Window_Wide_Round1: 2,
  Stairs_Exterior_Straight: 2,
  Prop_Wagon: 1,
  Prop_Crate: 1,
  Prop_WoodenFence_Single: 1,
  Prop_WoodenFence_Extension1: 1,
  Prop_Vine2: 1,
}

interface SyntheticCatalog {
  scene: THREE.Group
  geometry: THREE.BufferGeometry
  material: THREE.MeshStandardMaterial
  texture: THREE.Texture
}

function syntheticCatalog(): SyntheticCatalog {
  const scene = new THREE.Group()
  const geometry = new THREE.BoxGeometry()
  const texture = new THREE.Texture()
  const material = new THREE.MeshStandardMaterial({ map: texture })

  for (const name of VILLAGE_MODULE_NAMES) {
    const root = new THREE.Group()
    root.name = name
    root.position.set(0.01, 0.02, 0.03)
    root.userData = { sourceMarker: name }
    for (let draw = 0; draw < MODULE_DRAWS[name]; draw += 1) {
      root.add(new THREE.Mesh(geometry, material))
    }
    scene.add(root)
  }
  return { scene, geometry, material, texture }
}

function placement(cottage: THREE.Group, role: VillageCottageRole): THREE.Group {
  const match = cottage.children.find((child) => child.userData.sherwoodVillageRole === role)
  if (!(match instanceof THREE.Group)) throw new Error(`Missing cottage placement: ${role}`)
  return match
}

function firstMesh(root: THREE.Object3D): THREE.Mesh {
  let match: THREE.Mesh | undefined
  root.traverse((object) => {
    if (!match && (object as THREE.Mesh).isMesh) match = object as THREE.Mesh
  })
  if (!match) throw new Error("Expected a mesh descendant")
  return match
}

describe("village module catalog", () => {
  it("exports the exact curated root contract and indexes a valid direct catalog", () => {
    const { scene } = syntheticCatalog()
    const catalog = indexVillageModules(scene)

    expect(VILLAGE_MODULE_NAMES).toEqual([
      "Wall_Plaster_WoodGrid",
      "Wall_Plaster_Door_Round",
      "Wall_Plaster_Window_Wide_Round",
      "Roof_RoundTiles_4x4",
      "Door_1_Round",
      "Window_Wide_Round1",
      "Stairs_Exterior_Straight",
      "Prop_Wagon",
      "Prop_Crate",
      "Prop_WoodenFence_Single",
      "Prop_WoodenFence_Extension1",
      "Prop_Vine2",
    ])
    expect(Object.keys(catalog)).toEqual(VILLAGE_MODULE_NAMES)
    expect(Object.isFrozen(catalog)).toBe(true)
    expect(catalog.Prop_Wagon).toBe(scene.getObjectByName("Prop_Wagon"))
  })

  it("fails closed for a missing direct root", () => {
    const { scene } = syntheticCatalog()
    scene.remove(scene.getObjectByName("Prop_Crate")!)
    expect(() => indexVillageModules(scene)).toThrow("missing: Prop_Crate")
  })

  it("fails closed for a duplicate direct root", () => {
    const { scene } = syntheticCatalog()
    const duplicate = new THREE.Group()
    duplicate.name = "Prop_Wagon"
    scene.add(duplicate)
    expect(() => indexVillageModules(scene)).toThrow("duplicates: Prop_Wagon")
  })

  it("fails closed for unexpected or nested replacement roots", () => {
    const { scene } = syntheticCatalog()
    const crate = scene.getObjectByName("Prop_Crate")!
    const wrapper = new THREE.Group()
    wrapper.name = "AssortedProps"
    scene.remove(crate)
    wrapper.add(crate)
    scene.add(wrapper)
    expect(() => indexVillageModules(scene)).toThrow(
      "missing: Prop_Crate; unexpected: AssortedProps",
    )
  })

  it("uses the stable extras ID when Three.js uniquifies runtime node names", () => {
    const { scene } = syntheticCatalog()
    for (const child of scene.children) {
      child.userData.sherwoodAssetId = child.name
      child.name = `${child.name}_1`
    }

    const catalog = indexVillageModules(scene)
    expect(Object.keys(catalog)).toEqual(VILLAGE_MODULE_NAMES)
    expect(catalog.Wall_Plaster_WoodGrid.name).toBe("Wall_Plaster_WoodGrid_1")
  })

  it("deep-clones nodes while sharing geometry, material, and texture resources", () => {
    const { scene, geometry, material, texture } = syntheticCatalog()
    const catalog = indexVillageModules(scene)
    const source = catalog.Wall_Plaster_WoodGrid
    const clone = cloneVillageModule(catalog, "Wall_Plaster_WoodGrid")
    const cloneMesh = firstMesh(clone)

    expect(clone).not.toBe(source)
    expect(clone.children[0]).not.toBe(source.children[0])
    expect(clone.userData).not.toBe(source.userData)
    expect(clone.userData.sherwoodVillageModule).toBe("Wall_Plaster_WoodGrid")
    expect(cloneMesh.geometry).toBe(geometry)
    expect(cloneMesh.material).toBe(material)
    expect((cloneMesh.material as THREE.MeshStandardMaterial).map).toBe(texture)
  })
})

describe("village runtime composition", () => {
  it("builds a tagged compact cottage with the expected module transforms", () => {
    const { scene } = syntheticCatalog()
    const cottage = createVillageCottage(scene)

    expect(cottage.name).toBe("SherwoodVillageCottage")
    expect(cottage.userData).toMatchObject({
      sherwoodVillageKind: "cottage",
      sherwoodVillageRole: "cottage",
      sherwoodVillageDrawCalls: 21,
    })
    expect(cottage.children).toHaveLength(10)

    const rear = placement(cottage, "rear-wall")
    expect(rear.userData.sherwoodVillageModule).toBe("Wall_Plaster_WoodGrid")
    expect(rear.position.toArray()).toEqual([0, 0, -1.55])
    expect(rear.rotation.y).toBeCloseTo(Math.PI)
    expect(rear.scale.toArray()).toEqual([1.8, 1, 1])

    const left = placement(cottage, "left-wall")
    const right = placement(cottage, "right-wall")
    expect(left.rotation.y).toBeCloseTo(Math.PI / 2)
    expect(right.rotation.y).toBeCloseTo(-Math.PI / 2)

    const roof = placement(cottage, "roof")
    expect(roof.position.toArray()).toEqual([0, 2.55, 0])
    expect(roof.scale.toArray()).toEqual([0.72, 0.52, 0.72])

    const door = placement(cottage, "door")
    const window = placement(cottage, "window")
    const steps = placement(cottage, "steps")
    const vine = placement(cottage, "vine")
    expect(door.userData.sherwoodVillageModule).toBe("Door_1_Round")
    expect(window.userData.sherwoodVillageModule).toBe("Window_Wide_Round1")
    expect(steps.userData.sherwoodVillageModule).toBe("Stairs_Exterior_Straight")
    expect(vine.userData.sherwoodVillageModule).toBe("Prop_Vine2")
  })

  it("holds the accepted 21-draw cottage below the runtime ceiling", () => {
    const { scene } = syntheticCatalog()
    const cottage = createVillageCottage(scene)

    expect(countVillageDrawCalls(cottage)).toBe(21)
    expect(countVillageDrawCalls(cottage)).toBeLessThanOrEqual(VILLAGE_COTTAGE_DRAW_CALL_BUDGET)
  })

  it("counts Three.js double-sided transparent passes unless single-pass is explicit", () => {
    const root = new THREE.Group()
    const glass = new THREE.MeshStandardMaterial({
      transparent: true,
      side: THREE.DoubleSide,
    })
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), glass)
    root.add(pane)

    expect(countVillageDrawCalls(root)).toBe(2)
    glass.forceSinglePass = true
    expect(countVillageDrawCalls(root)).toBe(1)
  })

  it("rejects a catalog whose selected modules would exceed the draw ceiling", () => {
    const { scene, geometry, material } = syntheticCatalog()
    const roof = scene.getObjectByName("Roof_RoundTiles_4x4")!
    for (let draw = 0; draw < 4; draw += 1) roof.add(new THREE.Mesh(geometry, material))

    expect(() => createVillageCottage(scene)).toThrow(
      "Village cottage uses 25 draw calls; budget is 24",
    )
  })

  it("creates a tagged 0.8-scale wagon shell rotated onto the cart's long X axis", () => {
    const { scene, geometry, material } = syntheticCatalog()
    const sourceWagon = scene.getObjectByName("Prop_Wagon")!
    const shell = createVillageWagonShell(scene)
    const clone = shell.children[0]

    expect(shell.name).toBe("SherwoodVillageWagonShell")
    expect(shell.userData).toEqual({
      sherwoodVillageKind: "wagon-shell",
      sherwoodVillageModule: "Prop_Wagon",
      sherwoodVillageRole: "wagon-shell",
    })
    expect(shell.rotation.y).toBeCloseTo(Math.PI / 2)
    expect(shell.scale.toArray()).toEqual([0.8, 0.8, 0.8])
    expect(clone).not.toBe(sourceWagon)
    expect(clone.userData.sherwoodVillageModule).toBe("Prop_Wagon")
    expect(firstMesh(clone).geometry).toBe(geometry)
    expect(firstMesh(clone).material).toBe(material)
  })

  it("leaves source roots, transforms, hierarchy, and userData untouched", () => {
    const { scene } = syntheticCatalog()
    const sourceChildren = [...scene.children]
    const snapshots = sourceChildren.map((child) => ({
      parent: child.parent,
      position: child.position.clone(),
      quaternion: child.quaternion.clone(),
      scale: child.scale.clone(),
      userData: structuredClone(child.userData),
    }))

    createVillageCottage(scene)
    createVillageWagonShell(scene)

    expect(scene.children).toEqual(sourceChildren)
    sourceChildren.forEach((child, index) => {
      expect(child.parent).toBe(snapshots[index].parent)
      expect(child.position.equals(snapshots[index].position)).toBe(true)
      expect(child.quaternion.equals(snapshots[index].quaternion)).toBe(true)
      expect(child.scale.equals(snapshots[index].scale)).toBe(true)
      expect(child.userData).toEqual(snapshots[index].userData)
    })
  })
})
