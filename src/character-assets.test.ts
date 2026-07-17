import { afterEach, describe, expect, it, vi } from "vitest"
import * as THREE from "three"
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js"
import {
  createCharacterVisual,
  disposeCharacterVisual,
  normalizeAuthoredHero,
  poseCharacterVisual,
  waitForCharacterVisual,
} from "./character-assets"

const authoredHeroes = [
  { id: "robin", uri: "/assets/characters/robin-kaykit-ranger.glb", height: 2.35 },
  { id: "marian", uri: "/assets/characters/marian-kaykit-rogue.glb", height: 2.15 },
  { id: "little-john", uri: "/assets/characters/little-john-kaykit-barbarian.glb", height: 2.5 },
  { id: "much", uri: "/assets/characters/much-kaykit-rogue-hooded.glb", height: 1.92 },
] as const

function createAuthoredAsset(): GLTF {
  const scene = new THREE.Group()
  const body = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.6), new THREE.MeshStandardMaterial())
  const bowString = new THREE.Mesh(new THREE.BoxGeometry(0.02, 1, 0.02), new THREE.MeshStandardMaterial())
  bowString.name = "KayKitBowString"
  bowString.morphTargetDictionary = { Draw: 0 }
  bowString.morphTargetInfluences = [0]
  scene.add(body, bowString)
  const clipDurations = {
    Idle: 2,
    Walk: 1.2,
    Attack: 1,
    Signature: 1.6,
  } as const
  return {
    scene,
    scenes: [scene],
    animations: Object.entries(clipDurations).map(([name, duration]) => (
      new THREE.AnimationClip(name, duration, [])
    )),
    cameras: [],
    asset: { version: "2.0" },
    parser: {} as GLTF["parser"],
    userData: {},
  }
}

interface AuthoredRuntimeProbe {
  model: THREE.Group
  actions: Record<"idle" | "walk" | "attack" | "signature", THREE.AnimationAction>
  activeState: "idle" | "walk" | "attack" | "signature" | null
}

function authoredRuntime(visual: THREE.Group): AuthoredRuntimeProbe {
  const runtime = visual.userData.characterVisualRuntime as { authored?: AuthoredRuntimeProbe }
  if (!runtime.authored) throw new Error("Expected an authored test runtime")
  return runtime.authored
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("authored character visuals", () => {
  it("keeps a synchronous procedural fallback while an authored asset loads", () => {
    const visual = createCharacterVisual("robin", { loadAuthoredAssets: false })
    expect(visual.name).toBe("character.robin.visual")
    expect(visual.userData.assetStatus).toBe("pending")
    expect(visual.getObjectByName("character.robin.procedural")).toBeTruthy()
  })

  it("loads every KayKit role with distinct clips, proportional heights, and a bow string", async () => {
    const load = vi.spyOn(GLTFLoader.prototype, "loadAsync").mockImplementation(async () => createAuthoredAsset())
    const visuals = authoredHeroes.map(({ id }) => createCharacterVisual(id))

    await Promise.all(visuals.map((visual) => waitForCharacterVisual(visual)))

    expect(load.mock.calls.map(([uri]) => uri.replace(/\?v=[^#]+/, ""))).toEqual(
      authoredHeroes.map(({ uri }) => uri),
    )
    for (const [index, { id, height }] of authoredHeroes.entries()) {
      const visual = visuals[index]
      expect(visual.userData.assetStatus).toBe("authored")
      const model = visual.getObjectByName(`character.${id}.authored`) as THREE.Group
      expect(new THREE.Box3().setFromObject(model, true).getSize(new THREE.Vector3()).y).toBeCloseTo(height, 5)
      expect(model.getObjectByName("KayKitBowString")).toBeInstanceOf(THREE.Mesh)

      const actions = authoredRuntime(visual).actions
      expect(Object.keys(actions)).toEqual(["idle", "walk", "attack", "signature"])
      expect(actions.idle.getClip().name).toBe("Idle")
      expect(actions.walk.getClip().name).toBe("Walk")
      expect(actions.attack.getClip().name).toBe("Attack")
      expect(actions.signature.getClip().name).toBe("Signature")
      expect(actions.signature).not.toBe(actions.attack)
    }

    visuals.forEach(disposeCharacterVisual)
  })

  it("samples attack and signature clips deterministically from action progress", async () => {
    vi.spyOn(GLTFLoader.prototype, "loadAsync").mockImplementation(async () => createAuthoredAsset())
    const visuals = authoredHeroes.map(({ id }) => createCharacterVisual(id))
    await Promise.all(visuals.map((visual) => waitForCharacterVisual(visual)))

    for (const visual of visuals) {
      const actions = authoredRuntime(visual).actions

      poseCharacterVisual(visual, { elapsed: 10, moving: false, action: "attack", actionProgress: 0.25 })
      expect(actions.attack.time).toBeCloseTo(0.25, 8)
      expect(actions.attack.paused).toBe(true)

      // Wall-clock time cannot advance a one-shot while actionProgress is fixed.
      poseCharacterVisual(visual, { elapsed: 999, moving: false, action: "attack", actionProgress: 0.25 })
      expect(actions.attack.time).toBeCloseTo(0.25, 8)
      poseCharacterVisual(visual, { elapsed: 1_000, moving: false, action: "attack", actionProgress: 0.75 })
      expect(actions.attack.time).toBeCloseTo(0.75, 8)

      poseCharacterVisual(visual, { elapsed: 1_001, moving: false, action: "signature", actionProgress: 0.5 })
      expect(actions.signature.time).toBeCloseTo(0.8, 8)
      expect(actions.signature.paused).toBe(true)
      expect(actions.attack.time).toBeCloseTo(0.75, 8)
      expect(authoredRuntime(visual).activeState).toBe("signature")

      poseCharacterVisual(visual, { elapsed: 1_002, moving: false, action: "signature", actionProgress: 2 })
      expect(actions.signature.time).toBeCloseTo(actions.signature.getClip().duration, 8)
      poseCharacterVisual(visual, {
        elapsed: 1_003,
        moving: false,
        action: "signature",
        actionProgress: Number.NaN,
      })
      expect(actions.signature.time).toBe(0)
    }

    visuals.forEach(disposeCharacterVisual)
  })

  it("keeps every bow string synchronized to the full draw and release seam", async () => {
    vi.spyOn(GLTFLoader.prototype, "loadAsync").mockImplementation(async () => createAuthoredAsset())
    const visuals = authoredHeroes.map(({ id }) => createCharacterVisual(id))
    await Promise.all(visuals.map((visual) => waitForCharacterVisual(visual)))

    for (const [index, visual] of visuals.entries()) {
      const { id } = authoredHeroes[index]
      const bowString = visual.getObjectByName("KayKitBowString") as THREE.Mesh
      const draw = (): number => bowString.morphTargetInfluences?.[0] ?? -1

      poseCharacterVisual(visual, { elapsed: 0.1, moving: false, action: "attack", actionProgress: 0 })
      expect(draw()).toBe(0)
      poseCharacterVisual(visual, { elapsed: 0.2, moving: false, action: "attack", actionProgress: 0.3 })
      expect(draw()).toBeCloseTo(0.5, 8)
      poseCharacterVisual(visual, { elapsed: 0.3, moving: false, action: "attack", actionProgress: 0.6 })
      expect(draw()).toBe(1)
      poseCharacterVisual(visual, { elapsed: 0.4, moving: false, action: "attack", actionProgress: 0.61 })
      expect(draw()).toBeCloseTo(0.5, 8)
      poseCharacterVisual(visual, { elapsed: 0.5, moving: false, action: "attack", actionProgress: 0.62 })
      expect(draw()).toBe(0)
      poseCharacterVisual(visual, { elapsed: 0.6, moving: false, action: "attack", actionProgress: 0.8 })
      expect(draw()).toBe(0)

      poseCharacterVisual(visual, { elapsed: 0.7, moving: false, action: "attack", actionProgress: 0.6 })
      expect(draw()).toBe(1)
      poseCharacterVisual(visual, { elapsed: 0.8, moving: false, action: "signature", actionProgress: 0.15 })
      expect(draw()).toBe(id === "robin" ? 1 : 0)
      poseCharacterVisual(visual, { elapsed: 0.85, moving: false, action: "signature", actionProgress: 0.17125 })
      expect(draw()).toBeCloseTo(id === "robin" ? 0.5 : 0, 8)
      poseCharacterVisual(visual, { elapsed: 0.9, moving: false, action: "signature", actionProgress: 0.5 })
      expect(draw()).toBe(0)
      poseCharacterVisual(visual, { elapsed: 0.95, moving: false, action: "idle" })
      expect(draw()).toBe(0)

      poseCharacterVisual(visual, {
        elapsed: 1,
        moving: false,
        action: "attack",
        actionProgress: 0.6,
        downed: true,
      })
      expect(draw()).toBe(0)
      expect(authoredRuntime(visual).model.visible).toBe(false)
    }

    visuals.forEach(disposeCharacterVisual)
  })

  it("finishes attack-to-idle crossfades while reduced motion freezes loop time", async () => {
    vi.spyOn(GLTFLoader.prototype, "loadAsync").mockImplementation(async () => createAuthoredAsset())
    const visual = createCharacterVisual("robin")
    await waitForCharacterVisual(visual)
    const actions = authoredRuntime(visual).actions

    poseCharacterVisual(visual, {
      elapsed: 0.1,
      moving: false,
      action: "attack",
      actionProgress: 0.5,
      motionScale: 0,
    })
    const attackWeight = actions.attack.getEffectiveWeight()
    const idleWeight = actions.idle.getEffectiveWeight()

    poseCharacterVisual(visual, {
      elapsed: 0.2,
      moving: false,
      action: "idle",
      motionScale: 0,
    })
    expect(actions.attack.getEffectiveWeight()).toBeLessThan(attackWeight)
    expect(actions.idle.getEffectiveWeight()).toBeGreaterThan(idleWeight)
    expect(actions.idle.time).toBe(0)

    poseCharacterVisual(visual, {
      elapsed: 0.3,
      moving: false,
      action: "idle",
      motionScale: 0,
    })
    expect(actions.attack.getEffectiveWeight()).toBe(0)
    expect(actions.idle.getEffectiveWeight()).toBe(1)
    expect(actions.idle.time).toBe(0)

    disposeCharacterVisual(visual)
  })

  it("normalizes authored characters to a grounded target height", () => {
    const model = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1), new THREE.MeshBasicMaterial())
    mesh.position.set(3, 5, -2)
    model.add(mesh)

    normalizeAuthoredHero(model, 2.35)
    const bounds = new THREE.Box3().setFromObject(model, true)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    expect(bounds.min.y).toBeCloseTo(0, 5)
    expect(size.y).toBeCloseTo(2.35, 5)
    expect(center.x).toBeCloseTo(0, 5)
    expect(center.z).toBeCloseTo(0, 5)
  })

  it("normalizes from character geometry without letting an offset bow shift the body", () => {
    const model = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 1), new THREE.MeshBasicMaterial())
    body.position.set(3, 5, -2)
    const bow = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3, 0.1), new THREE.MeshBasicMaterial())
    bow.name = "KayKitBowString"
    bow.position.set(100, -50, 40)
    model.add(body, bow)

    normalizeAuthoredHero(model, 2.35)
    const bodyBounds = new THREE.Box3().setFromObject(body, true)
    const bodySize = bodyBounds.getSize(new THREE.Vector3())
    const bodyCenter = bodyBounds.getCenter(new THREE.Vector3())
    expect(bodyBounds.min.y).toBeCloseTo(0, 5)
    expect(bodySize.y).toBeCloseTo(2.35, 5)
    expect(bodyCenter.x).toBeCloseTo(0, 5)
    expect(bodyCenter.z).toBeCloseTo(0, 5)

    body.geometry.dispose()
    bow.geometry.dispose()
    ;(body.material as THREE.Material).dispose()
    ;(bow.material as THREE.Material).dispose()
  })

  it("preserves procedural poses and disposal when authored loading is disabled", () => {
    const visual = createCharacterVisual("marian", { loadAuthoredAssets: false })
    poseCharacterVisual(visual, { elapsed: 0.4, moving: true, action: "idle" })
    expect(visual.getObjectByName("RigLeftLeg")?.rotation.x).not.toBe(0)
    expect(() => disposeCharacterVisual(visual)).not.toThrow()
    expect(() => disposeCharacterVisual(visual)).not.toThrow()
  })

  it("exposes an immediately settled readiness contract when authored loading is disabled", async () => {
    const visual = createCharacterVisual("little-john", { loadAuthoredAssets: false })
    await expect(waitForCharacterVisual(visual)).resolves.toBeUndefined()
    disposeCharacterVisual(visual)
  })
})
