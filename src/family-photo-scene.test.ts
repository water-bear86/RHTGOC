import { describe, expect, it } from "vitest"
import * as THREE from "three"
import { VILLAGE_MODULE_NAMES } from "./village-assets"
import { TREE_VARIANT_NAMES } from "./tree-placements"
import {
  FAMILY_PHOTO_ASPECT,
  FAMILY_PHOTO_CAPTURE_TIME_SECONDS,
  FAMILY_PHOTO_CHARACTER_IDS,
  FAMILY_PHOTO_GUARD_IDS,
  FAMILY_PHOTO_HEIGHT,
  FAMILY_PHOTO_SEED,
  FAMILY_PHOTO_WIDTH,
  createFamilyPhotoScene,
} from "./family-photo-scene"

function syntheticCatalog(names: readonly string[]): THREE.Group {
  const catalog = new THREE.Group()
  for (const name of names) {
    const module = new THREE.Group()
    module.name = name
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.25, 0.5, 0.25),
      new THREE.MeshStandardMaterial({ color: 0xffffff }),
    )
    mesh.name = `${name}:mesh`
    module.add(mesh)
    catalog.add(module)
  }
  return catalog
}

describe("Merry Band family photo", () => {
  it("assembles every procedural hero and every guard appearance in a real village scene", () => {
    const portrait = createFamilyPhotoScene()

    expect(portrait.scene.name).toBe("SherwoodMerryBandFamilyPhoto")
    expect(portrait.scene.getObjectByName("FamilyPhotoTerrain")).toBeTruthy()
    expect(portrait.scene.getObjectByName("FamilyPhotoRoads")).toBeTruthy()
    expect(portrait.scene.getObjectByName("FamilyPhotoVillage")).toBeTruthy()
    expect(portrait.scene.getObjectByName("FamilyPhotoCampfire")).toBeTruthy()
    expect(portrait.scene.getObjectByName("FamilyPhotoFallbackTrees")).toBeTruthy()

    expect([...portrait.heroes.keys()]).toEqual(FAMILY_PHOTO_CHARACTER_IDS)
    for (const characterId of FAMILY_PHOTO_CHARACTER_IDS) {
      const hero = portrait.heroes.get(characterId)
      expect(hero?.name).toBe(`FamilyPhotoHero:${characterId}`)
      expect(hero?.userData.characterId).toBe(characterId)
      expect(hero?.userData.familyPhotoRole).toBe("hero")
      expect(hero?.getObjectByName("RigBodyRoot")).toBeTruthy()
    }

    expect(portrait.guards.map((guard) => guard.userData.guardId)).toEqual(FAMILY_PHOTO_GUARD_IDS)
    expect(portrait.guards.map((guard) => guard.userData.guardVariant)).toEqual([
      "levy",
      "man-at-arms",
      "sergeant",
    ])
    expect(portrait.guards.every((guard) => guard.userData.familyPhotoRole === "guard")).toBe(true)
    portrait.dispose()
  })

  it("publishes a fixed, inspectable 16:9 capture contract", () => {
    const first = createFamilyPhotoScene()
    const second = createFamilyPhotoScene()

    expect(first.metadata).toEqual(second.metadata)
    expect(first.metadata).toEqual({
      seed: FAMILY_PHOTO_SEED,
      width: FAMILY_PHOTO_WIDTH,
      height: FAMILY_PHOTO_HEIGHT,
      characters: FAMILY_PHOTO_CHARACTER_IDS,
      guardIds: FAMILY_PHOTO_GUARD_IDS,
      villageAsset: "procedural-fallback",
      treeAsset: "procedural-fallback",
    })
    expect(first.camera.aspect).toBe(FAMILY_PHOTO_ASPECT)
    expect(first.camera.fov).toBe(30)
    expect(first.camera.userData.familyPhotoTarget).toEqual(second.camera.userData.familyPhotoTarget)

    const flame = first.scene.getObjectByName("CampfireFlameOuter")!
    first.renderFrame(FAMILY_PHOTO_CAPTURE_TIME_SECONDS)
    const transform = flame.matrix.clone()
    first.renderFrame(FAMILY_PHOTO_CAPTURE_TIME_SECONDS)
    expect(flame.matrix.equals(transform)).toBe(true)
    first.dispose()
    second.dispose()
  })

  it("uses the authored village and tree catalogs when capture assets are available", () => {
    const portrait = createFamilyPhotoScene({
      villageCatalog: syntheticCatalog(VILLAGE_MODULE_NAMES),
      treeCatalog: syntheticCatalog(TREE_VARIANT_NAMES),
    })

    expect(portrait.metadata.villageAsset).toBe("authored")
    expect(portrait.metadata.treeAsset).toBe("authored")
    expect(portrait.scene.getObjectByName("SherwoodVillageCottageBatch")).toBeTruthy()
    const trees = portrait.scene.getObjectByName("FamilyPhotoAuthoredTrees")
    expect(trees).toBeTruthy()
    expect(trees?.userData.sherwoodTreeCount).toBeGreaterThan(0)
    expect(trees?.children.length).toBe(TREE_VARIANT_NAMES.length)
    expect(() => {
      portrait.dispose()
      portrait.dispose()
    }).not.toThrow()
  })
})
