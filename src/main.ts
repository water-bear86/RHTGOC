import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js"
import "./style.css"
import {
  activateSignature,
  calculateMastery,
  CART_POSITION,
  DELIVERY_TARGET,
  VILLAGE_POSITION,
  createInitialState,
  getContextPrompt,
  interact,
  shoot,
  updateSimulation,
  type CharacterId,
  type Vec2,
} from "./simulation"
import { loadLeaderboard, submitLeaderboardEntry, subscribeToLeaderboard, type LeaderboardKind } from "./leaderboard"
import { MultiplayerClient } from "./multiplayer"
import { SnapshotBuffer } from "./snapshot-buffer"
import { chooseRenderProfile } from "./render-profile"
import type { LastMissionResult, LoadoutId, MissionCaptive, MissionEvent, MissionSnapshot, MissionTrap, PingKind, RoomPlayer, VillageState, VoteChoice, WorldPing } from "../shared/protocol"
import { getMissionDefinition, MISSION_CATALOG, PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import {
  ACTION_LABELS,
  DEFAULT_INPUT_SETTINGS,
  GAME_ACTIONS,
  keyLabel,
  loadInputSettings,
  saveInputSettings,
  type GameAction,
  type InputSettings,
  type PointerAction,
} from "./input-settings"

const container = document.querySelector<HTMLDivElement>("#game")!
const intro = document.querySelector<HTMLDivElement>("#intro")!
const startButton = document.querySelector<HTMLButtonElement>("#start-button")!
const promptElement = document.querySelector<HTMLDivElement>("#prompt")!
const toastElement = document.querySelector<HTMLDivElement>("#toast")!
const objectiveElement = document.querySelector<HTMLElement>("#objective-text")!
const missionTitle = document.querySelector<HTMLElement>("#mission-title")!
const progressElement = document.querySelector<HTMLElement>("#progress-fill")!
const missionModifiers = document.querySelector<HTMLElement>("#mission-modifiers")!
const healthElement = document.querySelector<HTMLElement>("#health")!
const arrowsElement = document.querySelector<HTMLElement>("#arrows")!
const lootElement = document.querySelector<HTMLElement>("#loot")!
const heatWrap = document.querySelector<HTMLElement>("#heat-wrap")!
const heatElement = document.querySelector<HTMLElement>("#heat-fill")!
const helpButton = document.querySelector<HTMLButtonElement>("#help-button")!
const helpPanel = document.querySelector<HTMLDivElement>("#help-panel")!
const closeHelp = document.querySelector<HTMLButtonElement>("#close-help")!
const signatureElement = document.querySelector<HTMLElement>("#signature")!
const signatureKeyElement = document.querySelector<HTMLElement>(".signature-status i")!
const leaderboardButton = document.querySelector<HTMLButtonElement>("#leaderboard-button")!
const leaderboardPanel = document.querySelector<HTMLDivElement>("#leaderboard-panel")!
const closeLeaderboard = document.querySelector<HTMLButtonElement>("#close-leaderboard")!
const leaderboardList = document.querySelector<HTMLOListElement>("#leaderboard-list")!
const leaderboardState = document.querySelector<HTMLElement>("#leaderboard-state")!
const boardKind = document.querySelector<HTMLSelectElement>("#board-kind")!
const boardCharacter = document.querySelector<HTMLSelectElement>("#board-character")!
const boardParty = document.querySelector<HTMLSelectElement>("#board-party")!
const boardScope = document.querySelector<HTMLSelectElement>("#board-scope")!
const boardMission = document.querySelector<HTMLSelectElement>("#board-mission")!
const boardSeason = document.querySelector<HTMLSelectElement>("#board-season")!
const characterButtons = [...document.querySelectorAll<HTMLButtonElement>(".character-option")]
const playerNameInput = document.querySelector<HTMLInputElement>("#player-name")!
const roomCodeInput = document.querySelector<HTMLInputElement>("#room-code")!
const createRoomButton = document.querySelector<HTMLButtonElement>("#create-room")!
const joinRoomButton = document.querySelector<HTMLButtonElement>("#join-room")!
const roomLobby = document.querySelector<HTMLDivElement>("#room-lobby")!
const lobbyCode = document.querySelector<HTMLElement>("#lobby-code")!
const lobbyStatus = document.querySelector<HTMLElement>("#lobby-status")!
const partyList = document.querySelector<HTMLUListElement>("#party-list")!
const readyButton = document.querySelector<HTMLButtonElement>("#ready-button")!
const partyHud = document.querySelector<HTMLElement>("#party-hud")!
const missionPartyList = document.querySelector<HTMLUListElement>("#mission-party-list")!
const missionRoomCode = document.querySelector<HTMLElement>("#mission-room-code")!
const resultsPanel = document.querySelector<HTMLDivElement>("#results-panel")!
const closeResults = document.querySelector<HTMLButtonElement>("#close-results")!
const resultGrade = document.querySelector<HTMLElement>("#result-grade")!
const resultScore = document.querySelector<HTMLElement>("#result-score")!
const resultBreakdown = document.querySelector<HTMLDListElement>("#result-breakdown")!
const communityAllocation = document.querySelector<HTMLElement>("#community-allocation")!
const voteState = document.querySelector<HTMLElement>("#vote-state")!
const voteButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-vote]")]
const safetyButton = document.querySelector<HTMLButtonElement>("#safety-button")!
const safetyPanel = document.querySelector<HTMLDivElement>("#safety-panel")!
const closeSafety = document.querySelector<HTMLButtonElement>("#close-safety")!
const safetyPartyList = document.querySelector<HTMLUListElement>("#safety-party-list")!
const settingsButton = document.querySelector<HTMLButtonElement>("#settings-button")!
const settingsPanel = document.querySelector<HTMLDivElement>("#settings-panel")!
const closeSettings = document.querySelector<HTMLButtonElement>("#close-settings")!
const keyboardBindings = document.querySelector<HTMLDivElement>("#keyboard-bindings")!
const pointerBindings = document.querySelector<HTMLDivElement>("#pointer-bindings")!
const controllerBindings = document.querySelector<HTMLDivElement>("#controller-bindings")!
const resetSettings = document.querySelector<HTMLButtonElement>("#reset-settings")!
const settingsStatus = document.querySelector<HTMLElement>("#settings-status")!
const spectatorBanner = document.querySelector<HTMLElement>("#spectator-banner")!
const introControls = document.querySelector<HTMLElement>("#intro-controls")!
const helpMove = document.querySelector<HTMLElement>("#help-move")!
const helpInteract = document.querySelector<HTMLElement>("#help-interact")!
const helpFire = document.querySelector<HTMLElement>("#help-fire")!
const helpSignature = document.querySelector<HTMLElement>("#help-signature")!
const helpSignals = document.querySelector<HTMLElement>("#help-signals")!
const helpSupport = document.querySelector<HTMLElement>("#help-support")!
const reducedMotionSetting = document.querySelector<HTMLInputElement>("#setting-reduced-motion")!
const highContrastSetting = document.querySelector<HTMLInputElement>("#setting-high-contrast")!
const captionsSetting = document.querySelector<HTMLInputElement>("#setting-captions")!
const readableTextSetting = document.querySelector<HTMLInputElement>("#setting-readable-text")!
const mobileSpectatorSetting = document.querySelector<HTMLInputElement>("#setting-mobile-spectator")!
const missionDebugButton = document.querySelector<HTMLButtonElement>("#mission-debug-button")!
const missionDebug = document.querySelector<HTMLPreElement>("#mission-debug")!
const rejoinRoomButton = document.querySelector<HTMLButtonElement>("#rejoin-room")!
const hubPanel = document.querySelector<HTMLElement>("#hub-panel")!
const hubRoomCode = document.querySelector<HTMLElement>("#hub-room-code")!
const hubRecent = document.querySelector<HTMLElement>("#hub-recent")!
const hubMissions = document.querySelector<HTMLDivElement>("#hub-missions")!
const hubRoles = [...document.querySelectorAll<HTMLButtonElement>("[data-hub-character]")]
const hubLoadout = document.querySelector<HTMLSelectElement>("#hub-loadout")!
const hubCopyCode = document.querySelector<HTMLButtonElement>("#hub-copy-code")!
const hubReady = document.querySelector<HTMLButtonElement>("#hub-ready")!
const hubState = document.querySelector<HTMLElement>("#hub-state")!
const returnHubButton = document.querySelector<HTMLButtonElement>("#return-hub")!
playerNameInput.value = localStorage.getItem("sherwood-rebellion:player-name") ?? "Greenhood"
const invitedRoom = new URLSearchParams(location.search).get("room")?.trim().toUpperCase()
if (invitedRoom?.match(/^[A-Z2-9]{6}$/)) roomCodeInput.value = invitedRoom
const lastRoomCode = localStorage.getItem("sherwood:last-room-code")
if (lastRoomCode?.match(/^[A-Z2-9]{6}$/)) rejoinRoomButton.classList.remove("hidden")

let inputSettings: InputSettings = loadInputSettings(localStorage)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x91aa83)
scene.fog = new THREE.FogExp2(0x91aa83, 0.026)

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 140)
camera.position.set(6, 14, 20)

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" })
const renderProfile = chooseRenderProfile({
  maxTextureSize: renderer.capabilities.maxTextureSize,
  maxTextures: renderer.capabilities.maxTextures,
  devicePixelRatio: window.devicePixelRatio,
  reducedMotion: inputSettings.reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
})
renderer.setPixelRatio(renderProfile.pixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = renderProfile.shadows
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
container.appendChild(renderer.domElement)

let selectedCharacter: CharacterId = "robin"
let state = createInitialState(selectedCharacter)
const clock = new THREE.Clock()
const keys = new Set<string>()
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const clickPoint = new THREE.Vector3()
let clickTarget: Vec2 | null = null
let running = false
let toastTimer = 0
let ended = false
let lastPlayerPosition = { ...state.player.position }
let resultSubmitted = false
let unsubscribeLeaderboard: (() => void) | null = null
let multiplayerActive = false
let inHub = false
let roomConnected = false
let localReady = false
let currentRoomPlayers: RoomPlayer[] = []
let lastMissionEventSequence = 0
let localDownedFor = 0
let missionTarget = DELIVERY_TARGET
let missionObjective = "Find the Sheriff's tax cart"
let missionPrompt = "Scout together and signal a route"
let currentMissionPhase: MissionSnapshot["phase"] = "scout"
let currentMissionSlug = PEOPLES_PURSE_MISSION.slug
let currentVillage: VillageState = { granary: 0, infirmary: 0, watchtower: 0 }
let currentLastResult: LastMissionResult | null = null
let signalSabotaged = false
let latestMissionSnapshot: MissionSnapshot | null = null
let missionPackageStatus = "client package valid"
let capturingAction: GameAction | null = null
let previousGamepadButtons: boolean[] = []
let lastPanelTrigger: HTMLElement | null = null

const guardViews: THREE.Group[] = []
const arrowEffects: { line: THREE.Line; age: number }[] = []
const vanguardEffects: { ring: THREE.Mesh; age: number }[] = []
interface RemoteView {
  view: THREE.Group
  fallback: THREE.Group
  authored: THREE.Group | null
  snapshots: SnapshotBuffer
  mixer: THREE.AnimationMixer | null
  actions: Map<string, THREE.AnimationAction>
  motion: string
  lastPosition: THREE.Vector3
  characterId: CharacterId
  downedFor: number
}

const remoteViews = new Map<string, RemoteView>()
const pingViews = new Map<number, THREE.Group>()
const trapViews = new Map<number, THREE.Group>()
const captiveViews = new Map<number, THREE.Group>()
const villageUpgradeViews = new Map<VoteChoice, THREE.Group>()
const mutedPlayerIds = new Set<string>()
const gltfLoader = new GLTFLoader()
let rangerAssetPromise: Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> | null = null
let robinRangerMixer: THREE.AnimationMixer | null = null
let robinRangerActions = new Map<string, THREE.AnimationAction>()
let robinRangerMotion = ""
let robinShotUntil = 0

const palette = {
  grass: 0x506e40,
  grassLight: 0x64844c,
  grassDark: 0x3b5834,
  earth: 0x9c7a4d,
  path: 0xb19567,
  leaf: 0x284f32,
  leafLight: 0x3c6a3e,
  trunk: 0x59422b,
  cream: 0xe8dfbd,
  gold: 0xe2af43,
  red: 0x8d352b,
  green: 0x315f37,
  water: 0x5c8791,
}

const SIGNAL_POSITION = { ...PEOPLES_PURSE_MISSION.spawns.reinforcementSignal }

const characterNames: Record<CharacterId, string> = {
  robin: "Robin Hood",
  marian: "Maid Marian",
  "little-john": "Little John",
  much: "Much",
}

function characterName(characterId: CharacterId): string {
  return characterNames[characterId]
}

function material(color: number, roughness = 0.9): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 })
}

function mesh(
  geometry: THREE.BufferGeometry,
  color: number,
  options: { y?: number; receive?: boolean; cast?: boolean } = {},
): THREE.Mesh {
  const object = new THREE.Mesh(geometry, material(color))
  object.position.y = options.y ?? 0
  object.castShadow = options.cast ?? true
  object.receiveShadow = options.receive ?? true
  return object
}

function addLighting(): void {
  const hemisphere = new THREE.HemisphereLight(0xe9efce, 0x243823, 2.2)
  scene.add(hemisphere)

  const sun = new THREE.DirectionalLight(0xffedc8, 4.2)
  sun.position.set(-18, 28, 14)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -30
  sun.shadow.camera.right = 30
  sun.shadow.camera.top = 30
  sun.shadow.camera.bottom = -30
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 70
  sun.shadow.bias = -0.0004
  scene.add(sun)
}

function createTree(x: number, z: number, scale = 1): THREE.Group {
  const tree = new THREE.Group()
  tree.position.set(x, 0, z)
  const trunk = mesh(new THREE.CylinderGeometry(0.22 * scale, 0.34 * scale, 2.4 * scale, 7), palette.trunk)
  trunk.position.y = 1.2 * scale
  tree.add(trunk)

  const crownA = mesh(new THREE.ConeGeometry(1.25 * scale, 2.8 * scale, 7), palette.leaf)
  crownA.position.y = 3 * scale
  crownA.rotation.y = x * 0.15
  const crownB = mesh(new THREE.ConeGeometry(0.92 * scale, 2.2 * scale, 7), palette.leafLight)
  crownB.position.set(0.35 * scale, 3.8 * scale, 0.12 * scale)
  crownB.rotation.y = z * 0.12
  tree.add(crownA, crownB)
  scene.add(tree)
  return tree
}

function createHut(x: number, z: number, rotation = 0): THREE.Group {
  const hut = new THREE.Group()
  hut.position.set(x, 0, z)
  hut.rotation.y = rotation
  const walls = mesh(new THREE.BoxGeometry(3.2, 1.9, 2.6), 0xc5aa74)
  walls.position.y = 0.95
  const roof = mesh(new THREE.ConeGeometry(2.65, 1.6, 4), 0x6d4931)
  roof.position.y = 2.4
  roof.rotation.y = Math.PI / 4
  const door = mesh(new THREE.BoxGeometry(0.7, 1.25, 0.08), 0x4e3628)
  door.position.set(0, 0.65, 1.34)
  hut.add(walls, roof, door)
  scene.add(hut)
  return hut
}

function createWorld(): void {
  const ground = mesh(new THREE.PlaneGeometry(52, 52), palette.grass, { receive: true, cast: false })
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.04
  scene.add(ground)

  const river = mesh(new THREE.PlaneGeometry(5, 54), palette.water, { receive: true, cast: false })
  river.rotation.x = -Math.PI / 2
  river.rotation.z = -0.1
  river.position.set(1, 0.01, 0)
  scene.add(river)

  const road = mesh(new THREE.PlaneGeometry(5.5, 48), palette.path, { receive: true, cast: false })
  road.rotation.x = -Math.PI / 2
  road.rotation.z = Math.PI / 4.15
  road.position.set(-0.2, 0.025, 0.2)
  scene.add(road)

  const bridge = mesh(new THREE.BoxGeometry(7.2, 0.32, 3.3), 0x8b653d)
  bridge.position.set(0.9, 0.18, -0.2)
  bridge.rotation.y = -0.1
  scene.add(bridge)
  for (let i = -3; i <= 3; i += 1) {
    const plank = mesh(new THREE.BoxGeometry(0.12, 0.11, 3.5), 0x4b382a)
    plank.position.set(0.9 + i, 0.39, -0.2 - i * 0.1)
    plank.rotation.y = -0.1
    scene.add(plank)
  }

  createHut(-14, 11, 0.35)
  createHut(-10, 14, -0.55)
  createHut(-15, 6, 1.1)
  const villageCircle = mesh(new THREE.TorusGeometry(2.35, 0.08, 6, 48), palette.gold, { cast: false })
  villageCircle.position.set(VILLAGE_POSITION.x, 0.06, VILLAGE_POSITION.z)
  villageCircle.rotation.x = Math.PI / 2
  scene.add(villageCircle)

  const fireLight = new THREE.PointLight(0xf39a43, 4, 14, 2)
  fireLight.position.set(VILLAGE_POSITION.x, 1.2, VILLAGE_POSITION.z)
  scene.add(fireLight)
  const fire = mesh(new THREE.ConeGeometry(0.35, 1, 6), 0xe88032)
  fire.position.set(VILLAGE_POSITION.x, 0.5, VILLAGE_POSITION.z)
  scene.add(fire)

  let seed = 1937
  const random = (): number => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let i = 0; i < 90; i += 1) {
    const x = random() * 48 - 24
    const z = random() * 48 - 24
    const nearVillage = Math.hypot(x - VILLAGE_POSITION.x, z - VILLAGE_POSITION.z) < 6.5
    const nearCart = Math.hypot(x - CART_POSITION.x, z - CART_POSITION.z) < 6
    const nearRiver = Math.abs(x - 1 - z * 0.1) < 3.8
    const nearRoad = Math.abs(z - x) < 3
    if (!nearVillage && !nearCart && !nearRiver && !nearRoad) createTree(x, z, 0.7 + random() * 0.7)
  }

  for (let i = 0; i < 18; i += 1) {
    const rock = mesh(new THREE.DodecahedronGeometry(0.25 + random() * 0.45, 0), 0x687060)
    rock.scale.y = 0.55
    rock.position.set(random() * 44 - 22, 0.2, random() * 44 - 22)
    rock.rotation.set(random(), random(), random())
    scene.add(rock)
  }
}

function createCharacter(role: CharacterId | "guard"): THREE.Group {
  const character = new THREE.Group()
  const isRobin = role === "robin"
  const isMarian = role === "marian"
  const isLittleJohn = role === "little-john"
  const isHero = role !== "guard"
  const tunicColor = isRobin ? palette.green : isMarian ? 0x4d536f : isLittleJohn ? 0x76532f : role === "much" ? 0x665337 : palette.red
  const tunic = mesh(new THREE.CylinderGeometry(isLittleJohn ? 0.48 : 0.38, isLittleJohn ? 0.62 : 0.52, isLittleJohn ? 1.52 : 1.35, 8), tunicColor)
  tunic.position.y = 1.08
  const belt = mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.14, 8), 0x3e2a21)
  belt.position.y = 1.15
  const head = mesh(new THREE.SphereGeometry(0.32, 12, 8), 0xd9b187)
  head.position.y = 1.96
  const legLeft = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.72, 6), 0x493d2d)
  legLeft.position.set(-0.19, 0.38, 0)
  const legRight = legLeft.clone()
  legRight.position.x = 0.19
  const hat = isHero
    ? mesh(new THREE.ConeGeometry(0.48, 0.72, 7), isMarian ? 0x34374f : 0x234b2d)
    : mesh(new THREE.SphereGeometry(0.39, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0x777d78)
  hat.position.y = 2.23
  hat.rotation.z = isHero ? -0.35 : 0
  character.add(tunic, belt, head, legLeft, legRight, hat)
  if (isHero && !isLittleJohn) {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.035, 5, 18, Math.PI * 1.45), material(0x7e512f))
    bow.position.set(-0.5, 1.15, 0)
    bow.rotation.set(Math.PI / 2, 0, Math.PI / 2)
    character.add(bow)
    if (isMarian) {
      const mantle = mesh(new THREE.ConeGeometry(0.6, 1.45, 8, 1, true), 0x39465d)
      mantle.position.set(0, 1.1, 0.17)
      mantle.rotation.x = 0.08
      character.add(mantle)
    }
    if (role === "much") {
      const satchel = mesh(new THREE.BoxGeometry(0.48, 0.42, 0.24), 0x8b6234)
      satchel.position.set(0.43, 1.04, 0.28)
      satchel.rotation.z = -0.18
      const fuse = mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 5), 0xd4b15e)
      fuse.position.set(0.36, 1.55, 0.22)
      fuse.rotation.z = -0.55
      character.add(satchel, fuse)
    }
  } else if (isLittleJohn) {
    const staff = mesh(new THREE.CylinderGeometry(0.055, 0.065, 2.9, 8), 0x654225)
    staff.position.set(0.55, 1.25, 0)
    staff.rotation.z = -0.16
    const ironBand = mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.22, 8), 0x8b8f86)
    ironBand.position.set(0.78, 2.66, 0)
    ironBand.rotation.z = -0.16
    const shoulder = mesh(new THREE.TorusGeometry(0.48, 0.075, 6, 18, Math.PI), 0x3e2a21)
    shoulder.position.set(0, 1.64, 0)
    shoulder.rotation.x = Math.PI / 2
    character.add(staff, ironBand, shoulder)
  } else {
    const spear = mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.5, 5), 0x3c2c20)
    spear.position.set(0.48, 1.15, 0)
    const tip = mesh(new THREE.ConeGeometry(0.12, 0.4, 5), 0xaeb4ae)
    tip.position.set(0.48, 2.55, 0)
    character.add(spear, tip)
  }
  return character
}

function loadRobinRanger(): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  rangerAssetPromise ??= gltfLoader.loadAsync("/assets/characters/robin-ranger-rigged.glb")
    .then((asset) => ({ scene: asset.scene, animations: asset.animations }))
  return rangerAssetPromise
}

function prepareRangerInstance(source: THREE.Group): THREE.Group {
  const ranger = cloneSkeleton(source) as THREE.Group
  ranger.scale.setScalar(2.15)
  ranger.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
    child.frustumCulled = true
  })
  return ranger
}

function attachRobinRanger(view: THREE.Group): void {
  void loadRobinRanger().then((asset) => {
    if (playerView !== view || selectedCharacter !== "robin") return
    view.clear()
    const ranger = prepareRangerInstance(asset.scene)
    view.add(ranger)
    robinRangerMixer = new THREE.AnimationMixer(ranger)
    robinRangerActions = new Map(asset.animations.map((clip) => [clip.name, robinRangerMixer!.clipAction(clip)]))
    robinRangerMotion = ""
    setRobinRangerMotion("Robin_Idle")
  }).catch(() => showToast("Robin's ranger model could not be loaded"))
}

function setRobinRangerMotion(name: string): void {
  if (!robinRangerMixer || robinRangerMotion === name) return
  const next = robinRangerActions.get(name)
  if (!next) return
  const previous = robinRangerActions.get(robinRangerMotion)
  previous?.fadeOut(0.12)
  next.reset().fadeIn(0.12).play()
  robinRangerMotion = name
}

function createCart(): THREE.Group {
  const cart = new THREE.Group()
  cart.position.set(CART_POSITION.x, 0, CART_POSITION.z)
  cart.rotation.y = -0.75
  const bed = mesh(new THREE.BoxGeometry(2.8, 0.7, 1.65), 0x7a4e2d)
  bed.position.y = 1
  cart.add(bed)
  for (const x of [-1.05, 1.05]) {
    for (const z of [-0.9, 0.9]) {
      const wheel = mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.18, 12), 0x3b2a21)
      wheel.position.set(x, 0.55, z)
      wheel.rotation.x = Math.PI / 2
      cart.add(wheel)
    }
  }
  for (let i = 0; i < 5; i += 1) {
    const coin = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.08, 12), palette.gold)
    coin.position.set(-0.6 + i * 0.3, 1.45 + (i % 2) * 0.1, 0)
    coin.rotation.x = Math.PI / 2
    coin.userData.coin = true
    cart.add(coin)
  }
  const cage = new THREE.Group()
  cage.userData.prison = true
  const cageRoof = mesh(new THREE.BoxGeometry(2.25, 0.12, 1.45), 0x3f3428)
  cageRoof.position.y = 2.75
  cage.add(cageRoof)
  for (const x of [-0.95, -0.48, 0, 0.48, 0.95]) {
    for (const z of [-0.66, 0.66]) {
      const bar = mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.65, 6), 0x3f3428)
      bar.position.set(x, 1.95, z)
      cage.add(bar)
    }
  }
  for (const x of [-1.08, 1.08]) {
    for (const z of [-0.42, 0, 0.42]) {
      const bar = mesh(new THREE.CylinderGeometry(0.035, 0.045, 1.65, 6), 0x3f3428)
      bar.position.set(x, 1.95, z)
      cage.add(bar)
    }
  }
  cage.visible = false
  cart.add(cage)
  scene.add(cart)
  return cart
}

function createSignalPost(): THREE.Group {
  const signal = new THREE.Group()
  const pole = mesh(new THREE.CylinderGeometry(0.08, 0.1, 3.8, 8), 0x513824)
  pole.position.y = 1.9
  const arm = mesh(new THREE.BoxGeometry(1.35, 0.1, 0.1), 0x513824)
  arm.position.set(0.55, 3.45, 0)
  const flag = mesh(new THREE.PlaneGeometry(1.1, 0.65), 0xa94132, { cast: false })
  flag.position.set(0.68, 3.04, 0.04)
  flag.userData.signalFlag = true
  signal.add(pole, arm, flag)
  signal.position.set(SIGNAL_POSITION.x, 0, SIGNAL_POSITION.z)
  scene.add(signal)
  return signal
}

function createMissionBoard(): THREE.Group {
  const board = new THREE.Group()
  for (const x of [-0.9, 0.9]) {
    const post = mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.3, 7), 0x4f3522)
    post.position.set(x, 1.15, 0)
    board.add(post)
  }
  const face = mesh(new THREE.BoxGeometry(2.3, 1.2, 0.16), 0x8e6739)
  face.position.y = 1.65
  const crest = mesh(new THREE.CircleGeometry(0.24, 18), palette.gold, { cast: false })
  crest.position.set(0, 1.72, 0.1)
  board.add(face, crest)
  board.position.set(VILLAGE_POSITION.x + 3.4, 0, VILLAGE_POSITION.z - 0.4)
  scene.add(board)
  return board
}

addLighting()
createWorld()

let playerView = createCharacter(selectedCharacter)
scene.add(playerView)
attachRobinRanger(playerView)
state.guards.forEach(() => {
  const guard = createCharacter("guard")
  guardViews.push(guard)
  scene.add(guard)
})
const cartView = createCart()
const signalView = createSignalPost()
const missionBoardView = createMissionBoard()

const destinationMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.42, 0.56, 24),
  new THREE.MeshBasicMaterial({ color: palette.cream, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
)
destinationMarker.rotation.x = -Math.PI / 2
destinationMarker.position.y = 0.08
destinationMarker.visible = false
scene.add(destinationMarker)

const multiplayer = new MultiplayerClient({
  onWelcome: (_playerId, roomCode) => {
    roomConnected = true
    localStorage.setItem("sherwood:last-room-code", roomCode)
    lobbyCode.textContent = roomCode
    missionRoomCode.textContent = roomCode
    hubRoomCode.textContent = roomCode
    roomCodeInput.value = roomCode
    roomLobby.classList.remove("hidden")
    lobbyStatus.textContent = "Share this code, then ready up together."
    enterHub(true)
  },
  onRoomState: (_roomCode, phase, players, missionSlug, village, lastResult) => {
    currentRoomPlayers = players
    currentMissionSlug = missionSlug
    currentVillage = { ...village }
    currentLastResult = lastResult
    renderParty(players)
    renderSafetyPanel(players)
    const localPlayer = players.find((player) => player.id === multiplayer.playerId)
    localReady = localPlayer?.ready ?? false
    if (localPlayer) {
      if (localPlayer.characterId !== selectedCharacter) selectLocalCharacter(localPlayer.characterId, false)
      state.player.health = localPlayer.health
      if (phase === "lobby") state.player.position = { ...localPlayer.position }
    }
    readyButton.textContent = localReady ? "NOT READY" : "READY UP"
    hubReady.textContent = localReady ? "NOT READY" : "READY UP"
    hubLoadout.value = localPlayer?.loadoutId ?? "balanced"
    applyVillageState(village)
    renderHub()
    if (phase === "lobby") {
      multiplayerActive = false
      enterHub(true)
      ensureRemotePlayers(players)
      return
    }
    if (phase === "mission") {
      multiplayerActive = true
      inHub = false
      running = true
      intro.scrollTop = 0
      intro.classList.add("closed")
      hubPanel.classList.add("hidden")
      setMissionWorldVisible(true)
      lobbyStatus.textContent = "Mission started"
      ensureRemotePlayers(players)
      partyHud.classList.remove("hidden")
      clock.getDelta()
    }
  },
  onSnapshot: (_tick, players, mission) => {
    const receivedAt = performance.now()
    for (const player of players) {
      if (player.id === multiplayer.playerId) {
        state.player.position.x += (player.position.x - state.player.position.x) * 0.35
        state.player.position.z += (player.position.z - state.player.position.z) * 0.35
        state.player.health = player.health
        state.player.arrows = player.arrows
        state.player.loot = player.loot
        state.player.signatureCooldown = player.signatureCooldown
        localDownedFor = player.downedFor
      } else {
        const remote = remoteViews.get(player.id)
        remote?.snapshots.push(player.position, receivedAt)
        if (remote) remote.downedFor = player.downedFor
      }
    }
    currentRoomPlayers = currentRoomPlayers.map((roomPlayer) => {
      const snapshotPlayer = players.find((player) => player.id === roomPlayer.id)
      return snapshotPlayer ? { ...roomPlayer, ...snapshotPlayer } : roomPlayer
    })
    renderParty(currentRoomPlayers)
    renderSafetyPanel(currentRoomPlayers)
    applyMissionSnapshot(mission)
  },
  onError: (message) => {
    lobbyStatus.textContent = message
    showToast(message)
  },
  onConnection: (connected) => {
    roomConnected = connected
    lobbyStatus.textContent = connected ? "Connected to Sherwood" : "Connection lost — reconnect with the same code"
    if (inHub) hubState.textContent = connected ? "Connected · choose a target and ready together." : "Connection lost · attempting to return to this camp."
  },
})

function setMissionWorldVisible(visible: boolean): void {
  cartView.visible = visible
  signalView.visible = visible
  for (const guard of guardViews) guard.visible = visible
  missionBoardView.visible = !visible
  if (!visible) {
    syncTrapViews([])
    syncCaptiveViews([])
  }
}

function renderHub(): void {
  const isLeader = !roomConnected || currentRoomPlayers[0]?.id === multiplayer.playerId
  missionTitle.textContent = getMissionDefinition(currentMissionSlug).name.toUpperCase()
  hubMissions.replaceChildren()
  for (const mission of MISSION_CATALOG.values()) {
    const button = document.createElement("button")
    button.classList.toggle("selected", mission.slug === currentMissionSlug)
    button.disabled = roomConnected && !isLeader
    const name = document.createElement("b")
    const detail = document.createElement("small")
    name.textContent = mission.name
    detail.textContent = `${mission.routes.entry.length} approaches · ${Math.round(mission.mastery.parSeconds / 60)} min par · v${mission.missionVersion}`
    button.append(name, detail)
    button.addEventListener("click", () => {
      currentMissionSlug = mission.slug
      if (roomConnected) multiplayer.selectMission(mission.slug)
      else renderHub()
    })
    hubMissions.append(button)
  }
  for (const button of hubRoles) button.classList.toggle("selected", button.dataset.hubCharacter === selectedCharacter)
  hubRoomCode.textContent = roomConnected ? multiplayer.roomCode ?? "------" : "SOLO"
  hubCopyCode.disabled = !roomConnected
  hubReady.textContent = roomConnected ? (localReady ? "NOT READY" : "READY UP") : "START MISSION"
  hubRecent.textContent = currentLastResult
    ? `Last heist: ${currentLastResult.status === "succeeded" ? currentLastResult.grade : "PARTIAL"} · ${currentLastResult.score.toLocaleString()} renown${currentLastResult.totalCaptives > 0 ? ` · ${currentLastResult.rescuedCaptives}/${currentLastResult.totalCaptives} rescued` : ""}. Village: G${currentVillage.granary} I${currentVillage.infirmary} W${currentVillage.watchtower}.`
    : `Village works: granary ${currentVillage.granary}, infirmary ${currentVillage.infirmary}, watchtower ${currentVillage.watchtower}.`
  hubState.textContent = roomConnected
    ? `${isLeader ? "Band leader chooses the target." : "The band leader chooses the target."} Ready together when roles and kits are set.`
    : "Move around the fire or start the selected mission."
}

function enterHub(online: boolean): void {
  inHub = true
  multiplayerActive = false
  roomConnected = online
  running = true
  ended = false
  intro.scrollTop = 0
  intro.classList.add("closed")
  hubPanel.classList.remove("hidden")
  partyHud.classList.toggle("hidden", !online)
  setMissionWorldVisible(false)
  objectiveElement.textContent = "Choose the band's next target"
  missionModifiers.textContent = `${MISSION_CATALOG.size} TRUSTED MISSION${MISSION_CATALOG.size === 1 ? "" : "S"} ON THE BOARD`
  if (!online) state.player.position = { ...PEOPLES_PURSE_MISSION.spawns.players[0] }
  lastPlayerPosition = { ...state.player.position }
  renderHub()
  clock.getDelta()
}

function startSoloMission(): void {
  inHub = false
  multiplayerActive = false
  hubPanel.classList.add("hidden")
  setMissionWorldVisible(true)
  state = createInitialState(selectedCharacter)
  localDownedFor = 0
  ended = false
  resultSubmitted = false
  missionTarget = DELIVERY_TARGET
  objectiveElement.textContent = "Find the Sheriff's tax cart"
  missionModifiers.textContent = ""
  clock.getDelta()
}

const controllerActions = GAME_ACTIONS.filter((action) => !action.startsWith("move")) as Array<keyof InputSettings["controller"]>
const panelElements = [helpPanel, leaderboardPanel, resultsPanel, safetyPanel, settingsPanel]
const controllerButtonLabels = ["A / Cross", "B / Circle", "X / Square", "Y / Triangle", "LB / L1", "RB / R1", "LT / L2", "RT / R2", "View / Share", "Menu / Options", "Left stick", "Right stick", "D-pad up", "D-pad down", "D-pad left", "D-pad right"]
const pointerActionLabels: Record<PointerAction, string> = {
  move: "Move to ground",
  interact: ACTION_LABELS.interact,
  fire: ACTION_LABELS.fire,
  signature: ACTION_LABELS.signature,
  revive: ACTION_LABELS.revive,
  transferLoot: ACTION_LABELS.transferLoot,
  pingDanger: ACTION_LABELS.pingDanger,
  pingTarget: ACTION_LABELS.pingTarget,
  pingRoute: ACTION_LABELS.pingRoute,
  pingLoot: ACTION_LABELS.pingLoot,
  pingRegroup: ACTION_LABELS.pingRegroup,
}

function isMobileSpectator(): boolean {
  return inputSettings.mobileSpectator && window.innerWidth <= 720
}

function refreshControlCopy(): void {
  const key = inputSettings.keyboard
  helpMove.textContent = `${keyLabel(key.moveUp)} / ${keyLabel(key.moveLeft)} / ${keyLabel(key.moveDown)} / ${keyLabel(key.moveRight)}, controller stick, or mapped pointer movement`
  helpInteract.textContent = `${keyLabel(key.interact)} near the cart or village fire`
  helpFire.textContent = `${keyLabel(key.fire)} stuns the nearest guard in range`
  helpSignature.textContent = `${keyLabel(key.signature)} uses Twin Shot, Marian's Veil, Oak Sweep, or Much's Road Snare`
  signatureKeyElement.textContent = keyLabel(key.signature)
  helpSignals.textContent = `${keyLabel(key.pingDanger)} / ${keyLabel(key.pingTarget)} / ${keyLabel(key.pingRoute)} / ${keyLabel(key.pingLoot)} / ${keyLabel(key.pingRegroup)} place symbol-coded signals`
  helpSupport.textContent = `${keyLabel(key.revive)} revives a nearby outlaw · ${keyLabel(key.transferLoot)} transfers up to 60 coin`
  introControls.textContent = `${keyLabel(key.moveUp)}${keyLabel(key.moveLeft)}${keyLabel(key.moveDown)}${keyLabel(key.moveRight)} / POINTER / STICK TO MOVE · ${keyLabel(key.interact)} INTERACT · ${keyLabel(key.fire)} FIRE · ${keyLabel(key.signature)} SIGNATURE`
  missionPrompt = missionPromptForPhase(currentMissionPhase)
}

function applyInputSettings(): void {
  const systemReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  document.body.classList.toggle("reduced-motion", inputSettings.reducedMotion || systemReducedMotion)
  document.body.classList.toggle("high-contrast", inputSettings.highContrast)
  document.body.classList.toggle("captions-off", !inputSettings.captions)
  document.body.classList.toggle("readable-text", inputSettings.readableText)
  renderProfile.motionScale = inputSettings.reducedMotion || systemReducedMotion ? 0 : 1
  const spectator = isMobileSpectator()
  spectatorBanner.classList.toggle("hidden", !spectator)
  renderer.shadowMap.enabled = spectator ? false : renderProfile.shadows
  renderer.setPixelRatio(spectator ? 1 : renderProfile.pixelRatio)
  reducedMotionSetting.checked = inputSettings.reducedMotion
  highContrastSetting.checked = inputSettings.highContrast
  captionsSetting.checked = inputSettings.captions
  readableTextSetting.checked = inputSettings.readableText
  mobileSpectatorSetting.checked = inputSettings.mobileSpectator
  refreshControlCopy()
}

function persistInputSettings(message = "Changes saved on this device."): void {
  saveInputSettings(localStorage, inputSettings)
  applyInputSettings()
  settingsStatus.textContent = message
}

function renderBindingControls(): void {
  keyboardBindings.replaceChildren()
  for (const action of GAME_ACTIONS) {
    const label = document.createElement("label")
    label.textContent = ACTION_LABELS[action]
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = capturingAction === action ? "PRESS A KEY…" : keyLabel(inputSettings.keyboard[action])
    button.setAttribute("aria-label", `Remap ${ACTION_LABELS[action]}, currently ${keyLabel(inputSettings.keyboard[action])}`)
    button.addEventListener("click", () => {
      capturingAction = action
      settingsStatus.textContent = `Press a key for ${ACTION_LABELS[action]}. Escape cancels.`
      renderBindingControls()
    })
    keyboardBindings.append(label, button)
  }

  pointerBindings.replaceChildren()
  for (const buttonName of ["primary", "middle", "secondary"] as const) {
    const label = document.createElement("label")
    label.textContent = `${buttonName[0].toUpperCase()}${buttonName.slice(1)} button`
    const select = document.createElement("select")
    select.setAttribute("aria-label", `${label.textContent} action`)
    for (const [value, text] of Object.entries(pointerActionLabels)) {
      const option = document.createElement("option")
      option.value = value
      option.textContent = text
      option.selected = inputSettings.pointer[buttonName] === value
      select.append(option)
    }
    select.addEventListener("change", () => {
      inputSettings.pointer[buttonName] = select.value as PointerAction
      persistInputSettings()
    })
    pointerBindings.append(label, select)
  }

  controllerBindings.replaceChildren()
  for (const action of controllerActions) {
    const label = document.createElement("label")
    label.textContent = ACTION_LABELS[action]
    const select = document.createElement("select")
    select.setAttribute("aria-label", `Controller ${ACTION_LABELS[action]}`)
    controllerButtonLabels.forEach((text, index) => {
      const option = document.createElement("option")
      option.value = String(index)
      option.textContent = `${index}: ${text}`
      option.selected = inputSettings.controller[action] === index
      select.append(option)
    })
    select.addEventListener("change", () => {
      inputSettings.controller[action] = Number(select.value)
      persistInputSettings()
    })
    controllerBindings.append(label, select)
  }
}

function openPanel(panel: HTMLElement, trigger?: HTMLElement): void {
  keys.clear()
  for (const candidate of panelElements) {
    if (candidate !== panel) candidate.classList.add("hidden")
    candidate.setAttribute("aria-hidden", String(candidate !== panel))
  }
  lastPanelTrigger = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  panel.classList.remove("hidden")
  queueMicrotask(() => panel.focus())
}

function closePanel(panel: HTMLElement): void {
  panel.classList.add("hidden")
  panel.setAttribute("aria-hidden", "true")
  if (panel === settingsPanel && capturingAction) {
    capturingAction = null
    renderBindingControls()
  }
  lastPanelTrigger?.focus()
}

function closeActivePanel(): boolean {
  const open = panelElements.find((panel) => !panel.classList.contains("hidden"))
  if (!open) return false
  closePanel(open)
  return true
}

function performMappedAction(action: GameAction | PointerAction): void {
  if (action === "move" || action.startsWith("move")) return
  if (action === "interact") handleInteraction()
  if (action === "fire") fireArrow()
  if (action === "signature") useSignature()
  if (action === "revive" && multiplayerActive) sendSupportAction("revive")
  if (action === "transferLoot" && multiplayerActive) sendSupportAction("transfer_loot")
  const pings: Partial<Record<GameAction, PingKind>> = {
    pingDanger: "danger",
    pingTarget: "target",
    pingRoute: "route",
    pingLoot: "loot",
    pingRegroup: "regroup",
  }
  const ping = pings[action as GameAction]
  if (ping && multiplayerActive) multiplayer.sendPing(ping)
}

function pollControllerActions(): void {
  const gamepad = navigator.getGamepads?.()[0]
  if (!gamepad) {
    previousGamepadButtons = []
    return
  }
  if (running && !isModalOpen() && !isMobileSpectator()) {
    for (const action of controllerActions) {
      const button = inputSettings.controller[action]
      if (gamepad.buttons[button]?.pressed && !previousGamepadButtons[button]) performMappedAction(action)
    }
  }
  previousGamepadButtons = gamepad.buttons.map((button) => button.pressed)
}

function missionPromptForPhase(phase: MissionSnapshot["phase"]): string {
  const key = inputSettings.keyboard
  if (latestMissionSnapshot?.missionKind === "prison-wagon") {
    const prompts: Record<MissionSnapshot["phase"], string> = {
      scout: `Choose the fallen oak or ford intercept · ${keyLabel(key.pingRoute)} signals a route`,
      ambush: `${keyLabel(key.fire)} or ${keyLabel(key.signature)} stops the escort`,
      robbery: `Press ${keyLabel(key.interact)} beside the cage to work the lock`,
      pursuit: `Lead the captives to either refuge · ${keyLabel(key.pingRegroup)} calls the band`,
      escape: `Stay with the captives and press ${keyLabel(key.interact)} at extraction`,
      extraction: "Every villager is accounted for · choose Sherwood's next work",
    }
    return prompts[phase]
  }
  const prompts: Record<MissionSnapshot["phase"], string> = {
    scout: `Reach the forest edge or river crossing · ${keyLabel(key.pingRoute)} signals a route`,
    ambush: `${keyLabel(key.fire)} or ${keyLabel(key.signature)} stuns escorts · ${keyLabel(key.pingDanger)} warns the band`,
    robbery: `Press ${keyLabel(key.interact)} beside the tax cart`,
    pursuit: `Carry coin to the forest north or river east · ${keyLabel(key.pingLoot)} marks loot`,
    escape: `Reach the village fire · ${keyLabel(key.revive)} rescues · ${keyLabel(key.transferLoot)} shares coin`,
    extraction: `Press ${keyLabel(key.interact)} at the village fire`,
  }
  return prompts[phase]
}

function updateMissionDebug(): void {
  const mission = latestMissionSnapshot
  const definition = getMissionDefinition(currentMissionSlug)
  missionTitle.textContent = definition.name.toUpperCase()
  const objective = definition.objectives.find((candidate) => candidate.phase === (mission?.phase ?? currentMissionPhase))
  missionDebug.textContent = [
    `MISSION  ${definition.id}`,
    `VERSION  ${definition.missionVersion}`,
    `HASH     ${definition.contentHash}`,
    `STATUS   ${missionPackageStatus}`,
    `SERVER   ${mission ? `${mission.missionId} · ${mission.missionVersion} · ${mission.contentHash}` : "waiting for authoritative snapshot"}`,
    `PHASE    ${mission?.phase ?? "local preview"}`,
    `OBJECTIVE ${objective?.id ?? "none"}`,
    `TRIGGER  ${objective?.trigger ?? "none"}`,
    `ROUTES   entry=${mission?.entryRoute ?? "unset"} escape=${mission?.escapeRoute ?? "unset"}`,
    `MODIFIERS ${(mission?.modifiers ?? []).map((modifier) => modifier.id).join(", ") || "pending"}`,
    `TRAPS    ${mission?.traps.length ?? 0} · SIGNAL ${mission?.signalSabotaged ? "cut" : "active"}`,
    `RESCUE   ${mission?.captives.filter((captive) => captive.rewarded).length ?? 0}/${mission?.captives.length ?? 0} · LOCK ${mission?.lockProgress ?? 0}/${mission?.lockTarget ?? 0}`,
  ].join("\n")
}

function applyMissionSnapshot(mission: MissionSnapshot): void {
  latestMissionSnapshot = mission
  const definition = getMissionDefinition(currentMissionSlug)
  const packageMatches = mission.missionId === definition.id
    && mission.missionVersion === definition.missionVersion
    && mission.contentHash === definition.contentHash
  missionPackageStatus = packageMatches ? "client/server package match" : "ERROR: client/server package mismatch"
  if (!packageMatches) showToast("Mission package mismatch — reconnect after updating")
  state.heat = mission.heat
  state.cartCoin = mission.cartCoin
  state.delivered = mission.delivered
  state.won = mission.status === "succeeded"
  state.lost = mission.status === "failed"
  signalSabotaged = mission.signalSabotaged
  missionTarget = mission.target
  const objectives: Record<MissionSnapshot["phase"], string> = mission.missionKind === "prison-wagon" ? {
    scout: "Choose the fallen oak or ford interception",
    ambush: mission.wagonMoving ? "Stop the moving prison wagon" : "Scatter the escort guards",
    robbery: `Break the cage lock · ${mission.lockProgress}/${mission.lockTarget}`,
    pursuit: "Escort the freed captives toward either refuge",
    escape: `Protect and extract every captive · ${mission.captives.filter((captive) => captive.rewarded).length}/${mission.captives.length}`,
    extraction: "Every rescued villager is accounted for",
  } : {
    scout: `Scout the forest or river approach · shipment ${mission.cycle}`,
    ambush: "Stun the escort guards",
    robbery: "Rob the Sheriff's tax cart",
    pursuit: "Carry the coin to a forest or river escape",
    escape: "Break pursuit and reach the village fire",
    extraction: "Return the taxes to the people",
  }
  missionObjective = objectives[mission.phase]
  currentMissionPhase = mission.phase
  missionPrompt = missionPromptForPhase(mission.phase)
  const completedOptional = mission.optionalObjectives.filter((objective) => objective.completed).length
  const sabotageState = mission.signalSabotaged ? ` · SIGNAL CUT ${Math.ceil(mission.reinforcementDelaySeconds)}s` : ""
  missionModifiers.textContent = `${mission.modifiers.map((modifier) => modifier.label).join(" · ")} · ${mission.sheriffPlan.toUpperCase()} PLAN${sabotageState} · OPTIONAL ${completedOptional}/${mission.optionalObjectives.length}`
  if (mission.phase === "robbery") localStorage.setItem("sherwood:tutorial-complete", "true")
  while (guardViews.length < mission.guards.length) {
    const guardState = mission.guards[guardViews.length]
    state.guards.push({
      id: guardState.id,
      position: { ...guardState.position },
      home: { ...guardState.position },
      patrolAngle: 0,
      stunnedFor: guardState.stunnedFor,
    })
    const guardView = createCharacter("guard")
    guardViews.push(guardView)
    scene.add(guardView)
  }
  for (const guard of mission.guards) {
    const local = state.guards[guard.id]
    if (!local) continue
    local.position = { ...guard.position }
    local.stunnedFor = guard.stunnedFor
  }
  if (mission.latestEvent && mission.latestEvent.sequence > lastMissionEventSequence) {
    lastMissionEventSequence = mission.latestEvent.sequence
    showMissionEvent(mission.latestEvent)
  }
  syncPingViews(mission.pings)
  syncTrapViews(mission.traps)
  syncCaptiveViews(mission.captives)
  cartView.position.set(mission.cartPosition.x, 0, mission.cartPosition.z)
  signalView.position.set(definition.spawns.reinforcementSignal.x, 0, definition.spawns.reinforcementSignal.z)
  cartView.children.forEach((child) => {
    if (child.userData.prison) child.visible = mission.missionKind === "prison-wagon"
  })
  signalView.rotation.z = mission.signalSabotaged ? Math.PI / 2.8 : 0
  signalView.traverse((child) => {
    if (child instanceof THREE.Mesh && child.userData.signalFlag) (child.material as THREE.MeshStandardMaterial).color.setHex(mission.signalSabotaged ? 0x5f5b45 : 0xa94132)
  })
  applyVillageState(mission.village)
  renderMissionResolution(mission)
  updateMissionDebug()
}

function showMissionEvent(event: MissionEvent): void {
  const messages: Partial<Record<MissionEvent["type"], string>> = {
    cart_robbed: "THE TAX CART IS OURS — RUN!",
    loot_delivered: "COIN RETURNED TO THE PEOPLE",
    wagon_intercepted: "THE PRISON WAGON IS STOPPED",
    lock_breached: "THE CAGE LOCK IS GIVING WAY",
    captives_freed: "THE CAPTIVES ARE FREE — PROTECT THEM",
    captive_extracted: "A VILLAGER REACHED SAFETY",
    reinforcement_arrived: "SHERIFF'S RELIEF PATROL ARRIVED",
    guard_stunned: "Guard stunned",
    crowd_controlled: "OAK SWEEP — ESCORT SCATTERED",
    ally_protected: "VANGUARD PROTECTION",
    heavy_carry: "HEAVY CARRY SECURED",
    trap_placed: "ROAD SNARE SET",
    trap_triggered: "SNARE CAUGHT AN ESCORT",
    reinforcement_sabotaged: "SHERIFF'S SIGNAL CUT",
    player_hit: "The Sheriff strikes!",
    player_downed: "AN OUTLAW IS DOWN",
    player_revived: "OUTLAW RESCUED",
    player_captured: "AN OUTLAW WAS CAPTURED",
    loot_transferred: "COIN HANDED OFF",
    ping_sent: "SIGNAL PLACED",
    route_selected: "ROUTE CHOSEN",
    phase_changed: "THE HEIST ADVANCES",
    signature_used: "SIGNATURE UNLEASHED",
    mission_succeeded: "SHERWOOD RISES",
    mission_failed: "THE BAND HAS FALLEN",
  }
  if (event.type === "signature_used" && event.detail === "little-john-sweep") showVanguardImpact(event.playerId)
  const message = event.type === "signature_used" && event.detail === "little-john-sweep"
    ? "OAK SWEEP — HOLD THE LINE"
    : event.type === "signature_used" && event.detail === "much-snare"
      ? "ROAD SNARE SET — DRAW THEM IN"
    : messages[event.type]
  if (message) showToast(message)
}

function syncPingViews(pings: WorldPing[]): void {
  const visiblePings = pings.filter((ping) => !mutedPlayerIds.has(ping.playerId))
  const activeIds = new Set(visiblePings.map((ping) => ping.id))
  for (const ping of visiblePings) {
    let view = pingViews.get(ping.id)
    if (!view) {
      view = createPingView(ping)
      pingViews.set(ping.id, view)
      scene.add(view)
    }
    view.position.set(ping.position.x, 0.08, ping.position.z)
  }
  for (const [id, view] of pingViews) {
    if (activeIds.has(id)) continue
    scene.remove(view)
    pingViews.delete(id)
  }
}

function createTrapView(trap: MissionTrap): THREE.Group {
  const group = new THREE.Group()
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.68, 0.92, 24),
    new THREE.MeshBasicMaterial({ color: 0xe7bd5a, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.05
  for (const rotation of [-0.7, 0.7]) {
    const bar = mesh(new THREE.BoxGeometry(1.55, 0.14, 0.14), 0x553923)
    bar.position.y = 0.11
    bar.rotation.y = rotation
    group.add(bar)
  }
  const marker = mesh(new THREE.ConeGeometry(0.16, 0.62, 5), 0xe7bd5a)
  marker.position.set(0, 0.78, 0)
  for (const x of [-0.72, 0.72]) {
    const stake = mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.85, 6), 0xe7bd5a)
    stake.position.set(x, 0.43, 0)
    group.add(stake)
  }
  group.add(ring, marker)
  group.position.set(trap.position.x, 0, trap.position.z)
  return group
}

function syncTrapViews(traps: MissionTrap[]): void {
  const activeIds = new Set(traps.map((trap) => trap.id))
  for (const trap of traps) {
    if (trapViews.has(trap.id)) continue
    const view = createTrapView(trap)
    trapViews.set(trap.id, view)
    scene.add(view)
  }
  for (const [id, view] of trapViews) {
    if (activeIds.has(id)) continue
    scene.remove(view)
    trapViews.delete(id)
  }
}

function createCaptiveView(captive: MissionCaptive): THREE.Group {
  const group = new THREE.Group()
  const body = mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.9, 7), captive.id % 2 === 0 ? 0x7f6846 : 0x6e7950)
  body.position.y = 0.62
  const head = mesh(new THREE.SphereGeometry(0.22, 8, 6), 0xd4aa78)
  head.position.y = 1.25
  const hood = mesh(new THREE.ConeGeometry(0.3, 0.42, 7), captive.id % 2 === 0 ? 0x75503a : 0x4e6140)
  hood.position.y = 1.48
  group.add(body, head, hood)
  return group
}

function syncCaptiveViews(captives: MissionCaptive[]): void {
  const activeIds = new Set(captives.filter((captive) => captive.status !== "extracted").map((captive) => captive.id))
  for (const captive of captives) {
    if (captive.status === "extracted") continue
    let view = captiveViews.get(captive.id)
    if (!view) {
      view = createCaptiveView(captive)
      captiveViews.set(captive.id, view)
      scene.add(view)
    }
    view.position.set(captive.position.x, captive.status === "locked" ? 1.03 : 0, captive.position.z)
    view.scale.setScalar(captive.status === "locked" ? 0.72 : 1)
  }
  for (const [id, view] of captiveViews) {
    if (activeIds.has(id)) continue
    scene.remove(view)
    captiveViews.delete(id)
  }
}

function renderSafetyPanel(players: RoomPlayer[]): void {
  safetyPartyList.replaceChildren()
  for (const player of players) {
    if (player.id === multiplayer.playerId) continue
    const item = document.createElement("li")
    const identity = document.createElement("span")
    identity.textContent = `${player.displayName} · ${characterName(player.characterId)}`
    const actions = document.createElement("div")
    actions.className = "safety-actions"
    const mute = document.createElement("button")
    mute.textContent = mutedPlayerIds.has(player.id) ? "UNMUTE" : "MUTE"
    mute.addEventListener("click", () => {
      if (mutedPlayerIds.has(player.id)) mutedPlayerIds.delete(player.id)
      else mutedPlayerIds.add(player.id)
      renderSafetyPanel(currentRoomPlayers)
    })
    const report = document.createElement("button")
    report.textContent = "REPORT GRIEFING"
    report.addEventListener("click", () => {
      multiplayer.moderate("report", player.id, "griefing")
      showToast("Report sent to the room audit")
    })
    const remove = document.createElement("button")
    remove.textContent = "REMOVE"
    remove.addEventListener("click", () => multiplayer.moderate("remove", player.id))
    const block = document.createElement("button")
    block.textContent = "BLOCK"
    block.addEventListener("click", () => multiplayer.moderate("block", player.id))
    actions.append(mute, report, remove, block)
    item.append(identity, actions)
    safetyPartyList.append(item)
  }
}

function createPingView(ping: WorldPing): THREE.Group {
  const colors: Record<PingKind, number> = {
    danger: 0xc9513f,
    target: 0xe4b653,
    route: 0x70a6c9,
    loot: 0xe2af43,
    regroup: 0x86b36b,
  }
  const symbols: Record<PingKind, string> = { danger: "!", target: "◎", route: "➜", loot: "$", regroup: "✦" }
  const group = new THREE.Group()
  group.userData.createdAt = clock.elapsedTime
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.52, 0.68, 28),
    new THREE.MeshBasicMaterial({ color: colors[ping.kind], transparent: true, opacity: 0.88, side: THREE.DoubleSide }),
  )
  ring.rotation.x = -Math.PI / 2
  const canvas = document.createElement("canvas")
  canvas.width = 64
  canvas.height = 64
  const context = canvas.getContext("2d")!
  context.fillStyle = "rgba(16,37,29,.9)"
  context.beginPath()
  context.arc(32, 32, 27, 0, Math.PI * 2)
  context.fill()
  context.strokeStyle = `#${colors[ping.kind].toString(16).padStart(6, "0")}`
  context.lineWidth = 4
  context.stroke()
  context.fillStyle = "#f7f0d4"
  context.font = "bold 34px sans-serif"
  context.textAlign = "center"
  context.textBaseline = "middle"
  context.fillText(symbols[ping.kind], 32, 33)
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false }))
  sprite.position.y = 1.6
  sprite.scale.setScalar(0.85)
  group.add(ring, sprite)
  return group
}

function renderMissionResolution(mission: MissionSnapshot): void {
  if (!mission.result) return
  if (resultsPanel.classList.contains("hidden")) openPanel(resultsPanel)
  resultGrade.textContent = mission.result.grade
  resultScore.textContent = mission.result.score.toLocaleString()
  resultBreakdown.replaceChildren()
  for (const [label, value] of Object.entries(mission.result.breakdown)) {
    const term = document.createElement("dt")
    const detail = document.createElement("dd")
    term.textContent = label
    detail.textContent = `${value}/100`
    resultBreakdown.append(term, detail)
  }
  const localPlayer = currentRoomPlayers.find((player) => player.id === multiplayer.playerId)
  if (localPlayer?.characterId === "little-john") {
    const term = document.createElement("dt")
    const detail = document.createElement("dd")
    term.textContent = "Vanguard impact"
    detail.textContent = `${localPlayer.protectionScore} protection · ${localPlayer.crowdControl} controlled · ${localPlayer.heavyCarryPeak} max carry`
    resultBreakdown.append(term, detail)
  }
  if (localPlayer?.characterId === "much") {
    const term = document.createElement("dt")
    const detail = document.createElement("dd")
    term.textContent = "Saboteur impact"
    detail.textContent = `${localPlayer.trapHits} traps triggered · ${localPlayer.sabotageCount} signals cut`
    resultBreakdown.append(term, detail)
  }
  const voteChoices = resultsPanel.querySelector<HTMLElement>(".vote-choices")!
  const voteEyebrow = voteChoices.previousElementSibling as HTMLElement
  if (!mission.vote) {
    voteChoices.style.display = "none"
    voteEyebrow.style.display = "none"
    const rescued = mission.captives.filter((captive) => captive.rewarded).length
    communityAllocation.textContent = mission.missionKind === "prison-wagon"
      ? `Partial rescue: ${rescued}/${mission.captives.length} villagers reached safety. No captive can be rewarded twice.`
      : "The band was defeated before community rewards settled."
    voteState.textContent = `MISSION FAILED · ${(mission.failureReason ?? "unknown").replaceAll("-", " ").toUpperCase()}`
    const isLeader = currentRoomPlayers[0]?.id === multiplayer.playerId
    returnHubButton.disabled = !isLeader
    returnHubButton.textContent = isLeader ? "RETURN BAND TO CAMPFIRE" : "WAITING FOR BAND LEADER"
    return
  }
  voteChoices.style.display = "grid"
  voteEyebrow.style.display = ""
  communityAllocation.textContent = `${mission.result.communityCoin} crown coin is locked for the winning village project. Personal renown cannot reduce it.`
  for (const button of voteButtons) {
    const choice = button.dataset.vote as VoteChoice
    const count = button.querySelector("b")!
    count.textContent = String(mission.vote.counts[choice])
    button.classList.toggle("selected", mission.vote.votes[multiplayer.playerId ?? ""] === choice)
    button.disabled = mission.vote.resolved
  }
  voteState.textContent = mission.vote.resolved
    ? `${mission.vote.winner?.toUpperCase()} WINS · ${mission.vote.allocatedCoin} COIN ALLOCATED`
    : "The band decides together. Ties resolve deterministically."
  const isLeader = currentRoomPlayers[0]?.id === multiplayer.playerId
  returnHubButton.disabled = !mission.vote.resolved || !isLeader
  returnHubButton.textContent = isLeader ? "RETURN BAND TO CAMPFIRE" : "WAITING FOR BAND LEADER"
}

function applyVillageState(village: VillageState): void {
  for (const choice of ["granary", "infirmary", "watchtower"] as VoteChoice[]) {
    if (village[choice] <= 0 || villageUpgradeViews.has(choice)) continue
    const view = new THREE.Group()
    if (choice === "granary") {
      for (let index = 0; index < 4; index += 1) {
        const crate = mesh(new THREE.BoxGeometry(0.65, 0.55, 0.65), 0xa87a43)
        crate.position.set((index % 2) * 0.75, 0.28, Math.floor(index / 2) * 0.75)
        view.add(crate)
      }
      view.position.set(VILLAGE_POSITION.x + 2.4, 0, VILLAGE_POSITION.z)
    } else if (choice === "infirmary") {
      const tent = mesh(new THREE.ConeGeometry(1.35, 2.1, 4), 0xd8d0ad)
      tent.position.y = 1.05
      tent.rotation.y = Math.PI / 4
      const cross = mesh(new THREE.BoxGeometry(0.5, 0.12, 0.08), 0xa94132)
      cross.position.set(0, 1.2, 1.04)
      view.add(tent, cross)
      view.position.set(VILLAGE_POSITION.x - 2.7, 0, VILLAGE_POSITION.z + 0.5)
    } else {
      const tower = mesh(new THREE.CylinderGeometry(0.65, 0.9, 4.2, 6), 0x715239)
      tower.position.y = 2.1
      const roof = mesh(new THREE.ConeGeometry(1.1, 1.2, 6), 0x405538)
      roof.position.y = 4.55
      view.add(tower, roof)
      view.position.set(VILLAGE_POSITION.x, 0, VILLAGE_POSITION.z - 3)
    }
    villageUpgradeViews.set(choice, view)
    scene.add(view)
  }
}

function renderParty(players: RoomPlayer[]): void {
  partyList.replaceChildren()
  missionPartyList.replaceChildren()
  for (const player of players) {
    const item = document.createElement("li")
    item.classList.toggle("ready", player.ready)
    item.textContent = `${player.ready ? "✓" : "○"} ${player.displayName} · ${characterName(player.characterId)}${player.connected ? "" : " · reconnecting"}`
    partyList.append(item)

    const compact = document.createElement("li")
    compact.classList.toggle("local", player.id === multiplayer.playerId)
    compact.classList.toggle("disconnected", !player.connected)
    const presence = document.createElement("i")
    presence.className = "presence"
    presence.textContent = player.connected ? "●" : "×"
    presence.setAttribute("aria-label", player.connected ? "Connected" : "Reconnecting")
    const identity = document.createElement("span")
    identity.className = "identity"
    identity.textContent = `${player.displayName} · ${characterName(player.characterId)}`
    const vitality = document.createElement("b")
    vitality.className = "vitality"
    vitality.textContent = player.downedFor > 0
      ? `DOWN ${Math.ceil(player.downedFor)}s`
      : `${"♥".repeat(Math.max(0, player.health))}${player.characterId === "little-john" ? ` · 🛡${player.protectionScore} ⚒${player.crowdControl}` : player.characterId === "much" ? ` · ⛓${player.trapHits} ✂${player.sabotageCount}` : ""}`
    compact.append(presence, identity, vitality)
    missionPartyList.append(compact)
  }
  lobbyStatus.textContent = players.length < 2 ? "Waiting for another outlaw…" : "Ready together to begin."
}

function ensureRemotePlayers(players: RoomPlayer[]): void {
  const activeIds = new Set(players.filter((player) => player.id !== multiplayer.playerId).map((player) => player.id))
  for (const player of players) {
    if (player.id === multiplayer.playerId || remoteViews.has(player.id)) continue
    const view = new THREE.Group()
    const fallback = createCharacter(player.characterId)
    view.add(fallback)
    view.position.set(player.position.x, 0, player.position.z)
    scene.add(view)
    const remote: RemoteView = {
      view,
      fallback,
      authored: null,
      snapshots: new SnapshotBuffer(),
      mixer: null,
      actions: new Map(),
      motion: "",
      lastPosition: view.position.clone(),
      characterId: player.characterId,
      downedFor: player.downedFor,
    }
    remote.snapshots.push(player.position, performance.now())
    remoteViews.set(player.id, remote)
    if (player.characterId === "robin") {
      void loadRobinRanger().then((asset) => {
        if (remoteViews.get(player.id) !== remote) return
        const ranger = prepareRangerInstance(asset.scene)
        view.add(ranger)
        remote.authored = ranger
        remote.fallback.visible = false
        remote.mixer = new THREE.AnimationMixer(ranger)
        remote.actions = new Map(asset.animations.map((clip) => [clip.name, remote.mixer!.clipAction(clip)]))
        remote.motion = "Robin_Idle"
        remote.actions.get("Robin_Idle")?.play()
      }).catch(() => undefined)
    }
  }
  for (const [id, remote] of remoteViews) {
    if (activeIds.has(id)) continue
    scene.remove(remote.view)
    remoteViews.delete(id)
  }
}

function getMoveInput(): Vec2 {
  if (isMobileSpectator()) return { x: 0, z: 0 }
  let x = 0
  let z = 0
  if (keys.has(inputSettings.keyboard.moveLeft)) x -= 1
  if (keys.has(inputSettings.keyboard.moveRight)) x += 1
  if (keys.has(inputSettings.keyboard.moveUp)) z -= 1
  if (keys.has(inputSettings.keyboard.moveDown)) z += 1
  const gamepad = navigator.getGamepads?.()[0]
  if (gamepad) {
    const gamepadX = Math.abs(gamepad.axes[0] ?? 0) >= 0.18 ? gamepad.axes[0] : 0
    const gamepadZ = Math.abs(gamepad.axes[1] ?? 0) >= 0.18 ? gamepad.axes[1] : 0
    x += gamepadX
    z += gamepadZ
  }
  if (x !== 0 || z !== 0) {
    clickTarget = null
    destinationMarker.visible = false
    return { x, z }
  }
  if (clickTarget) {
    const dx = clickTarget.x - state.player.position.x
    const dz = clickTarget.z - state.player.position.z
    if (Math.hypot(dx, dz) < 0.35) {
      clickTarget = null
      destinationMarker.visible = false
      return { x: 0, z: 0 }
    }
    return { x: dx, z: dz }
  }
  return { x: 0, z: 0 }
}

function showToast(message: string): void {
  toastElement.textContent = message
  toastElement.classList.add("show")
  toastTimer = 2.4
}

function handleInteraction(): void {
  if (inHub) {
    hubPanel.classList.remove("hidden")
    hubReady.focus()
    showToast("MISSION BOARD OPEN")
    return
  }
  if (multiplayerActive) {
    multiplayer.sendAction("interact")
    return
  }
  const result = interact(state)
  const messages: Record<string, string> = {
    "robbed-cart": "120 CROWN COIN TAKEN — RUN!",
    "cart-empty": "The tax cart is empty",
    delivered: "COIN RETURNED TO THE PEOPLE",
    restocked: "Quiver restocked",
    "no-loot": "Bring stolen taxes back here",
    won: "SHERWOOD RISES",
  }
  if (messages[result]) showToast(messages[result])
}

function fireArrow(): void {
  if (inHub) {
    showToast("Weapons stay lowered at the campfire")
    return
  }
  if (multiplayerActive) {
    if (state.player.arrows <= 0) {
      showToast("Your quiver is empty")
      return
    }
    multiplayer.sendAction("shoot")
    robinShotUntil = clock.elapsedTime + 0.8
    setRobinRangerMotion("Robin_Shoot")
    return
  }
  const guardId = shoot(state)
  if (guardId === null) {
    showToast(state.player.arrows === 0 ? "Your quiver is empty" : "No guard in range")
    return
  }
  const start = new THREE.Vector3(state.player.position.x, 1.45, state.player.position.z)
  const target = new THREE.Vector3(state.guards[guardId].position.x, 1.3, state.guards[guardId].position.z)
  const geometry = new THREE.BufferGeometry().setFromPoints([start, target])
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffe3a0 }))
  scene.add(line)
  arrowEffects.push({ line, age: 0 })
  robinShotUntil = clock.elapsedTime + 0.8
  setRobinRangerMotion("Robin_Shoot")
  showToast("Guard stunned")
}

function showVanguardImpact(playerId?: string): void {
  const source = playerId && playerId !== multiplayer.playerId
    ? currentRoomPlayers.find((player) => player.id === playerId)?.position
    : state.player.position
  if (!source) return
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.8, 1.05, 36),
    new THREE.MeshBasicMaterial({ color: 0xf0c86a, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }),
  )
  ring.position.set(source.x, 0.12, source.z)
  ring.rotation.x = -Math.PI / 2
  scene.add(ring)
  vanguardEffects.push({ ring, age: 0 })
}

function useSignature(): void {
  if (inHub) {
    showToast("Save your signature for the heist")
    return
  }
  if (multiplayerActive) {
    multiplayer.sendAction("signature")
    return
  }
  const result = activateSignature(state)
  const messages: Record<string, string> = {
    "marian-veil": "MARIAN'S VEIL — PURSUIT BROKEN",
    "robin-volley": "TWIN SHOT — GUARDS PINNED",
    "little-john-sweep": "OAK SWEEP — HOLD THE LINE",
    "much-snare": "ROAD SNARE SET — DRAW THEM IN",
    "volley-missed": "No guards in Twin Shot range",
    "signature-unavailable": `Signature ready in ${Math.ceil(state.player.signatureCooldown)}s`,
  }
  if (result.event === "little-john-sweep") showVanguardImpact()
  if (result.event === "much-snare") {
    syncTrapViews(state.traps.map((trap) => ({ id: trap.id, ownerId: "local", position: trap.position, expiresAtTick: 0 })))
  }
  showToast(messages[result.event] ?? result.event)
}

function isModalOpen(): boolean {
  return panelElements.some((panel) => !panel.classList.contains("hidden"))
}

async function openLeaderboard(): Promise<void> {
  if (leaderboardPanel.classList.contains("hidden")) openPanel(leaderboardPanel, leaderboardButton)
  leaderboardState.textContent = "Loading the global board…"
  leaderboardList.replaceChildren()
  const kind = boardKind.value as LeaderboardKind
  const scope = boardScope.value
  const bandId = scope === "band" ? localStorage.getItem("sherwood:band-id") ?? undefined : undefined
  if (scope === "band" && !bandId) {
    leaderboardState.textContent = "Join or create a persistent Merry Band to use this filter"
    return
  }
  let friendIds: string[] | undefined
  if (scope === "friends") {
    try { friendIds = JSON.parse(localStorage.getItem("sherwood:friend-ids") ?? "[]") as string[] }
    catch { friendIds = [] }
  }
  const board = await loadLeaderboard({
    kind,
    seasonSlug: boardSeason.value,
    characterId: boardCharacter.value ? boardCharacter.value as CharacterId : undefined,
    partySize: boardParty.value ? Number(boardParty.value) : undefined,
    missionSlug: boardMission.value,
    bandId,
    playerIds: friendIds,
  })
  const titles: Record<LeaderboardKind, string> = {
    "master-outlaws": "Master Outlaws",
    "peoples-champions": "People's Champions",
    "clean-escapes": "Clean Escapes",
    rescuers: "Rescuers",
    "swift-arrows": "Swift Arrows",
  }
  leaderboardPanel.querySelector("h2")!.textContent = titles[kind]
  leaderboardState.textContent = board.global
    ? "Global alpha board · verified results rank first"
    : "Offline preview · connect the leaderboard database for global results"
  for (const entry of board.entries.slice(0, 10)) {
    const item = document.createElement("li")
    const identity = document.createElement("div")
    const name = document.createElement("b")
    const detail = document.createElement("span")
    const score = document.createElement("strong")
    name.textContent = `${entry.verified ? "◆ " : ""}${entry.playerName}`
    detail.textContent = `${characterName(entry.characterId)} · ${entry.grade} · ${entry.missionSeconds}s`
    score.textContent = kind === "peoples-champions"
      ? `${entry.generosity ?? 0}%`
      : kind === "clean-escapes"
        ? `${entry.missionSeconds}s`
        : kind === "rescuers"
          ? `${entry.rescues ?? 0} R`
          : kind === "swift-arrows"
            ? `${entry.precision ?? 0}%`
            : entry.score.toLocaleString()
    identity.append(name, detail)
    item.append(identity, score)
    leaderboardList.append(item)
  }
  if (!unsubscribeLeaderboard) {
    unsubscribeLeaderboard = subscribeToLeaderboard(() => {
      if (!leaderboardPanel.classList.contains("hidden")) void openLeaderboard()
    })
  }
}

function updateUI(): void {
  healthElement.textContent = String(state.player.health)
  arrowsElement.textContent = String(state.player.arrows)
  const rescueMission = latestMissionSnapshot?.missionKind === "prison-wagon"
  lootElement.textContent = String(rescueMission ? latestMissionSnapshot!.captives.filter((captive) => captive.rewarded).length : state.player.loot)
  lootElement.parentElement?.setAttribute("title", rescueMission ? "Captives extracted" : "Stolen coin")
  signatureElement.textContent = state.player.signatureCooldown > 0 ? `${Math.ceil(state.player.signatureCooldown)}s` : "READY"
  heatElement.style.width = `${state.heat}%`
  heatWrap.setAttribute("aria-valuenow", String(Math.max(0, Math.min(100, Math.round(state.heat)))))
  heatWrap.setAttribute("aria-valuetext", state.heat > 60 ? "High pursuit" : state.heat > 20 ? "Sheriff searching" : "Hidden")
  heatWrap.classList.toggle("visible", state.heat > 3)
  progressElement.style.width = `${Math.min(100, (state.delivered / missionTarget) * 100)}%`
  if (inHub) {
    objectiveElement.textContent = "Prepare at the campfire mission board"
    progressElement.style.width = "0%"
    promptElement.textContent = `${keyLabel(inputSettings.keyboard.interact)} opens the board · move with your mapped controls`
    return
  }
  const signalPosition = getMissionDefinition(currentMissionSlug).spawns.reinforcementSignal
  const atSignal = multiplayerActive && selectedCharacter === "much" && !signalSabotaged && Math.hypot(state.player.position.x - signalPosition.x, state.player.position.z - signalPosition.z) < 3.2
  promptElement.textContent = isMobileSpectator()
    ? "Spectating the Merry Band · disable spectator mode in accessibility settings to play"
    : atSignal
      ? `${keyLabel(inputSettings.keyboard.interact)}  CUT THE SHERIFF'S REINFORCEMENT SIGNAL`
    : localDownedFor > 0
    ? `DOWNED · ${Math.ceil(localDownedFor)}s for a teammate to revive you`
    : multiplayerActive
      ? missionPrompt
      : getContextPrompt(state)
  if (multiplayerActive) {
    objectiveElement.textContent = missionObjective
    return
  }
  if (state.player.loot > 0) objectiveElement.textContent = "Return the coin to the village"
  else if (state.heat > 10) objectiveElement.textContent = "Disappear into the deep woods"
  else objectiveElement.textContent = state.delivered > 0 ? "Strike the tax cart again" : "Find the Sheriff's tax cart"
}

function showEnding(won: boolean): void {
  if (ended) return
  ended = true
  const title = intro.querySelector("h1")!
  const copy = intro.querySelector("p")!
  const eyebrow = intro.querySelector<HTMLElement>(".eyebrow")!
  const small = intro.querySelector("small")!
  const mastery = calculateMastery(state)
  eyebrow.textContent = won ? "THE FIRST SPARK" : "CAPTURED BY THE SHERIFF"
  title.innerHTML = won ? "Sherwood<br /><em>rises.</em>" : "The rebellion<br /><em>needs another try.</em>"
  copy.textContent = won
    ? `${state.delivered} crown coin reached the people. Mastery grade ${mastery.grade} · ${mastery.score.toLocaleString()} points · ${Math.round(state.stats.elapsedSeconds)} seconds.`
    : `The guards caught ${characterName(state.player.characterId)}. Grade ${mastery.grade} · ${mastery.score.toLocaleString()} points. Change your route and time your signature.`
  startButton.innerHTML = "PLAY AGAIN <span>→</span>"
  small.textContent = "RESTART THE 3D PROTOTYPE"
  intro.classList.remove("closed")
  intro.querySelector<HTMLElement>(".character-select")!.style.display = "none"
  if (won && !resultSubmitted) {
    resultSubmitted = true
    const playerName = localStorage.getItem("sherwood-rebellion:player-name") ?? "Anonymous Outlaw"
    void submitLeaderboardEntry({
      playerName,
      characterId: state.player.characterId,
      result: mastery,
      missionSeconds: state.stats.elapsedSeconds,
      delivered: state.delivered,
    })
  }
  startButton.onclick = () => window.location.reload()
}

function syncViews(elapsed: number, dt: number): void {
  if (!multiplayerActive) {
    syncTrapViews(state.traps.map((trap) => ({ id: trap.id, ownerId: "local", position: trap.position, expiresAtTick: 0 })))
  }
  const player = state.player.position
  playerView.position.set(player.x, Math.sin(elapsed * 9) * 0.035 * renderProfile.motionScale, player.z)
  playerView.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material.transparent = state.player.veilFor > 0
      child.material.opacity = state.player.veilFor > 0 ? 0.48 : 1
    }
  })
  const dx = player.x - lastPlayerPosition.x
  const dz = player.z - lastPlayerPosition.z
  const playerMoving = Math.hypot(dx, dz) > 0.001
  if (playerMoving) playerView.rotation.y = Math.atan2(dx, dz)
  lastPlayerPosition = { ...player }
  if (robinRangerMixer) {
    const motion = elapsed < robinShotUntil ? "Robin_Shoot" : playerMoving ? "Robin_Walk" : "Robin_Idle"
    setRobinRangerMotion(motion)
    robinRangerMixer.update(dt)
  }

  state.guards.forEach((guard, index) => {
    const view = guardViews[index]
    view.position.set(guard.position.x, guard.stunnedFor > 0 ? 0.05 : Math.sin(elapsed * 7 + index) * 0.025 * renderProfile.motionScale, guard.position.z)
    if (state.heat > 8) view.rotation.y = Math.atan2(player.x - guard.position.x, player.z - guard.position.z)
    view.rotation.z = guard.stunnedFor > 0 ? Math.sin(elapsed * 14) * 0.1 : 0
  })

  const snapshotNow = performance.now()
  for (const remote of remoteViews.values()) {
    const sampled = remote.snapshots.sample(snapshotNow)
    if (sampled) remote.view.position.set(sampled.x, 0, sampled.z)
    const remoteDx = remote.view.position.x - remote.lastPosition.x
    const remoteDz = remote.view.position.z - remote.lastPosition.z
    const moving = Math.hypot(remoteDx, remoteDz) > 0.0001
    const cameraDistance = camera.position.distanceTo(remote.view.position)
    if (remote.authored) {
      remote.authored.visible = cameraDistance <= 24
      remote.fallback.visible = cameraDistance > 24 && cameraDistance <= 48
    } else {
      remote.fallback.visible = cameraDistance <= 48
    }
    if (moving) remote.view.rotation.y = Math.atan2(remoteDx, remoteDz)
    remote.view.rotation.z = remote.downedFor > 0 ? Math.PI / 2.7 : 0
    remote.lastPosition.copy(remote.view.position)
    if (remote.mixer) {
      const motion = moving ? "Robin_Walk" : "Robin_Idle"
      if (motion !== remote.motion) {
        remote.actions.get(remote.motion)?.fadeOut(0.12)
        remote.actions.get(motion)?.reset().fadeIn(0.12).play()
        remote.motion = motion
      }
      remote.mixer.update(dt)
    }
  }

  for (const view of pingViews.values()) {
    const age = elapsed - Number(view.userData.createdAt ?? elapsed)
    const pulse = 1 + Math.sin(age * 6) * 0.08 * renderProfile.motionScale
    view.scale.setScalar(pulse)
    const sprite = view.children[1]
    if (sprite) sprite.position.y = 1.55 + Math.sin(age * 4) * 0.12 * renderProfile.motionScale
  }

  cartView.children.forEach((child) => {
    if (child.userData.coin) child.visible = state.cartCoin > 0
  })

  const desiredCamera = new THREE.Vector3(player.x + 12.5, 14.5, player.z + 15.5)
  camera.position.lerp(desiredCamera, 1 - Math.pow(0.001, dt))
  camera.lookAt(player.x, 0.75, player.z)

  for (let i = arrowEffects.length - 1; i >= 0; i -= 1) {
    arrowEffects[i].age += dt
    if (arrowEffects[i].age > 0.16) {
      scene.remove(arrowEffects[i].line)
      arrowEffects[i].line.geometry.dispose()
      ;(arrowEffects[i].line.material as THREE.Material).dispose()
      arrowEffects.splice(i, 1)
    }
  }
  for (let index = vanguardEffects.length - 1; index >= 0; index -= 1) {
    const effect = vanguardEffects[index]
    effect.age += dt
    const progress = Math.min(1, effect.age / 0.55)
    effect.ring.scale.setScalar(1 + progress * 5 * Math.max(0.25, renderProfile.motionScale))
    ;(effect.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - progress)
    if (progress >= 1) {
      scene.remove(effect.ring)
      effect.ring.geometry.dispose()
      ;(effect.ring.material as THREE.Material).dispose()
      vanguardEffects.splice(index, 1)
    }
  }
}

function animate(): void {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.05)
  const elapsed = clock.elapsedTime
  pollControllerActions()
  if (running && isModalOpen()) {
    syncViews(elapsed, dt)
    renderer.render(scene, camera)
    return
  }
  if (running) {
    const move = getMoveInput()
    let events: string[] = []
    if (inHub) {
      const length = Math.hypot(move.x, move.z)
      if (length > 0.001) {
        state.player.position.x = Math.max(-20, Math.min(20, state.player.position.x + (move.x / length) * 5.8 * dt))
        state.player.position.z = Math.max(-20, Math.min(20, state.player.position.z + (move.z / length) * 5.8 * dt))
      }
    } else if (multiplayerActive) {
      multiplayer.sendInput(move)
      predictMultiplayerMovement(move, dt)
      state.stats.elapsedSeconds += dt
    } else {
      events = updateSimulation(state, { move }, dt)
    }
    for (const event of events) {
      if (event === "player-hit") showToast("The Sheriff strikes!")
      if (event === "cart-ready") showToast("A new tax cart has entered Sherwood")
    }
    updateUI()
    if (toastTimer > 0) {
      toastTimer -= dt
      if (toastTimer <= 0) toastElement.classList.remove("show")
    }
    if ((state.won || state.lost) && !multiplayerActive) showEnding(state.won)
  }
  syncViews(elapsed, dt)
  renderer.render(scene, camera)
}

function predictMultiplayerMovement(move: Vec2, dt: number): void {
  const length = Math.hypot(move.x, move.z)
  if (length <= 0.001 || state.player.health <= 0 || localDownedFor > 0) return
  const speed = state.player.characterId === "marian" ? 6.75 : state.player.characterId === "little-john" ? 5.9 : 6.2
  const lootPenalty = state.player.characterId === "little-john"
    ? Math.max(0.82, 1 - state.player.loot / 1_100)
    : Math.max(0.68, 1 - state.player.loot / 600)
  state.player.position.x = Math.max(-22, Math.min(22, state.player.position.x + (move.x / length) * speed * lootPenalty * dt))
  state.player.position.z = Math.max(-22, Math.min(22, state.player.position.z + (move.z / length) * speed * lootPenalty * dt))
}

function nearbyTeammate(predicate: (player: RoomPlayer) => boolean): RoomPlayer | null {
  return currentRoomPlayers
    .filter((player) => player.id !== multiplayer.playerId && predicate(player))
    .map((player) => ({ player, distance: Math.hypot(player.position.x - state.player.position.x, player.position.z - state.player.position.z) }))
    .filter(({ distance }) => distance <= 2.8)
    .sort((a, b) => a.distance - b.distance)[0]?.player ?? null
}

function sendSupportAction(action: "revive" | "transfer_loot"): void {
  const target = nearbyTeammate((player) => action === "revive" ? player.downedFor > 0 : player.downedFor <= 0)
  if (!target) {
    showToast(action === "revive" ? "No downed outlaw nearby" : "No outlaw nearby")
    return
  }
  if (action === "transfer_loot" && state.player.loot <= 0) {
    showToast("You have no coin to hand off")
    return
  }
  multiplayer.sendAction(action, target.id)
}

startButton.addEventListener("click", () => {
  enterHub(false)
})

rejoinRoomButton.addEventListener("click", () => {
  const code = localStorage.getItem("sherwood:last-room-code")
  const displayName = playerNameInput.value.trim().slice(0, 20)
  if (!code || !displayName) return
  multiplayer.joinRoom(code, displayName, selectedCharacter)
})

createRoomButton.addEventListener("click", () => {
  const displayName = playerNameInput.value.trim().slice(0, 20)
  if (!displayName) {
    lobbyStatus.textContent = "Choose an outlaw name first"
    return
  }
  localStorage.setItem("sherwood-rebellion:player-name", displayName)
  multiplayer.createRoom(displayName, selectedCharacter)
})

joinRoomButton.addEventListener("click", () => {
  const displayName = playerNameInput.value.trim().slice(0, 20)
  const code = roomCodeInput.value.trim().toUpperCase()
  if (!displayName || code.length !== 6) {
    lobbyStatus.textContent = "Enter an outlaw name and six-character room code"
    roomLobby.classList.remove("hidden")
    return
  }
  localStorage.setItem("sherwood-rebellion:player-name", displayName)
  multiplayer.joinRoom(code, displayName, selectedCharacter)
})

readyButton.addEventListener("click", () => multiplayer.setReady(!localReady))
hubReady.addEventListener("click", () => {
  if (roomConnected) multiplayer.setReady(!localReady)
  else startSoloMission()
})
hubRoles.forEach((button) => button.addEventListener("click", () => {
  const characterId = button.dataset.hubCharacter
  if (characterId === "robin" || characterId === "marian" || characterId === "little-john" || characterId === "much") selectLocalCharacter(characterId, roomConnected)
  renderHub()
}))
hubLoadout.addEventListener("change", () => {
  if (roomConnected) multiplayer.selectLoadout(hubLoadout.value as LoadoutId)
})
hubCopyCode.addEventListener("click", () => {
  const code = multiplayer.roomCode
  if (!code) return
  const invite = `${location.origin}${location.pathname}?room=${code}`
  void navigator.clipboard.writeText(invite).then(() => showToast("INVITE LINK COPIED")).catch(() => showToast(`ROOM CODE ${code}`))
})
returnHubButton.addEventListener("click", () => multiplayer.returnToHub())

characterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (running) return
    const characterId = button.dataset.character
    if (characterId === "robin" || characterId === "marian" || characterId === "little-john" || characterId === "much") selectLocalCharacter(characterId, true)
  })
})

function selectLocalCharacter(characterId: CharacterId, notifyServer: boolean): void {
  if (selectedCharacter === characterId) return
  selectedCharacter = characterId
  characterButtons.forEach((option) => {
    const selected = option.dataset.character === characterId
    option.classList.toggle("selected", selected)
    option.setAttribute("aria-pressed", String(selected))
  })
  state = createInitialState(selectedCharacter)
  lastPlayerPosition = { ...state.player.position }
  scene.remove(playerView)
  robinRangerMixer = null
  robinRangerActions = new Map()
  robinRangerMotion = ""
  playerView = createCharacter(selectedCharacter)
  scene.add(playerView)
  if (selectedCharacter === "robin") attachRobinRanger(playerView)
  if (notifyServer && multiplayer.playerId) multiplayer.selectCharacter(selectedCharacter)
  updateUI()
}

helpButton.addEventListener("click", () => openPanel(helpPanel, helpButton))
closeHelp.addEventListener("click", () => closePanel(helpPanel))
missionDebugButton.addEventListener("click", () => {
  missionDebug.classList.toggle("hidden")
  updateMissionDebug()
})
leaderboardButton.addEventListener("click", () => void openLeaderboard())
closeLeaderboard.addEventListener("click", () => closePanel(leaderboardPanel))
for (const filter of [boardKind, boardCharacter, boardParty, boardScope, boardMission, boardSeason]) filter.addEventListener("change", () => void openLeaderboard())
closeResults.addEventListener("click", () => closePanel(resultsPanel))
voteButtons.forEach((button) => button.addEventListener("click", () => multiplayer.vote(button.dataset.vote as VoteChoice)))
safetyButton.addEventListener("click", () => openPanel(safetyPanel, safetyButton))
closeSafety.addEventListener("click", () => closePanel(safetyPanel))
settingsButton.addEventListener("click", () => {
  renderBindingControls()
  openPanel(settingsPanel, settingsButton)
})
closeSettings.addEventListener("click", () => closePanel(settingsPanel))

reducedMotionSetting.addEventListener("change", () => { inputSettings.reducedMotion = reducedMotionSetting.checked; persistInputSettings() })
highContrastSetting.addEventListener("change", () => { inputSettings.highContrast = highContrastSetting.checked; persistInputSettings() })
captionsSetting.addEventListener("change", () => { inputSettings.captions = captionsSetting.checked; persistInputSettings() })
readableTextSetting.addEventListener("change", () => { inputSettings.readableText = readableTextSetting.checked; persistInputSettings() })
mobileSpectatorSetting.addEventListener("change", () => { inputSettings.mobileSpectator = mobileSpectatorSetting.checked; persistInputSettings() })
resetSettings.addEventListener("click", () => {
  inputSettings = {
    ...DEFAULT_INPUT_SETTINGS,
    keyboard: { ...DEFAULT_INPUT_SETTINGS.keyboard },
    controller: { ...DEFAULT_INPUT_SETTINGS.controller },
    pointer: { ...DEFAULT_INPUT_SETTINGS.pointer },
  }
  capturingAction = null
  persistInputSettings("Default controls restored.")
  renderBindingControls()
})

window.addEventListener("keydown", (event) => {
  if (capturingAction) {
    event.preventDefault()
    if (event.code === "Escape") {
      capturingAction = null
      settingsStatus.textContent = "Remapping cancelled."
      renderBindingControls()
      return
    }
    if (["Tab", "MetaLeft", "MetaRight"].includes(event.code)) {
      settingsStatus.textContent = "Choose a non-system key."
      return
    }
    const previousCode = inputSettings.keyboard[capturingAction]
    const conflict = GAME_ACTIONS.find((action) => action !== capturingAction && inputSettings.keyboard[action] === event.code)
    if (conflict) inputSettings.keyboard[conflict] = previousCode
    inputSettings.keyboard[capturingAction] = event.code
    const label = ACTION_LABELS[capturingAction]
    capturingAction = null
    persistInputSettings(`${label} remapped to ${keyLabel(event.code)}.`)
    renderBindingControls()
    return
  }
  const activePanel = panelElements.find((panel) => !panel.classList.contains("hidden"))
  if (event.code === "Tab" && activePanel) {
    const focusable = [...activePanel.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex='-1'])")]
      .filter((element) => element.offsetParent !== null)
    if (focusable.length > 0) {
      event.preventDefault()
      const current = focusable.indexOf(document.activeElement as HTMLElement)
      const next = event.shiftKey
        ? (current <= 0 ? focusable.length - 1 : current - 1)
        : (current < 0 || current === focusable.length - 1 ? 0 : current + 1)
      focusable[next].focus()
    }
    return
  }
  if (event.code === "Escape") {
    event.preventDefault()
    if (!closeActivePanel() && running) openPanel(helpPanel, helpButton)
    return
  }
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return
  const action = GAME_ACTIONS.find((candidate) => inputSettings.keyboard[candidate] === event.code)
  if (action && running) event.preventDefault()
  if (!running || event.repeat) return
  if (isModalOpen()) return
  keys.add(event.code)
  if (action) performMappedAction(action)
})

window.addEventListener("keyup", (event) => keys.delete(event.code))

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (!running || isModalOpen() || isMobileSpectator()) return
  const buttonName = event.button === 1 ? "middle" : event.button === 2 ? "secondary" : "primary"
  const action = inputSettings.pointer[buttonName]
  if (action !== "move") {
    event.preventDefault()
    performMappedAction(action)
    return
  }
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  if (raycaster.ray.intersectPlane(groundPlane, clickPoint)) {
    clickTarget = { x: clickPoint.x, z: clickPoint.z }
    destinationMarker.position.set(clickPoint.x, 0.08, clickPoint.z)
    destinationMarker.visible = true
  }
})
renderer.domElement.addEventListener("contextmenu", (event) => {
  if (running) event.preventDefault()
})

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  applyInputSettings()
  updateUI()
})

window.addEventListener("blur", () => keys.clear())
window.addEventListener("beforeunload", () => unsubscribeLeaderboard?.())
renderer.domElement.addEventListener("webglcontextlost", (event) => {
  event.preventDefault()
  showToast("Graphics paused — restoring Sherwood")
})
renderer.domElement.addEventListener("webglcontextrestored", () => showToast("Sherwood restored"))

renderBindingControls()
applyInputSettings()
updateMissionDebug()
for (const panel of panelElements) panel.setAttribute("aria-hidden", String(panel.classList.contains("hidden")))
updateUI()
syncViews(0, 0.016)
animate()
