import { describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { createHeroCharacter, disposeHeroCharacter, poseHeroCharacter } from "./character-visuals"

const heroes = ["robin", "marian", "little-john", "much"] as const

function effectivelyVisible(object: THREE.Object3D, root: THREE.Object3D): boolean {
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
    if (!(object instanceof THREE.Mesh) || !effectivelyVisible(object, root)) return
    bounds.expandByObject(object, true)
  })
  return bounds
}

function ancestorNames(object: THREE.Object3D | undefined): string[] {
  const names: string[] = []
  let current = object?.parent ?? null
  while (current) {
    names.push(current.name)
    current = current.parent
  }
  return names
}

function rotations(root: THREE.Group): number[] {
  return ["RigBodyRoot", "RigPelvis", "RigTorso", "RigHead", "RigLeftArm", "RigRightArm", "RigLeftArmForearm", "RigRightArmForearm", "RigLeftLeg", "RigRightLeg", "RigLeftLegShin", "RigRightLegShin"]
    .flatMap((name) => {
      const rotation = root.getObjectByName(name)!.rotation
      return [rotation.x, rotation.y, rotation.z]
    })
}

describe("procedural Merry Band characters", () => {
  it("keeps every fallback hero in a distinct, readable Sherwood green", () => {
    const tunicColours = heroes.map((hero) => {
      const tunic = createHeroCharacter(hero).getObjectByName("TunicChest") as THREE.Mesh
      const colour = (tunic.material as THREE.MeshToonMaterial).color
      expect(colour.g).toBeGreaterThan(colour.r)
      expect(colour.g).toBeGreaterThan(colour.b)
      return colour.getHex()
    })
    expect(new Set(tunicColours).size).toBe(heroes.length)

    for (const detail of [
      createHeroCharacter("marian").getObjectByName("MarianMantlePanel2"),
      createHeroCharacter("little-john").getObjectByName("JohnVestLeft"),
      createHeroCharacter("much").getObjectByName("MuchCap"),
    ]) {
      const colour = ((detail as THREE.Mesh).material as THREE.MeshToonMaterial).color
      expect(colour.g).toBeGreaterThan(colour.r)
      expect(colour.g).toBeGreaterThan(colour.b)
    }
  })

  it("builds all four heroes around one clean body and socket hierarchy", () => {
    for (const hero of heroes) {
      const character = createHeroCharacter(hero)
      expect(character.name).toBe(`character.${hero}.procedural`)
      expect(character.getObjectByName("RigBodyRoot")).toBeTruthy()
      expect(character.getObjectByName("RigPelvis")?.parent?.name).toBe("RigBodyRoot")
      expect(character.getObjectByName("RigTorso")?.parent?.name).toBe("RigPelvis")
      expect(ancestorNames(character.getObjectByName("RigHead"))).toContain("RigTorso")
      expect(ancestorNames(character.getObjectByName("RigLeftArm"))).toContain("RigTorso")
      expect(ancestorNames(character.getObjectByName("RigRightLeg"))).toContain("RigPelvis")
      expect(character.getObjectByName("RigBackSocket")?.parent?.name).toBe("RigTorso")
      expect(ancestorNames(character.getObjectByName("QuiverCase"))).toContain("RigBackSocket")
    }
  })

  it("parents wearable details to the bones they must follow", () => {
    const robin = createHeroCharacter("robin")
    expect(ancestorNames(robin.getObjectByName("RobinLeftBracer"))).toContain("RigLeftArmForearm")
    expect(ancestorNames(robin.getObjectByName("RobinRightBracer"))).toContain("RigRightArmForearm")
    const marian = createHeroCharacter("marian")
    expect(ancestorNames(marian.getObjectByName("MarianSash"))).toContain("RigTorso")
    expect(ancestorNames(marian.getObjectByName("MarianMantleHinge"))).toContain("RigTorso")
    const john = createHeroCharacter("little-john")
    expect(ancestorNames(john.getObjectByName("JohnShoulderLeft"))).toContain("RigLeftArm")
    expect(ancestorNames(john.getObjectByName("JohnQuarterstaff"))).toContain("RigRightArmHand")
    const much = createHeroCharacter("much")
    expect(ancestorNames(much.getObjectByName("MuchSatchel"))).toContain("RigTorso")
    expect(ancestorNames(much.getObjectByName("MuchPatchedSleeve"))).toContain("RigRightArm")
  })

  it("grounds every neutral silhouette and makes proportions visibly distinct", () => {
    const characters = Object.fromEntries(heroes.map((hero) => [hero, createHeroCharacter(hero)])) as Record<typeof heroes[number], THREE.Group>
    const bounds = Object.fromEntries(heroes.map((hero) => [hero, visibleBounds(characters[hero])])) as Record<typeof heroes[number], THREE.Box3>
    for (const hero of heroes) expect(bounds[hero].min.y).toBeCloseTo(0, 4)
    const height = (hero: typeof heroes[number]) => bounds[hero].getSize(new THREE.Vector3()).y
    expect(height("much")).toBeLessThan(height("marian") * 0.9)
    expect(height("much")).toBeLessThan(height("robin") * 0.82)

    const chestWidth = (hero: typeof heroes[number]) => new THREE.Box3().setFromObject(characters[hero].getObjectByName("TunicChest")!, true).getSize(new THREE.Vector3()).x
    expect(chestWidth("little-john")).toBeGreaterThan(chestWidth("robin") * 1.2)
    expect(chestWidth("marian")).toBeLessThan(chestWidth("robin"))
  })

  it("gives every outlaw a readable role prop without imported assets", () => {
    expect(createHeroCharacter("robin").getObjectByName("RobinFeather")).toBeTruthy()
    expect(createHeroCharacter("robin").getObjectByName("RobinVolleyArrow")).toBeTruthy()
    expect(createHeroCharacter("marian").getObjectByName("MarianMantlePanel2")).toBeTruthy()
    expect(createHeroCharacter("marian").getObjectByName("MarianSash")).toBeTruthy()
    expect(createHeroCharacter("marian").getObjectByName("MarianCircletJewel")).toBeTruthy()
    expect(createHeroCharacter("marian").getObjectByName("MarianHairCap")).toBeTruthy()
    expect(createHeroCharacter("marian").getObjectByName("MarianHairLockLeft")).toBeTruthy()
    expect(createHeroCharacter("marian").getObjectByName("MarianBraid")).toBeTruthy()
    expect(createHeroCharacter("marian").getObjectByName("MarianOverskirtLeft")).toBeTruthy()
    expect(createHeroCharacter("marian").getObjectByName("MarianOverskirtRight")).toBeTruthy()
    expect(createHeroCharacter("little-john").getObjectByName("JohnQuarterstaffBack")).toBeTruthy()
    expect(createHeroCharacter("little-john").getObjectByName("equipment.bow.shortbow")).toBeTruthy()
    expect(createHeroCharacter("much").getObjectByName("MuchSatchel")).toBeTruthy()
    expect(createHeroCharacter("much").getObjectByName("MuchHandSnare")).toBeTruthy()
  })

  it("switches John cleanly between a normal bow attack and his staff signature", () => {
    const john = createHeroCharacter("little-john")
    poseHeroCharacter(john, { elapsed: 0, moving: false, action: "attack", actionProgress: 0.5 })
    expect(john.getObjectByName("equipment.bow.shortbow")?.visible).toBe(true)
    expect(john.getObjectByName("JohnQuarterstaff")?.visible).toBe(false)
    expect(john.getObjectByName("JohnQuarterstaffBack")?.visible).toBe(true)
    poseHeroCharacter(john, { elapsed: 0, moving: false, action: "signature", actionProgress: 0.5 })
    expect(john.getObjectByName("equipment.bow.shortbow")?.visible).toBe(false)
    expect(john.getObjectByName("JohnQuarterstaff")?.visible).toBe(true)
    expect(john.getObjectByName("JohnQuarterstaffBack")?.visible).toBe(false)
  })

  it("shows signature-specific props instead of recycling one bow pose", () => {
    const robin = createHeroCharacter("robin")
    poseHeroCharacter(robin, { elapsed: 0, moving: false, action: "signature", actionProgress: 0.5 })
    expect(robin.getObjectByName("RobinVolleyArrow")?.visible).toBe(true)
    const much = createHeroCharacter("much")
    poseHeroCharacter(much, { elapsed: 0, moving: false, action: "signature", actionProgress: 0.5 })
    expect(much.getObjectByName("MuchHandSnare")?.visible).toBe(true)
    expect(much.getObjectByName("equipment.bow.shortbow")?.visible).toBe(false)
    const marian = createHeroCharacter("marian")
    poseHeroCharacter(marian, { elapsed: 0, moving: false, action: "signature", actionProgress: 0.5 })
    expect(marian.getObjectByName("BowNockedArrow")?.visible).toBe(false)
    expect(Math.abs(marian.getObjectByName("RigLeftArm")!.rotation.z)).toBeLessThan(0.7)
    expect(marian.getObjectByName("RigHead")!.rotation.y).toBeGreaterThan(0)
  })

  it("gives Marian a softer embedded face and correctly oriented circlet", () => {
    const marian = createHeroCharacter("marian")
    const face = marian.getObjectByName("Face") as THREE.Mesh
    const leftEye = marian.getObjectByName("FaceLeftEye") as THREE.Mesh
    const circlet = marian.getObjectByName("MarianCirclet")!

    expect(face.scale.y).toBeLessThan(1.05)
    expect(leftEye.geometry.type).toBe("CircleGeometry")
    expect(marian.getObjectByName("FaceLeftPupil")).toBeTruthy()
    expect(marian.getObjectByName("FaceRightPupil")).toBeTruthy()
    expect(circlet.rotation.x).toBe(0)
    expect(circlet.scale.y).toBeLessThan(0.4)
  })

  it("aims a nocked arrow in the same direction as the hero faces", () => {
    for (const hero of heroes) {
      const character = createHeroCharacter(hero)
      poseHeroCharacter(character, { elapsed: 0, moving: false, action: "attack", actionProgress: 0.5 })
      character.updateMatrixWorld(true)
      const fletching = character.getObjectByName("NockedArrowFletching")!
      const tip = character.getObjectByName("NockedArrowTip")!
      const arrowDirection = tip.getWorldPosition(new THREE.Vector3())
        .sub(fletching.getWorldPosition(new THREE.Vector3()))
        .normalize()

      expect(arrowDirection.z).toBeGreaterThan(0.9)
    }
  })

  it("fully resets controlled joints after an action", () => {
    for (const hero of heroes) {
      const character = createHeroCharacter(hero)
      poseHeroCharacter(character, { elapsed: 0, moving: false, action: "idle" })
      const neutral = rotations(character)
      poseHeroCharacter(character, { elapsed: 0, moving: false, action: "signature", actionProgress: 0.5 })
      poseHeroCharacter(character, { elapsed: 0, moving: false, action: "idle" })
      expect(rotations(character)).toEqual(neutral)
    }
  })

  it("uses one readable downed pose inside the rig", () => {
    for (const hero of heroes) {
      const character = createHeroCharacter(hero)
      poseHeroCharacter(character, { elapsed: 0.3, moving: true, action: "signature", actionProgress: 0.5, downed: true })
      expect(character.getObjectByName("RigBodyRoot")!.rotation.z).toBeGreaterThan(1)
      expect(character.getObjectByName("RigLeftLeg")!.rotation.x).toBeLessThan(0)
      expect(character.getObjectByName("MuchHandSnare")?.visible ?? false).toBe(false)
      expect(visibleBounds(character).min.y).toBeGreaterThanOrEqual(-0.02)
      expect(visibleBounds(character).min.y).toBeLessThanOrEqual(0.04)
    }
  })

  it("keeps committed signatures and John's staff above the terrain", () => {
    for (const hero of heroes) {
      const character = createHeroCharacter(hero)
      poseHeroCharacter(character, { elapsed: 0, moving: false, action: "signature", actionProgress: 0.5 })
      expect(visibleBounds(character).min.y).toBeGreaterThanOrEqual(-0.02)
    }
    const john = createHeroCharacter("little-john")
    poseHeroCharacter(john, { elapsed: 0, moving: false, action: "signature", actionProgress: 0.5 })
    const staffBounds = new THREE.Box3().setFromObject(john.getObjectByName("JohnQuarterstaff")!, true)
    expect(staffBounds.min.y).toBeGreaterThanOrEqual(0)
  })

  it("keeps materials, meshes, and shadow casters bounded", () => {
    for (const hero of heroes) {
      const character = createHeroCharacter(hero)
      const materials = new Set<THREE.Material>()
      let meshes = 0
      let shadowCasters = 0
      character.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        meshes += 1
        materials.add(object.material as THREE.Material)
        if (object.castShadow) shadowCasters += 1
      })
      expect(meshes).toBeLessThanOrEqual(68)
      expect(materials.size).toBeLessThanOrEqual(24)
      expect(shadowCasters).toBeLessThanOrEqual(32)
      expect((character.getObjectByName("FaceLeftEye") as THREE.Mesh).castShadow).toBe(false)
    }
  })

  it("disposes shared procedural resources exactly once", () => {
    const character = createHeroCharacter("robin")
    const leftEye = character.getObjectByName("FaceLeftEye") as THREE.Mesh
    const rightEye = character.getObjectByName("FaceRightEye") as THREE.Mesh
    expect(rightEye.geometry).toBe(leftEye.geometry)
    const geometryDispose = vi.spyOn(leftEye.geometry, "dispose")
    const materialDispose = vi.spyOn(leftEye.material as THREE.Material, "dispose")

    disposeHeroCharacter(character)
    disposeHeroCharacter(character)

    expect(geometryDispose).toHaveBeenCalledOnce()
    expect(materialDispose).toHaveBeenCalledOnce()
  })
})
