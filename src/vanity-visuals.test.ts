import * as THREE from "three"
import { describe, expect, it } from "vitest"
import { createVanityPresenter, isVanityCosmetic } from "./vanity-visuals"

function characterView(characterId = "robin"): THREE.Group {
  const view = new THREE.Group()
  view.userData.characterId = characterId
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.6, 0.3))
  view.add(body)
  return view
}

function namedChildren(root: THREE.Object3D): string[] {
  return root.children.map((child) => child.name).filter(Boolean)
}

describe("vanity presenter", () => {
  it("attaches plume and fireflies to the local character and keeps the trail in world space", () => {
    const scene = new THREE.Scene()
    const view = characterView()
    const presenter = createVanityPresenter(scene)
    presenter.attach(view)
    presenter.setEquipped(["fox-plume", "sherwood-fireflies", "kings-ransom-trail"])

    expect(namedChildren(view)).toEqual(["VanityFoxPlume", "VanitySherwoodFireflies"])
    expect(namedChildren(scene)).toEqual(["VanityKingsRansomTrail"])
    expect(presenter.equipped()).toEqual(["fox-plume", "sherwood-fireflies", "kings-ransom-trail"])
  })

  it("re-equips when the equipped set changes and cleans up when detached", () => {
    const scene = new THREE.Scene()
    const view = characterView("much")
    const presenter = createVanityPresenter(scene)
    presenter.attach(view)
    presenter.setEquipped(["fox-plume"])

    presenter.setEquipped(["sherwood-fireflies"])
    expect(namedChildren(view)).toEqual(["VanitySherwoodFireflies"])
    expect(namedChildren(scene)).toEqual([])

    presenter.attach(null)
    expect(namedChildren(view)).toEqual([])
    presenter.dispose()
    expect(presenter.equipped()).toEqual([])
  })

  it("ignores unknown cosmetic ids from a client render", () => {
    const scene = new THREE.Scene()
    const view = characterView()
    const presenter = createVanityPresenter(scene)
    presenter.attach(view)
    presenter.setEquipped(["gilded-horn", "fox-plume"])
    expect(namedChildren(view)).toEqual(["VanityFoxPlume"])
  })

  it("marks every cosmetic mesh for occlusion exclusion", () => {
    const scene = new THREE.Scene()
    const view = characterView()
    const presenter = createVanityPresenter(scene)
    presenter.attach(view)
    presenter.setEquipped(["fox-plume", "sherwood-fireflies", "kings-ransom-trail"])
    const cosmeticMeshes: THREE.Mesh[] = []
    scene.traverse((object) => { if (object instanceof THREE.Mesh) cosmeticMeshes.push(object) })
    view.traverse((object) => {
      if (object instanceof THREE.Mesh && isVanityCosmetic(object)) cosmeticMeshes.push(object)
    })
    expect(cosmeticMeshes.length).toBeGreaterThan(0)
    expect(cosmeticMeshes.every(isVanityCosmetic)).toBe(true)
  })

  it("animates fireflies deterministically and freezes under reduced motion", () => {
    const scene = new THREE.Scene()
    const view = characterView()
    const presenter = createVanityPresenter(scene)
    presenter.attach(view)
    presenter.setEquipped(["sherwood-fireflies"])
    const fireflies = view.getObjectByName("VanitySherwoodFireflies")!
    const firstMote = fireflies.children[0] as THREE.Mesh
    presenter.update({ elapsed: 1, dt: 0.05, motionScale: 1, position: null, moving: false })
    const first = firstMote.position.toArray()
    presenter.update({ elapsed: 4, dt: 0.05, motionScale: 1, position: null, moving: false })
    expect(firstMote.position.toArray()).not.toEqual(first)
    presenter.update({ elapsed: 99, dt: 0.05, motionScale: 0, position: null, moving: false })
    const frozen = firstMote.position.toArray()
    presenter.update({ elapsed: 100, dt: 0.05, motionScale: 0, position: null, moving: false })
    expect(firstMote.position.toArray()).toEqual(frozen)
  })

  it("spawns and retires fading trail puffs while moving", () => {
    const scene = new THREE.Scene()
    const view = characterView()
    const presenter = createVanityPresenter(scene)
    presenter.attach(view)
    presenter.setEquipped(["kings-ransom-trail"])
    const trailRoot = scene.getObjectByName("VanityKingsRansomTrail")!

    // Move for long enough to accumulate several puffs.
    let x = 0
    for (let frame = 0; frame < 60; frame += 1) {
      x += 0.2
      presenter.update({ elapsed: frame / 60, dt: 1 / 60, motionScale: 1, position: { x, y: 0, z: 0 }, moving: true })
    }
    const spawned = trailRoot.children.length
    expect(spawned).toBeGreaterThan(3)

    // Standing still lets every puff age out.
    for (let frame = 0; frame < 240; frame += 1) {
      presenter.update({ elapsed: 4 + frame / 60, dt: 1 / 60, motionScale: 1, position: { x, y: 0, z: 0 }, moving: false })
    }
    expect(trailRoot.children.length).toBe(0)
  })

  it("keeps all cosmetic motion finite for invalid elapsed input", () => {
    const scene = new THREE.Scene()
    const view = characterView()
    const presenter = createVanityPresenter(scene)
    presenter.attach(view)
    presenter.setEquipped(["fox-plume", "sherwood-fireflies", "kings-ransom-trail"])
    presenter.update({ elapsed: Number.NaN, dt: 0.1, motionScale: 1, position: { x: 0, y: 0, z: 0 }, moving: true })
    const positions: number[] = []
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh) positions.push(...object.position.toArray())
    })
    view.traverse((object) => {
      if (object instanceof THREE.Mesh) positions.push(...object.position.toArray())
    })
    expect(positions.every(Number.isFinite)).toBe(true)
  })
})
