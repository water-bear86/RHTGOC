import * as THREE from "three"
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js"
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js"
import type { CharacterId } from "./simulation"
import {
  createHeroCharacter,
  disposeHeroCharacter,
  poseHeroCharacter,
  type CharacterPose,
  type HeroAction,
} from "./character-visuals"
import {
  cloneObjectMaterialsForInstance,
  convertObjectToToon,
  disposeObjectInstanceMaterials,
} from "./toon-materials"
import { versionedAssetUrl } from "./release"

interface AuthoredHeroDefinition {
  uri: string
  height: number
  bowSignature: boolean
  clips: Readonly<Record<AuthoredAnimationState, string>>
}

type AuthoredAnimationState = HeroAction | "walk"

interface AuthoredHeroRuntime {
  model: THREE.Group
  mixer: THREE.AnimationMixer
  actions: Readonly<Record<AuthoredAnimationState, THREE.AnimationAction>>
  bowStringMorph: AuthoredBowStringMorph
  bowSignature: boolean
  activeState: AuthoredAnimationState | null
  lastElapsed: number | null
}

interface AuthoredBowStringMorph {
  mesh: THREE.Mesh
  drawIndex: number
}

interface CharacterVisualRuntime {
  characterId: CharacterId
  fallback: THREE.Group
  authored: AuthoredHeroRuntime | null
  disposed: boolean
  lastPose: CharacterPose
  ready: Promise<void>
}

// Attack is exported as an 0.8s clip: the final 0.12s of Bow Draw followed by
// Bow Release. KayKit's release hand separates during the first 2/40 of the
// release clip, so keep the string/hand contact locked to the same seam.
const BOW_ATTACK_RELEASE_START = 0.15
const BOW_RELEASE_SEPARATION_FRACTION = 2 / 40
const BOW_ATTACK_RELEASE_END = BOW_ATTACK_RELEASE_START
  + (1 - BOW_ATTACK_RELEASE_START) * BOW_RELEASE_SEPARATION_FRACTION

export interface CharacterVisualOptions {
  loadAuthoredAssets?: boolean
}

const AUTHORED_HEROES: Readonly<Partial<Record<CharacterId, AuthoredHeroDefinition>>> = Object.freeze({
  robin: {
    uri: "/assets/characters/robin-kaykit-ranger.glb",
    height: 2.35,
    bowSignature: true,
    clips: {
      idle: "Idle",
      walk: "Walk",
      attack: "Attack",
      signature: "Signature",
    },
  },
  marian: {
    uri: "/assets/characters/marian-kaykit-rogue.glb",
    height: 2.15,
    bowSignature: false,
    clips: {
      idle: "Idle",
      walk: "Walk",
      attack: "Attack",
      signature: "Signature",
    },
  },
  "little-john": {
    uri: "/assets/characters/little-john-kaykit-barbarian.glb",
    height: 2.5,
    bowSignature: false,
    clips: {
      idle: "Idle",
      walk: "Walk",
      attack: "Attack",
      signature: "Signature",
    },
  },
  much: {
    uri: "/assets/characters/much-kaykit-rogue-hooded.glb",
    height: 1.92,
    bowSignature: false,
    clips: {
      idle: "Idle",
      walk: "Walk",
      attack: "Attack",
      signature: "Signature",
    },
  },
})

const gltfLoader = new GLTFLoader()
const assetPromises = new Map<string, Promise<GLTF>>()

function definitionFor(characterId: CharacterId): AuthoredHeroDefinition | undefined {
  return AUTHORED_HEROES[characterId]
}

function loadAuthoredHero(definition: AuthoredHeroDefinition): Promise<GLTF> {
  const cached = assetPromises.get(definition.uri)
  if (cached) return cached

  const loading = gltfLoader.loadAsync(versionedAssetUrl(definition.uri))
    .then((asset) => {
      convertObjectToToon(asset.scene)
      return asset
    })
    .catch((error: unknown) => {
      assetPromises.delete(definition.uri)
      throw error
    })
  assetPromises.set(definition.uri, loading)
  return loading
}

export function normalizeAuthoredHero(model: THREE.Group, targetHeight: number): void {
  model.position.set(0, 0, 0)
  model.scale.setScalar(1)
  model.updateMatrixWorld(true)
  const bounds = new THREE.Box3()
  const vertex = new THREE.Vector3()
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.name === "KayKitBowString") return
    const positions = object.geometry.getAttribute("position")
    if (!positions) return
    for (let index = 0; index < positions.count; index += 1) {
      object.getVertexPosition(index, vertex)
      bounds.expandByPoint(vertex.applyMatrix4(object.matrixWorld))
    }
  })
  const size = bounds.getSize(new THREE.Vector3())
  if (!Number.isFinite(size.y) || size.y <= 0) throw new Error("Authored character has invalid bounds")

  const scale = targetHeight / size.y
  const center = bounds.getCenter(new THREE.Vector3())
  model.scale.setScalar(scale)
  model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
  model.updateMatrixWorld(true)
}

function createActions(
  mixer: THREE.AnimationMixer,
  clips: readonly THREE.AnimationClip[],
  definition: AuthoredHeroDefinition,
): AuthoredHeroRuntime["actions"] {
  const find = (name: string): THREE.AnimationClip => {
    const clip = clips.find((candidate) => candidate.name === name)
    if (!clip) throw new Error(`Authored character is missing animation clip ${name}`)
    return clip
  }
  const idle = mixer.clipAction(find(definition.clips.idle))
  const walk = mixer.clipAction(find(definition.clips.walk))
  const attack = mixer.clipAction(find(definition.clips.attack))
  const signature = mixer.clipAction(find(definition.clips.signature))
  idle.setLoop(THREE.LoopRepeat, Infinity)
  walk.setLoop(THREE.LoopRepeat, Infinity)
  attack.setLoop(THREE.LoopOnce, 1)
  attack.clampWhenFinished = true
  signature.setLoop(THREE.LoopOnce, 1)
  signature.clampWhenFinished = true
  return { idle, walk, attack, signature }
}

function switchAuthoredAnimation(runtime: AuthoredHeroRuntime, pose: CharacterPose): void {
  const requestedState: AuthoredAnimationState = pose.action && pose.action !== "idle"
    ? pose.action
    : pose.moving
      ? "walk"
      : "idle"
  if (runtime.activeState === requestedState) return

  const next = runtime.actions[requestedState]
  const previous = runtime.activeState ? runtime.actions[runtime.activeState] : null
  if (previous && previous !== next) previous.fadeOut(0.12)
  next.reset().play()
  if (previous) next.fadeIn(0.12)
  else next.setEffectiveWeight(1)
  runtime.activeState = requestedState
}

function findBowStringMorph(model: THREE.Group): AuthoredBowStringMorph | null {
  const object = model.getObjectByName("KayKitBowString")
  if (!(object instanceof THREE.Mesh)) return null
  const drawIndex = object.morphTargetDictionary?.Draw
  if (!Number.isInteger(drawIndex) || drawIndex === undefined || drawIndex < 0) return null
  if (!object.morphTargetInfluences || drawIndex >= object.morphTargetInfluences.length) return null
  return { mesh: object, drawIndex }
}

function setBowStringDraw(runtime: AuthoredHeroRuntime, draw: number): void {
  const target = runtime.bowStringMorph
  if (!target.mesh.morphTargetInfluences) return
  target.mesh.morphTargetInfluences[target.drawIndex] = THREE.MathUtils.clamp(draw, 0, 1)
}

function normalizedActionProgress(pose: CharacterPose): number {
  return Number.isFinite(pose.actionProgress)
    ? THREE.MathUtils.clamp(pose.actionProgress ?? 0, 0, 1)
    : 0
}

function bowDrawAtAttackProgress(progress: number): number {
  if (progress <= BOW_ATTACK_RELEASE_START) {
    return progress / BOW_ATTACK_RELEASE_START
  }
  if (progress < BOW_ATTACK_RELEASE_END) {
    return 1 - (progress - BOW_ATTACK_RELEASE_START)
      / (BOW_ATTACK_RELEASE_END - BOW_ATTACK_RELEASE_START)
  }
  return 0
}

function bowDrawForPose(runtime: AuthoredHeroRuntime, pose: CharacterPose): number {
  const usesBowString = pose.action === "attack"
    || (pose.action === "signature" && runtime.bowSignature)
  return usesBowString ? bowDrawAtAttackProgress(normalizedActionProgress(pose)) : 0
}

function sampleOneShot(runtime: AuthoredHeroRuntime, pose: CharacterPose): void {
  const state = runtime.activeState
  if (state !== "attack" && state !== "signature") return
  const action = runtime.actions[state]
  action.time = normalizedActionProgress(pose) * action.getClip().duration
  action.paused = true
}

function poseAuthoredHero(runtime: AuthoredHeroRuntime, pose: CharacterPose): void {
  runtime.model.visible = !pose.downed
  if (pose.downed) {
    setBowStringDraw(runtime, 0)
    runtime.lastElapsed = pose.elapsed
    return
  }

  switchAuthoredAnimation(runtime, pose)
  sampleOneShot(runtime, pose)
  const motionScale = THREE.MathUtils.clamp(pose.motionScale ?? 1, 0, 1)
  runtime.actions.idle.setEffectiveTimeScale(motionScale)
  runtime.actions.walk.setEffectiveTimeScale(motionScale)
  if (runtime.lastElapsed === null) {
    const activeAction = runtime.activeState ? runtime.actions[runtime.activeState] : null
    if (activeAction && runtime.activeState !== "attack" && runtime.activeState !== "signature") {
      activeAction.time = Math.max(0, pose.elapsed) % activeAction.getClip().duration
    }
    runtime.mixer.update(0)
    runtime.lastElapsed = pose.elapsed
    setBowStringDraw(
      runtime,
      bowDrawForPose(runtime, pose),
    )
    return
  }
  const delta = THREE.MathUtils.clamp(pose.elapsed - runtime.lastElapsed, 0, 0.1)
  runtime.lastElapsed = pose.elapsed
  // Mixer time must keep moving so crossfade weights complete even when a
  // reduced-motion pose freezes the looping clip's local time.
  runtime.mixer.update(delta)
  setBowStringDraw(
    runtime,
    bowDrawForPose(runtime, pose),
  )
}

async function attachAuthoredHero(root: THREE.Group, runtime: CharacterVisualRuntime): Promise<void> {
  const definition = definitionFor(runtime.characterId)
  if (!definition) return

  root.userData.assetStatus = "loading"
  try {
    const asset = await loadAuthoredHero(definition)
    if (runtime.disposed) return

    const model = cloneSkeleton(asset.scene) as THREE.Group
    cloneObjectMaterialsForInstance(model)
    model.name = `character.${runtime.characterId}.authored`
    normalizeAuthoredHero(model, definition.height)
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = true
      object.receiveShadow = true
    })
    const mixer = new THREE.AnimationMixer(model)
    const bowStringMorph = findBowStringMorph(model)
    if (!bowStringMorph) {
      throw new Error("Authored character is missing KayKitBowString.Draw")
    }
    const authored: AuthoredHeroRuntime = {
      model,
      mixer,
      actions: createActions(mixer, asset.animations, definition),
      bowStringMorph,
      bowSignature: definition.bowSignature,
      activeState: null,
      lastElapsed: null,
    }
    runtime.authored = authored
    root.add(model)
    runtime.fallback.visible = Boolean(runtime.lastPose.downed)
    poseAuthoredHero(authored, runtime.lastPose)
    root.userData.assetStatus = "authored"
  } catch (error) {
    root.userData.assetStatus = "fallback"
    root.userData.assetError = error instanceof Error ? error.message : String(error)
  }
}

function characterVisualRuntime(root: THREE.Group): CharacterVisualRuntime | null {
  const runtime = root.userData.characterVisualRuntime as CharacterVisualRuntime | undefined
  return runtime?.fallback instanceof THREE.Group ? runtime : null
}

export function createCharacterVisual(
  characterId: CharacterId,
  options: CharacterVisualOptions = {},
): THREE.Group {
  const root = new THREE.Group()
  root.name = `character.${characterId}.visual`
  root.userData.characterId = characterId
  const fallback = createHeroCharacter(characterId)
  root.add(fallback)
  const runtime: CharacterVisualRuntime = {
    characterId,
    fallback,
    authored: null,
    disposed: false,
    lastPose: { elapsed: 0, moving: false, action: "idle" },
    ready: Promise.resolve(),
  }
  root.userData.characterVisualRuntime = runtime
  root.userData.assetStatus = definitionFor(characterId) ? "pending" : "procedural"
  if (options.loadAuthoredAssets !== false) runtime.ready = attachAuthoredHero(root, runtime)
  return root
}

export function waitForCharacterVisual(root: THREE.Group): Promise<void> {
  return characterVisualRuntime(root)?.ready ?? Promise.resolve()
}

export function poseCharacterVisual(root: THREE.Group, pose: CharacterPose): void {
  const runtime = characterVisualRuntime(root)
  if (!runtime) {
    poseHeroCharacter(root, pose)
    return
  }
  runtime.lastPose = pose
  poseHeroCharacter(runtime.fallback, pose)
  runtime.fallback.visible = !runtime.authored || Boolean(pose.downed)
  if (runtime.authored) poseAuthoredHero(runtime.authored, pose)
}

export function disposeCharacterVisual(root: THREE.Group): void {
  const runtime = characterVisualRuntime(root)
  if (!runtime) {
    disposeHeroCharacter(root)
    return
  }
  if (runtime.disposed) return
  runtime.disposed = true
  disposeHeroCharacter(runtime.fallback)
  if (runtime.authored) {
    runtime.authored.mixer.stopAllAction()
    runtime.authored.mixer.uncacheRoot(runtime.authored.model)
    disposeObjectInstanceMaterials(runtime.authored.model)
  }
}
