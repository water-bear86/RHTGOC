import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js"
import "./style.css"
import {
  activateSignature,
  calculateMastery,
  DELIVERY_TARGET,
  createInitialState,
  getContextPrompt,
  interact,
  shoot,
  updateSimulation,
  type CharacterId,
  type Vec2,
} from "./simulation"
import { loadLeaderboard, loadLeaderboardSeasons, submitLeaderboardEntry, subscribeToLeaderboard, type LeaderboardKind } from "./leaderboard"
import { MultiplayerClient } from "./multiplayer"
import { SnapshotBuffer } from "./snapshot-buffer"
import { chooseRenderProfile } from "./render-profile"
import {
  cloneObjectMaterialsForInstance,
  convertObjectToToon,
  createToonMaterial,
  disposeObjectInstanceMaterials,
  setMeshColor,
  setObjectOpacityFactor,
} from "./toon-materials"
import type { BandContribution, ContributionType, LastMissionResult, LoadoutId, MerryBandState, MissionAlarm, MissionCaptive, MissionEvent, MissionLootCache, MissionPreparation, MissionSnapshot, MissionTrap, PingKind, PublicHubPlayer, RescueOffer, RoomPlayer, VillageState, VoteChoice, WorldPing } from "../shared/protocol"
import { getMissionDefinition, MISSION_CATALOG, PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import type { SheriffRotation } from "../shared/sheriff-rotation"
import type { SherwoodSeasonSnapshot } from "../shared/sherwood-season"
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
import { blockSocialPlayer, loadSocialState, registerSocialProfile, removeFriend, respondDirectInvite, respondFriendRequest, sendDirectInvite, sendFriendRequest, sendMagicLink, signOutSocial, updateSocialPresence, type SocialState } from "./social"
import { createVillageCottage, createVillageWagonShell } from "./village-assets"
import { createAuthoredTreePlacements, TREE_VARIANT_NAMES } from "./tree-placements"
import {
  PUBLIC_HUB_WORLD_BOUNDS,
  resolveSherwoodCombinedMovement,
  resolveSherwoodPlayerMovement,
} from "../shared/world-collisions"
import { SHERWOOD_GUARD_SEPARATION, activeGuardPositions } from "../shared/guard-rules"
import { SHERWOOD_TREE_LAYOUT } from "../shared/world-layout"
import { createSherwoodWater } from "./water"
import { createArcheryEquipment } from "./archery-equipment"
import { createHeroCharacter, poseHeroCharacter, type HeroAction } from "./character-visuals"
import { cameraRelativeMove, rotateCameraOffset } from "./camera-controls"
import { syncGuardViewCount } from "./guard-view-pool"
import { sherwoodRegionCells, stableSeed, type RegionalMissionLayout } from "../shared/regional-layout"
import { buildRegionMapCells, regionMapCellClassName } from "./region-map"
import { createForestDressing } from "./forest-dressing"
import { createSherwoodLandmarks, type SherwoodLandmarks } from "./world-landmarks"
import { composeSherwoodWorld } from "../shared/world-composer"
import { createSherwoodTerrain, sherwoodHeightAt } from "./sherwood-terrain"
import { createProceduralRoads } from "./procedural-roads"
import { createSettlementWorld } from "./settlement-renderer"
import { animateObjectiveMarker, createObjectiveMarker, setObjectiveMarkerLabel } from "./objective-marker"
import { computeObjectivePointer } from "./objective-guidance"
import { missionObjectivePosition } from "../shared/mission-objective"
import { selectRegionalMissionLayout, synchronizeMissionGuards } from "./mission-snapshot-state"

const container = document.querySelector<HTMLDivElement>("#game")!
const intro = document.querySelector<HTMLDivElement>("#intro")!
const startButton = document.querySelector<HTMLButtonElement>("#start-button")!
const promptElement = document.querySelector<HTMLDivElement>("#prompt")!
const toastElement = document.querySelector<HTMLDivElement>("#toast")!
const objectivePointer = document.querySelector<HTMLElement>("#objective-pointer")!
const objectivePointerDistance = document.querySelector<HTMLElement>("#objective-pointer-distance")!
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
const characterButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-character]")]
const roleChoicePanel = document.querySelector<HTMLElement>("#role-choice-panel")!
const roleChoiceButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-room-character]")]
const roleChoiceStatus = document.querySelector<HTMLElement>("#role-choice-status")!
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
const regionMap = document.querySelector<HTMLElement>("#region-map")!
const regionMapGrid = document.querySelector<HTMLElement>("#region-map-grid")!
const regionMapCount = document.querySelector<HTMLElement>("#region-map-count")!
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
const socialButton = document.querySelector<HTMLButtonElement>("#social-button")!
const socialPanel = document.querySelector<HTMLElement>("#social-panel")!
const closeSocial = document.querySelector<HTMLButtonElement>("#close-social")!
const socialSignedOut = document.querySelector<HTMLElement>("#social-signed-out")!
const socialSignedIn = document.querySelector<HTMLElement>("#social-signed-in")!
const socialEmail = document.querySelector<HTMLInputElement>("#social-email")!
const socialSignIn = document.querySelector<HTMLButtonElement>("#social-sign-in")!
const socialSignOut = document.querySelector<HTMLButtonElement>("#social-sign-out")!
const socialFriendCode = document.querySelector<HTMLElement>("#social-friend-code")!
const socialPresence = document.querySelector<HTMLInputElement>("#social-presence")!
const socialFriendInput = document.querySelector<HTMLInputElement>("#social-friend-input")!
const socialAddFriend = document.querySelector<HTMLButtonElement>("#social-add-friend")!
const socialRequestList = document.querySelector<HTMLUListElement>("#social-request-list")!
const socialInviteList = document.querySelector<HTMLUListElement>("#social-invite-list")!
const socialFriendList = document.querySelector<HTMLUListElement>("#social-friend-list")!
const socialRecentList = document.querySelector<HTMLUListElement>("#social-recent-list")!
const socialStatus = document.querySelector<HTMLElement>("#social-status")!
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
const graphicsRestoreButton = document.querySelector<HTMLButtonElement>("#graphics-restore-button")!
const missionDebug = document.querySelector<HTMLPreElement>("#mission-debug")!
const rejoinRoomButton = document.querySelector<HTMLButtonElement>("#rejoin-room")!
const joinPublicHubButton = document.querySelector<HTMLButtonElement>("#join-public-hub")!
const hubPanel = document.querySelector<HTMLElement>("#hub-panel")!
const hubRoomCode = document.querySelector<HTMLElement>("#hub-room-code")!
const hubRecent = document.querySelector<HTMLElement>("#hub-recent")!
const hubBand = document.querySelector<HTMLElement>("#hub-band")!
const hubBandName = document.querySelector<HTMLElement>("#hub-band-name")!
const hubBandCamp = document.querySelector<HTMLElement>("#hub-band-camp")!
const hubBandHistory = document.querySelector<HTMLElement>("#hub-band-history")!
const hubBandControls = document.querySelector<HTMLElement>("#hub-band-controls")!
const hubBandNameInput = document.querySelector<HTMLInputElement>("#hub-band-name-input")!
const hubBandBanner = document.querySelector<HTMLSelectElement>("#hub-band-banner")!
const hubBandSave = document.querySelector<HTMLButtonElement>("#hub-band-save")!
const hubSeason = document.querySelector<HTMLElement>("#hub-season")!
const hubSeasonPhase = document.querySelector<HTMLElement>("#hub-season-phase")!
const hubSeasonName = document.querySelector<HTMLElement>("#hub-season-name")!
const hubSeasonCopy = document.querySelector<HTMLElement>("#hub-season-copy")!
const hubSeasonPressure = document.querySelector<HTMLElement>("#hub-season-pressure")!
const hubSeasonPressureFill = document.querySelector<HTMLElement>("#hub-season-pressure-fill")!
const hubSeasonProjects = document.querySelector<HTMLElement>("#hub-season-projects")!
const hubSeasonFinale = document.querySelector<HTMLElement>("#hub-season-finale")!
const hubRotations = document.querySelector<HTMLDivElement>("#hub-rotations")!
const hubRotationState = document.querySelector<HTMLElement>("#hub-rotation-state")!
const hubRescue = document.querySelector<HTMLElement>("#hub-rescue")!
const hubRescueCopy = document.querySelector<HTMLElement>("#hub-rescue-copy")!
const hubAcceptRescue = document.querySelector<HTMLButtonElement>("#hub-accept-rescue")!
const hubAbandonRescue = document.querySelector<HTMLButtonElement>("#hub-abandon-rescue")!
const contributionDepositButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-contribution-type]")]
const hubContributionList = document.querySelector<HTMLUListElement>("#hub-contribution-list")!
const hubContributionState = document.querySelector<HTMLElement>("#hub-contribution-state")!
const hubMissions = document.querySelector<HTMLDivElement>("#hub-missions")!
const hubRoles = [...document.querySelectorAll<HTMLButtonElement>("[data-hub-character]")]
const hubLoadout = document.querySelector<HTMLSelectElement>("#hub-loadout")!
const hubCopyCode = document.querySelector<HTMLButtonElement>("#hub-copy-code")!
const hubReady = document.querySelector<HTMLButtonElement>("#hub-ready")!
const hubState = document.querySelector<HTMLElement>("#hub-state")!
const returnHubButton = document.querySelector<HTMLButtonElement>("#return-hub")!
const publicHubPanel = document.querySelector<HTMLElement>("#public-hub-panel")!
const publicHubCount = document.querySelector<HTMLElement>("#public-hub-count")!
const publicHubTarget = document.querySelector<HTMLSelectElement>("#public-hub-target")!
const publicHubSize = document.querySelector<HTMLSelectElement>("#public-hub-size")!
const publicHubLooking = document.querySelector<HTMLButtonElement>("#public-hub-looking")!
const publicHubEmotes = [...document.querySelectorAll<HTMLButtonElement>("[data-hub-emote]")]
const publicHubPings = [...document.querySelectorAll<HTMLButtonElement>("[data-hub-ping]")]
const publicHubList = document.querySelector<HTMLUListElement>("#public-hub-list")!
const publicHubLeave = document.querySelector<HTMLButtonElement>("#public-hub-leave")!
const publicHubStatus = document.querySelector<HTMLElement>("#public-hub-status")!
playerNameInput.value = localStorage.getItem("sherwood-rebellion:player-name") ?? "Greenhood"
const invitedRoom = new URLSearchParams(location.search).get("room")?.trim().toUpperCase()
if (invitedRoom?.match(/^[A-Z2-9]{6}$/)) roomCodeInput.value = invitedRoom
const lastRoomCode = localStorage.getItem("sherwood:last-room-code")
if (lastRoomCode?.match(/^[A-Z2-9]{6}$/)) rejoinRoomButton.classList.remove("hidden")

let inputSettings: InputSettings = loadInputSettings(localStorage)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x91aa83)
scene.fog = new THREE.FogExp2(0x91aa83, 0.012)

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 280)
camera.position.set(6, 14, 20)
const BASE_CAMERA_OFFSET = Object.freeze({ x: 12.5, z: 15.5 })

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" })
const renderProfile = chooseRenderProfile({
  maxTextureSize: renderer.capabilities.maxTextureSize,
  maxTextures: renderer.capabilities.maxTextures,
  devicePixelRatio: window.devicePixelRatio,
  reducedMotion: inputSettings.reducedMotion || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
}, new URLSearchParams(location.search).get("render") === "degraded")
renderer.setPixelRatio(renderProfile.pixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = renderProfile.shadows
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.05
renderer.setClearColor(0x91aa83, 1)
container.appendChild(renderer.domElement)

let selectedCharacter: CharacterId = "robin"
let state = createInitialState(selectedCharacter)
let soloRunSequence = 0
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
let currentRotations: SheriffRotation[] = []
let upcomingRotations: SheriffRotation[] = []
let rotationsPaused = false
let selectedRotationId: string | null = null
let currentRescueOffer: RescueOffer | null = null
let currentSeason: SherwoodSeasonSnapshot | null = null
let currentContributions: BandContribution[] = []
let selectedContributionIds: string[] = []
let signalSabotaged = false
let latestMissionSnapshot: MissionSnapshot | null = null
let missionPackageStatus = "client package valid"
let capturingAction: GameAction | null = null
let previousGamepadButtons: boolean[] = []
let lastPanelTrigger: HTMLElement | null = null
let currentSocial: SocialState | null = null
let currentBand: MerryBandState | null = null
let lastPresenceSignature = ""
let inPublicHub = false
let publicHubParticipantId: string | null = null
let publicHubPlayers: PublicHubPlayer[] = []
let publicHubIsLooking = false
let localRoleConfirmed = false
let cameraQuarterTurns = 0

const guardViews: THREE.Group[] = []
const arrowEffects: { line: THREE.Line; age: number }[] = []
const vanguardEffects: { ring: THREE.Mesh; age: number }[] = []
interface RemoteView {
  view: THREE.Group
  fallback: THREE.Group
  snapshots: SnapshotBuffer
  lastPosition: THREE.Vector3
  characterId: CharacterId
  downedFor: number
  action: HeroAction
  actionUntil: number
}

const remoteViews = new Map<string, RemoteView>()
const pingViews = new Map<number, THREE.Group>()
const trapViews = new Map<number, THREE.Group>()
const captiveViews = new Map<number, THREE.Group>()
const alarmViews = new Map<string, THREE.Group>()
const lootCacheViews = new Map<string, THREE.Group>()
const preparationViews = new Map<string, THREE.Group>()
const villageUpgradeViews = new Map<VoteChoice, THREE.Group>()
interface AuthoredTreeInstance {
  batch: THREE.InstancedMesh
  instanceId: number
  visibleMatrix: THREE.Matrix4
  hiddenMatrix: THREE.Matrix4
  x: number
  z: number
  radius: number
  hidden: boolean
}

const authoredTreeInstances: AuthoredTreeInstance[] = []
const regionFogViews: THREE.Mesh[] = []
const medievalPropViews: THREE.Object3D[] = []
const cameraOccluders: Array<{ view: THREE.Group; radius: number; maxDistance?: number }> = []
const water = createSherwoodWater(7, 138)
const crossingInfrastructure = new THREE.Group()
const bowCacheInfrastructure = new THREE.Group()
const missionCampfireView = new THREE.Group()
let windmillRotor: THREE.Group | null = null
let landmarkViews: SherwoodLandmarks | null = null
let composedWorldView: THREE.Group | null = null
let composedWorldLayoutKey = ""
let terrainView: THREE.Mesh | null = null
const HUB_CAMPFIRE_POSITION = Object.freeze({ x: -11, z: 9 })
const mutedPlayerIds = new Set<string>()
const gltfLoader = new GLTFLoader()
let treeCatalogAssetPromise: Promise<THREE.Group> | null = null
let villageAssetPromise: Promise<THREE.Group> | null = null
let medievalPropsPromise: Promise<THREE.Group> | null = null
let treasureChestPromise: Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> | null = null
let bowCacheLoadGeneration = 0
const bowCacheAnimations: Array<{ view: THREE.Group; mixer: THREE.AnimationMixer; open: THREE.AnimationAction }> = []
let villageCottageFallback: THREE.Group | null = null
let villageCottageView: THREE.Group | null = null
let proceduralWagonShellView: THREE.Group | null = null
let villageWagonShellView: THREE.Group | null = null
let heroAttackUntil = 0
let heroSignatureUntil = 0

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

const characterNames: Record<CharacterId, string> = {
  robin: "Robin Hood",
  marian: "Maid Marian",
  "little-john": "Little John",
  much: "Much",
}

function characterName(characterId: CharacterId): string {
  return characterNames[characterId]
}

function material(color: number): THREE.MeshToonMaterial {
  return createToonMaterial({ color })
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
  const hemisphere = new THREE.HemisphereLight(0xe9efce, 0x243823, 1.35)
  scene.add(hemisphere)

  const sun = new THREE.DirectionalLight(0xffedc8, 2.8)
  sun.position.set(-18, 28, 14)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.camera.left = -75
  sun.shadow.camera.right = 75
  sun.shadow.camera.top = 75
  sun.shadow.camera.bottom = -75
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 150
  sun.shadow.bias = -0.0004
  sun.shadow.intensity = 0.3
  scene.add(sun)
}

function createFallbackTree(x: number, z: number, scale = 1): THREE.Group {
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
  cameraOccluders.push({ view: tree, radius: 1.2 * scale, maxDistance: 42 })
  return tree
}

function createHut(x: number, z: number, rotation = 0): THREE.Group {
  const hut = new THREE.Group()
  hut.position.set(x, sherwoodHeightAt(x, z), z)
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
  cameraOccluders.push({ view: hut, radius: 2.2 })
  return hut
}

function createWorld(): void {
  terrainView = createSherwoodTerrain()
  scene.add(terrainView)

  water.group.rotation.x = -Math.PI / 2
  water.group.rotation.z = -0.1
  water.group.position.set(1, 0.01, 0)
  scene.add(water.group)
  scene.add(crossingInfrastructure)
  scene.add(bowCacheInfrastructure)
  rebuildCrossingInfrastructure(state.layout)
  rebuildBowCaches(state.layout)

  createHut(-14, 11, 0.35)
  villageCottageFallback = createHut(-10, 14, -0.55)
  createHut(-15, 6, 1.1)
  const villageCircle = mesh(new THREE.TorusGeometry(2.35, 0.08, 6, 48), palette.gold, { cast: false })
  villageCircle.position.set(0, 0.06, 0)
  villageCircle.rotation.x = Math.PI / 2
  missionCampfireView.add(villageCircle)

  const fireLight = new THREE.PointLight(0xf39a43, 4, 14, 2)
  fireLight.position.set(0, 1.2, 0)
  missionCampfireView.add(fireLight)
  const fire = mesh(new THREE.ConeGeometry(0.35, 1, 6), 0xe88032)
  fire.position.set(0, 0.5, 0)
  missionCampfireView.add(fire)
  missionCampfireView.position.set(state.layout.campfirePosition.x, sherwoodHeightAt(state.layout.campfirePosition.x, state.layout.campfirePosition.z), state.layout.campfirePosition.z)
  scene.add(missionCampfireView)

  let seed = 7331
  const random = (): number => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  for (let i = 0; i < 18; i += 1) {
    const rock = mesh(new THREE.DodecahedronGeometry(0.25 + random() * 0.45, 0), 0x687060)
    rock.scale.y = 0.55
    const rockX = random() * 128 - 64
    const rockZ = random() * 128 - 64
    rock.position.set(rockX, sherwoodHeightAt(rockX, rockZ) + 0.2, rockZ)
    rock.rotation.set(random(), random(), random())
    scene.add(rock)
  }

  const exclusions = sherwoodRegionCells().map((cell) => ({ x: cell.center.x, z: cell.center.z, radius: 8.5 }))
  const dressing = createForestDressing({ degraded: renderProfile.tier === "degraded", exclusions })
  scene.add(dressing.group)

  rebuildLandmarks(state.layout)
  rebuildComposedWorld(state.layout)
}

function rebuildLandmarks(layout: RegionalMissionLayout): void {
  if (landmarkViews) scene.remove(landmarkViews.group)
  landmarkViews = createSherwoodLandmarks(layout)
  windmillRotor = landmarkViews.windmillRotor
  scene.add(landmarkViews.group)
}

function rebuildComposedWorld(layout: RegionalMissionLayout): void {
  const key = [layout.campfireCell.index, layout.objectiveCell.index, ...layout.crossingPositions.flatMap((point) => [point.x.toFixed(2), point.z.toFixed(2)])].join(":")
  if (key === composedWorldLayoutKey) return
  composedWorldLayoutKey = key
  if (composedWorldView) scene.remove(composedWorldView)
  const composed = composeSherwoodWorld(layout)
  composedWorldView = new THREE.Group()
  composedWorldView.name = "ComposedSherwoodWorld"
  composedWorldView.add(createProceduralRoads(composed.roads), createSettlementWorld(composed))
  scene.add(composedWorldView)
}

function addRoadSegment(start: { x: number; z: number }, end: { x: number; z: number }): void {
  const dx = end.x - start.x
  const dz = end.z - start.z
  const length = Math.hypot(dx, dz)
  if (length < 0.5) return
  const points = Array.from({ length: 7 }, (_, index) => {
    const t = index / 6
    return { x: start.x + dx * t, z: start.z + dz * t }
  })
  crossingInfrastructure.add(createProceduralRoads([{ id: `mission-approach-${start.x}-${start.z}`, width: 3.8, points }]))
}

function rebuildCrossingInfrastructure(layout: RegionalMissionLayout): void {
  crossingInfrastructure.clear()
  const riverNormal = { x: Math.cos(0.1), z: Math.sin(0.1) }
  for (const crossing of layout.crossingPositions) {
    const bridge = mesh(new THREE.BoxGeometry(8.4, 0.3, 3.2), 0x8b653d)
    bridge.position.set(crossing.x, 0.18, crossing.z)
    bridge.rotation.y = -0.1
    crossingInfrastructure.add(bridge)
    for (let index = -3; index <= 3; index += 1) {
      const plank = mesh(new THREE.BoxGeometry(0.12, 0.1, 3.45), 0x4b382a)
      plank.position.set(crossing.x + index, 0.38, crossing.z - index * 0.1)
      plank.rotation.y = -0.1
      crossingInfrastructure.add(plank)
    }
  }
  for (const origin of [layout.campfirePosition, layout.objectivePosition]) {
    const nearest = [...layout.crossingPositions].sort((left, right) => Math.hypot(origin.x - left.x, origin.z - left.z) - Math.hypot(origin.x - right.x, origin.z - right.z))[0]
    const side = origin.x + 0.1 * origin.z - 1 >= 0 ? 1 : -1
    const bankApproach = { x: nearest.x + riverNormal.x * side * 4.6, z: nearest.z + riverNormal.z * side * 4.6 }
    addRoadSegment(origin, bankApproach)
  }
}

function rebuildBowCaches(layout: RegionalMissionLayout): void {
  const generation = ++bowCacheLoadGeneration
  bowCacheInfrastructure.clear()
  bowCacheAnimations.length = 0
  for (const [index, position] of layout.bowCachePositions.entries()) {
    const cache = new THREE.Group()
    const crate = mesh(new THREE.BoxGeometry(1.4, 0.62, 0.85), 0x6d4b2c)
    crate.position.y = 0.32
    const band = mesh(new THREE.BoxGeometry(1.48, 0.1, 0.92), 0xd1a94b)
    band.position.y = 0.5
    const { bow } = createArcheryEquipment(index % 2 === 0 ? "longbow" : "shortbow", 0.72)
    bow.position.set(0, 0.9, 0)
    bow.rotation.set(Math.PI / 2, 0, Math.PI / 2)
    cache.add(crate, band, bow)
    cache.position.set(position.x, 0, position.z)
    cache.rotation.y = index * 1.3
    bowCacheInfrastructure.add(cache)
  }

  treasureChestPromise ??= gltfLoader.loadAsync("/assets/props/treasure-chest.glb")
    .then((asset) => ({ scene: convertObjectToToon(asset.scene), animations: asset.animations }))
  void treasureChestPromise.then((asset) => {
    if (generation !== bowCacheLoadGeneration) return
    bowCacheInfrastructure.clear()
    bowCacheAnimations.length = 0
    const openClip = asset.animations.find((clip) => clip.name.includes("burst_open"))
      ?? asset.animations.find((clip) => clip.name.includes("open_anim"))
    for (const [index, position] of layout.bowCachePositions.entries()) {
      const chest = cloneSkeleton(asset.scene) as THREE.Group
      cloneObjectMaterialsForInstance(chest)
      chest.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(chest)
      const largestDimension = Math.max(0.001, bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z)
      chest.scale.setScalar(1.65 / largestDimension)
      chest.updateMatrixWorld(true)
      const grounded = new THREE.Box3().setFromObject(chest)
      chest.position.set(position.x, -grounded.min.y, position.z)
      chest.rotation.y = index * 1.3
      chest.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        child.castShadow = true
        child.receiveShadow = true
      })
      bowCacheInfrastructure.add(chest)
      if (openClip) {
        const mixer = new THREE.AnimationMixer(chest)
        const open = mixer.clipAction(openClip)
        open.setLoop(THREE.LoopOnce, 1)
        open.clampWhenFinished = true
        bowCacheAnimations.push({ view: chest, mixer, open })
      }
    }
  }).catch(() => {
    // The procedural crate remains a playable fallback when the authored prop cannot load.
  })
}

function openNearbyBowCache(): void {
  const nearest = bowCacheAnimations
    .map((cache) => ({ cache, distance: Math.hypot(cache.view.position.x - state.player.position.x, cache.view.position.z - state.player.position.z) }))
    .sort((left, right) => left.distance - right.distance)[0]
  if (!nearest || nearest.distance >= 2.8) return
  nearest.cache.open.reset().play()
}

function createCharacter(role: CharacterId | "guard"): THREE.Group {
  if (role !== "guard") return createHeroCharacter(role)
  const character = new THREE.Group()
  character.name = "character.sheriff.guard"
  const tunic = mesh(new THREE.CylinderGeometry(0.38, 0.52, 1.35, 8), palette.red)
  tunic.position.y = 1.08
  const belt = mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.14, 8), 0x3e2a21)
  belt.position.y = 1.15
  const head = mesh(new THREE.SphereGeometry(0.32, 12, 8), 0xd9b187)
  head.position.y = 1.96
  const legLeft = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.72, 6), 0x493d2d)
  legLeft.position.set(-0.19, 0.38, 0)
  const legRight = legLeft.clone()
  legRight.position.x = 0.19
  const hat = mesh(new THREE.SphereGeometry(0.39, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), 0x777d78)
  hat.position.y = 2.23
  character.add(tunic, belt, head, legLeft, legRight, hat)
  const spear = mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.5, 5), 0x3c2c20)
  spear.position.set(0.48, 1.15, 0)
  const tip = mesh(new THREE.ConeGeometry(0.12, 0.4, 5), 0xaeb4ae)
  tip.position.set(0.48, 2.55, 0)
  character.add(spear, tip)
  return character
}

function loadTreeCatalog(): Promise<THREE.Group> {
  treeCatalogAssetPromise ??= gltfLoader.loadAsync("/assets/environment/sherwood-tree-catalog.glb")
    .then((asset) => convertObjectToToon(asset.scene))
  return treeCatalogAssetPromise
}

function loadVillageCatalog(): Promise<THREE.Group> {
  villageAssetPromise ??= gltfLoader.loadAsync("/assets/environment/sherwood-village-slice.glb")
    .then((asset) => convertObjectToToon(asset.scene))
  return villageAssetPromise
}

function loadMedievalProps(): Promise<THREE.Group> {
  medievalPropsPromise ??= gltfLoader.loadAsync("/assets/environment/craftpix-medieval-props.glb")
    .then((asset) => convertObjectToToon(asset.scene))
  return medievalPropsPromise
}

function attachMedievalProps(): void {
  const placements = [
    ["Prop_Well", -30, -31, 0.2], ["Prop_Signpost", -17, -39, -0.5],
    ["Prop_Haystack", 31, -31, 0.8], ["Prop_Barrel", 38, -28, -0.2],
    ["Prop_Chest", 31, 30, 1.1], ["Prop_Box", 35, 33, 0.3],
    ["Prop_Bench", -32, 31, -0.7], ["Prop_Bucket", -29, 34, 0.1],
    ["Prop_Firewood", -3, 48, 0.5], ["Prop_Pot", 5, -48, -0.3],
  ] as const
  void loadMedievalProps().then((catalog) => {
    for (const [name, x, z, rotation] of placements) {
      const source = catalog.getObjectByName(name)
      if (!source) continue
      const prop = source.clone(true)
      prop.position.set(x, 0, z)
      prop.rotation.y = rotation
      prop.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        child.castShadow = true
        child.receiveShadow = true
      })
      medievalPropViews.push(prop)
      scene.add(prop)
    }
  }).catch(() => showToast("Regional props could not be loaded; the mission remains playable"))
}

function prepareVillageRuntimeObject<T extends THREE.Object3D>(root: T): T {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.castShadow = true
    child.receiveShadow = true
    child.frustumCulled = true
  })
  return root
}

function attachVillageSlice(cart: THREE.Group): void {
  void loadVillageCatalog().then((source) => {
    const cottage = prepareVillageRuntimeObject(createVillageCottage(source))
    cottage.position.set(-10, 0, 14)
    cottage.rotation.y = -0.55
    cottage.visible = false
    villageCottageView = cottage
    cameraOccluders.push({ view: cottage, radius: 3.2 })
    scene.add(cottage)

    const wagonShell = prepareVillageRuntimeObject(createVillageWagonShell(source))
    wagonShell.visible = false
    villageWagonShellView = wagonShell
    cart.add(wagonShell)
  }).catch((error) => {
    console.error("Authored village kit failed to initialize", error)
    showToast("The authored village kit could not be loaded; procedural fallbacks remain active")
  })
}

function attachStylizedTrees(): void {
  const placements = createAuthoredTreePlacements(SHERWOOD_TREE_LAYOUT)
  void loadTreeCatalog().then((catalog) => {
    const batches: THREE.InstancedMesh[] = []
    const records: AuthoredTreeInstance[] = []
    catalog.updateMatrixWorld(true)

    for (const variantName of TREE_VARIANT_NAMES) {
      const source = catalog.getObjectByName(variantName)
      if (!source) throw new Error(`Tree catalog is missing ${variantName}`)
      const sourceMeshes: THREE.Mesh[] = []
      source.traverse((child) => {
        if (child instanceof THREE.Mesh) sourceMeshes.push(child)
      })
      if (sourceMeshes.length === 0) throw new Error(`Tree catalog variant has no mesh: ${variantName}`)
      const variantPlacements = placements.filter((placement) => placement.variantName === variantName)
      sourceMeshes.forEach((sourceMesh, partIndex) => {
        const batch = new THREE.InstancedMesh(sourceMesh.geometry, sourceMesh.material, variantPlacements.length)
        batch.name = `${variantName}_Part_${partIndex + 1}_Instances`
        batch.castShadow = renderProfile.tier !== "degraded"
        batch.receiveShadow = true
        batch.frustumCulled = true
        batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage)

        variantPlacements.forEach((placement, instanceId) => {
          const visibleMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(placement.x, sherwoodHeightAt(placement.x, placement.z), placement.z),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.rotation),
            new THREE.Vector3(placement.height, placement.height, placement.height),
          ).multiply(sourceMesh.matrixWorld)
          const hiddenMatrix = new THREE.Matrix4().compose(
            new THREE.Vector3(placement.x, sherwoodHeightAt(placement.x, placement.z) - 20, placement.z),
            new THREE.Quaternion(),
            new THREE.Vector3(0.001, 0.001, 0.001),
          )
          batch.setMatrixAt(instanceId, visibleMatrix)
          records.push({
            batch,
            instanceId,
            visibleMatrix,
            hiddenMatrix,
            x: placement.x,
            z: placement.z,
            radius: placement.visualRadius,
            hidden: false,
          })
        })

        batch.computeBoundingBox()
        batch.computeBoundingSphere()
        batch.instanceMatrix.needsUpdate = true
        batches.push(batch)
      })
    }

    authoredTreeInstances.push(...records)
    scene.add(...batches)
  }).catch((error) => {
    console.error("Stylized tree catalog failed to initialize", error)
    for (const tree of SHERWOOD_TREE_LAYOUT) createFallbackTree(tree.x, tree.z, tree.scale)
    showToast("Stylized trees could not be loaded; simple forest fallback enabled")
  })
}

function createCart(): THREE.Group {
  const cart = new THREE.Group()
  cart.position.set(state.layout.objectivePosition.x, sherwoodHeightAt(state.layout.objectivePosition.x, state.layout.objectivePosition.z), state.layout.objectivePosition.z)
  cart.rotation.y = -0.75
  const proceduralShell = new THREE.Group()
  proceduralShell.name = "ProceduralWagonFallback"
  proceduralShell.userData.proceduralWagonShell = true
  const bed = mesh(new THREE.BoxGeometry(2.8, 0.7, 1.65), 0x7a4e2d)
  bed.position.y = 1
  proceduralShell.add(bed)
  for (const x of [-1.05, 1.05]) {
    for (const z of [-0.9, 0.9]) {
      const wheel = mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.18, 12), 0x3b2a21)
      wheel.position.set(x, 0.55, z)
      wheel.rotation.x = Math.PI / 2
      proceduralShell.add(wheel)
    }
  }
  proceduralWagonShellView = proceduralShell
  cart.add(proceduralShell)
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
  signal.position.set(state.layout.reinforcementSignalPosition.x, sherwoodHeightAt(state.layout.reinforcementSignalPosition.x, state.layout.reinforcementSignalPosition.z), state.layout.reinforcementSignalPosition.z)
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
  board.position.set(HUB_CAMPFIRE_POSITION.x + 3.4, 0, HUB_CAMPFIRE_POSITION.z - 0.4)
  scene.add(board)
  return board
}

function createRoyalStorehouse(): THREE.Group {
  const storehouse = new THREE.Group()
  const floor = mesh(new THREE.BoxGeometry(7.2, 0.12, 6.2), 0x765d3b)
  floor.position.y = 0.06
  const wallSpecs = [
    { size: [7.2, 1.6, 0.22], position: [0, 0.8, -3.1] },
    { size: [2.25, 1.6, 0.22], position: [-2.48, 0.8, 3.1] },
    { size: [2.25, 1.6, 0.22], position: [2.48, 0.8, 3.1] },
    { size: [0.22, 1.6, 6.2], position: [-3.6, 0.8, 0] },
    { size: [0.22, 1.6, 4.1], position: [3.6, 0.8, 1.05] },
  ]
  for (const spec of wallSpecs) {
    const wall = mesh(new THREE.BoxGeometry(...spec.size as [number, number, number]), 0x8f7447)
    wall.position.set(...spec.position as [number, number, number])
    storehouse.add(wall)
  }
  for (const [x, z] of [[-3.45, -2.95], [3.45, -2.95], [-3.45, 2.95], [3.45, 2.95]] as const) {
    const post = mesh(new THREE.CylinderGeometry(0.11, 0.14, 2.7, 7), 0x4d382d)
    post.position.set(x, 1.35, z)
    storehouse.add(post)
  }
  const roofBeamA = mesh(new THREE.BoxGeometry(7.1, 0.16, 0.18), 0x4d382d)
  roofBeamA.position.set(0, 2.62, -2.95)
  const roofBeamB = roofBeamA.clone()
  roofBeamB.position.z = 2.95
  const gate = mesh(new THREE.BoxGeometry(1.9, 1.45, 0.16), 0x3e2d22)
  gate.position.set(0, 0.72, 3.12)
  gate.rotation.y = -0.62
  const canalDoor = mesh(new THREE.BoxGeometry(1.5, 1.45, 0.16), 0x3e2d22)
  canalDoor.position.set(3.62, 0.72, -1.9)
  canalDoor.rotation.y = Math.PI / 2 + 0.62
  const crest = mesh(new THREE.CircleGeometry(0.48, 18), palette.gold, { cast: false })
  crest.position.set(0, 1.75, 3.22)
  storehouse.add(floor, roofBeamA, roofBeamB, gate, canalDoor, crest)
  storehouse.position.set(7, 0, -7)
  storehouse.visible = false
  scene.add(storehouse)
  return storehouse
}

function createDisguiseRack(): THREE.Group {
  const rack = new THREE.Group()
  const beam = mesh(new THREE.BoxGeometry(1.7, 0.1, 0.12), 0x4f3522)
  beam.position.y = 1.75
  for (const x of [-0.72, 0.72]) {
    const post = mesh(new THREE.CylinderGeometry(0.055, 0.07, 1.8, 6), 0x4f3522)
    post.position.set(x, 0.9, 0)
    rack.add(post)
  }
  const cloak = mesh(new THREE.ConeGeometry(0.48, 1.35, 7, 1, true), 0x8c3430)
  cloak.position.set(0, 1.05, 0)
  rack.add(beam, cloak)
  rack.visible = false
  scene.add(rack)
  return rack
}

addLighting()
createWorld()
attachStylizedTrees()
attachMedievalProps()

let playerView = createCharacter(selectedCharacter)
scene.add(playerView)
state.guards.forEach(() => {
  const guard = createCharacter("guard")
  guardViews.push(guard)
  scene.add(guard)
})
const cartView = createCart()
attachVillageSlice(cartView)
const signalView = createSignalPost()
const missionBoardView = createMissionBoard()
const storehouseView = createRoyalStorehouse()
const disguiseRackView = createDisguiseRack()

const destinationMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.42, 0.56, 24),
  new THREE.MeshBasicMaterial({ color: palette.cream, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
)
destinationMarker.rotation.x = -Math.PI / 2
destinationMarker.position.y = 0.08
destinationMarker.visible = false
scene.add(destinationMarker)

const objectiveMarker = createObjectiveMarker()
const objectiveBeacon = objectiveMarker.group
objectiveBeacon.visible = false
scene.add(objectiveBeacon)

const multiplayer = new MultiplayerClient({
  onWelcome: (_playerId, roomCode) => {
    inPublicHub = false
    publicHubIsLooking = false
    publicHubPlayers = []
    publicHubParticipantId = null
    publicHubPanel.classList.add("hidden")
    roomConnected = true
    localStorage.setItem("sherwood:last-room-code", roomCode)
    lobbyCode.textContent = roomCode
    missionRoomCode.textContent = roomCode
    hubRoomCode.textContent = roomCode
    roomCodeInput.value = roomCode
    roomLobby.classList.remove("hidden")
    lobbyStatus.textContent = "Choose an outlaw, then ready up together."
    enterHub(true)
    void syncPresence("in-band", roomCode)
  },
  onRoomState: (_roomCode, phase, players, missionSlug, village, lastResult, nextSelectedRotationId, nextRotationsPaused, nextRotations, nextUpcomingRotations, rescueOffer, contributions, nextSelectedContributionIds, season, band) => {
    currentRoomPlayers = players
    currentMissionSlug = missionSlug
    currentVillage = { ...village }
    currentLastResult = lastResult
    selectedRotationId = nextSelectedRotationId
    rotationsPaused = nextRotationsPaused
    currentRotations = nextRotations
    upcomingRotations = nextUpcomingRotations
    currentRescueOffer = rescueOffer
    currentSeason = season
    currentContributions = contributions
    selectedContributionIds = nextSelectedContributionIds
    currentBand = band
    if (band) localStorage.setItem("sherwood:band-id", band.id)
    else localStorage.removeItem("sherwood:band-id")
    renderParty(players)
    renderSafetyPanel(players)
    const localPlayer = players.find((player) => player.id === multiplayer.playerId)
    localReady = localPlayer?.ready ?? false
    localRoleConfirmed = localPlayer?.roleConfirmed ?? false
    if (localPlayer) {
      if (localPlayer.characterId !== selectedCharacter) selectLocalCharacter(localPlayer.characterId, false)
      state.player.health = localPlayer.health
      if (phase === "lobby") state.player.position = { ...localPlayer.position }
    }
    readyButton.textContent = localReady ? "NOT READY" : "READY UP"
    readyButton.disabled = !localRoleConfirmed
    hubReady.textContent = localReady ? "NOT READY" : "READY UP"
    hubReady.disabled = roomConnected && !localRoleConfirmed
    hubLoadout.value = localPlayer?.loadoutId ?? "balanced"
    applyVillageState(visibleVillageState(village))
    renderHub()
    renderRoleChoice(players)
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
    if (!connected) void syncPresence("available", null)
  },
  onHubWelcome: (_instanceId, participantId, capacity) => {
    inPublicHub = true
    inHub = false
    multiplayerActive = false
    publicHubParticipantId = participantId
    running = true
    intro.classList.add("closed")
    hubPanel.classList.add("hidden")
    publicHubPanel.classList.remove("hidden")
    partyHud.classList.add("hidden")
    setMissionWorldVisible(false)
    objectiveElement.textContent = "Meet outlaws and form a private band"
    missionModifiers.textContent = `OPT-IN PUBLIC CAMP · CAP ${capacity} · NO PUBLIC CHAT`
    void syncPresence("available", null)
  },
  onHubState: (players) => {
    publicHubPlayers = players
    const local = players.find((player) => player.id === publicHubParticipantId)
    if (local) state.player.position = { ...local.position }
    const remotes = players.filter((player) => player.id !== publicHubParticipantId).map(hubPlayerAsRoomPlayer)
    ensureRemotePlayers(remotes)
    const receivedAt = performance.now()
    for (const player of remotes) remoteViews.get(player.id)?.snapshots.push(player.position, receivedAt)
    renderPublicHub()
  },
})

function hubPlayerAsRoomPlayer(player: PublicHubPlayer): RoomPlayer {
  return {
    id: player.id, displayName: player.displayName, characterId: player.characterId, loadoutId: "balanced", ready: player.looking, connected: true,
    roleConfirmed: true,
    bandRole: null, bandInvitePending: false,
    health: 3, arrows: 0, loot: 0, downedFor: 0, signatureCooldown: 0, protectionScore: 0, crowdControl: 0, heavyCarryPeak: 0, trapHits: 0, sabotageCount: 0,
    position: { ...player.position }, lastInputSequence: 0,
  }
}

function renderRoleChoice(players: RoomPlayer[]): void {
  const shouldOpen = roomConnected && !localRoleConfirmed
  const opening = shouldOpen && roleChoicePanel.classList.contains("hidden")
  roleChoicePanel.classList.toggle("hidden", !shouldOpen)
  roleChoicePanel.setAttribute("aria-hidden", String(!shouldOpen))
  for (const button of roleChoiceButtons) {
    const characterId = button.dataset.roomCharacter as CharacterId
    const selected = players.filter((player) => player.roleConfirmed && player.characterId === characterId).length
    const full = selected >= 2
    button.disabled = full
    button.classList.toggle("selected", localRoleConfirmed && selectedCharacter === characterId)
    const availability = button.querySelector("i")
    if (availability) availability.textContent = full ? "FULL" : `${2 - selected} SLOT${2 - selected === 1 ? "" : "S"} OPEN`
  }
  roleChoiceStatus.textContent = "Choose an outlaw before readying up."
  if (opening) roleChoiceButtons.find((button) => !button.disabled)?.focus()
}

function setMissionWorldVisible(visible: boolean): void {
  cartView.visible = visible
  signalView.visible = visible
  for (const guard of guardViews) guard.visible = visible
  missionBoardView.visible = !visible
  if (!visible) {
    syncTrapViews([])
    syncCaptiveViews([])
    syncAlarmViews([])
    syncLootCacheViews([])
    syncPreparationViews([])
    storehouseView.visible = false
    disguiseRackView.visible = false
  }
}

function applyRegionalLayout(layout: RegionalMissionLayout): void {
  state.layout = {
    ...layout,
    campfireCell: { ...layout.campfireCell, center: { ...layout.campfireCell.center } },
    objectiveCell: { ...layout.objectiveCell, center: { ...layout.objectiveCell.center } },
    campfirePosition: { ...layout.campfirePosition },
    objectivePosition: { ...layout.objectivePosition },
    crossingPositions: layout.crossingPositions.map((position) => ({ ...position })) as RegionalMissionLayout["crossingPositions"],
    guardPositions: layout.guardPositions.map((position) => ({ ...position })),
    bowCachePositions: layout.bowCachePositions.map((position) => ({ ...position })),
    reinforcementSignalPosition: { ...layout.reinforcementSignalPosition },
    disguisePosition: { ...layout.disguisePosition },
    playerSpawns: layout.playerSpawns.map((position) => ({ ...position })),
  }
  missionCampfireView.position.set(layout.campfirePosition.x, sherwoodHeightAt(layout.campfirePosition.x, layout.campfirePosition.z), layout.campfirePosition.z)
  cartView.position.set(layout.objectivePosition.x, sherwoodHeightAt(layout.objectivePosition.x, layout.objectivePosition.z), layout.objectivePosition.z)
  signalView.position.set(layout.reinforcementSignalPosition.x, sherwoodHeightAt(layout.reinforcementSignalPosition.x, layout.reinforcementSignalPosition.z), layout.reinforcementSignalPosition.z)
  storehouseView.position.set(layout.objectivePosition.x, sherwoodHeightAt(layout.objectivePosition.x, layout.objectivePosition.z), layout.objectivePosition.z)
  disguiseRackView.position.set(layout.disguisePosition.x, sherwoodHeightAt(layout.disguisePosition.x, layout.disguisePosition.z), layout.disguisePosition.z)
  rebuildCrossingInfrastructure(layout)
  rebuildBowCaches(layout)
  rebuildLandmarks(layout)
  rebuildComposedWorld(layout)
  positionVillageUpgrades(layout.campfirePosition)
}

function renderHub(): void {
  const isLeader = !roomConnected || currentRoomPlayers[0]?.id === multiplayer.playerId
  missionTitle.textContent = getMissionDefinition(currentMissionSlug).name.toUpperCase()
  hubRotations.replaceChildren()
  for (const rotation of currentRotations) {
    const mission = getMissionDefinition(rotation.missionSlug)
    const button = document.createElement("button")
    button.classList.toggle("selected", rotation.id === selectedRotationId)
    button.disabled = !roomConnected || !isLeader || rotationsPaused
    const name = document.createElement("b")
    const detail = document.createElement("small")
    name.textContent = `${rotation.partySize}P · ${mission.name}`
    detail.textContent = `${rotation.region.replaceAll("-", " ")} · ${rotation.modifierIds.map((id) => id.replaceAll("-", " ")).join(" + ")} · ${rotation.rewardLabel}`
    button.append(name, detail)
    button.addEventListener("click", () => multiplayer.selectRotation(rotation.id))
    hubRotations.append(button)
  }
  if (currentRotations.length === 0 && !rotationsPaused) {
    const empty = document.createElement("small")
    empty.textContent = roomConnected ? "The Sheriff has posted no valid target." : "Form a band to load today's server-owned targets."
    hubRotations.append(empty)
  }
  renderRotationCountdown()
  renderRescueOffer()
  renderContributions()
  renderSeason()
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
  hubBand.classList.toggle("hidden", !currentBand)
  if (currentBand) {
    const localBandRole = currentRoomPlayers.find((player) => player.id === multiplayer.playerId)?.bandRole ?? null
    hubBandName.textContent = currentBand.name.toUpperCase()
    hubBandCamp.textContent = `${currentBand.bannerId.toUpperCase()} BANNER · ${currentBand.memberCount} MEMBER${currentBand.memberCount === 1 ? "" : "S"} · HEARTH ${currentBand.camp.hearth} · WORKBENCH ${currentBand.camp.workbench} · STORES ${currentBand.camp.stores}`
    hubBandHistory.textContent = currentBand.missionCount === 0 ? "No recorded missions yet." : `${currentBand.missionCount} recorded mission${currentBand.missionCount === 1 ? "" : "s"} · progression v${currentBand.progressionVersion}`
    hubBandControls.classList.toggle("hidden", localBandRole !== "leader")
    if (document.activeElement !== hubBandNameInput) hubBandNameInput.value = currentBand.name
    hubBandBanner.value = currentBand.bannerId
  }
  hubRecent.textContent = currentLastResult
    ? `Last heist: ${currentLastResult.status === "succeeded" ? currentLastResult.grade : "PARTIAL"} · ${currentLastResult.score.toLocaleString()} renown${currentLastResult.totalCaptives > 0 ? ` · ${currentLastResult.rescuedCaptives}/${currentLastResult.totalCaptives} rescued` : ""}. Village: G${currentVillage.granary} I${currentVillage.infirmary} W${currentVillage.watchtower}.`
    : `Village works: granary ${currentVillage.granary}, infirmary ${currentVillage.infirmary}, watchtower ${currentVillage.watchtower}.`
  hubState.textContent = roomConnected
    ? `${isLeader ? "Band leader chooses the target." : "The band leader chooses the target."} Ready together when roles and kits are set.`
    : "Move around the fire or start the selected mission."
}

function renderPublicHub(): void {
  publicHubCount.textContent = `${publicHubPlayers.length}/12`
  publicHubLooking.textContent = publicHubIsLooking ? "CANCEL SEARCH" : "FIND A BAND"
  const desiredPartySize = Number(publicHubSize.value)
  const compatible = publicHubPlayers.filter((player) => player.id !== publicHubParticipantId && player.looking && player.desiredPartySize === desiredPartySize && (publicHubTarget.value === "any" || player.targetPreference === "any" || player.targetPreference === publicHubTarget.value)).length
  publicHubList.replaceChildren()
  for (const player of publicHubPlayers) {
    const item = document.createElement("li")
    const copy = document.createElement("div")
    const name = document.createElement("span")
    const detail = document.createElement("small")
    name.textContent = `${player.displayName} · ${characterName(player.characterId)}${player.emote ? ` · ${player.emote.toUpperCase()}` : ""}${player.ping ? ` · ${player.ping.toUpperCase()}!` : ""}`
    detail.textContent = player.looking ? `LOOKING · ${player.targetPreference.replaceAll("-", " ")} · ${player.desiredPartySize}P` : "At the fire"
    copy.append(name, detail)
    const actions = document.createElement("div")
    if (player.id !== publicHubParticipantId) {
      const mute = document.createElement("button")
      mute.textContent = mutedPlayerIds.has(player.id) ? "UNMUTE" : "MUTE"
      mute.addEventListener("click", () => { if (mutedPlayerIds.has(player.id)) mutedPlayerIds.delete(player.id); else mutedPlayerIds.add(player.id); renderPublicHub() })
      const report = document.createElement("button")
      report.textContent = "REPORT"
      report.addEventListener("click", () => { multiplayer.reportHubPlayer(player.id, "griefing"); publicHubStatus.textContent = "Fixed-reason report recorded without public text." })
      const block = document.createElement("button")
      block.textContent = "BLOCK"
      block.addEventListener("click", () => { mutedPlayerIds.add(player.id); multiplayer.blockHubPlayer(player.id); publicHubStatus.textContent = "Blocked player hidden from this public camp." })
      actions.append(mute, report, block)
    }
    item.append(copy, actions)
    publicHubList.append(item)
  }
  publicHubStatus.textContent = publicHubIsLooking
    ? `Searching across every public camp · ${compatible} visible match${compatible === 1 ? "" : "es"} here · friends receive priority but are never required.`
    : "Choose a target and party size, then find a band automatically."
}

function renderRotationCountdown(): void {
  if (rotationsPaused) {
    hubRotationState.textContent = "Targets are paused by the operator while a broken rotation is reviewed."
    return
  }
  const expiry = currentRotations[0]?.endsAt
  if (!expiry) {
    hubRotationState.textContent = roomConnected ? "Waiting for a valid target schedule." : "Daily targets are server-owned."
    return
  }
  const remaining = Math.max(0, expiry - Date.now())
  const hours = Math.floor(remaining / 3_600_000)
  const minutes = Math.floor((remaining % 3_600_000) / 60_000)
  const nextMissions = upcomingRotations.length > 0
    ? upcomingRotations.map((rotation) => `${rotation.partySize}P ${getMissionDefinition(rotation.missionSlug).name}`).join(" · ")
    : "pending"
  hubRotationState.textContent = `Expires in ${hours}h ${minutes}m UTC · next: ${nextMissions}. Rewards and modifiers are verified by the room server.`
}

function renderRescueOffer(): void {
  const offer = currentRescueOffer
  hubRescue.classList.toggle("hidden", !offer)
  if (!offer) return
  const remaining = Math.max(0, offer.expiresAt - Date.now())
  const minutes = Math.ceil(remaining / 60_000)
  const contexts: Record<RescueOffer["context"], string> = {
    "captured-outlaws": `${offer.targetCount} captured outlaw${offer.targetCount === 1 ? "" : "s"} may be moved along the Iron Road.`,
    "lost-captives": `${offer.targetCount} captive${offer.targetCount === 1 ? "" : "s"} from the last rescue remain on the Iron Road.`,
    "lost-supplies": `The Sheriff recovered ${offer.targetCount} cache${offer.targetCount === 1 ? "" : "s"} from the failed run.`,
  }
  const outcomes: Partial<Record<RescueOffer["status"], string>> = {
    accepted: "The fresh rescue mission is selected. Helpers may join this private band before readiness.",
    completed: `Rescue completed · ${offer.recoveredValue} value recovered exactly once.`,
    expired: "The bounded rescue window expired. Ordinary play was never restricted.",
    abandoned: "The band declined this rescue. No penalty applies.",
    failed: "The rescue attempt failed and will not create an unbounded chain.",
  }
  hubRescueCopy.textContent = `${contexts[offer.context]} ${outcomes[offer.status] ?? `Offer expires in ${minutes}m. No names or mission history are shared outside this band.`}`
  const isLeader = currentRoomPlayers[0]?.id === multiplayer.playerId
  hubAcceptRescue.disabled = !isLeader || offer.status !== "active" || remaining <= 0
  hubAcceptRescue.textContent = offer.status === "accepted" ? "RESCUE SELECTED" : offer.status === "completed" ? "RESCUE COMPLETE" : "ACCEPT RESCUE"
  hubAbandonRescue.disabled = !isLeader || (offer.status !== "active" && offer.status !== "accepted")
}

function renderContributions(): void {
  const labels: Record<ContributionType, string> = {
    supplies: "Supply cache",
    intelligence: "Scout intelligence",
    "snare-kit": "Road snare kit",
    "safe-house": "Safe-house aid",
  }
  const localId = multiplayer.playerId
  const isLeader = currentRoomPlayers[0]?.id === localId
  const available = currentContributions.filter((contribution) => contribution.status === "available")
  const localAvailable = available.filter((contribution) => contribution.contributorPlayerId === localId)
  for (const button of contributionDepositButtons) {
    const type = button.dataset.contributionType as ContributionType
    button.disabled = !roomConnected
      || available.length >= 6
      || localAvailable.length >= 2
      || available.filter((contribution) => contribution.type === type).length >= 2
  }
  hubContributionList.replaceChildren()
  for (const contribution of currentContributions.slice(0, 12)) {
    const selected = selectedContributionIds.includes(contribution.id)
    const item = document.createElement("li")
    item.classList.toggle("selected", selected)
    const copy = document.createElement("span")
    const title = document.createElement("b")
    const detail = document.createElement("small")
    title.textContent = labels[contribution.type]
    const minutes = Math.max(0, Math.ceil((contribution.expiresAt - Date.now()) / 60_000))
    detail.textContent = `${contribution.contributorLabel} · ${selected ? "selected · " : ""}${contribution.status}${contribution.status === "available" ? ` · ${minutes}m` : ""}`
    copy.append(title, detail)
    const actions = document.createElement("span")
    actions.className = "contribution-actions"
    if (contribution.status === "available" && isLeader) {
      const choose = document.createElement("button")
      choose.textContent = selected ? "REMOVE" : "SELECT"
      choose.disabled = !selected && selectedContributionIds.length >= 3
      choose.addEventListener("click", () => multiplayer.toggleContribution(contribution.id))
      actions.append(choose)
    }
    if (contribution.status === "available" && contribution.contributorPlayerId === localId) {
      const revoke = document.createElement("button")
      revoke.className = "revoke"
      revoke.textContent = "REVOKE"
      revoke.addEventListener("click", () => multiplayer.revokeContribution(contribution.id))
      actions.append(revoke)
    }
    item.append(copy, actions)
    hubContributionList.append(item)
  }
  if (currentContributions.length === 0) {
    const empty = document.createElement("li")
    empty.textContent = roomConnected ? "No shared preparations yet." : "Online bands can leave bounded preparations here."
    hubContributionList.append(empty)
  }
  hubContributionState.textContent = roomConnected
    ? `${selectedContributionIds.length}/3 selected for the next mission · ${available.length}/6 available · readiness locks the set.`
    : "Form a band to share preparation."
}

function renderSeason(): void {
  const season = currentSeason
  hubSeason.classList.toggle("hidden", !season)
  if (!season) return
  hubSeasonPhase.textContent = season.phase.toUpperCase()
  hubSeasonName.textContent = season.name
  hubSeasonPressure.textContent = String(season.pressure)
  hubSeasonPressureFill.style.width = `${season.pressure}%`
  const phaseCopy: Record<SherwoodSeasonSnapshot["phase"], string> = {
    active: "Every verified redistribution, rescue, clean escape, and shared preparation changes the same Sherwood.",
    paused: "Campaign scoring is paused for operator review; permanent band and identity data are untouched.",
    finale: "The Sheriff is exposed. Complete verified daily marks before his counter-campaign closes the roads.",
    succeeded: "Sherwood broke the campaign. The season awaits archival and permanent recognition.",
    failed: "The Sheriff held this campaign. Village work and permanent recognition remain intact.",
    archived: "This campaign is preserved as history. No permanent identity or entitlement was reset.",
  }
  hubSeasonCopy.textContent = phaseCopy[season.phase]
  hubSeasonProjects.replaceChildren()
  for (const project of Object.values(season.projects)) {
    const item = document.createElement("div")
    item.className = "season-project"
    const label = document.createElement("b")
    const value = document.createElement("span")
    const track = document.createElement("i")
    const fill = document.createElement("em")
    label.textContent = project.label
    value.textContent = `TIER ${project.tier} · ${project.total.toLocaleString()}${project.nextThreshold ? `/${project.nextThreshold.toLocaleString()}` : " · COMPLETE"}`
    const denominator = project.nextThreshold ?? Math.max(1, project.total)
    fill.style.width = `${Math.min(100, (project.total / denominator) * 100)}%`
    track.append(fill)
    item.append(label, value, track)
    hubSeasonProjects.append(item)
  }
  hubSeasonFinale.textContent = season.phase === "finale" || season.phase === "succeeded" || season.phase === "failed"
    ? `Finale: ${season.finale.successes}/${season.finale.target} successful marks · ${season.finale.attempts}/${season.finale.maxAttempts} attempts.`
    : `Complete all three Tier 3 projects to expose the finale · revision ${season.revision}.`
}

function visibleVillageState(village: VillageState): VillageState {
  if (!currentSeason) return village
  return {
    granary: Math.max(village.granary, currentSeason.projects.granary.tier),
    infirmary: Math.max(village.infirmary, currentSeason.projects.infirmary.tier),
    watchtower: Math.max(village.watchtower, currentSeason.projects.watchtower.tier),
  }
}

function enterHub(online: boolean): void {
  inHub = true
  multiplayerActive = false
  roomConnected = online
  running = true
  ended = false
  state.won = false
  state.lost = false
  intro.scrollTop = 0
  intro.classList.add("closed")
  resultsPanel.classList.add("hidden")
  resultsPanel.setAttribute("aria-hidden", "true")
  hubPanel.classList.remove("hidden")
  partyHud.classList.toggle("hidden", !online)
  setMissionWorldVisible(false)
  missionCampfireView.position.set(HUB_CAMPFIRE_POSITION.x, 0, HUB_CAMPFIRE_POSITION.z)
  positionVillageUpgrades(HUB_CAMPFIRE_POSITION)
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
  soloRunSequence += 1
  state = createInitialState(selectedCharacter, stableSeed(`solo:${Date.now()}:${soloRunSequence}`))
  applyRegionalLayout(state.layout)
  localDownedFor = 0
  ended = false
  resultSubmitted = false
  missionTarget = DELIVERY_TARGET
  objectiveElement.textContent = "Search Sherwood for the Sheriff's shipment"
  missionModifiers.textContent = ""
  clock.getDelta()
}

const controllerActions = GAME_ACTIONS.filter((action) => !action.startsWith("move")) as Array<keyof InputSettings["controller"]>
const panelElements = [helpPanel, leaderboardPanel, resultsPanel, safetyPanel, settingsPanel, socialPanel]
const controllerButtonLabels = ["A / Cross", "B / Circle", "X / Square", "Y / Triangle", "LB / L1", "RB / R1", "LT / L2", "RT / R2", "View / Share", "Menu / Options", "Left stick", "Right stick", "D-pad up", "D-pad down", "D-pad left", "D-pad right"]
const pointerActionLabels: Record<PointerAction, string> = {
  move: "Move to ground",
  cameraLeft: ACTION_LABELS.cameraLeft,
  cameraRight: ACTION_LABELS.cameraRight,
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
  helpMove.textContent = `${keyLabel(key.moveUp)} / ${keyLabel(key.moveLeft)} / ${keyLabel(key.moveDown)} / ${keyLabel(key.moveRight)} moves by perspective · ${keyLabel(key.cameraLeft)} / ${keyLabel(key.cameraRight)} rotates the camera 90°`
  helpInteract.textContent = `${keyLabel(key.interact)} near the cart or village fire`
  helpFire.textContent = `${keyLabel(key.fire)} stuns the nearest guard in range`
  helpSignature.textContent = `${keyLabel(key.signature)} uses Twin Shot, Marian's Veil, Oak Sweep, or Much's Road Snare`
  signatureKeyElement.textContent = keyLabel(key.signature)
  helpSignals.textContent = `${keyLabel(key.pingDanger)} / ${keyLabel(key.pingTarget)} / ${keyLabel(key.pingRoute)} / ${keyLabel(key.pingLoot)} / ${keyLabel(key.pingRegroup)} place symbol-coded signals`
  helpSupport.textContent = `${keyLabel(key.revive)} revives a nearby outlaw · ${keyLabel(key.transferLoot)} transfers up to 60 coin`
  introControls.textContent = `${keyLabel(key.moveUp)}${keyLabel(key.moveLeft)}${keyLabel(key.moveDown)}${keyLabel(key.moveRight)} / POINTER / STICK TO MOVE · ${keyLabel(key.cameraLeft)}/${keyLabel(key.cameraRight)} CAMERA · ${keyLabel(key.interact)} INTERACT · ${keyLabel(key.fire)} FIRE · ${keyLabel(key.signature)} SIGNATURE`
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
  if (action === "cameraLeft" || action === "cameraRight") {
    cameraQuarterTurns = (cameraQuarterTurns + (action === "cameraLeft" ? -1 : 1) + 4) % 4
    clickTarget = null
    destinationMarker.visible = false
    showToast(`CAMERA ROTATED ${action === "cameraLeft" ? "LEFT" : "RIGHT"}`)
    return
  }
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
  if (latestMissionSnapshot?.missionKind === "storehouse") {
    const prompts: Record<MissionSnapshot["phase"], string> = {
      scout: `Case the tally gate or canal roofline · ${keyLabel(key.pingRoute)} signals the approach`,
      ambush: `${keyLabel(key.interact)} disguises, sabotages, or forces entry · ${keyLabel(key.fire)} opens loudly`,
      robbery: `${keyLabel(key.interact)} opens nearby caches or cuts an alarm`,
      pursuit: `Carry the levy to either extraction · ${keyLabel(key.pingLoot)} marks the carrier`,
      escape: `${keyLabel(key.interact)} settles secured coin at extraction`,
      extraction: "Review alarms, intelligence, ledger, and mastery conditions",
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
    `INFILTRATION alarms=${mission?.alarmLevel ?? 0} waves=${mission?.reinforcementWave ?? 0} intel=${mission?.intelFound ? "yes" : "no"} ledger=${mission?.ledgerStolen ? "yes" : "no"}`,
    `ROTATION ${mission?.rotationId ?? "standard"} · modifiers=${mission?.rotationModifierIds.join(",") || "seeded"}`,
    `RESCUE CHAIN ${mission?.rescueOfferId ?? "none"} · source=${mission?.rescueSourceMissionId ?? "none"}`,
    `PREPARATION ${(mission?.preparations ?? []).map((preparation) => `${preparation.type}:${preparation.status}:${preparation.contributorLabel}`).join(" · ") || "none"}`,
    `RENDER   ${renderProfile.tier} · calls=${renderer.info.render.calls} · triangles=${renderer.info.render.triangles}`,
  ].join("\n")
}

function applyMissionSnapshot(mission: MissionSnapshot): void {
  latestMissionSnapshot = mission
  const nextLayout = selectRegionalMissionLayout(state.layout, mission.layout)
  if (nextLayout !== state.layout) applyRegionalLayout(nextLayout)
  const definition = getMissionDefinition(currentMissionSlug)
  const packageMatches = mission.missionId === definition.id
    && mission.missionVersion === definition.missionVersion
    && mission.contentHash === definition.contentHash
  missionPackageStatus = packageMatches ? "client/server package match" : "ERROR: client/server package mismatch"
  if (!packageMatches) showToast("Mission package mismatch — reconnect after updating")
  state.heat = mission.heat
  state.cartCoin = mission.cartCoin
  state.delivered = mission.delivered
  state.exploredCellIndices = [...mission.exploredCellIndices]
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
  } : mission.missionKind === "storehouse" ? {
    scout: "Case the tally gate or canal roofline",
    ambush: "Disguise, sabotage, or force an entry",
    robbery: `Secure the royal levy · ${mission.delivered + currentRoomPlayers.reduce((sum, player) => sum + player.loot, 0)}/${mission.target}`,
    pursuit: "Break contact and choose an extraction route",
    escape: `Extract the levy · alarms ${mission.alarmLevel}/3`,
    extraction: `Infiltration accounted · intel ${mission.intelFound ? "secured" : "missed"} · ledger ${mission.ledgerStolen ? "secured" : "missed"}`,
  } : {
    scout: mission.objectiveDiscovered
      ? `Shipment ${mission.cycle} found · choose the forest or river approach`
      : `Search the 5×5 region for shipment ${mission.cycle} · Sheriff pressure ${mission.searchPressure}/3`,
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
  const rotationState = mission.rotationId ? ` · DAILY ${mission.rotationId.split("-").slice(-2).join(" ").toUpperCase()}` : ""
  const preparationState = mission.preparations.length > 0 ? ` · PREP ${mission.preparations.filter((preparation) => preparation.status === "consumed").length}/${mission.preparations.length}` : ""
  missionModifiers.textContent = `5×5 SHERWOOD · SEARCH ${mission.searchPressure}/3 · ${mission.modifiers.map((modifier) => modifier.label).join(" · ")} · ${mission.sheriffPlan.toUpperCase()} PLAN${sabotageState}${rotationState}${preparationState} · OPTIONAL ${completedOptional}/${mission.optionalObjectives.length}`
  if (mission.phase === "robbery") localStorage.setItem("sherwood:tutorial-complete", "true")
  state.guards = synchronizeMissionGuards(state.guards, mission.guards)
  if (mission.latestEvent && mission.latestEvent.sequence > lastMissionEventSequence) {
    lastMissionEventSequence = mission.latestEvent.sequence
    showMissionEvent(mission.latestEvent)
  }
  syncPingViews(mission.pings)
  syncTrapViews(mission.traps)
  syncCaptiveViews(mission.captives)
  syncAlarmViews(mission.alarms)
  syncLootCacheViews(mission.lootCaches)
  syncPreparationViews(mission.preparations)
  cartView.position.set(mission.cartPosition.x, sherwoodHeightAt(mission.cartPosition.x, mission.cartPosition.z), mission.cartPosition.z)
  signalView.position.set(mission.layout.reinforcementSignalPosition.x, sherwoodHeightAt(mission.layout.reinforcementSignalPosition.x, mission.layout.reinforcementSignalPosition.z), mission.layout.reinforcementSignalPosition.z)
  cartView.children.forEach((child) => {
    if (child.userData.prison) child.visible = mission.missionKind === "prison-wagon"
  })
  cartView.visible = mission.missionKind !== "storehouse"
  storehouseView.visible = mission.missionKind === "storehouse"
  storehouseView.position.set(mission.layout.objectivePosition.x, sherwoodHeightAt(mission.layout.objectivePosition.x, mission.layout.objectivePosition.z), mission.layout.objectivePosition.z)
  disguiseRackView.visible = mission.missionKind === "storehouse" && mission.disguisePlayerId === null
  if (definition.scenario?.kind === "storehouse") disguiseRackView.position.set(mission.layout.disguisePosition.x, sherwoodHeightAt(mission.layout.disguisePosition.x, mission.layout.disguisePosition.z), mission.layout.disguisePosition.z)
  signalView.visible = mission.missionKind !== "storehouse"
  signalView.rotation.z = mission.signalSabotaged ? Math.PI / 2.8 : 0
  signalView.traverse((child) => {
    if (child instanceof THREE.Mesh && child.userData.signalFlag) setMeshColor(child, mission.signalSabotaged ? 0x5f5b45 : 0xa94132)
  })
  applyVillageState(visibleVillageState(mission.village))
  renderMissionResolution(mission)
  updateMissionDebug()
}

function showMissionEvent(event: MissionEvent): void {
  const messages: Partial<Record<MissionEvent["type"], string>> = {
    cart_robbed: "THE TAX CART IS OURS — RUN!",
    escort_blocking: latestMissionSnapshot?.missionKind === "storehouse"
      ? "GUARDS BLOCKING THE CACHE — STUN OR DRAW THEM AWAY"
      : latestMissionSnapshot?.missionKind === "prison-wagon"
        ? "ESCORT BLOCKING THE WAGON — STUN OR DRAW THEM AWAY"
        : "ESCORT BLOCKING THE CART — STUN OR DRAW THEM AWAY",
    loot_delivered: "COIN RETURNED TO THE PEOPLE",
    wagon_intercepted: "THE PRISON WAGON IS STOPPED",
    lock_breached: "THE CAGE LOCK IS GIVING WAY",
    captives_freed: "THE CAPTIVES ARE FREE — PROTECT THEM",
    captive_extracted: "A VILLAGER REACHED SAFETY",
    alarm_triggered: "THE ALARM BELLS ARE RINGING",
    alarm_sabotaged: "ALARM LINE CUT",
    disguise_acquired: "MARIAN HAS A ROYAL DISGUISE",
    cache_looted: "ROYAL LEVY SECURED",
    intel_found: "PATROL INTELLIGENCE FOUND",
    ledger_stolen: "THE NOTTINGHAM LEDGER IS OURS",
    extraction_reached: "SECURED VALUE REACHED EXTRACTION",
    contribution_consumed: "SHARED PREPARATION USED — CREDIT RECORDED",
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
  if (event.type === "signature_used") {
    if (event.playerId === multiplayer.playerId) heroSignatureUntil = clock.elapsedTime + 0.9
    else if (event.playerId) {
      const remote = remoteViews.get(event.playerId)
      if (remote) {
        remote.action = "signature"
        remote.actionUntil = clock.elapsedTime + 0.9
      }
    }
  } else if (event.type === "guard_stunned" && event.playerId && event.playerId !== multiplayer.playerId) {
    const remote = remoteViews.get(event.playerId)
    if (remote) {
      remote.action = "attack"
      remote.actionUntil = clock.elapsedTime + 0.8
    }
  }
  if (event.type === "signature_used" && event.detail === "little-john-sweep") showVanguardImpact(event.playerId)
  const message = event.type === "signature_used" && event.detail === "little-john-sweep"
    ? "OAK SWEEP — HOLD THE LINE"
    : event.type === "signature_used" && event.detail === "much-snare"
      ? "ROAD SNARE SET — DRAW THEM IN"
    : event.type === "reinforcement_arrived" && event.detail === "search-pressure"
      ? `SEARCH DELAY — THE SHERIFF FORTIFIES THE TARGET (${event.value}/3)`
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

function createPreparationView(preparation: MissionPreparation): THREE.Group {
  const group = new THREE.Group()
  if (preparation.type === "supplies") {
    const crate = mesh(new THREE.BoxGeometry(1.05, 0.62, 0.72), 0x6d4b2c)
    crate.position.y = 0.34
    const band = mesh(new THREE.BoxGeometry(1.12, 0.12, 0.78), 0xd1a94b)
    band.position.y = 0.52
    const arrows = mesh(new THREE.CylinderGeometry(0.11, 0.15, 0.86, 8), 0x315f37)
    arrows.rotation.z = Math.PI / 2
    arrows.position.set(0, 0.84, 0)
    group.add(crate, band, arrows)
  } else if (preparation.type === "intelligence") {
    const stand = mesh(new THREE.CylinderGeometry(0.05, 0.07, 1.35, 6), 0x4f3522)
    stand.position.y = 0.68
    const map = mesh(new THREE.PlaneGeometry(1.1, 0.72), 0xe8dfbd, { cast: false })
    map.position.set(0, 1.34, 0)
    const seal = mesh(new THREE.CircleGeometry(0.13, 12), 0x8d352b, { cast: false })
    seal.position.set(0.34, 1.2, 0.01)
    group.add(stand, map, seal)
  } else if (preparation.type === "safe-house") {
    const tent = mesh(new THREE.ConeGeometry(1.35, 1.8, 4), 0x48693f)
    tent.rotation.y = Math.PI / 4
    tent.position.y = 0.9
    const doorway = mesh(new THREE.PlaneGeometry(0.55, 0.85), 0x172d21, { cast: false })
    doorway.position.set(0, 0.5, 0.96)
    group.add(tent, doorway)
  }
  const marker = mesh(new THREE.RingGeometry(0.82, 0.96, 24), 0xe2af43, { cast: false })
  marker.rotation.x = -Math.PI / 2
  marker.position.y = 0.06
  group.add(marker)
  group.position.set(preparation.position.x, 0, preparation.position.z)
  group.userData.type = preparation.type
  return group
}

function syncPreparationViews(preparations: MissionPreparation[]): void {
  const visible = preparations.filter((preparation) => preparation.type !== "snare-kit" && (preparation.status === "active" || preparation.type === "intelligence"))
  const activeIds = new Set(visible.map((preparation) => preparation.id))
  for (const preparation of visible) {
    let view = preparationViews.get(preparation.id)
    if (!view) {
      view = createPreparationView(preparation)
      preparationViews.set(preparation.id, view)
      scene.add(view)
    }
    view.position.set(preparation.position.x, 0, preparation.position.z)
    view.visible = true
    setObjectOpacityFactor(view, preparation.status === "consumed" ? 0.45 : 1)
  }
  for (const [id, view] of preparationViews) {
    if (activeIds.has(id)) continue
    scene.remove(view)
    preparationViews.delete(id)
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

function createAlarmView(alarm: MissionAlarm): THREE.Group {
  const group = new THREE.Group()
  const post = mesh(new THREE.CylinderGeometry(0.055, 0.075, 2.3, 6), 0x4f3522)
  post.position.y = 1.15
  const bell = mesh(new THREE.ConeGeometry(0.34, 0.5, 10), 0xc79d42)
  bell.position.y = 2.35
  bell.rotation.z = Math.PI
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.78, 28),
    new THREE.MeshBasicMaterial({ color: 0xb43e32, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.08
  ring.userData.alarmPulse = true
  group.add(post, bell, ring)
  group.position.set(alarm.position.x, 0, alarm.position.z)
  return group
}

function syncAlarmViews(alarms: MissionAlarm[], elapsed = clock.elapsedTime): void {
  const activeIds = new Set(alarms.map((alarm) => alarm.id))
  for (const alarm of alarms) {
    let view = alarmViews.get(alarm.id)
    if (!view) {
      view = createAlarmView(alarm)
      alarmViews.set(alarm.id, view)
      scene.add(view)
    }
    view.position.set(alarm.position.x, 0, alarm.position.z)
    view.userData.alarmStatus = alarm.status
    const ring = view.children.find((child) => child.userData.alarmPulse) as THREE.Mesh | undefined
    if (ring) {
      const material = ring.material as THREE.MeshBasicMaterial
      material.color.setHex(alarm.status === "triggered" ? 0xc94a3d : alarm.status === "sabotaged" ? 0x56644a : 0xe3b54a)
      material.opacity = alarm.status === "triggered" ? 0.58 + Math.sin(elapsed * 8) * 0.3 : alarm.status === "sabotaged" ? 0.22 : 0.72
    }
    view.rotation.z = alarm.status === "sabotaged" ? Math.PI / 2.7 : 0
  }
  for (const [id, view] of alarmViews) {
    if (activeIds.has(id)) continue
    scene.remove(view)
    alarmViews.delete(id)
  }
}

function createLootCacheView(cache: MissionLootCache): THREE.Group {
  const group = new THREE.Group()
  const color = cache.kind === "coin" ? 0x7e532e : cache.kind === "intel" ? 0x38556b : 0x6c3431
  const chest = mesh(new THREE.BoxGeometry(cache.kind === "coin" ? 1.35 : 0.9, 0.72, cache.kind === "coin" ? 0.95 : 0.65), color)
  chest.position.y = 0.36
  const band = mesh(new THREE.BoxGeometry(0.16, 0.82, cache.kind === "coin" ? 1 : 0.7), 0xb28c48)
  band.position.y = 0.4
  group.add(chest, band)
  group.position.set(cache.position.x, 0, cache.position.z)
  return group
}

function syncLootCacheViews(caches: MissionLootCache[]): void {
  const secured = caches.filter((cache) => cache.status === "secured")
  const activeIds = new Set(secured.map((cache) => cache.id))
  for (const cache of secured) {
    if (lootCacheViews.has(cache.id)) continue
    const view = createLootCacheView(cache)
    lootCacheViews.set(cache.id, view)
    scene.add(view)
  }
  for (const [id, view] of lootCacheViews) {
    if (activeIds.has(id)) continue
    scene.remove(view)
    lootCacheViews.delete(id)
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

async function refreshSocialPanel(): Promise<void> {
  try {
    let state = await loadSocialState()
    if (state.session && !state.profile) {
      await registerSocialProfile(playerNameInput.value.trim().slice(0, 20) || "Greenhood")
      state = await loadSocialState()
    }
    currentSocial = state
    if (state.session) {
      localStorage.setItem("sherwood:friend-ids", JSON.stringify([state.session.user.id, ...state.friends.map((friend) => friend.profile.user_id)]))
      localStorage.setItem("sherwood:blocked-player-ids", JSON.stringify(state.blockedPlayerIds))
    } else {
      localStorage.removeItem("sherwood:friend-ids")
      localStorage.removeItem("sherwood:blocked-player-ids")
    }
    socialSignedOut.classList.toggle("hidden", Boolean(state.session))
    socialSignedIn.classList.toggle("hidden", !state.session)
    if (!state.session || !state.profile) return
    socialFriendCode.textContent = state.profile.friend_code
    socialPresence.checked = state.profile.presence_enabled
    renderSocialList(socialRequestList, state.incomingRequests, (friend, actions) => {
      addSocialAction(actions, "ACCEPT", async () => { await respondFriendRequest(friend.profile.user_id, true); await refreshSocialPanel() })
      addSocialAction(actions, "DECLINE", async () => { await respondFriendRequest(friend.profile.user_id, false); await refreshSocialPanel() })
    })
    renderSocialList(socialFriendList, state.friends, (friend, actions) => {
      if (roomConnected && multiplayer.roomCode) addSocialAction(actions, "INVITE", async () => {
        await sendDirectInvite(friend.profile.user_id, multiplayer.roomCode!, selectedCharacter)
        socialStatus.textContent = `Invite sent to ${friend.profile.display_name}. It expires in 15 minutes.`
      })
      addSocialAction(actions, "REMOVE", async () => { await removeFriend(friend.profile.user_id); await refreshSocialPanel() })
      addSocialAction(actions, "BLOCK", async () => { await blockSocialPlayer(friend.profile.user_id); await refreshSocialPanel() })
    })
    socialRecentList.replaceChildren()
    const friendIds = new Set(state.friends.map((friend) => friend.profile.user_id))
    for (const profile of state.recentPlayers.filter((candidate) => !friendIds.has(candidate.user_id))) {
      const item = document.createElement("li")
      const name = document.createElement("span")
      name.textContent = profile.display_name
      const actions = document.createElement("div")
      addSocialAction(actions, "ADD", async () => { await sendFriendRequest(profile.friend_code); await refreshSocialPanel() })
      addSocialAction(actions, "BLOCK", async () => { await blockSocialPlayer(profile.user_id); await refreshSocialPanel() })
      item.append(name, actions)
      socialRecentList.append(item)
    }
    socialInviteList.replaceChildren()
    for (const invite of state.invites) {
      const sender = state.friends.find((friend) => friend.profile.user_id === invite.sender_id)?.profile
      const item = document.createElement("li")
      const copy = document.createElement("div")
      const name = document.createElement("span")
      const detail = document.createElement("small")
      name.textContent = sender?.display_name ?? "Trusted outlaw"
      detail.textContent = `Band ${invite.room_code} · ${invite.character_hint ? characterName(invite.character_hint) : "choose any hero"} · expires ${new Date(invite.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      copy.append(name, detail)
      const actions = document.createElement("div")
      addSocialAction(actions, "USE INVITE", async () => {
        const code = await respondDirectInvite(invite.id, true)
        if (!code) throw new Error("That invitation expired")
        multiplayer.close()
        roomConnected = false
        multiplayerActive = false
        running = false
        hubPanel.classList.add("hidden")
        roomCodeInput.value = code
        intro.classList.remove("closed")
        closePanel(socialPanel)
        showToast("INVITE READY · JOIN THE ROOM TO CHOOSE YOUR HERO")
      })
      addSocialAction(actions, "DECLINE", async () => { await respondDirectInvite(invite.id, false); await refreshSocialPanel() })
      item.append(copy, actions)
      socialInviteList.append(item)
    }
    appendSocialEmpty(socialRequestList, "No pending friend requests.")
    appendSocialEmpty(socialInviteList, "No active direct invitations.")
    appendSocialEmpty(socialFriendList, "Add a trusted outlaw with their private friend code.")
    appendSocialEmpty(socialRecentList, "Completed authenticated missions will list recent bandmates here.")
    socialStatus.textContent = state.profile.presence_enabled
      ? "Presence is shared only with accepted, unblocked friends."
      : "Presence is off by default. Friends cannot see room availability."
  } catch (error) {
    socialStatus.textContent = error instanceof Error ? error.message : "Unable to load friends"
  }
}

function renderSocialList(list: HTMLUListElement, friends: SocialState["friends"], addActions: (friend: SocialState["friends"][number], actions: HTMLDivElement) => void): void {
  list.replaceChildren()
  for (const friend of friends) {
    const item = document.createElement("li")
    const copy = document.createElement("div")
    const name = document.createElement("span")
    const detail = document.createElement("small")
    name.textContent = friend.profile.display_name
    detail.textContent = friend.profile.presence_enabled ? `${friend.profile.presence_status.replace("-", " ")}${friend.profile.active_room_code ? " · band available" : ""}` : "presence private"
    copy.append(name, detail)
    const actions = document.createElement("div")
    addActions(friend, actions)
    item.append(copy, actions)
    list.append(item)
  }
}

function addSocialAction(actions: HTMLDivElement, label: string, action: () => Promise<void>): void {
  const button = document.createElement("button")
  button.textContent = label
  button.addEventListener("click", () => void action().catch((error) => { socialStatus.textContent = error instanceof Error ? error.message : "Social action failed" }))
  actions.append(button)
}

function appendSocialEmpty(list: HTMLUListElement, label: string): void {
  if (list.children.length > 0) return
  const item = document.createElement("li")
  item.textContent = label
  list.append(item)
}

async function syncPresence(status: "offline" | "available" | "in-band", roomCode: string | null): Promise<void> {
  if (!currentSocial?.profile?.presence_enabled) return
  const signature = `${status}:${roomCode ?? ""}`
  if (signature === lastPresenceSignature) return
  lastPresenceSignature = signature
  try { await updateSocialPresence(true, status, roomCode) } catch { lastPresenceSignature = "" }
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
  if (mission.missionKind === "storehouse") {
    const term = document.createElement("dt")
    const detail = document.createElement("dd")
    term.textContent = "Infiltration"
    const triggered = mission.alarms.filter((alarm) => alarm.status === "triggered").map((alarm) => alarm.id.replace("alarm.", "")).join(", ") || "none"
    detail.textContent = `${mission.alarmLevel} alarms (${triggered}) · ${mission.reinforcementWave} relief waves · intel ${mission.intelFound ? "secured" : "missed"} · ledger ${mission.ledgerStolen ? "secured" : "missed"}`
    resultBreakdown.append(term, detail)
  }
  const optionalTerm = document.createElement("dt")
  const optionalDetail = document.createElement("dd")
  optionalTerm.textContent = "Optional"
  optionalDetail.textContent = mission.optionalObjectives.map((objective) => `${objective.completed ? "✓" : objective.failed ? "×" : "○"} ${objective.label}`).join(" · ")
  resultBreakdown.append(optionalTerm, optionalDetail)
  if (mission.rotationId) {
    const term = document.createElement("dt")
    const detail = document.createElement("dd")
    term.textContent = "Daily target"
    detail.textContent = `${mission.rotationId} · ${mission.rotationModifierIds.join(" + ")} · server verified`
    resultBreakdown.append(term, detail)
  }
  if (mission.rescueOfferId) {
    const term = document.createElement("dt")
    const detail = document.createElement("dd")
    term.textContent = "Rescue chain"
    detail.textContent = `${mission.rescueOfferId} · rescuer credit and recovered value settle on the room server`
    resultBreakdown.append(term, detail)
  }
  if (mission.preparations.length > 0) {
    const term = document.createElement("dt")
    const detail = document.createElement("dd")
    term.textContent = "Band preparation"
    detail.textContent = mission.preparations.map((preparation) => `${preparation.status === "consumed" ? "✓" : "↩"} ${preparation.type.replaceAll("-", " ")} by ${preparation.contributorLabel}`).join(" · ")
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
  const campfire = inHub || inPublicHub ? HUB_CAMPFIRE_POSITION : state.layout.campfirePosition
  for (const choice of ["granary", "infirmary", "watchtower"] as VoteChoice[]) {
    if (village[choice] <= 0) continue
    const existing = villageUpgradeViews.get(choice)
    if (existing) {
      updateVillageUpgradeTier(existing, village[choice])
      continue
    }
    const view = new THREE.Group()
    if (choice === "granary") {
      for (let index = 0; index < 4; index += 1) {
        const crate = mesh(new THREE.BoxGeometry(0.65, 0.55, 0.65), 0xa87a43)
        crate.position.set((index % 2) * 0.75, 0.28, Math.floor(index / 2) * 0.75)
        view.add(crate)
      }
      view.userData.campOffset = { x: 2.4, z: 0 }
    } else if (choice === "infirmary") {
      const tent = mesh(new THREE.ConeGeometry(1.35, 2.1, 4), 0xd8d0ad)
      tent.position.y = 1.05
      tent.rotation.y = Math.PI / 4
      const cross = mesh(new THREE.BoxGeometry(0.5, 0.12, 0.08), 0xa94132)
      cross.position.set(0, 1.2, 1.04)
      view.add(tent, cross)
      view.userData.campOffset = { x: -2.7, z: 0.5 }
    } else {
      const tower = mesh(new THREE.CylinderGeometry(0.65, 0.9, 4.2, 6), 0x715239)
      tower.position.y = 2.1
      const roof = mesh(new THREE.ConeGeometry(1.1, 1.2, 6), 0x405538)
      roof.position.y = 4.55
      view.add(tower, roof)
      view.userData.campOffset = { x: 0, z: -3 }
    }
    villageUpgradeViews.set(choice, view)
    const offset = view.userData.campOffset as { x: number; z: number }
    view.position.set(campfire.x + offset.x, 0, campfire.z + offset.z)
    scene.add(view)
    updateVillageUpgradeTier(view, village[choice])
  }
}

function positionVillageUpgrades(campfire: { x: number; z: number }): void {
  for (const view of villageUpgradeViews.values()) {
    const offset = view.userData.campOffset as { x: number; z: number } | undefined
    if (offset) view.position.set(campfire.x + offset.x, 0, campfire.z + offset.z)
  }
}

function updateVillageUpgradeTier(view: THREE.Group, tier: number): void {
  const boundedTier = Math.max(1, Math.min(3, tier))
  view.scale.setScalar(1 + (boundedTier - 1) * 0.14)
  const renderedTier = Number(view.userData.tier ?? 0)
  for (let level = renderedTier + 1; level <= boundedTier; level += 1) {
    const beacon = mesh(new THREE.SphereGeometry(0.11 + level * 0.025, 8, 6), level === 3 ? 0xf2c65e : 0x8eb875, { cast: false })
    beacon.position.set((level - 2) * 0.42, 2.25 + level * 0.34, 0)
    const light = new THREE.PointLight(level === 3 ? 0xf2c65e : 0x8eb875, level * 0.55, 4)
    light.position.copy(beacon.position)
    view.add(beacon, light)
  }
  view.userData.tier = boundedTier
}

function renderParty(players: RoomPlayer[]): void {
  partyList.replaceChildren()
  missionPartyList.replaceChildren()
  for (const player of players) {
    const item = document.createElement("li")
    item.classList.toggle("ready", player.ready)
    const identity = document.createElement("span")
    identity.textContent = `${player.ready ? "✓" : "○"} ${player.displayName} · ${characterName(player.characterId)}${player.connected ? "" : " · reconnecting"}`
    item.append(identity)
    if (player.bandRole) {
      const role = document.createElement("small")
      role.className = "band-member"
      role.textContent = player.bandRole.toUpperCase()
      item.append(role)
    }
    const localPlayer = players.find((candidate) => candidate.id === multiplayer.playerId)
    if (player.id === multiplayer.playerId && player.bandInvitePending) {
      const accept = document.createElement("button")
      accept.textContent = "JOIN BAND"
      accept.addEventListener("click", () => multiplayer.respondBandMembership(true))
      const decline = document.createElement("button")
      decline.textContent = "DECLINE"
      decline.addEventListener("click", () => multiplayer.respondBandMembership(false))
      item.append(accept, decline)
    } else if (localPlayer?.bandRole === "leader" && player.id !== multiplayer.playerId && !player.bandRole) {
      const offer = document.createElement("button")
      offer.textContent = "OFFER MEMBERSHIP"
      offer.addEventListener("click", () => multiplayer.offerBandMembership(player.id))
      item.append(offer)
    } else if (localPlayer?.bandRole === "leader" && player.bandRole === "member") {
      const remove = document.createElement("button")
      remove.textContent = "REMOVE"
      remove.addEventListener("click", () => multiplayer.removeBandMember(player.id))
      item.append(remove)
    }
    partyList.append(item)

    const compact = document.createElement("li")
    compact.classList.toggle("local", player.id === multiplayer.playerId)
    compact.classList.toggle("disconnected", !player.connected)
    const presence = document.createElement("i")
    presence.className = "presence"
    presence.textContent = player.connected ? "●" : "×"
    presence.setAttribute("aria-label", player.connected ? "Connected" : "Reconnecting")
    const compactIdentity = document.createElement("span")
    compactIdentity.className = "identity"
    compactIdentity.textContent = `${player.displayName} · ${characterName(player.characterId)}`
    const vitality = document.createElement("b")
    vitality.className = "vitality"
    vitality.textContent = player.downedFor > 0
      ? `DOWN ${Math.ceil(player.downedFor)}s`
      : `${"♥".repeat(Math.max(0, player.health))}${player.characterId === "little-john" ? ` · 🛡${player.protectionScore} ⚒${player.crowdControl}` : player.characterId === "much" ? ` · ⛓${player.trapHits} ✂${player.sabotageCount}` : ""}`
    compact.append(presence, compactIdentity, vitality)
    missionPartyList.append(compact)
  }
  lobbyStatus.textContent = players.length < 2 ? "Waiting for another outlaw…" : "Ready together to begin."
}

function ensureRemotePlayers(players: RoomPlayer[]): void {
  const activeIds = new Set(players.filter((player) => player.id !== multiplayer.playerId).map((player) => player.id))
  for (const player of players) {
    if (player.id === multiplayer.playerId) continue
    const existing = remoteViews.get(player.id)
    if (existing) {
      existing.downedFor = player.downedFor
      if (existing.characterId !== player.characterId) {
        disposeObjectInstanceMaterials(existing.fallback)
        existing.view.remove(existing.fallback)
        existing.fallback = createCharacter(player.characterId)
        existing.characterId = player.characterId
        existing.view.add(existing.fallback)
      }
      continue
    }
    const view = new THREE.Group()
    const fallback = createCharacter(player.characterId)
    view.add(fallback)
    view.position.set(player.position.x, 0, player.position.z)
    scene.add(view)
    const remote: RemoteView = {
      view,
      fallback,
      snapshots: new SnapshotBuffer(),
      lastPosition: view.position.clone(),
      characterId: player.characterId,
      downedFor: player.downedFor,
      action: "idle",
      actionUntil: 0,
    }
    remote.snapshots.push(player.position, performance.now())
    remoteViews.set(player.id, remote)
  }
  for (const [id, remote] of remoteViews) {
    if (activeIds.has(id)) continue
    disposeObjectInstanceMaterials(remote.view)
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
    return cameraRelativeMove({ x, z }, { x: camera.position.x, z: camera.position.z }, state.player.position)
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
    openNearbyBowCache()
    multiplayer.sendAction("interact")
    return
  }
  const result = interact(state)
  const messages: Record<string, string> = {
    "robbed-cart": "120 CROWN COIN TAKEN — RUN!",
    "escort-blocking": "ESCORT BLOCKING THE CART — STUN OR DRAW THEM AWAY",
    "cart-empty": "The tax cart is empty",
    delivered: "COIN RETURNED TO THE PEOPLE",
    restocked: "Quiver restocked",
    "no-loot": "Bring stolen taxes back here",
    won: "SHERWOOD RISES",
    "bow-cache": "QUIVER REFILLED — CHEST OPENED",
    "quiver-full": "Your quiver is already full",
  }
  if (result === "bow-cache") openNearbyBowCache()
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
    heroAttackUntil = clock.elapsedTime + 0.8
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
  heroAttackUntil = clock.elapsedTime + 0.8
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
    heroSignatureUntil = clock.elapsedTime + 0.9
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
  if (result.event !== "signature-unavailable" && result.event !== "volley-missed") heroSignatureUntil = clock.elapsedTime + 0.9
  showToast(messages[result.event] ?? result.event)
}

function isModalOpen(): boolean {
  return !roleChoicePanel.classList.contains("hidden") || panelElements.some((panel) => !panel.classList.contains("hidden"))
}

async function openLeaderboard(): Promise<void> {
  if (leaderboardPanel.classList.contains("hidden")) openPanel(leaderboardPanel, leaderboardButton)
  leaderboardState.textContent = "Loading the global board…"
  leaderboardList.replaceChildren()
  const selectedSeason = boardSeason.value || "season-zero"
  const seasons = await loadLeaderboardSeasons()
  boardSeason.replaceChildren(...seasons.map((season) => {
    const option = document.createElement("option")
    option.value = season.slug
    option.textContent = season.name
    return option
  }))
  boardSeason.value = seasons.some((season) => season.slug === selectedSeason) ? selectedSeason : seasons[0]!.slug
  const kind = boardKind.value as LeaderboardKind
  const scope = boardScope.value
  const bandId = scope === "band" ? localStorage.getItem("sherwood:band-id") ?? undefined : undefined
  if (scope === "band" && !bandId) {
    leaderboardState.textContent = "Join or create a persistent Merry Band to use this filter"
    return
  }
  let friendIds: string[] | undefined
  let acceptedPlayerIds: string[] | undefined
  let blockedPlayerIds: string[] = []
  if (!currentSocial) {
    try { currentSocial = await loadSocialState() } catch { /* offline board remains available */ }
  }
  if (currentSocial?.session) {
    acceptedPlayerIds = [currentSocial.session.user.id, ...currentSocial.friends.map((friend) => friend.profile.user_id)]
    blockedPlayerIds = currentSocial.blockedPlayerIds
  } else {
    try { blockedPlayerIds = JSON.parse(localStorage.getItem("sherwood:blocked-player-ids") ?? "[]") as string[] } catch { blockedPlayerIds = [] }
  }
  if (scope === "friends") {
    try { friendIds = acceptedPlayerIds ?? JSON.parse(localStorage.getItem("sherwood:friend-ids") ?? "[]") as string[] }
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
    excludedPlayerIds: blockedPlayerIds,
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
    ? "Global alpha board · authoritative verified results"
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
      ? `${entry.delivered.toLocaleString()} coin`
      : kind === "clean-escapes"
        ? `${entry.delivered.toLocaleString()} coin`
        : kind === "rescuers"
          ? `${entry.rescues ?? 0} R`
          : kind === "swift-arrows"
            ? `${entry.missionSeconds}s`
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
  renderRegionMap()
  if (inHub) {
    renderRotationCountdown()
    renderRescueOffer()
    objectiveElement.textContent = "Prepare at the campfire mission board"
    progressElement.style.width = "0%"
    promptElement.textContent = `${keyLabel(inputSettings.keyboard.interact)} opens the board · move with your mapped controls`
    return
  }
  const signalPosition = latestMissionSnapshot?.layout.reinforcementSignalPosition ?? state.layout.reinforcementSignalPosition
  const atSignal = multiplayerActive && latestMissionSnapshot?.missionKind !== "storehouse" && selectedCharacter === "much" && !signalSabotaged && Math.hypot(state.player.position.x - signalPosition.x, state.player.position.z - signalPosition.z) < 3.2
  promptElement.textContent = isMobileSpectator()
    ? "Spectating the Merry Band · disable spectator mode in accessibility settings to play"
    : atSignal
      ? `${keyLabel(inputSettings.keyboard.interact)}  CUT THE SHERIFF'S REINFORCEMENT SIGNAL`
    : localDownedFor > 0
    ? `DOWNED · ${Math.ceil(localDownedFor)}s for a teammate to revive you`
    : multiplayerActive
      ? missionPrompt
      : getContextPrompt(state)
  const discovered = latestMissionSnapshot?.objectiveDiscovered ?? state.objectiveDiscovered
  const objectivePosition = latestMissionSnapshot
    ? missionObjectivePosition(latestMissionSnapshot)
    : state.layout.objectivePosition
  const dx = objectivePosition.x - state.player.position.x
  const dz = objectivePosition.z - state.player.position.z
  const objectiveDistance = Math.round(Math.hypot(dx, dz))
  const angle = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360
  const bearing = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(angle / 45) % 8]
  if (multiplayerActive) {
    objectiveElement.textContent = discovered && latestMissionSnapshot?.phase === "scout"
      ? `${missionObjective} · ${bearing} ${objectiveDistance}m`
      : missionObjective
    return
  }
  if (state.player.loot > 0) objectiveElement.textContent = "Return the coin to the village"
  else if (state.heat > 10) objectiveElement.textContent = "Disappear into the deep woods"
  else objectiveElement.textContent = state.delivered > 0
    ? "Strike the tax cart again"
    : state.objectiveDiscovered
      ? `Close on the Sheriff's shipment · ${bearing} ${objectiveDistance}m`
      : "Search all 25 Sherwood sectors"
}

function renderRegionMap(): void {
  const missionVisible = running && !inHub && !inPublicHub && intro.classList.contains("closed")
  regionMap.classList.toggle("hidden", !missionVisible)
  if (!missionVisible) return
  const explored = latestMissionSnapshot?.exploredCellIndices ?? state.exploredCellIndices
  const objectiveDiscovered = latestMissionSnapshot?.objectiveDiscovered ?? state.objectiveDiscovered
  const searchPressure = latestMissionSnapshot?.searchPressure ?? state.searchPressure
  const objectivePosition = latestMissionSnapshot
    ? missionObjectivePosition(latestMissionSnapshot)
    : state.layout.objectivePosition
  const cells = buildRegionMapCells(state.layout, explored, state.player.position, objectiveDiscovered, searchPressure, objectivePosition)
  if (regionMapGrid.children.length !== cells.length) {
    regionMapGrid.replaceChildren(...cells.map(() => {
      const cell = document.createElement("span")
      cell.className = "region-map-cell"
      return cell
    }))
  }
  let exploredCount = 0
  cells.forEach((cell, index) => {
    const view = regionMapGrid.children[index] as HTMLElement
    if (cell.explored) exploredCount += 1
    view.className = regionMapCellClassName(cell)
    view.textContent = cell.current ? "▲" : ""
    view.setAttribute("aria-hidden", "true")
  })
  regionMapCount.textContent = `${exploredCount}/25`
  regionMapGrid.setAttribute("aria-label", `${exploredCount} of 25 Sherwood regions explored`)
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
  roleChoicePanel.classList.add("hidden")
  roleChoicePanel.setAttribute("aria-hidden", "true")
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

function syncVillageLods(player: Vec2): void {
  const cottageDistance = Math.hypot(player.x + 10, player.z - 14)
  const authoredCottageAvailable = villageCottageView !== null
  if (villageCottageView) villageCottageView.userData.lodVisible = cottageDistance <= 34
  if (villageCottageFallback) {
    villageCottageFallback.userData.lodVisible = authoredCottageAvailable
      ? cottageDistance > 34 && cottageDistance <= 58
      : cottageDistance <= 58
  }

  const wagonDistance = Math.hypot(player.x - cartView.position.x, player.z - cartView.position.z)
  if (villageWagonShellView) villageWagonShellView.visible = wagonDistance <= 34
  if (proceduralWagonShellView) {
    proceduralWagonShellView.visible = villageWagonShellView
      ? wagonDistance > 34 && wagonDistance <= 58
      : wagonDistance <= 58
  }
}

function syncViews(elapsed: number, dt: number): void {
  syncGuardViewCount(
    guardViews,
    state.guards.length,
    () => createCharacter("guard"),
    (view) => scene.add(view),
    (view) => {
      scene.remove(view)
      disposeObjectInstanceMaterials(view)
    },
  )
  water.update(elapsed, renderProfile.motionScale)
  const objectiveDiscovered = latestMissionSnapshot?.objectiveDiscovered ?? state.objectiveDiscovered
  const objectiveStillActive = multiplayerActive
    ? latestMissionSnapshot !== null && ["scout", "ambush", "robbery"].includes(latestMissionSnapshot.phase)
    : state.cartCoin > 0 && state.player.loot === 0 && !state.won && !state.lost
  const objectiveVisible = running
    && !inHub
    && !inPublicHub
    && intro.classList.contains("closed")
    && objectiveDiscovered
    && objectiveStillActive
  const objectiveLabel = !multiplayerActive || latestMissionSnapshot?.missionKind === "tax-cart"
    ? "SHERIFF'S CART"
    : latestMissionSnapshot?.missionKind === "prison-wagon"
      ? "PRISON WAGON"
      : "NOTTINGHAM LEDGER"
  const objectivePosition = latestMissionSnapshot
    ? missionObjectivePosition(latestMissionSnapshot)
    : state.layout.objectivePosition
  setObjectiveMarkerLabel(objectiveMarker, objectiveLabel)
  objectiveBeacon.visible = objectiveVisible
  objectiveBeacon.position.set(objectivePosition.x, sherwoodHeightAt(objectivePosition.x, objectivePosition.z) + Math.sin(elapsed * 2) * 0.12, objectivePosition.z)
  animateObjectiveMarker(objectiveMarker, elapsed, renderProfile.motionScale)
  if (windmillRotor) windmillRotor.rotation.z = elapsed * 0.32 * renderProfile.motionScale
  if (!multiplayerActive) {
    syncTrapViews(state.traps.map((trap) => ({ id: trap.id, ownerId: "local", position: trap.position, expiresAtTick: 0 })))
  }
  const player = state.player.position
  const explored = new Set(latestMissionSnapshot?.exploredCellIndices ?? state.exploredCellIndices)
  explored.add(state.layout.campfireCell.index)
  for (const fogTile of regionFogViews) fogTile.visible = !inHub && !explored.has(Number(fogTile.userData.regionCell))
  const treeDistance = renderProfile.tier === "degraded" ? 34 : 48
  const propDistance = renderProfile.tier === "degraded" ? 34 : 48
  for (const prop of medievalPropViews) prop.visible = Math.hypot(prop.position.x - player.x, prop.position.z - player.z) <= propDistance
  syncVillageLods(player)
  const cameraToPlayer = { x: player.x - camera.position.x, z: player.z - camera.position.z }
  const cameraToPlayerLengthSquared = cameraToPlayer.x ** 2 + cameraToPlayer.z ** 2
  for (const occluder of cameraOccluders) {
    const cameraToOccluder = { x: occluder.view.position.x - camera.position.x, z: occluder.view.position.z - camera.position.z }
    const cameraDistance = Math.hypot(cameraToOccluder.x, cameraToOccluder.z)
    const segmentPosition = cameraToPlayerLengthSquared > 0
      ? Math.max(0, Math.min(1, (cameraToOccluder.x * cameraToPlayer.x + cameraToOccluder.z * cameraToPlayer.z) / cameraToPlayerLengthSquared))
      : 0
    const sightline = {
      x: camera.position.x + cameraToPlayer.x * segmentPosition,
      z: camera.position.z + cameraToPlayer.z * segmentPosition,
    }
    occluder.view.visible = occluder.view.userData.lodVisible !== false
      && cameraDistance > occluder.radius * 2.35
      && (occluder.maxDistance === undefined || Math.hypot(occluder.view.position.x - player.x, occluder.view.position.z - player.z) <= occluder.maxDistance)
      && !(segmentPosition > 0.05 && segmentPosition < 0.95
      && Math.hypot(occluder.view.position.x - sightline.x, occluder.view.position.z - sightline.z) < occluder.radius)
  }
  const dirtyTreeBatches = new Set<THREE.InstancedMesh>()
  for (const tree of authoredTreeInstances) {
    const playerDistance = Math.hypot(tree.x - player.x, tree.z - player.z)
    const cameraToTree = { x: tree.x - camera.position.x, z: tree.z - camera.position.z }
    const cameraDistance = Math.hypot(cameraToTree.x, cameraToTree.z)
    const segmentPosition = cameraToPlayerLengthSquared > 0
      ? Math.max(0, Math.min(1, (cameraToTree.x * cameraToPlayer.x + cameraToTree.z * cameraToPlayer.z) / cameraToPlayerLengthSquared))
      : 0
    const sightline = {
      x: camera.position.x + cameraToPlayer.x * segmentPosition,
      z: camera.position.z + cameraToPlayer.z * segmentPosition,
    }
    const blocksCamera = segmentPosition > 0.05 && segmentPosition < 0.95
      && Math.hypot(tree.x - sightline.x, tree.z - sightline.z) < tree.radius
    const hidden = playerDistance > treeDistance || cameraDistance <= tree.radius * 2.35 || blocksCamera
    if (hidden === tree.hidden) continue
    tree.hidden = hidden
    tree.batch.setMatrixAt(tree.instanceId, hidden ? tree.hiddenMatrix : tree.visibleMatrix)
    dirtyTreeBatches.add(tree.batch)
  }
  for (const batch of dirtyTreeBatches) batch.instanceMatrix.needsUpdate = true
  for (const view of alarmViews.values()) {
    if (view.userData.alarmStatus !== "triggered") continue
    const pulse = 1 + Math.sin(elapsed * 8) * 0.14 * renderProfile.motionScale
    view.scale.setScalar(pulse)
  }
  const playerGroundY = sherwoodHeightAt(player.x, player.z)
  playerView.position.set(player.x, playerGroundY + Math.sin(elapsed * 9) * 0.035 * renderProfile.motionScale, player.z)
  setObjectOpacityFactor(playerView, state.player.veilFor > 0 ? 0.48 : 1)
  const dx = player.x - lastPlayerPosition.x
  const dz = player.z - lastPlayerPosition.z
  const playerMoving = Math.hypot(dx, dz) > 0.001
  if (playerMoving) playerView.rotation.y = Math.atan2(dx, dz)
  lastPlayerPosition = { ...player }
  poseHeroCharacter(playerView, {
    elapsed,
    moving: playerMoving,
    action: elapsed < heroSignatureUntil ? "signature" : elapsed < heroAttackUntil ? "attack" : "idle",
    downed: localDownedFor > 0,
    motionScale: renderProfile.motionScale,
  })
  for (const cache of bowCacheAnimations) cache.mixer.update(dt)

  state.guards.forEach((guard, index) => {
    const view = guardViews[index]
    const guardGroundY = sherwoodHeightAt(guard.position.x, guard.position.z)
    view.position.set(guard.position.x, guardGroundY + (guard.stunnedFor > 0 ? 0.05 : Math.sin(elapsed * 7 + index) * 0.025 * renderProfile.motionScale), guard.position.z)
    if (state.heat > 8) view.rotation.y = Math.atan2(player.x - guard.position.x, player.z - guard.position.z)
    view.rotation.z = guard.stunnedFor > 0 ? Math.sin(elapsed * 14) * 0.1 : 0
  })

  const snapshotNow = performance.now()
  for (const remote of remoteViews.values()) {
    const sampled = remote.snapshots.sample(snapshotNow)
    if (sampled) remote.view.position.set(sampled.x, sherwoodHeightAt(sampled.x, sampled.z), sampled.z)
    const remoteDx = remote.view.position.x - remote.lastPosition.x
    const remoteDz = remote.view.position.z - remote.lastPosition.z
    const moving = Math.hypot(remoteDx, remoteDz) > 0.0001
    const cameraDistance = camera.position.distanceTo(remote.view.position)
    remote.fallback.visible = cameraDistance <= 48
    if (moving) remote.view.rotation.y = Math.atan2(remoteDx, remoteDz)
    remote.view.rotation.z = remote.downedFor > 0 ? Math.PI / 2.7 : 0
    if (elapsed >= remote.actionUntil) remote.action = "idle"
    poseHeroCharacter(remote.fallback, {
      elapsed,
      moving,
      action: remote.action,
      downed: remote.downedFor > 0,
      motionScale: renderProfile.motionScale,
    })
    remote.lastPosition.copy(remote.view.position)
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

  const cameraOffset = rotateCameraOffset(BASE_CAMERA_OFFSET, cameraQuarterTurns)
  const desiredCamera = new THREE.Vector3(player.x + cameraOffset.x, playerGroundY + 14.5, player.z + cameraOffset.z)
  camera.position.lerp(desiredCamera, 1 - Math.pow(0.001, dt))
  camera.lookAt(player.x, playerGroundY + 0.75, player.z)
  if (objectiveVisible) {
    const projectedObjective = new THREE.Vector3(objectiveBeacon.position.x, objectiveBeacon.position.y + 6, objectiveBeacon.position.z).project(camera)
    const pointerLayout = computeObjectivePointer({
      ndcX: projectedObjective.x,
      ndcY: projectedObjective.y,
      ndcZ: projectedObjective.z,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      distanceMeters: Math.hypot(objectivePosition.x - player.x, objectivePosition.z - player.z),
    })
    objectivePointer.classList.toggle("hidden", !pointerLayout.visible)
    objectivePointer.style.left = `${pointerLayout.x}px`
    objectivePointer.style.top = `${pointerLayout.y}px`
    objectivePointer.style.setProperty("--objective-angle", `${pointerLayout.angleDegrees}deg`)
    objectivePointerDistance.textContent = pointerLayout.distanceLabel
  } else objectivePointer.classList.add("hidden")

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
    if (inPublicHub) {
      multiplayer.sendHubMove(move)
      const length = Math.hypot(move.x, move.z)
      if (length > 0.001) {
        state.player.position = resolveSherwoodPlayerMovement(state.player.position, {
          x: (move.x / length) * 5.8 * dt,
          z: (move.z / length) * 5.8 * dt,
        }, PUBLIC_HUB_WORLD_BOUNDS)
      }
    } else if (inHub) {
      const length = Math.hypot(move.x, move.z)
      if (length > 0.001) {
        state.player.position = resolveSherwoodPlayerMovement(state.player.position, {
          x: (move.x / length) * 5.8 * dt,
          z: (move.z / length) * 5.8 * dt,
        }, 20)
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
      if (event === "objective-found") showToast("THE SHERIFF'S SHIPMENT — FOUND")
      if (event === "search-reinforced") showToast(`SEARCH DELAY — SHERIFF PRESSURE ${state.searchPressure}/3`)
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
  const origin = { ...state.player.position }
  state.player.position = resolveSherwoodCombinedMovement(origin, {
    x: (move.x / length) * speed * lootPenalty * dt,
    z: (move.z / length) * speed * lootPenalty * dt,
  }, {
    worldBounds: state.layout.worldBounds,
    layout: state.layout,
    circleBlockers: activeGuardPositions(state.guards),
    circleSeparation: SHERWOOD_GUARD_SEPARATION,
  })
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

joinPublicHubButton.addEventListener("click", () => void (async () => {
  const social = await loadSocialState().catch(() => null)
  if (!social?.session) {
    openPanel(socialPanel, joinPublicHubButton)
    socialStatus.textContent = "Sign in by private email link before opting into the public camp."
    await refreshSocialPanel()
    return
  }
  currentSocial = social
  const displayName = playerNameInput.value.trim().slice(0, 20)
  if (!displayName) return
  localStorage.setItem("sherwood-rebellion:player-name", displayName)
  multiplayer.joinPublicHub(displayName, selectedCharacter)
})())

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
hubBandSave.addEventListener("click", () => {
  const name = hubBandNameInput.value.trim()
  if (!name.match(/^[A-Za-z0-9 _-]{3,28}$/)) {
    showToast("BAND NAME MUST BE 3–28 LETTERS, NUMBERS, SPACES, DASHES OR UNDERSCORES")
    return
  }
  multiplayer.updateBandIdentity(name, hubBandBanner.value as MerryBandState["bannerId"])
})
returnHubButton.addEventListener("click", () => multiplayer.returnToHub())
hubAcceptRescue.addEventListener("click", () => {
  if (currentRescueOffer) multiplayer.acceptRescue(currentRescueOffer.id)
})
hubAbandonRescue.addEventListener("click", () => {
  if (currentRescueOffer) multiplayer.abandonRescue(currentRescueOffer.id)
})
publicHubLooking.addEventListener("click", () => {
  publicHubIsLooking = !publicHubIsLooking
  multiplayer.setHubIntent(publicHubIsLooking, publicHubTarget.value as PublicHubPlayer["targetPreference"], Number(publicHubSize.value) as 2 | 3 | 4)
  renderPublicHub()
})
for (const select of [publicHubTarget, publicHubSize]) select.addEventListener("change", () => {
  if (publicHubIsLooking) multiplayer.setHubIntent(true, publicHubTarget.value as PublicHubPlayer["targetPreference"], Number(publicHubSize.value) as 2 | 3 | 4)
})
publicHubEmotes.forEach((button) => button.addEventListener("click", () => multiplayer.sendHubEmote(button.dataset.hubEmote as "wave" | "cheer" | "bow")))
publicHubPings.forEach((button) => button.addEventListener("click", () => multiplayer.sendHubPing(button.dataset.hubPing as "regroup" | "target")))
publicHubLeave.addEventListener("click", () => {
  multiplayer.leavePublicHub()
  window.setTimeout(() => multiplayer.close(), 80)
  inPublicHub = false
  publicHubIsLooking = false
  publicHubParticipantId = null
  publicHubPlayers = []
  publicHubPanel.classList.add("hidden")
  intro.classList.remove("closed")
  running = false
  ensureRemotePlayers([])
  void syncPresence("available", null)
})
contributionDepositButtons.forEach((button) => button.addEventListener("click", () => {
  const type = button.dataset.contributionType
  if (type === "supplies" || type === "intelligence" || type === "snare-kit" || type === "safe-house") multiplayer.depositContribution(type)
}))

characterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (running) return
    const characterId = button.dataset.character
    if (characterId === "robin" || characterId === "marian" || characterId === "little-john" || characterId === "much") selectLocalCharacter(characterId, true)
  })
})

roleChoiceButtons.forEach((button) => button.addEventListener("click", () => {
  const characterId = button.dataset.roomCharacter
  if (characterId !== "robin" && characterId !== "marian" && characterId !== "little-john" && characterId !== "much") return
  roleChoiceStatus.textContent = `Securing ${characterName(characterId)}…`
  selectLocalCharacter(characterId, true)
}))

function selectLocalCharacter(characterId: CharacterId, notifyServer: boolean): void {
  if (selectedCharacter === characterId) {
    if (notifyServer && multiplayer.playerId) multiplayer.selectCharacter(characterId)
    return
  }
  selectedCharacter = characterId
  characterButtons.forEach((option) => {
    const selected = option.dataset.character === characterId
    option.classList.toggle("selected", selected)
    option.setAttribute("aria-pressed", String(selected))
  })
  state = createInitialState(selectedCharacter)
  lastPlayerPosition = { ...state.player.position }
  disposeObjectInstanceMaterials(playerView)
  scene.remove(playerView)
  playerView = createCharacter(selectedCharacter)
  scene.add(playerView)
  if (notifyServer && multiplayer.playerId) multiplayer.selectCharacter(selectedCharacter)
  updateUI()
}

helpButton.addEventListener("click", () => openPanel(helpPanel, helpButton))
closeHelp.addEventListener("click", () => closePanel(helpPanel))
missionDebugButton.addEventListener("click", () => {
  missionDebug.classList.toggle("hidden")
  updateMissionDebug()
})
if (new URLSearchParams(location.search).get("debug") === "webgl") {
  graphicsRestoreButton.hidden = false
  graphicsRestoreButton.addEventListener("click", () => {
    const extension = renderer.getContext().getExtension("WEBGL_lose_context")
    if (!extension) {
      showToast("Graphics restore test is unavailable")
      return
    }
    extension.loseContext()
    window.setTimeout(() => extension.restoreContext(), 250)
  })
}
leaderboardButton.addEventListener("click", () => void openLeaderboard())
closeLeaderboard.addEventListener("click", () => closePanel(leaderboardPanel))
for (const filter of [boardKind, boardCharacter, boardParty, boardScope, boardMission, boardSeason]) filter.addEventListener("change", () => void openLeaderboard())
closeResults.addEventListener("click", () => closePanel(resultsPanel))
voteButtons.forEach((button) => button.addEventListener("click", () => multiplayer.vote(button.dataset.vote as VoteChoice)))
safetyButton.addEventListener("click", () => openPanel(safetyPanel, safetyButton))
closeSafety.addEventListener("click", () => closePanel(safetyPanel))
socialButton.addEventListener("click", () => {
  openPanel(socialPanel, socialButton)
  void refreshSocialPanel()
})
closeSocial.addEventListener("click", () => closePanel(socialPanel))
socialSignIn.addEventListener("click", () => void (async () => {
  const email = socialEmail.value.trim()
  if (!email) return
  try {
    await sendMagicLink(email)
    socialStatus.textContent = "Sign-in link sent. Return here after opening it; your email stays private."
  } catch (error) { socialStatus.textContent = error instanceof Error ? error.message : "Unable to send sign-in link" }
})())
socialSignOut.addEventListener("click", () => void signOutSocial().then(() => { currentSocial = null; return refreshSocialPanel() }).catch((error) => { socialStatus.textContent = error instanceof Error ? error.message : "Unable to sign out" }))
socialAddFriend.addEventListener("click", () => void sendFriendRequest(socialFriendInput.value).then(async () => {
  socialFriendInput.value = ""
  socialStatus.textContent = "Friend request sent. Duplicate requests are suppressed."
  await refreshSocialPanel()
}).catch((error) => { socialStatus.textContent = error instanceof Error ? error.message : "Unable to send request" }))
socialPresence.addEventListener("change", () => void updateSocialPresence(socialPresence.checked, roomConnected ? "in-band" : "available", roomConnected ? multiplayer.roomCode : null).then(async () => {
  lastPresenceSignature = ""
  await refreshSocialPanel()
}).catch((error) => { socialStatus.textContent = error instanceof Error ? error.message : "Unable to update presence" }))
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
  const activePanel = !roleChoicePanel.classList.contains("hidden")
    ? roleChoicePanel
    : panelElements.find((panel) => !panel.classList.contains("hidden"))
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
    if (!roleChoicePanel.classList.contains("hidden")) return
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
  const terrainHit = terrainView ? raycaster.intersectObject(terrainView, false)[0] : undefined
  const fallbackHit = !terrainHit && raycaster.ray.intersectPlane(groundPlane, clickPoint) ? clickPoint : undefined
  const hitPoint = terrainHit?.point ?? fallbackHit
  if (hitPoint) {
    clickTarget = { x: hitPoint.x, z: hitPoint.z }
    destinationMarker.position.set(hitPoint.x, hitPoint.y + 0.08, hitPoint.z)
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
