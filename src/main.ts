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
import type { BandContribution, ContributionType, LastMissionResult, LoadoutId, MerryBandState, MissionAlarm, MissionCaptive, MissionEvent, MissionKind, MissionLootCache, MissionPreparation, MissionSnapshot, MissionTrap, PingKind, PublicHubPlayer, RescueOffer, RoomPlayer, VillageState, VoteChoice, WorldPing } from "../shared/protocol"
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
import { blockSocialPlayer, loadSocialState, registerSocialProfile, removeFriend, respondDirectInvite, respondFriendRequest, sendDirectInvite, sendFriendRequest, updateSocialPresence, type SocialState } from "./social"
import { currentWalletSession, disconnectRobinhoodWallet, shortWalletAddress, signInWithRobinhoodWallet, walletAddress } from "./wallet-auth"
import { loadAccessState, purchaseTokenPass, type AccessState } from "./token-access"
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
import type { HeroAction } from "./character-visuals"
import { createCharacterVisual, disposeCharacterVisual, poseCharacterVisual } from "./character-assets"
import { HERO_ACTION_DURATIONS, HERO_ATTACK_RELEASE_PROGRESS, normalizedHeroActionProgress } from "./character-animation"
import { cameraRelativeMove, rotateCameraOffset } from "./camera-controls"
import { createGuardVisual, poseGuardVisual, synchronizeGuardVisualsById } from "./guard-visuals"
import { regionCellIndexAt, sherwoodRegionCells, stableSeed, type RegionalMissionLayout } from "../shared/regional-layout"
import { buildRegionMapCells, regionMapCellClassName, type RegionMapCellState } from "./region-map"
import { createAuthoredForestDressing, createForestDressing } from "./forest-dressing"
import { indexNatureCatalog, type NatureCatalog } from "./nature-assets"
import { createSherwoodLandmarks, type SherwoodLandmarks } from "./world-landmarks"
import { composeSherwoodWorld } from "../shared/world-composer"
import {
  SHERWOOD_BRIDGE_CENTER_Y,
  SHERWOOD_BRIDGE_HEIGHT,
  SHERWOOD_BRIDGE_LENGTH,
  SHERWOOD_BRIDGE_ROTATION,
  SHERWOOD_BRIDGE_WIDTH,
  createSherwoodTerrain,
  sherwoodHeightAt,
  sherwoodWalkableHeightAt,
} from "./sherwood-terrain"
import { createProceduralRoads } from "./procedural-roads"
import { createSettlementWorld, disposeSettlementWorld } from "./settlement-renderer"
import { animateObjectiveMarker, createObjectiveMarker, setObjectiveMarkerLabel } from "./objective-marker"
import { computeObjectivePointer, shouldShowMissionCampfireHalo } from "./objective-guidance"
import { missionObjectivePosition } from "../shared/mission-objective"
import { selectRegionalMissionLayout, synchronizeMissionGuards } from "./mission-snapshot-state"
import { createCampfireVisuals } from "./campfire-visuals"
import { createStylizedBuildingVisual } from "./building-visuals"
import { getProductAnalyticsConsent, setProductAnalyticsConsent } from "./analytics-consent"
import { ClientDiagnosticReporter } from "./client-diagnostics"
import { versionedAssetUrl } from "./release"
import type { RoomExperimentAssignment } from "../shared/experiments"
import { buildTutorialPlan, type TutorialLesson, type TutorialPlan } from "./tutorial-content"
import { completeTutorialPlan, loadTutorialProgress, saveTutorialProgress } from "./tutorial-progress"
import type { ChatChannel, ChatErrorCode, ChatMessage, ChatReportReason } from "../shared/chat"
import { ChatState, truncateChatInput } from "./chat-state"

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
const regionMapExpand = document.querySelector<HTMLButtonElement>("#region-map-expand")!
const fieldMapPanel = document.querySelector<HTMLElement>("#field-map-panel")!
const closeFieldMap = document.querySelector<HTMLButtonElement>("#close-field-map")!
const fieldMapGrid = document.querySelector<HTMLElement>("#field-map-grid")!
const fieldMapCount = document.querySelector<HTMLElement>("#field-map-count")!
const tutorialScrim = document.querySelector<HTMLElement>("#tutorial-scrim")!
const tutorialPanel = document.querySelector<HTMLElement>("#tutorial-panel")!
const closeTutorial = document.querySelector<HTMLButtonElement>("#close-tutorial")!
const tutorialEyebrow = document.querySelector<HTMLElement>("#tutorial-eyebrow")!
const tutorialTitle = document.querySelector<HTMLElement>("#tutorial-title")!
const tutorialCopy = document.querySelector<HTMLElement>("#tutorial-copy")!
const tutorialVisual = document.querySelector<HTMLElement>("#tutorial-visual")!
const tutorialPoints = document.querySelector<HTMLUListElement>("#tutorial-points")!
const tutorialTip = document.querySelector<HTMLElement>("#tutorial-tip")!
const tutorialProgressBar = document.querySelector<HTMLElement>(".tutorial-progress")!
const tutorialProgressFill = document.querySelector<HTMLElement>("#tutorial-progress-fill")!
const tutorialStepCount = document.querySelector<HTMLElement>("#tutorial-step-count")!
const tutorialBack = document.querySelector<HTMLButtonElement>("#tutorial-back")!
const tutorialNext = document.querySelector<HTMLButtonElement>("#tutorial-next")!
const replayTutorialButton = document.querySelector<HTMLButtonElement>("#replay-tutorial-button")!
const fieldMapSignalKeys = [...document.querySelectorAll<HTMLElement>("[data-signal-key]")]
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
const walletState = document.querySelector<HTMLElement>("#wallet-state")!
const accessCopy = document.querySelector<HTMLElement>("#access-copy")!
const accessStatus = document.querySelector<HTMLElement>("#access-status")!
const walletSignIn = document.querySelector<HTMLButtonElement>("#wallet-sign-in")!
const walletSignOut = document.querySelector<HTMLButtonElement>("#wallet-sign-out")!
const tokenPassPurchase = document.querySelector<HTMLButtonElement>("#token-pass-purchase")!
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
const gameplayAnalyticsSetting = document.querySelector<HTMLInputElement>("#setting-gameplay-analytics")!
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
const chatButton = document.querySelector<HTMLButtonElement>("#chat-button")!
const chatUnreadBadge = document.querySelector<HTMLElement>("#chat-unread-badge")!
const chatDrawer = document.querySelector<HTMLElement>("#chat-drawer")!
const closeChatButton = document.querySelector<HTMLButtonElement>("#close-chat")!
const chatTabs = [...document.querySelectorAll<HTMLButtonElement>("[data-chat-channel]")]
const chatStatus = document.querySelector<HTMLElement>("#chat-status")!
const chatLog = document.querySelector<HTMLOListElement>("#chat-log")!
const chatNewMessages = document.querySelector<HTMLButtonElement>("#chat-new-messages")!
const chatForm = document.querySelector<HTMLFormElement>("#chat-form")!
const chatInput = document.querySelector<HTMLInputElement>("#chat-input")!
const chatSubmit = chatForm.querySelector<HTMLButtonElement>("button[type='submit']")!
const chatPeek = document.querySelector<HTMLOListElement>("#chat-peek")!
const quickChatForm = document.querySelector<HTMLFormElement>("#quick-chat")!
const quickChatInput = document.querySelector<HTMLInputElement>("#quick-chat-input")!
const quickChatChannel = document.querySelector<HTMLElement>("#quick-chat-channel")!
playerNameInput.value = localStorage.getItem("sherwood-rebellion:player-name") ?? "Greenhood"
const invitedRoom = new URLSearchParams(location.search).get("room")?.trim().toUpperCase()
if (invitedRoom?.match(/^[A-Z2-9]{6}$/)) roomCodeInput.value = invitedRoom
const lastRoomCode = localStorage.getItem("sherwood:last-room-code")
if (lastRoomCode?.match(/^[A-Z2-9]{6}$/)) rejoinRoomButton.classList.remove("hidden")

let inputSettings: InputSettings = loadInputSettings(localStorage)
let diagnosticReporter: ClientDiagnosticReporter | null = null
let lastDiagnosticSnapshotAt = 0

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
renderer.domElement.tabIndex = 0
renderer.domElement.setAttribute("aria-label", "Sherwood game field")
container.appendChild(renderer.domElement)

let selectedCharacter: CharacterId = "robin"
let state = createInitialState(selectedCharacter)
let accessState: AccessState = { gateEnabled: false, authenticated: false, entitled: true, accessExpiresAt: null, referencePriceUsd: 6, payment: null }
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
let roomSessionActive = false
let pendingRoomSelection = false
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
let publicHubCapacity = 12
let localRoleConfirmed = false
let cameraQuarterTurns = 0
let currentExperimentAssignments: RoomExperimentAssignment[] = []
let regionMapRenderSignature = ""
let activeTutorialPlan: TutorialPlan | null = null
let activeTutorialLessonIndex = 0
let activeTutorialContinuation: (() => void) | null = null
let activeTutorialRecordsProgress = false
let activeTutorialShowsTacticalTip = false
let activeTutorialCompletionLabel = "CONTINUE"
let tutorialProgress = loadTutorialProgress(localStorage)
const chatState = new ChatState()
let quickChatActiveChannel: ChatChannel | null = null
let quickChatComposing = false
let fullChatComposing = false
let quickChatCompositionEndedAt = -Infinity
let fullChatCompositionEndedAt = -Infinity
let chatPeekTimer = 0
let chatDrawerReturnFocus: HTMLElement | null = null

const PING_MAP_ICONS: Readonly<Record<PingKind, string>> = Object.freeze({
  danger: "!",
  target: "◎",
  route: "➜",
  loot: "$",
  regroup: "✦",
})

type TutorialSignalAction = "pingDanger" | "pingTarget" | "pingRoute" | "pingLoot" | "pingRegroup"

const TUTORIAL_SIGNALS: readonly { action: TutorialSignalAction; label: string }[] = Object.freeze([
  { action: "pingDanger", label: "DANGER" },
  { action: "pingTarget", label: "TARGET" },
  { action: "pingRoute", label: "ROUTE" },
  { action: "pingLoot", label: "LOOT" },
  { action: "pingRegroup", label: "REGROUP" },
])

const guardViews: THREE.Group[] = []
const lastGuardPositions = new Map<number, Vec2>()
const guardMovingUntil = new Map<number, number>()
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
  actionStartedAt: number
  actionUntil: number
  lastArrows: number
  lastSignatureCooldown: number
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
const missionCampfire = createCampfireVisuals({ degraded: renderProfile.tier === "degraded" })
let missionCampfireHalo: THREE.Mesh | null = null
let windmillRotor: THREE.Group | null = null
let landmarkViews: SherwoodLandmarks | null = null
let forestDressingView: THREE.Group | null = null
let composedWorldView: THREE.Group | null = null
let composedRoadView: THREE.Group | null = null
let settlementWorldView: THREE.Group | null = null
let composedWorldLayoutKey = ""
let terrainView: THREE.Mesh | null = null
const HUB_CAMPFIRE_POSITION = Object.freeze({ x: -11, z: 9 })
const mutedPlayerIds = new Set<string>()
const blockedPlayerIds = new Set<string>()
const gltfLoader = new GLTFLoader()
let treeCatalogAssetPromise: Promise<THREE.Group> | null = null
let villageAssetPromise: Promise<THREE.Group> | null = null
let villageCatalogSource: THREE.Group | null = null
let medievalPropsPromise: Promise<THREE.Group> | null = null
let medievalPropsCatalogSource: THREE.Group | null = null
let natureCatalogPromise: Promise<NatureCatalog> | null = null
let natureCatalogSource: NatureCatalog | null = null
let treasureChestPromise: Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> | null = null
let bowCacheLoadGeneration = 0
const bowCacheAnimations: Array<{ view: THREE.Group; mixer: THREE.AnimationMixer; open: THREE.AnimationAction }> = []
let villageCottageFallback: THREE.Group | null = null
let villageCottageView: THREE.Group | null = null
let proceduralWagonShellView: THREE.Group | null = null
let villageWagonShellView: THREE.Group | null = null
let heroAttackUntil = 0
let heroSignatureUntil = 0
let heroAttackStartedAt = 0
let heroSignatureStartedAt = 0
let pendingLocalShot: { releaseAt: number; multiplayer: boolean } | null = null

function beginLocalHeroAction(action: Exclude<HeroAction, "idle">): void {
  const now = clock.elapsedTime
  if (action === "attack") {
    heroAttackStartedAt = now
    heroAttackUntil = now + HERO_ACTION_DURATIONS.attack
    return
  }
  heroSignatureStartedAt = now
  heroSignatureUntil = now + HERO_ACTION_DURATIONS.signature
}

function beginRemoteHeroAction(
  remote: RemoteView,
  action: Exclude<HeroAction, "idle">,
  initialProgress = 0,
): void {
  const now = clock.elapsedTime
  const progress = THREE.MathUtils.clamp(initialProgress, 0, 1)
  const startedAt = now - HERO_ACTION_DURATIONS[action] * progress
  remote.action = action
  remote.actionStartedAt = startedAt
  remote.actionUntil = startedAt + HERO_ACTION_DURATIONS[action]
}

function ensureRemoteHeroAction(
  remote: RemoteView,
  action: Exclude<HeroAction, "idle">,
  initialProgress = 0,
): void {
  if (remote.action === action && clock.elapsedTime < remote.actionUntil) return
  beginRemoteHeroAction(remote, action, initialProgress)
}

function resetLocalHeroActions(): void {
  heroAttackStartedAt = 0
  heroAttackUntil = 0
  heroSignatureStartedAt = 0
  heroSignatureUntil = 0
  pendingLocalShot = null
}

function resetMissionRuntimeState(): void {
  latestMissionSnapshot = null
  lastMissionEventSequence = 0
  localDownedFor = 0
  lastGuardPositions.clear()
  guardMovingUntil.clear()
  for (const remote of remoteViews.values()) {
    remote.action = "idle"
    remote.actionStartedAt = 0
    remote.actionUntil = 0
  }
}

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
  const hut = createStylizedBuildingVisual({
    id: `CampCottage:${x}:${z}`,
    kind: "cottage",
    palette: "village",
    width: 3.2,
    depth: 2.6,
  }, { castShadow: renderProfile.shadows })
  hut.position.set(x, sherwoodHeightAt(x, z), z)
  hut.rotation.y = rotation
  scene.add(hut)
  cameraOccluders.push({ view: hut, radius: 2.2 })
  return hut
}

function positionMissionCampfire(anchor: Vec2): void {
  missionCampfireView.position.set(anchor.x, sherwoodHeightAt(anchor.x, anchor.z), anchor.z)
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
  villageCircle.name = "MissionCampfireHalo"
  villageCircle.position.set(0, 0.06, 0)
  villageCircle.rotation.x = Math.PI / 2
  villageCircle.visible = false
  missionCampfireHalo = villageCircle
  missionCampfireView.add(villageCircle, missionCampfire.group)
  positionMissionCampfire(state.layout.campfirePosition)
  scene.add(missionCampfireView)

  const exclusions = sherwoodRegionCells().map((cell) => ({ x: cell.center.x, z: cell.center.z, radius: 8.5 }))
  const dressing = createForestDressing({ degraded: renderProfile.tier === "degraded", exclusions })
  forestDressingView = dressing.group
  scene.add(dressing.group)

  rebuildLandmarks(state.layout)
  rebuildComposedWorld(state.layout)
}

function rebuildLandmarks(layout: RegionalMissionLayout): void {
  if (landmarkViews) {
    landmarkViews.dispose()
    scene.remove(landmarkViews.group)
  }
  landmarkViews = createSherwoodLandmarks(layout, { natureCatalog: natureCatalogSource ?? undefined })
  windmillRotor = landmarkViews.windmillRotor
  scene.add(landmarkViews.group)
}

function disposeOwnedMeshResources(view: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>()
  view.traverse((object) => {
    if (object instanceof THREE.Mesh) geometries.add(object.geometry)
  })
  geometries.forEach((geometry) => geometry.dispose())
  disposeObjectInstanceMaterials(view)
}

function rebuildComposedWorld(layout: RegionalMissionLayout, force = false): void {
  const pointKey = (point: Vec2): string => `${point.x}:${point.z}`
  const key = [layout.campfirePosition, layout.objectivePosition, ...layout.crossingPositions].map(pointKey).join("|")
  if (!force && key === composedWorldLayoutKey) return
  const composed = composeSherwoodWorld(layout)
  const nextRoadView = createProceduralRoads(composed.roads)
  let nextSettlementView: THREE.Group
  try {
    nextSettlementView = createSettlementWorld(composed, {
      villageCatalog: villageCatalogSource ?? undefined,
      castShadow: renderProfile.shadows,
    })
  } catch (error) {
    disposeOwnedMeshResources(nextRoadView)
    throw error
  }
  const nextWorldView = new THREE.Group()
  nextWorldView.name = "ComposedSherwoodWorld"
  nextWorldView.add(nextRoadView, nextSettlementView)

  if (composedWorldView) scene.remove(composedWorldView)
  if (settlementWorldView) disposeSettlementWorld(settlementWorldView)
  if (composedRoadView) disposeOwnedMeshResources(composedRoadView)
  composedWorldLayoutKey = key
  composedWorldView = nextWorldView
  composedRoadView = nextRoadView
  settlementWorldView = nextSettlementView
  scene.add(nextWorldView)
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
  disposeOwnedMeshResources(crossingInfrastructure)
  crossingInfrastructure.clear()
  const riverNormal = { x: Math.cos(0.1), z: Math.sin(0.1) }
  for (const crossing of layout.crossingPositions) {
    const crossingView = new THREE.Group()
    crossingView.name = `SherwoodBridge:${crossing.x}:${crossing.z}`
    crossingView.position.set(crossing.x, 0, crossing.z)
    crossingView.rotation.y = SHERWOOD_BRIDGE_ROTATION
    const bridge = mesh(
      new THREE.BoxGeometry(SHERWOOD_BRIDGE_LENGTH, SHERWOOD_BRIDGE_HEIGHT, SHERWOOD_BRIDGE_WIDTH),
      0x8b653d,
    )
    bridge.position.y = SHERWOOD_BRIDGE_CENTER_Y
    crossingView.add(bridge)
    for (let index = -3; index <= 3; index += 1) {
      const plank = mesh(new THREE.BoxGeometry(0.12, 0.1, SHERWOOD_BRIDGE_WIDTH + 0.25), 0x4b382a)
      plank.position.set(index, 0.38, 0)
      crossingView.add(plank)
    }
    crossingInfrastructure.add(crossingView)
  }
  for (const origin of [layout.campfirePosition, layout.objectivePosition]) {
    const nearest = [...layout.crossingPositions].sort((left, right) => Math.hypot(origin.x - left.x, origin.z - left.z) - Math.hypot(origin.x - right.x, origin.z - right.z))[0]
    const side = origin.x + 0.1 * origin.z - 1 >= 0 ? 1 : -1
    const bankApproach = { x: nearest.x + riverNormal.x * side * 4.6, z: nearest.z + riverNormal.z * side * 4.6 }
    addRoadSegment(origin, bankApproach)
  }
}

function clearBowCacheInfrastructure(): void {
  for (const animation of bowCacheAnimations) {
    animation.mixer.stopAllAction()
    animation.mixer.uncacheRoot(animation.view)
  }
  bowCacheAnimations.length = 0
  for (const child of bowCacheInfrastructure.children) {
    if (child.userData.sherwoodSharedGeometry === true) disposeObjectInstanceMaterials(child)
    else disposeOwnedMeshResources(child)
  }
  bowCacheInfrastructure.clear()
}

function rebuildBowCaches(layout: RegionalMissionLayout): void {
  const generation = ++bowCacheLoadGeneration
  clearBowCacheInfrastructure()
  for (const [index, position] of layout.bowCachePositions.entries()) {
    const cache = new THREE.Group()
    cache.userData.sherwoodOwnedGeometry = true
    const crate = mesh(new THREE.BoxGeometry(1.4, 0.62, 0.85), 0x6d4b2c)
    crate.position.y = 0.32
    const band = mesh(new THREE.BoxGeometry(1.48, 0.1, 0.92), 0xd1a94b)
    band.position.y = 0.5
    const { bow } = createArcheryEquipment(index % 2 === 0 ? "longbow" : "shortbow", 0.72)
    bow.position.set(0, 0.9, 0)
    bow.rotation.set(Math.PI / 2, 0, Math.PI / 2)
    cache.add(crate, band, bow)
    cache.position.set(position.x, sherwoodHeightAt(position.x, position.z), position.z)
    cache.rotation.y = index * 1.3
    bowCacheInfrastructure.add(cache)
  }

  treasureChestPromise ??= gltfLoader.loadAsync(versionedAssetUrl("/assets/props/treasure-chest.glb"))
    .then((asset) => ({ scene: convertObjectToToon(asset.scene), animations: asset.animations }))
    .catch((error) => {
      void diagnosticReporter?.report("asset_load_failed", error)
      throw error
    })
  void treasureChestPromise.then((asset) => {
    if (generation !== bowCacheLoadGeneration) return
    clearBowCacheInfrastructure()
    const openClip = asset.animations.find((clip) => clip.name.includes("burst_open"))
      ?? asset.animations.find((clip) => clip.name.includes("open_anim"))
    for (const [index, position] of layout.bowCachePositions.entries()) {
      const chest = cloneSkeleton(asset.scene) as THREE.Group
      cloneObjectMaterialsForInstance(chest)
      chest.userData.sherwoodSharedGeometry = true
      chest.updateMatrixWorld(true)
      const bounds = new THREE.Box3().setFromObject(chest)
      const largestDimension = Math.max(0.001, bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z)
      chest.scale.setScalar(1.65 / largestDimension)
      chest.updateMatrixWorld(true)
      const grounded = new THREE.Box3().setFromObject(chest)
      chest.position.set(position.x, sherwoodHeightAt(position.x, position.z) - grounded.min.y, position.z)
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

function createCharacter(role: CharacterId): THREE.Group {
  return createCharacterVisual(role)
}

function loadTreeCatalog(): Promise<THREE.Group> {
  treeCatalogAssetPromise ??= gltfLoader.loadAsync(versionedAssetUrl("/assets/environment/sherwood-tree-catalog.glb"))
    .then((asset) => convertObjectToToon(asset.scene))
    .catch((error) => { void diagnosticReporter?.report("asset_load_failed", error); throw error })
  return treeCatalogAssetPromise
}

function loadVillageCatalog(): Promise<THREE.Group> {
  villageAssetPromise ??= gltfLoader.loadAsync(versionedAssetUrl("/assets/environment/sherwood-village-slice.glb"))
    .then((asset) => convertObjectToToon(asset.scene))
    .catch((error) => { void diagnosticReporter?.report("asset_load_failed", error); throw error })
  return villageAssetPromise
}

function loadMedievalProps(): Promise<THREE.Group> {
  medievalPropsPromise ??= gltfLoader.loadAsync(versionedAssetUrl("/assets/environment/craftpix-medieval-props.glb"))
    .then((asset) => convertObjectToToon(asset.scene))
    .catch((error) => { void diagnosticReporter?.report("asset_load_failed", error); throw error })
  return medievalPropsPromise
}

function loadNatureCatalog(): Promise<NatureCatalog> {
  natureCatalogPromise ??= gltfLoader.loadAsync(versionedAssetUrl("/assets/environment/sherwood-nature-dressing.glb"))
    .then((asset) => indexNatureCatalog(convertObjectToToon(asset.scene)))
    .catch((error) => { void diagnosticReporter?.report("asset_load_failed", error); throw error })
  return natureCatalogPromise
}

function attachNatureDressing(): void {
  void loadNatureCatalog().then((catalog) => {
    natureCatalogSource = catalog
    const exclusions = sherwoodRegionCells().map((cell) => ({ x: cell.center.x, z: cell.center.z, radius: 8.5 }))
    const authored = createAuthoredForestDressing(catalog, { degraded: renderProfile.tier === "degraded", exclusions })
    if (forestDressingView) {
      scene.remove(forestDressingView)
      disposeOwnedMeshResources(forestDressingView)
    }
    forestDressingView = authored.group
    scene.add(authored.group)
    rebuildLandmarks(state.layout)
  }).catch(() => showToast("Textured forest dressing could not be loaded; using the lightweight fallback"))
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
    medievalPropsCatalogSource = catalog
    for (const [name, x, z, rotation] of placements) {
      const source = catalog.getObjectByName(name)
      if (!source) continue
      const prop = source.clone(true)
      prop.position.set(x, sherwoodHeightAt(x, z), z)
      prop.rotation.y = rotation
      prop.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return
        child.castShadow = true
        child.receiveShadow = true
      })
      medievalPropViews.push(prop)
      scene.add(prop)
    }
    if (latestMissionSnapshot) {
      syncLootCacheViews([])
      syncLootCacheViews(latestMissionSnapshot.lootCaches)
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
    cottage.position.set(-10, sherwoodHeightAt(-10, 14), 14)
    cottage.rotation.y = -0.55
    cottage.visible = false
    const wagonShell = prepareVillageRuntimeObject(createVillageWagonShell(source))
    wagonShell.visible = false

    villageCatalogSource = source
    try {
      rebuildComposedWorld(state.layout, true)
    } catch (error) {
      villageCatalogSource = null
      throw error
    }

    villageCottageView = cottage
    cameraOccluders.push({ view: cottage, radius: 3.2 })
    scene.add(cottage)
    villageWagonShellView = wagonShell
    cart.add(wagonShell)
  }).catch((error) => {
    villageCatalogSource = null
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
  const x = HUB_CAMPFIRE_POSITION.x + 3.4
  const z = HUB_CAMPFIRE_POSITION.z - 0.4
  board.position.set(x, sherwoodHeightAt(x, z), z)
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
attachNatureDressing()

let playerView = createCharacter(selectedCharacter)
scene.add(playerView)
state.guards.forEach((guardState) => {
  const guard = createGuardVisual(guardState.id)
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
    blockedPlayerIds.clear()
    mutedPlayerIds.clear()
    chatState.reset()
    closeQuickChat(false)
    closeChatDrawer(false)
    inPublicHub = false
    publicHubIsLooking = false
    publicHubPlayers = []
    publicHubParticipantId = null
    publicHubPanel.classList.add("hidden")
    roomConnected = true
    roomSessionActive = true
    localReady = false
    localRoleConfirmed = false
    pendingRoomSelection = false
    currentRoomPlayers = []
    localStorage.setItem("sherwood:last-room-code", roomCode)
    lobbyCode.textContent = roomCode
    missionRoomCode.textContent = roomCode
    hubRoomCode.textContent = roomCode
    roomCodeInput.value = roomCode
    roomLobby.classList.remove("hidden")
    lobbyStatus.textContent = "Choose an outlaw, then ready up together."
    enterHub(true)
    renderChatChrome()
    void syncPresence("in-band", roomCode)
  },
  onRoomState: (_roomCode, phase, players, missionSlug, village, lastResult, nextSelectedRotationId, nextRotationsPaused, nextRotations, nextUpcomingRotations, rescueOffer, contributions, nextSelectedContributionIds, season, band) => {
    pendingRoomSelection = false
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
      const enteringMission = inHub
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
      if (enteringMission) queueMicrotask(() => renderer.domElement.focus())
    }
  },
  onSnapshot: (_tick, players, mission) => {
    const receivedAt = performance.now()
    if (lastDiagnosticSnapshotAt > 0 && receivedAt - lastDiagnosticSnapshotAt >= 1_500) void diagnosticReporter?.report("snapshot_desync")
    lastDiagnosticSnapshotAt = receivedAt
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
        if (remote) {
          remote.downedFor = player.downedFor
          if (player.arrows < remote.lastArrows) beginRemoteHeroAction(remote, "attack", HERO_ATTACK_RELEASE_PROGRESS)
          if (player.signatureCooldown > remote.lastSignatureCooldown + 0.25) beginRemoteHeroAction(remote, "signature")
          remote.lastArrows = player.arrows
          remote.lastSignatureCooldown = player.signatureCooldown
        }
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
    if (pendingRoomSelection) {
      pendingRoomSelection = false
      if (inHub) renderHub()
      if (!roleChoicePanel.classList.contains("hidden")) renderRoleChoice(currentRoomPlayers)
    }
    lobbyStatus.textContent = message
    showToast(message)
  },
  onConnection: (connected) => {
    roomConnected = connected
    lobbyStatus.textContent = connected ? "Connected to Sherwood" : "Connection lost — reconnect with the same code"
    if (inHub) renderHub()
    if (!connected) closeQuickChat(false)
    renderChatChrome()
    if (!connected) void syncPresence("available", null)
  },
  onHubWelcome: (_instanceId, participantId, capacity) => {
    blockedPlayerIds.clear()
    mutedPlayerIds.clear()
    chatState.reset()
    closeQuickChat(false)
    closeChatDrawer(false)
    roomSessionActive = false
    inPublicHub = true
    inHub = false
    multiplayerActive = false
    publicHubParticipantId = participantId
    publicHubCapacity = capacity
    running = true
    intro.classList.add("closed")
    hubPanel.classList.add("hidden")
    publicHubPanel.classList.remove("hidden")
    partyHud.classList.add("hidden")
    resetMissionRuntimeState()
    resetLocalHeroActions()
    setMissionWorldVisible(false)
    positionMissionCampfire(HUB_CAMPFIRE_POSITION)
    positionVillageUpgrades(HUB_CAMPFIRE_POSITION)
    objectiveElement.textContent = "Meet outlaws and form a private band"
    renderChatChrome()
    void syncPresence("available", null)
  },
  onHubState: (players) => {
    publicHubPlayers = players
    const local = players.find((player) => player.id === publicHubParticipantId)
    if (local) state.player.position = { ...local.position }
    const remotes = players.filter((player) => player.id !== publicHubParticipantId && !blockedPlayerIds.has(player.id)).map(hubPlayerAsRoomPlayer)
    ensureRemotePlayers(remotes)
    const receivedAt = performance.now()
    for (const player of remotes) remoteViews.get(player.id)?.snapshots.push(player.position, receivedAt)
    renderPublicHub()
  },
  onExperiments: (assignments) => {
    currentExperimentAssignments = assignments
    updateMissionDebug()
  },
  onChatHistory: receiveChatHistory,
  onChatMessage: receiveChatMessage,
  onChatError: receiveChatError,
})

diagnosticReporter = new ClientDiagnosticReporter(
  (diagnostic) => multiplayer.sendDiagnostic(diagnostic),
  () => renderProfile.tier,
)
diagnosticReporter.installWindowHandlers()

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
    button.disabled = full || pendingRoomSelection
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
  positionMissionCampfire(layout.campfirePosition)
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
  const online = roomSessionActive
  const isLeader = !online || currentRoomPlayers[0]?.id === multiplayer.playerId
  missionTitle.textContent = getMissionDefinition(currentMissionSlug).name.toUpperCase()
  hubRotations.replaceChildren()
  for (const rotation of currentRotations) {
    const mission = getMissionDefinition(rotation.missionSlug)
    const button = document.createElement("button")
    button.classList.toggle("selected", rotation.id === selectedRotationId)
    button.disabled = !online || !roomConnected || !isLeader || rotationsPaused
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
    empty.textContent = online ? "The Sheriff has posted no valid target." : "Form a band to load today's server-owned targets."
    hubRotations.append(empty)
  }
  renderRotationCountdown()
  renderRescueOffer()
  renderContributions()
  renderSeason()
  hubMissions.replaceChildren()
  for (const mission of MISSION_CATALOG.values()) {
    const missionKind = mission.scenario?.kind ?? "tax-cart"
    const bandOnly = !online && missionKind !== "tax-cart"
    const button = document.createElement("button")
    button.classList.toggle("selected", mission.slug === currentMissionSlug)
    button.disabled = (online && (!roomConnected || !isLeader || pendingRoomSelection)) || bandOnly
    const name = document.createElement("b")
    const detail = document.createElement("small")
    name.textContent = mission.name
    detail.textContent = bandOnly
      ? `BAND REQUIRED · ${mission.routes.entry.length} approaches · ${Math.round(mission.mastery.parSeconds / 60)} min par`
      : `${mission.routes.entry.length} approaches · ${Math.round(mission.mastery.parSeconds / 60)} min par · v${mission.missionVersion}`
    if (bandOnly) button.title = "This mission currently requires a multiplayer Merry Band"
    button.append(name, detail)
    button.addEventListener("click", () => {
      if (online) {
        pendingRoomSelection = true
        renderHub()
        multiplayer.selectMission(mission.slug)
      }
      else {
        currentMissionSlug = mission.slug
        renderHub()
      }
    })
    hubMissions.append(button)
  }
  for (const button of hubRoles) {
    button.classList.toggle("selected", button.dataset.hubCharacter === selectedCharacter)
    button.disabled = online && (!roomConnected || pendingRoomSelection)
  }
  hubLoadout.disabled = online && !roomConnected
  hubRoomCode.textContent = online ? multiplayer.roomCode ?? "------" : "SOLO"
  hubCopyCode.disabled = !online || !roomConnected
  hubReady.textContent = online ? (localReady ? "NOT READY" : "READY UP") : "START MISSION"
  hubReady.disabled = online && (!roomConnected || !localRoleConfirmed || pendingRoomSelection)
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
  hubState.textContent = online
    ? roomConnected
      ? `${isLeader ? "Band leader chooses the target." : "The band leader chooses the target."} Ready together when roles and kits are set.`
      : "Connection lost · returning to this camp before any readiness can change."
    : "Start the People's Purse solo, or form a Merry Band for the prison wagon and storehouse."
}

function renderPublicHub(): void {
  const visiblePlayers = publicHubPlayers.filter((player) => !blockedPlayerIds.has(player.id))
  publicHubCount.textContent = `${visiblePlayers.length}/12`
  publicHubLooking.textContent = publicHubIsLooking ? "CANCEL SEARCH" : "FIND A BAND"
  const desiredPartySize = Number(publicHubSize.value)
  const compatible = visiblePlayers.filter((player) => player.id !== publicHubParticipantId && player.looking && player.desiredPartySize === desiredPartySize && (publicHubTarget.value === "any" || player.targetPreference === "any" || player.targetPreference === publicHubTarget.value)).length
  publicHubList.replaceChildren()
  for (const player of visiblePlayers) {
    const item = document.createElement("li")
    const copy = document.createElement("div")
    const name = document.createElement("span")
    const detail = document.createElement("small")
    const showSignals = !mutedPlayerIds.has(player.id)
    name.textContent = `${player.displayName} · ${characterName(player.characterId)}${showSignals && player.emote ? ` · ${player.emote.toUpperCase()}` : ""}${showSignals && player.ping ? ` · ${player.ping.toUpperCase()}!` : ""}`
    detail.textContent = player.looking ? `LOOKING · ${player.targetPreference.replaceAll("-", " ")} · ${player.desiredPartySize}P` : "At the fire"
    copy.append(name, detail)
    const actions = document.createElement("div")
    if (player.id !== publicHubParticipantId) {
      const mute = document.createElement("button")
      mute.textContent = mutedPlayerIds.has(player.id) ? "UNMUTE" : "MUTE"
      mute.addEventListener("click", () => {
        if (mutedPlayerIds.has(player.id)) mutedPlayerIds.delete(player.id)
        else {
          mutedPlayerIds.add(player.id)
          chatState.markPlayerRead(player.id)
        }
        renderPublicHub()
        renderChatHistory(false)
        renderChatPeek()
      })
      const report = document.createElement("button")
      report.textContent = "REPORT"
      report.addEventListener("click", () => { multiplayer.reportHubPlayer(player.id, "griefing"); publicHubStatus.textContent = "Fixed-reason player report recorded." })
      const block = document.createElement("button")
      block.textContent = "BLOCK"
      block.addEventListener("click", () => {
        blockedPlayerIds.add(player.id)
        mutedPlayerIds.add(player.id)
        chatState.markPlayerRead(player.id)
        multiplayer.blockHubPlayer(player.id)
        renderPublicHub()
        renderChatHistory(false)
        renderChatPeek()
        ensureRemotePlayers(publicHubPlayers.filter((candidate) => candidate.id !== publicHubParticipantId && !blockedPlayerIds.has(candidate.id)).map(hubPlayerAsRoomPlayer))
        publicHubStatus.textContent = "Blocked player hidden from this public camp."
      })
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
    hubRotationState.textContent = roomSessionActive ? "Waiting for a valid target schedule." : "Daily targets are server-owned."
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
    empty.textContent = roomSessionActive ? "No shared preparations yet." : "Online bands can leave bounded preparations here."
    hubContributionList.append(empty)
  }
  hubContributionState.textContent = roomSessionActive
    ? roomConnected
      ? `${selectedContributionIds.length}/3 selected for the next mission · ${available.length}/6 available · readiness locks the set.`
      : "Reconnecting before shared preparations can change."
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
  const enteringHub = !inHub
  inHub = true
  multiplayerActive = false
  roomSessionActive = online
  if (!online) roomConnected = false
  if (!online) currentMissionSlug = PEOPLES_PURSE_MISSION.slug
  running = true
  ended = false
  resetMissionRuntimeState()
  resetLocalHeroActions()
  state.won = false
  state.lost = false
  intro.scrollTop = 0
  intro.classList.add("closed")
  resultsPanel.classList.add("hidden")
  resultsPanel.setAttribute("aria-hidden", "true")
  hubPanel.classList.remove("hidden")
  partyHud.classList.toggle("hidden", !online)
  setMissionWorldVisible(false)
  positionMissionCampfire(HUB_CAMPFIRE_POSITION)
  positionVillageUpgrades(HUB_CAMPFIRE_POSITION)
  objectiveElement.textContent = "Choose the band's next target"
  missionModifiers.textContent = `${MISSION_CATALOG.size} TRUSTED MISSION${MISSION_CATALOG.size === 1 ? "" : "S"} ON THE BOARD`
  if (!online) state.player.position = { ...PEOPLES_PURSE_MISSION.spawns.players[0] }
  lastPlayerPosition = { ...state.player.position }
  renderHub()
  clock.getDelta()
  if (enteringHub && roleChoicePanel.classList.contains("hidden")) queueMicrotask(() => hubReady.focus())
}

function startSoloMission(): void {
  if (missionKindForSlug(currentMissionSlug) !== "tax-cart") {
    currentMissionSlug = PEOPLES_PURSE_MISSION.slug
    renderHub()
    showToast("PRISON WAGON AND STOREHOUSE MISSIONS REQUIRE A MERRY BAND")
    return
  }
  inHub = false
  multiplayerActive = false
  hubPanel.classList.add("hidden")
  setMissionWorldVisible(true)
  soloRunSequence += 1
  state = createInitialState(selectedCharacter, stableSeed(`solo:${Date.now()}:${soloRunSequence}`))
  resetMissionRuntimeState()
  applyRegionalLayout(state.layout)
  resetLocalHeroActions()
  ended = false
  resultSubmitted = false
  missionTarget = DELIVERY_TARGET
  objectiveElement.textContent = "Search Sherwood for the Sheriff's shipment"
  missionModifiers.textContent = ""
  clock.getDelta()
  queueMicrotask(() => renderer.domElement.focus())
}

const controllerActions = GAME_ACTIONS.filter((action) => !action.startsWith("move")) as Array<keyof InputSettings["controller"]>
const panelElements = [helpPanel, leaderboardPanel, resultsPanel, safetyPanel, settingsPanel, socialPanel, tutorialPanel, fieldMapPanel]
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

function missionKindForSlug(slug: string): MissionKind {
  return getMissionDefinition(slug).scenario?.kind ?? "tax-cart"
}

function resetActiveTutorial(): void {
  activeTutorialPlan = null
  activeTutorialLessonIndex = 0
  activeTutorialContinuation = null
  activeTutorialRecordsProgress = false
  activeTutorialShowsTacticalTip = false
  activeTutorialCompletionLabel = "CONTINUE"
}

function renderTutorialVisual(lesson: TutorialLesson): void {
  tutorialVisual.replaceChildren()
  if (lesson.visual === "signals") {
    const ribbon = document.createElement("div")
    ribbon.className = "tutorial-signal-ribbon"
    for (const signal of TUTORIAL_SIGNALS) {
      const item = document.createElement("span")
      const key = document.createElement("kbd")
      key.textContent = keyLabel(inputSettings.keyboard[signal.action])
      item.append(key, signal.label)
      ribbon.append(item)
    }
    tutorialVisual.append(ribbon)
    return
  }
  if (lesson.visual === "character") {
    const mark = document.createElement("div")
    mark.className = "tutorial-character-mark"
    mark.textContent = ({ robin: "RH", marian: "MM", "little-john": "LJ", much: "M" } as const)[activeTutorialPlan?.characterId ?? selectedCharacter]
    tutorialVisual.append(mark)
    return
  }
  const map = document.createElement("div")
  map.className = "tutorial-visual-map"
  const route = new Set([20, 16, 12, 8, 4])
  for (let index = 0; index < 25; index += 1) {
    const cell = document.createElement("i")
    cell.classList.toggle("seen", route.has(index))
    if (index === 20) cell.textContent = "▲"
    else if (index === 12) {
      cell.classList.add("signal")
      cell.textContent = "!"
    } else if (index === 4) cell.textContent = "◆"
    map.append(cell)
  }
  tutorialVisual.append(map)
}

function renderTutorialStep(): void {
  const plan = activeTutorialPlan
  if (!plan) return
  const lesson = plan.lessons[activeTutorialLessonIndex]
  const lastStep = activeTutorialLessonIndex === plan.lessons.length - 1
  tutorialEyebrow.textContent = lesson.eyebrow
  tutorialTitle.textContent = lesson.title
  tutorialCopy.textContent = lesson.body
  const lessonPoints = lesson.moduleId === "fieldcraft"
    ? lesson.points.map((point, index) => {
        const signal = TUTORIAL_SIGNALS[index]
        return signal ? point.replace(/^\d+/, keyLabel(inputSettings.keyboard[signal.action])) : point
      })
    : lesson.points
  const points = lesson.moduleId === "fieldcraft"
    ? [
        `${keyLabel(inputSettings.keyboard.moveUp)} / ${keyLabel(inputSettings.keyboard.moveLeft)} / ${keyLabel(inputSettings.keyboard.moveDown)} / ${keyLabel(inputSettings.keyboard.moveRight)} move by perspective · ${keyLabel(inputSettings.keyboard.cameraLeft)} / ${keyLabel(inputSettings.keyboard.cameraRight)} rotate 90° · ${keyLabel(inputSettings.keyboard.interact)} interacts · ${keyLabel(inputSettings.keyboard.fire)} fires · ${keyLabel(inputSettings.keyboard.signature)} uses your signature.`,
        ...lessonPoints,
      ]
    : lessonPoints
  tutorialPoints.replaceChildren(...points.map((point) => {
    const item = document.createElement("li")
    item.textContent = point
    return item
  }))
  renderTutorialVisual(lesson)
  tutorialTip.classList.toggle("hidden", !lastStep || !activeTutorialShowsTacticalTip)
  tutorialTip.textContent = lastStep && activeTutorialShowsTacticalTip
    ? `${plan.tacticalTip.label} — ${plan.tacticalTip.body}`
    : ""
  tutorialBack.disabled = activeTutorialLessonIndex === 0
  tutorialNext.textContent = lastStep ? activeTutorialCompletionLabel : "CONTINUE"
  tutorialStepCount.textContent = `${activeTutorialLessonIndex + 1} / ${plan.lessons.length}`
  tutorialProgressFill.style.width = `${((activeTutorialLessonIndex + 1) / plan.lessons.length) * 100}%`
  tutorialProgressBar.setAttribute("aria-valuemax", String(plan.lessons.length))
  tutorialProgressBar.setAttribute("aria-valuenow", String(activeTutorialLessonIndex + 1))
}

function openTutorial(
  plan: TutorialPlan,
  options: {
    continuation?: () => void
    completionLabel: string
    recordProgress: boolean
    showTacticalTip: boolean
    trigger: HTMLElement
  },
): void {
  activeTutorialPlan = plan
  activeTutorialLessonIndex = 0
  activeTutorialContinuation = options.continuation ?? null
  activeTutorialRecordsProgress = options.recordProgress
  activeTutorialShowsTacticalTip = options.showTacticalTip
  activeTutorialCompletionLabel = options.completionLabel
  renderTutorialStep()
  openPanel(tutorialPanel, options.trigger)
}

function finishTutorial(): void {
  const plan = activeTutorialPlan
  if (!plan) return
  const continuation = activeTutorialContinuation
  let saved = true
  if (activeTutorialRecordsProgress) {
    tutorialProgress = completeTutorialPlan(tutorialProgress, plan)
    saved = saveTutorialProgress(localStorage, tutorialProgress)
  }
  closePanel(tutorialPanel)
  if (!saved) showToast("FIELD LESSON COMPLETE · PROGRESS COULD NOT BE SAVED")
  continuation?.()
}

function runCampfireTutorialGate(action: () => void, trigger: HTMLElement, completionLabel: string): void {
  const fullPlan = buildTutorialPlan(selectedCharacter, missionKindForSlug(currentMissionSlug), tutorialProgress.completed)
  const lessons = fullPlan?.lessons.filter((lesson) => lesson.moduleId === "fieldcraft" || lesson.moduleId === `character:${selectedCharacter}`) ?? []
  if (!fullPlan || lessons.length === 0) {
    action()
    return
  }
  const plan: TutorialPlan = { ...fullPlan, lessons, moduleIds: lessons.map((lesson) => lesson.moduleId) }
  openTutorial(plan, {
    continuation: () => runCampfireTutorialGate(action, trigger, completionLabel),
    completionLabel,
    recordProgress: true,
    showTacticalTip: false,
    trigger,
  })
}

function requestMissionReady(trigger: HTMLElement): void {
  if (roomSessionActive && !roomConnected) {
    showToast("RETURNING TO YOUR BAND · READY AGAIN WHEN RECONNECTED")
    renderHub()
    return
  }
  if (pendingRoomSelection) {
    showToast("WAITING FOR THE BAND'S TARGET AND OUTLAW CHOICES")
    return
  }
  if (roomSessionActive) {
    const localPlayer = currentRoomPlayers.find((player) => player.id === multiplayer.playerId)
    if (!localPlayer?.roleConfirmed) {
      showToast("SECURE AN AVAILABLE OUTLAW BEFORE READYING")
      renderRoleChoice(currentRoomPlayers)
      return
    }
    if (localPlayer.characterId !== selectedCharacter) selectLocalCharacter(localPlayer.characterId, false)
  }
  if (roomSessionActive && localReady) {
    multiplayer.setReady(false)
    return
  }
  const plan = buildTutorialPlan(selectedCharacter, missionKindForSlug(currentMissionSlug), tutorialProgress.completed)
  if (plan) {
    openTutorial(plan, {
      continuation: () => requestMissionReady(trigger),
      completionLabel: roomSessionActive ? "READY UP" : "START MISSION",
      recordProgress: true,
      showTacticalTip: true,
      trigger,
    })
    return
  }
  if (roomSessionActive) multiplayer.setReady(true, { missionSlug: currentMissionSlug, characterId: selectedCharacter })
  else startSoloMission()
}

function replayCurrentTutorial(): void {
  const missionKind = latestMissionSnapshot?.missionKind ?? missionKindForSlug(currentMissionSlug)
  const plan = buildTutorialPlan(selectedCharacter, missionKind, {})
  if (!plan) return
  openTutorial(plan, {
    completionLabel: "CLOSE NOTES",
    recordProgress: false,
    showTacticalTip: true,
    trigger: helpButton,
  })
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
  for (const label of fieldMapSignalKeys) {
    const action = label.dataset.signalKey as "pingDanger" | "pingTarget" | "pingRoute" | "pingLoot" | "pingRegroup"
    label.textContent = keyLabel(key[action])
  }
  introControls.textContent = `${keyLabel(key.moveUp)}${keyLabel(key.moveLeft)}${keyLabel(key.moveDown)}${keyLabel(key.moveRight)} / POINTER / STICK TO MOVE · ${keyLabel(key.cameraLeft)}/${keyLabel(key.cameraRight)} CAMERA · ${keyLabel(key.interact)} INTERACT · ${keyLabel(key.fire)} FIRE · ${keyLabel(key.signature)} SIGNATURE · ENTER CHAT`
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
  gameplayAnalyticsSetting.checked = getProductAnalyticsConsent()
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
  closeQuickChat(false)
  closeChatDrawer(false)
  if (panel !== tutorialPanel && !tutorialPanel.classList.contains("hidden")) resetActiveTutorial()
  for (const candidate of panelElements) {
    if (candidate !== panel) candidate.classList.add("hidden")
    candidate.setAttribute("aria-hidden", String(candidate !== panel))
  }
  tutorialScrim.classList.toggle("hidden", panel !== tutorialPanel)
  lastPanelTrigger = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
  panel.classList.remove("hidden")
  queueMicrotask(() => panel.focus())
}

function closePanel(panel: HTMLElement, restoreFocus = true): void {
  panel.classList.add("hidden")
  panel.setAttribute("aria-hidden", "true")
  if (panel === tutorialPanel) {
    tutorialScrim.classList.add("hidden")
    resetActiveTutorial()
  }
  if (panel === settingsPanel && capturingAction) {
    capturingAction = null
    renderBindingControls()
  }
  const trigger = lastPanelTrigger
  lastPanelTrigger = null
  if (restoreFocus) trigger?.focus()
}

function closeActivePanel(): boolean {
  const open = panelElements.find((panel) => !panel.classList.contains("hidden"))
  if (!open) return false
  closePanel(open)
  return true
}

function performMappedAction(action: GameAction | PointerAction): void {
  if (isChatCapturingInput()) return
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
  if (running && !isModalOpen() && !isMobileSpectator() && !isChatCapturingInput()) {
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
    `EXPERIMENTS ${currentExperimentAssignments.map((assignment) => `${assignment.experimentId}@${assignment.experimentRevision}:${assignment.variantId}`).join(", ") || "none"}`,
    `RENDER   ${renderProfile.tier} · calls=${renderer.info.render.calls} · triangles=${renderer.info.render.triangles}`,
  ].join("\n")
}

function applyMissionSnapshot(mission: MissionSnapshot): void {
  latestMissionSnapshot = mission
  const nextLayout = selectRegionalMissionLayout(state.layout, mission.layout)
  if (nextLayout !== state.layout) applyRegionalLayout(nextLayout)
  else {
    // Hub scenes share these views; authoritative mission snapshots must always
    // put them back even when the seeded layout itself has not changed.
    positionMissionCampfire(nextLayout.campfirePosition)
    positionVillageUpgrades(nextLayout.campfirePosition)
  }
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
    if (event.playerId && event.playerId !== multiplayer.playerId) {
      const remote = remoteViews.get(event.playerId)
      if (remote) ensureRemoteHeroAction(remote, "signature")
    }
  } else if (event.type === "guard_stunned" && event.playerId && event.playerId !== multiplayer.playerId) {
    const remote = remoteViews.get(event.playerId)
    if (remote) ensureRemoteHeroAction(remote, "attack", HERO_ATTACK_RELEASE_PROGRESS)
  }
  if (event.type === "signature_used" && event.detail === "little-john-sweep" && event.playerId !== multiplayer.playerId) showVanguardImpact(event.playerId)
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
  const authoredName = cache.kind === "coin" ? "Prop_Chest" : "Prop_Box"
  const authoredSource = medievalPropsCatalogSource?.getObjectByName(authoredName)
  if (authoredSource) {
    const authored = authoredSource.clone(true) as THREE.Group
    authored.name = `MissionLootCache:${cache.kind}`
    authored.userData.sherwoodSharedGeometry = true
    authored.position.set(cache.position.x, sherwoodHeightAt(cache.position.x, cache.position.z), cache.position.z)
    authored.rotation.y = cache.kind === "intel" ? Math.PI / 5 : cache.kind === "ledger" ? -Math.PI / 6 : 0
    authored.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return
      child.castShadow = true
      child.receiveShadow = true
    })
    return authored
  }
  const group = new THREE.Group()
  const color = cache.kind === "coin" ? 0x7e532e : cache.kind === "intel" ? 0x38556b : 0x6c3431
  const chest = mesh(new THREE.BoxGeometry(cache.kind === "coin" ? 1.35 : 0.9, 0.72, cache.kind === "coin" ? 0.95 : 0.65), color)
  chest.position.y = 0.36
  const band = mesh(new THREE.BoxGeometry(0.16, 0.82, cache.kind === "coin" ? 1 : 0.7), 0xb28c48)
  band.position.y = 0.4
  group.add(chest, band)
  group.position.set(cache.position.x, sherwoodHeightAt(cache.position.x, cache.position.z), cache.position.z)
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
      else {
        mutedPlayerIds.add(player.id)
        chatState.markPlayerRead(player.id)
      }
      renderSafetyPanel(currentRoomPlayers)
      renderChatHistory(false)
      renderChatPeek()
      if (latestMissionSnapshot) syncPingViews(latestMissionSnapshot.pings)
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
        roomSessionActive = false
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

function canEnterSherwood(): boolean {
  return !accessState.gateEnabled || accessState.entitled
}

async function refreshAccessPanel(): Promise<void> {
  try {
    const [session, nextAccess] = await Promise.all([currentWalletSession(), loadAccessState()])
    accessState = nextAccess
    const address = session ? walletAddress(session) : null
    walletState.textContent = address ? shortWalletAddress(address) : nextAccess.authenticated ? "CONNECTED" : "NOT CONNECTED"
    walletSignIn.classList.toggle("hidden", nextAccess.authenticated)
    walletSignOut.classList.toggle("hidden", !nextAccess.authenticated)
    tokenPassPurchase.classList.toggle("hidden", !nextAccess.gateEnabled || !nextAccess.authenticated || nextAccess.entitled || !nextAccess.payment)
    startButton.disabled = !canEnterSherwood()
    createRoomButton.disabled = !canEnterSherwood()
    joinRoomButton.disabled = !canEnterSherwood()
    joinPublicHubButton.disabled = !canEnterSherwood()
    if (!nextAccess.gateEnabled) {
      accessCopy.textContent = "The token-pass gate is switched off. Wallet sign-in is optional while Sherwood remains open."
      accessStatus.textContent = "ACCESS SWITCH OFF · OPEN PLAY"
    } else if (!nextAccess.authenticated) {
      accessCopy.textContent = `Sign in with Robinhood Wallet, then buy a 30-day pass with the Sherwood token (approximately $${nextAccess.referencePriceUsd}).`
      accessStatus.textContent = "WALLET SIGNATURE REQUIRED"
    } else if (nextAccess.entitled) {
      const expiry = nextAccess.accessExpiresAt ? new Date(nextAccess.accessExpiresAt).toLocaleDateString() : ""
      accessCopy.textContent = "Your on-chain Sherwood pass is active. The authoritative realm is unlocked."
      accessStatus.textContent = expiry ? `PASS ACTIVE THROUGH ${expiry.toUpperCase()}` : "PASS ACTIVE"
    } else if (!nextAccess.payment) {
      accessCopy.textContent = "Token payments are not configured on this realm. Access remains locked while the gate is on."
      accessStatus.textContent = "TOKEN PAYMENT UNAVAILABLE"
    } else {
      const payment = nextAccess.payment
      tokenPassPurchase.textContent = `PAY ${payment.amountDisplay} ${payment.tokenSymbol} · ${payment.passDays} DAYS`
      accessCopy.textContent = `Transfer ${payment.amountDisplay} ${payment.tokenSymbol} on ${payment.chainName} for ${payment.passDays} days of access (approximately $${nextAccess.referencePriceUsd}).`
      accessStatus.textContent = "PASS NOT ACTIVE"
    }
  } catch (error) {
    accessStatus.textContent = error instanceof Error ? error.message : "Unable to check Sherwood access"
  }
}

async function connectWalletAndRefresh(): Promise<void> {
  walletSignIn.disabled = true
  socialSignIn.disabled = true
  accessStatus.textContent = "CHECK ROBINHOOD WALLET TO SIGN"
  try {
    await signInWithRobinhoodWallet()
    await Promise.all([refreshAccessPanel(), refreshSocialPanel()])
  } finally {
    walletSignIn.disabled = false
    socialSignIn.disabled = false
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
    const x = campfire.x + offset.x
    const z = campfire.z + offset.z
    view.position.set(x, sherwoodHeightAt(x, z), z)
    scene.add(view)
    updateVillageUpgradeTier(view, village[choice])
  }
}

function positionVillageUpgrades(campfire: { x: number; z: number }): void {
  for (const view of villageUpgradeViews.values()) {
    const offset = view.userData.campOffset as { x: number; z: number } | undefined
    if (offset) {
      const x = campfire.x + offset.x
      const z = campfire.z + offset.z
      view.position.set(x, sherwoodHeightAt(x, z), z)
    }
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
  const activeIds = new Set(players.filter((player) => player.id !== multiplayer.playerId && !blockedPlayerIds.has(player.id)).map((player) => player.id))
  for (const player of players) {
    if (player.id === multiplayer.playerId || blockedPlayerIds.has(player.id)) continue
    const existing = remoteViews.get(player.id)
    if (existing) {
      existing.downedFor = player.downedFor
      if (existing.characterId !== player.characterId) {
        disposeCharacterVisual(existing.fallback)
        existing.view.remove(existing.fallback)
        existing.fallback = createCharacter(player.characterId)
        existing.characterId = player.characterId
        existing.view.add(existing.fallback)
        existing.lastArrows = player.arrows
        existing.lastSignatureCooldown = player.signatureCooldown
      }
      if (!multiplayerActive) {
        existing.lastArrows = player.arrows
        existing.lastSignatureCooldown = player.signatureCooldown
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
      actionStartedAt: 0,
      actionUntil: 0,
      lastArrows: player.arrows,
      lastSignatureCooldown: player.signatureCooldown,
    }
    remote.snapshots.push(player.position, performance.now())
    remoteViews.set(player.id, remote)
  }
  for (const [id, remote] of remoteViews) {
    if (activeIds.has(id)) continue
    disposeCharacterVisual(remote.fallback)
    scene.remove(remote.view)
    remoteViews.delete(id)
  }
}

function getMoveInput(): Vec2 {
  if (isMobileSpectator() || isChatCapturingInput()) return { x: 0, z: 0 }
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

function contextualChatChannel(): ChatChannel {
  return inPublicHub ? "camp" : "band"
}

function hiddenChatPlayerIds(): Set<string> {
  return new Set([...mutedPlayerIds, ...blockedPlayerIds])
}

function isChatCapturingInput(): boolean {
  return chatState.drawerOpen || quickChatActiveChannel !== null
}

function stopGameplayForChat(): void {
  keys.clear()
  clickTarget = null
  destinationMarker.visible = false
  if (running && (roomSessionActive || inPublicHub)) multiplayer.stopMovement()
}

function chatLogIsNearBottom(): boolean {
  return chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 52
}

function formatChatTime(sentAt: number): string {
  return new Date(sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function createChatMessageElement(message: ChatMessage): HTMLLIElement {
  const item = document.createElement("li")
  item.className = "chat-message"
  item.classList.toggle("local", message.sender.playerId === multiplayer.playerId || message.sender.playerId === publicHubParticipantId)
  item.dataset.messageId = message.id

  const heading = document.createElement("header")
  const sender = document.createElement("b")
  sender.textContent = `${message.sender.displayName} · ${characterName(message.sender.characterId)}`
  const time = document.createElement("span")
  time.textContent = formatChatTime(message.sentAt)
  heading.append(sender, time)

  const copy = document.createElement("p")
  copy.textContent = message.text
  item.append(heading, copy)

  const isLocal = message.sender.playerId === multiplayer.playerId || message.sender.playerId === publicHubParticipantId
  if (isLocal) return item

  const actions = document.createElement("div")
  actions.className = "chat-message-actions"
  const mute = document.createElement("button")
  mute.type = "button"
  mute.textContent = mutedPlayerIds.has(message.sender.playerId) ? "UNMUTE" : "MUTE"
  mute.addEventListener("click", () => {
    if (mutedPlayerIds.has(message.sender.playerId)) mutedPlayerIds.delete(message.sender.playerId)
    else {
      mutedPlayerIds.add(message.sender.playerId)
      chatState.markPlayerRead(message.sender.playerId)
    }
    renderChatHistory(false)
    renderChatPeek()
    renderSafetyPanel(currentRoomPlayers)
    renderPublicHub()
    if (latestMissionSnapshot) syncPingViews(latestMissionSnapshot.pings)
  })
  actions.append(mute)

  if (message.channel === "camp") {
    const block = document.createElement("button")
    block.type = "button"
    block.textContent = "BLOCK"
    block.addEventListener("click", () => {
      blockedPlayerIds.add(message.sender.playerId)
      mutedPlayerIds.add(message.sender.playerId)
      chatState.markPlayerRead(message.sender.playerId)
      multiplayer.blockHubPlayer(message.sender.playerId)
      renderChatHistory(false)
      renderChatPeek()
      renderPublicHub()
      ensureRemotePlayers(publicHubPlayers.filter((player) => player.id !== publicHubParticipantId && !blockedPlayerIds.has(player.id)).map(hubPlayerAsRoomPlayer))
      chatStatus.textContent = "Player blocked and hidden from this camp."
    })
    actions.append(block)
  }

  const report = document.createElement("details")
  report.className = "chat-message-report"
  const reportSummary = document.createElement("summary")
  reportSummary.textContent = "REPORT"
  const reportReasons = document.createElement("div")
  const reasons: ReadonlyArray<{ value: ChatReportReason; label: string }> = [
    { value: "harassment", label: "Harassment" },
    { value: "griefing", label: "Griefing / spam" },
    { value: "unsafe-name", label: "Unsafe identity" },
    { value: "cheating", label: "Cheating claim" },
  ]
  for (const reason of reasons) {
    const button = document.createElement("button")
    button.type = "button"
    button.textContent = reason.label
    button.addEventListener("click", () => {
      multiplayer.reportChat(message.channel, message.id, reason.value)
      report.open = false
      chatStatus.textContent = "Message report sent with its server-held context."
    })
    reportReasons.append(button)
  }
  report.append(reportSummary, reportReasons)
  actions.append(report)
  item.append(actions)
  return item
}

function renderChatBadges(): void {
  const totalUnread = chatState.totalUnread()
  chatUnreadBadge.textContent = totalUnread > 99 ? "99+" : String(totalUnread)
  chatUnreadBadge.classList.toggle("hidden", totalUnread === 0)
  chatButton.setAttribute("aria-label", totalUnread > 0 ? `Open chat, ${totalUnread} unread` : "Open chat")
  for (const tab of chatTabs) {
    const channel = tab.dataset.chatChannel as ChatChannel
    const unread = chatState.unread(channel)
    const badge = tab.querySelector<HTMLElement>("b")!
    badge.textContent = unread > 99 ? "99+" : String(unread)
    badge.classList.toggle("hidden", unread === 0)
  }
  chatNewMessages.textContent = chatState.unread(chatState.activeChannel) > 0
    ? `${chatState.unread(chatState.activeChannel)} NEW MESSAGE${chatState.unread(chatState.activeChannel) === 1 ? "" : "S"}`
    : "NEW MESSAGES"
}

function renderChatChrome(statusOverride?: string): void {
  const preferred = contextualChatChannel()
  if (!chatState.isAvailable(chatState.activeChannel)) {
    if (chatState.isAvailable(preferred)) chatState.selectChannel(preferred)
    else if (chatState.isAvailable("band")) chatState.selectChannel("band")
    else if (chatState.isAvailable("camp")) chatState.selectChannel("camp")
  }
  const anyAvailable = chatState.isAvailable("band") || chatState.isAvailable("camp")
  chatButton.classList.toggle("hidden", !anyAvailable)
  for (const tab of chatTabs) {
    const channel = tab.dataset.chatChannel as ChatChannel
    tab.disabled = !chatState.isAvailable(channel)
    tab.setAttribute("aria-pressed", String(channel === chatState.activeChannel))
  }
  const canSend = roomConnected && chatState.isAvailable(chatState.activeChannel)
  chatInput.disabled = !canSend
  chatSubmit.disabled = !canSend
  chatInput.placeholder = chatState.activeChannel === "camp" ? "Message this camp" : "Message your band"
  chatLog.setAttribute("aria-label", `${chatState.activeChannel === "camp" ? "Camp" : "Band"} chat messages`)
  chatStatus.textContent = statusOverride ?? (!chatState.isAvailable(chatState.activeChannel)
    ? "Join a band or authenticated camp to chat."
    : !roomConnected
      ? "Connection lost — history remains visible while Sherwood reconnects."
      : chatState.activeChannel === "camp"
        ? "Authenticated · visible only in this 12-player camp instance."
        : "Private to this Merry Band · Enter opens quick chat.")
  if (inPublicHub) {
    const chatLabel = chatState.isAvailable("camp") ? "INSTANCE CHAT" : "CAMP CHAT OFF"
    missionModifiers.textContent = `OPT-IN PUBLIC CAMP · CAP ${publicHubCapacity} · ${chatLabel}`
  }
  renderChatBadges()
}

function renderChatHistory(scrollToEnd: boolean): void {
  chatLog.setAttribute("aria-live", "off")
  const messages = chatState.messages(chatState.activeChannel, hiddenChatPlayerIds())
  chatLog.replaceChildren(...messages.map(createChatMessageElement))
  if (scrollToEnd) {
    chatLog.scrollTop = chatLog.scrollHeight
    chatState.markRead(chatState.activeChannel)
    chatNewMessages.classList.add("hidden")
  } else {
    chatNewMessages.classList.toggle("hidden", chatState.unread(chatState.activeChannel) === 0)
  }
  renderChatChrome()
  queueMicrotask(() => chatLog.setAttribute("aria-live", "polite"))
}

function renderChatPeek(): void {
  if (chatPeekTimer) window.clearTimeout(chatPeekTimer)
  const channel = contextualChatChannel()
  const now = performance.now()
  const hiddenPlayerIds = hiddenChatPlayerIds()
  const messages = chatState.isAvailable(channel)
    ? chatState.recent(channel, now, hiddenPlayerIds)
    : []
  chatPeek.replaceChildren(...messages.map((message) => {
    const item = document.createElement("li")
    const sender = document.createElement("b")
    sender.textContent = message.sender.displayName
    item.append(sender, document.createTextNode(message.text))
    return item
  }))
  const visible = messages.length > 0 && !chatState.drawerOpen && quickChatActiveChannel === null
  chatPeek.classList.toggle("hidden", !visible)
  const nextExpiry = visible ? chatState.nextRecentExpiry(channel, now, hiddenPlayerIds) : null
  if (nextExpiry !== null) chatPeekTimer = window.setTimeout(renderChatPeek, Math.max(1, nextExpiry - now + 50))
}

function receiveChatHistory(channel: ChatChannel, messages: ChatMessage[]): void {
  chatState.replaceHistory(channel, messages)
  if (channel === contextualChatChannel()) chatState.selectChannel(channel)
  renderChatChrome()
  if (chatState.drawerOpen && chatState.activeChannel === channel) renderChatHistory(true)
}

function receiveChatMessage(message: ChatMessage): void {
  const hidden = hiddenChatPlayerIds().has(message.sender.playerId)
  const ownMessage = message.sender.playerId === multiplayer.playerId || message.sender.playerId === publicHubParticipantId
  const activeAtBottom = chatState.drawerOpen && chatState.activeChannel === message.channel && chatLogIsNearBottom()
  if (!chatState.append(message, performance.now(), hidden || ownMessage || activeAtBottom)) return

  if (chatState.drawerOpen && chatState.activeChannel === message.channel && !hidden) {
    chatLog.append(createChatMessageElement(message))
    if (activeAtBottom) {
      chatLog.scrollTop = chatLog.scrollHeight
      chatState.markRead(message.channel)
      chatNewMessages.classList.add("hidden")
    } else chatNewMessages.classList.remove("hidden")
  }
  renderChatChrome()
  renderChatPeek()
}

function receiveChatError(channel: ChatChannel, code: ChatErrorCode, message: string, retryAfterMs?: number): void {
  if (code === "NOT_AVAILABLE") chatState.setAvailability(channel, false)
  const retry = retryAfterMs && retryAfterMs > 0 ? ` Try again in ${Math.ceil(retryAfterMs / 1_000)}s.` : ""
  renderChatChrome(`${message}${retry}`)
  showToast(message)
}

function openQuickChat(): void {
  const channel = contextualChatChannel()
  if (!chatState.isAvailable(channel) || !roomConnected) {
    showToast(channel === "camp" ? "CAMP CHAT IS NOT AVAILABLE" : "JOIN A BAND TO CHAT")
    return
  }
  if (chatState.drawerOpen) closeChatDrawer(false)
  quickChatActiveChannel = channel
  quickChatChannel.textContent = channel.toUpperCase()
  quickChatInput.placeholder = channel === "camp" ? "Message this camp" : "Message your band"
  quickChatInput.value = ""
  quickChatForm.classList.remove("hidden")
  renderChatPeek()
  stopGameplayForChat()
  queueMicrotask(() => quickChatInput.focus())
}

function closeQuickChat(restoreFocus = true): void {
  quickChatActiveChannel = null
  quickChatComposing = false
  quickChatCompositionEndedAt = -Infinity
  quickChatInput.value = ""
  quickChatForm.classList.add("hidden")
  renderChatPeek()
  if (restoreFocus && running) queueMicrotask(() => renderer.domElement.focus())
}

function openChatDrawer(): void {
  const activeElement = document.activeElement
  chatDrawerReturnFocus = activeElement instanceof HTMLElement && activeElement !== quickChatInput
    ? activeElement
    : renderer.domElement
  closeQuickChat(false)
  const preferred = contextualChatChannel()
  if (chatState.isAvailable(preferred)) chatState.selectChannel(preferred)
  if (!chatState.isAvailable(chatState.activeChannel)) {
    showToast("CHAT IS NOT AVAILABLE HERE")
    return
  }
  chatState.setDrawerOpen(true)
  chatDrawer.classList.remove("hidden")
  chatDrawer.setAttribute("aria-hidden", "false")
  chatButton.setAttribute("aria-expanded", "true")
  stopGameplayForChat()
  renderChatHistory(true)
  renderChatPeek()
  queueMicrotask(() => chatInput.focus())
}

function closeChatDrawer(restoreFocus = true): void {
  const returnFocus = chatDrawerReturnFocus?.isConnected ? chatDrawerReturnFocus : renderer.domElement
  chatDrawerReturnFocus = null
  fullChatComposing = false
  fullChatCompositionEndedAt = -Infinity
  chatState.setDrawerOpen(false)
  chatDrawer.classList.add("hidden")
  chatDrawer.setAttribute("aria-hidden", "true")
  chatButton.setAttribute("aria-expanded", "false")
  chatNewMessages.classList.add("hidden")
  renderChatChrome()
  renderChatPeek()
  if (restoreFocus && running) queueMicrotask(() => returnFocus.focus())
}

function sendChatInput(input: HTMLInputElement, channel: ChatChannel): boolean {
  const text = truncateChatInput(input.value.trim())
  if (!text) return false
  if (!multiplayer.sendChat(channel, text)) {
    renderChatChrome("Connection lost — message kept while Sherwood reconnects.")
    showToast("MESSAGE NOT SENT — RECONNECTING")
    return false
  }
  input.value = ""
  return true
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
  if (clock.elapsedTime < heroAttackUntil || pendingLocalShot) return
  if (state.player.arrows <= 0) {
    showToast("Your quiver is empty")
    return
  }
  if (state.won || state.lost || localDownedFor > 0) return

  beginLocalHeroAction("attack")
  pendingLocalShot = {
    releaseAt: heroAttackStartedAt + HERO_ACTION_DURATIONS.attack * HERO_ATTACK_RELEASE_PROGRESS,
    multiplayer: multiplayerActive,
  }
}

function createArrowEffect(guardId: number): void {
  const guard = state.guards.find((candidate) => candidate.id === guardId)
  if (!guard) return
  const start = new THREE.Vector3(state.player.position.x, 1.45, state.player.position.z)
  const target = new THREE.Vector3(guard.position.x, 1.3, guard.position.z)
  const geometry = new THREE.BufferGeometry().setFromPoints([start, target])
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffe3a0 }))
  scene.add(line)
  arrowEffects.push({ line, age: 0 })
}

function commitPendingLocalShot(elapsed: number): void {
  const pending = pendingLocalShot
  if (!pending || elapsed < pending.releaseAt) return
  pendingLocalShot = null
  if (localDownedFor > 0 || state.won || state.lost) return
  if (pending.multiplayer) {
    multiplayer.sendAction("shoot")
    return
  }

  const guardId = shoot(state)
  if (guardId === null) {
    showToast(state.player.arrows === 0 ? "Your quiver is empty" : "No guard in range")
    return
  }
  createArrowEffect(guardId)
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
    if (clock.elapsedTime < heroSignatureUntil || state.player.signatureCooldown > 0) {
      showToast(`Signature ready in ${Math.max(1, Math.ceil(state.player.signatureCooldown))}s`)
      return
    }
    multiplayer.sendAction("signature")
    beginLocalHeroAction("signature")
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
  if (result.event !== "signature-unavailable" && result.event !== "volley-missed") beginLocalHeroAction("signature")
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

function renderRegionMapGrid(grid: HTMLElement, cells: readonly RegionMapCellState[], pings: readonly WorldPing[]): number {
  if (grid.children.length !== cells.length) {
    grid.replaceChildren(...cells.map(() => {
      const cell = document.createElement("span")
      cell.className = "region-map-cell"
      return cell
    }))
  }
  const pingsByCell = new Map<number, PingKind[]>()
  for (const ping of pings) {
    const cellIndex = regionCellIndexAt(ping.position)
    const kinds = pingsByCell.get(cellIndex) ?? []
    if (!kinds.includes(ping.kind)) kinds.push(ping.kind)
    pingsByCell.set(cellIndex, kinds)
  }
  let exploredCount = 0
  cells.forEach((cell, index) => {
    const view = grid.children[index] as HTMLElement
    if (cell.explored) exploredCount += 1
    view.className = regionMapCellClassName(cell)
    view.replaceChildren()
    if (cell.index === state.layout.campfireCell.index) {
      const camp = document.createElement("span")
      camp.className = "region-map-cell-camp"
      camp.textContent = "⌂"
      view.append(camp)
    }
    if (cell.current) {
      const player = document.createElement("span")
      player.className = "region-map-cell-player"
      player.textContent = "▲"
      view.append(player)
    }
    const signalKinds = pingsByCell.get(cell.index)
    if (signalKinds?.length) {
      const signals = document.createElement("span")
      signals.className = "region-map-cell-signals"
      for (const kind of signalKinds) {
        const signal = document.createElement("i")
        signal.className = `region-map-cell-signal signal-${kind}`
        signal.textContent = PING_MAP_ICONS[kind]
        signals.append(signal)
      }
      view.append(signals)
    }
    view.setAttribute("aria-hidden", "true")
  })
  return exploredCount
}

function renderRegionMap(): void {
  const missionVisible = running && !inHub && !inPublicHub && intro.classList.contains("closed")
  regionMap.classList.toggle("hidden", !missionVisible)
  if (!missionVisible) {
    regionMapRenderSignature = ""
    if (!fieldMapPanel.classList.contains("hidden")) closePanel(fieldMapPanel)
    return
  }
  const explored = latestMissionSnapshot?.exploredCellIndices ?? state.exploredCellIndices
  const objectiveDiscovered = latestMissionSnapshot?.objectiveDiscovered ?? state.objectiveDiscovered
  const searchPressure = latestMissionSnapshot?.searchPressure ?? state.searchPressure
  const objectivePosition = latestMissionSnapshot
    ? missionObjectivePosition(latestMissionSnapshot)
    : state.layout.objectivePosition
  const cells = buildRegionMapCells(state.layout, explored, state.player.position, objectiveDiscovered, searchPressure, objectivePosition)
  const pings = latestMissionSnapshot?.pings ?? []
  const missionMapEpoch = latestMissionSnapshot?.seed ?? soloRunSequence
  const nextSignature = `${missionMapEpoch}|${state.layout.campfireCell.index}|${cells.map((cell) => `${Number(cell.explored)}${Number(cell.current)}${Number(cell.objective)}`).join("")}|${pings.map((ping) => `${ping.id}:${ping.kind}:${regionCellIndexAt(ping.position)}`).join(",")}`
  if (nextSignature === regionMapRenderSignature) return
  regionMapRenderSignature = nextSignature
  const exploredCount = renderRegionMapGrid(regionMapGrid, cells, pings)
  renderRegionMapGrid(fieldMapGrid, cells, pings)
  regionMapCount.textContent = `${exploredCount}/25`
  fieldMapCount.textContent = `${exploredCount}/25 EXPLORED`
  regionMapGrid.setAttribute("aria-label", `${exploredCount} of 25 Sherwood regions explored`)
  fieldMapGrid.setAttribute("aria-label", `${exploredCount} of 25 Sherwood regions explored; map shows only discovered information and player signals`)
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
  synchronizeGuardVisualsById(
    guardViews,
    state.guards,
    (view) => scene.add(view),
    (view) => {
      scene.remove(view)
      disposeOwnedMeshResources(view)
    },
  )
  water.update(elapsed, renderProfile.motionScale)
  missionCampfire.update(elapsed, renderProfile.motionScale)
  if (missionCampfireHalo) {
    missionCampfireHalo.visible = !inHub
      && !inPublicHub
      && shouldShowMissionCampfireHalo({
        multiplayerActive,
        loot: state.player.loot,
        mission: latestMissionSnapshot,
      })
  }
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
  const playerGroundY = sherwoodWalkableHeightAt(player.x, player.z, state.layout)
  const playerRootBob = localDownedFor > 0 ? 0 : Math.sin(elapsed * 9) * 0.035 * renderProfile.motionScale
  playerView.position.set(player.x, playerGroundY + playerRootBob, player.z)
  setObjectOpacityFactor(playerView, state.player.veilFor > 0 ? 0.48 : 1)
  const dx = player.x - lastPlayerPosition.x
  const dz = player.z - lastPlayerPosition.z
  const playerMoving = Math.hypot(dx, dz) > 0.001
  if (playerMoving) playerView.rotation.y = Math.atan2(dx, dz)
  lastPlayerPosition = { ...player }
  const playerAction: HeroAction = elapsed < heroSignatureUntil
    ? "signature"
    : elapsed < heroAttackUntil
      ? "attack"
      : "idle"
  const playerActionStartedAt = playerAction === "signature"
    ? heroSignatureStartedAt
    : playerAction === "attack"
      ? heroAttackStartedAt
      : elapsed
  poseCharacterVisual(playerView, {
    elapsed,
    moving: playerMoving,
    action: playerAction,
    actionProgress: normalizedHeroActionProgress(elapsed, playerActionStartedAt, playerAction),
    downed: localDownedFor > 0,
    motionScale: renderProfile.motionScale,
  })
  for (const cache of bowCacheAnimations) cache.mixer.update(dt)

  const activeGuardIds = new Set<number>()
  state.guards.forEach((guard, index) => {
    const view = guardViews[index]
    activeGuardIds.add(guard.id)
    const previous = lastGuardPositions.get(guard.id)
    const dx = previous ? guard.position.x - previous.x : 0
    const dz = previous ? guard.position.z - previous.z : 0
    if (Math.hypot(dx, dz) > 0.0001) {
      view.rotation.y = Math.atan2(dx, dz)
      guardMovingUntil.set(guard.id, elapsed + 0.18)
    }
    const stunned = guard.stunnedFor > 0
    const moving = !stunned && (guardMovingUntil.get(guard.id) ?? 0) > elapsed
    const guardGroundY = sherwoodWalkableHeightAt(guard.position.x, guard.position.z, state.layout)
    view.position.set(guard.position.x, guardGroundY, guard.position.z)
    view.rotation.z = 0
    poseGuardVisual(view, {
      elapsed,
      moving,
      alert: state.heat > 8,
      stunned,
      motionScale: renderProfile.motionScale,
    })
    lastGuardPositions.set(guard.id, { ...guard.position })
  })
  for (const id of lastGuardPositions.keys()) {
    if (activeGuardIds.has(id)) continue
    lastGuardPositions.delete(id)
    guardMovingUntil.delete(id)
  }

  const snapshotNow = performance.now()
  for (const remote of remoteViews.values()) {
    const sampled = remote.snapshots.sample(snapshotNow)
    if (sampled) remote.view.position.set(sampled.x, sherwoodWalkableHeightAt(sampled.x, sampled.z, state.layout), sampled.z)
    const remoteDx = remote.view.position.x - remote.lastPosition.x
    const remoteDz = remote.view.position.z - remote.lastPosition.z
    const moving = Math.hypot(remoteDx, remoteDz) > 0.0001
    const cameraDistance = camera.position.distanceTo(remote.view.position)
    remote.fallback.visible = cameraDistance <= 48
    if (moving) remote.view.rotation.y = Math.atan2(remoteDx, remoteDz)
    remote.view.rotation.z = 0
    if (elapsed >= remote.actionUntil) remote.action = "idle"
    poseCharacterVisual(remote.fallback, {
      elapsed,
      moving,
      action: remote.action,
      actionProgress: normalizedHeroActionProgress(elapsed, remote.actionStartedAt, remote.action),
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
  if (document.visibilityState === "visible") diagnosticReporter?.observeFrame(performance.now())
  const dt = Math.min(clock.getDelta(), 0.05)
  const elapsed = clock.elapsedTime
  pollControllerActions()
  if (running) commitPendingLocalShot(elapsed)
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
  if (!canEnterSherwood()) {
    accessStatus.textContent = "Buy a 30-day token pass before entering Sherwood."
    return
  }
  runCampfireTutorialGate(() => enterHub(false), startButton, "ENTER CAMPFIRE")
})

rejoinRoomButton.addEventListener("click", () => {
  const code = localStorage.getItem("sherwood:last-room-code")
  const displayName = playerNameInput.value.trim().slice(0, 20)
  if (!code || !displayName) return
  runCampfireTutorialGate(() => multiplayer.joinRoom(code, displayName, selectedCharacter), rejoinRoomButton, "REJOIN BAND")
})

joinPublicHubButton.addEventListener("click", () => void (async () => {
  const social = await loadSocialState().catch(() => null)
  if (!social?.session) {
    openPanel(socialPanel, joinPublicHubButton)
    socialStatus.textContent = "Sign in with Robinhood Wallet before opting into the public camp."
    await refreshSocialPanel()
    return
  }
  currentSocial = social
  const displayName = playerNameInput.value.trim().slice(0, 20)
  if (!displayName) return
  localStorage.setItem("sherwood-rebellion:player-name", displayName)
  runCampfireTutorialGate(() => multiplayer.joinPublicHub(displayName, selectedCharacter), joinPublicHubButton, "ENTER CAMPFIRE")
})())

createRoomButton.addEventListener("click", () => {
  const displayName = playerNameInput.value.trim().slice(0, 20)
  if (!displayName) {
    lobbyStatus.textContent = "Choose an outlaw name first"
    return
  }
  localStorage.setItem("sherwood-rebellion:player-name", displayName)
  runCampfireTutorialGate(() => multiplayer.createRoom(displayName, selectedCharacter), createRoomButton, "FORM BAND")
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
  runCampfireTutorialGate(() => multiplayer.joinRoom(code, displayName, selectedCharacter), joinRoomButton, "JOIN BAND")
})

readyButton.addEventListener("click", () => requestMissionReady(readyButton))
hubReady.addEventListener("click", () => requestMissionReady(hubReady))
hubRoles.forEach((button) => button.addEventListener("click", () => {
  const characterId = button.dataset.hubCharacter
  if (characterId !== "robin" && characterId !== "marian" && characterId !== "little-john" && characterId !== "much") return
  if (roomSessionActive) {
    pendingRoomSelection = true
    renderHub()
    multiplayer.selectCharacter(characterId)
  }
  else {
    selectLocalCharacter(characterId, false)
    renderHub()
  }
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
chatButton.addEventListener("click", () => {
  if (!isModalOpen()) openChatDrawer()
})
closeChatButton.addEventListener("click", () => closeChatDrawer())
chatTabs.forEach((tab) => tab.addEventListener("click", () => {
  const channel = tab.dataset.chatChannel as ChatChannel
  if (!chatState.selectChannel(channel)) return
  chatState.markRead(channel)
  renderChatHistory(true)
  chatInput.focus()
}))
chatNewMessages.addEventListener("click", () => {
  chatLog.scrollTop = chatLog.scrollHeight
  chatState.markRead(chatState.activeChannel)
  chatNewMessages.classList.add("hidden")
  renderChatBadges()
  chatInput.focus()
})
chatLog.addEventListener("scroll", () => {
  if (!chatLogIsNearBottom()) return
  chatState.markRead(chatState.activeChannel)
  chatNewMessages.classList.add("hidden")
  renderChatBadges()
})
quickChatForm.addEventListener("submit", (event) => {
  event.preventDefault()
  if (quickChatComposing || performance.now() - quickChatCompositionEndedAt < 40 || !quickChatActiveChannel) return
  if (sendChatInput(quickChatInput, quickChatActiveChannel)) closeQuickChat()
})
quickChatInput.addEventListener("compositionstart", () => { quickChatComposing = true; quickChatCompositionEndedAt = -Infinity })
quickChatInput.addEventListener("compositionend", () => { quickChatComposing = false; quickChatCompositionEndedAt = performance.now() })
quickChatInput.addEventListener("input", () => { quickChatInput.value = truncateChatInput(quickChatInput.value) })
quickChatInput.addEventListener("keydown", (event) => {
  event.stopPropagation()
  if (event.key === "Escape" && !event.isComposing) {
    event.preventDefault()
    closeQuickChat()
  } else if (event.key === "Enter" && (event.isComposing || event.keyCode === 229 || quickChatComposing)) event.preventDefault()
})
chatForm.addEventListener("submit", (event) => {
  event.preventDefault()
  if (fullChatComposing || performance.now() - fullChatCompositionEndedAt < 40 || !chatState.isAvailable(chatState.activeChannel)) return
  sendChatInput(chatInput, chatState.activeChannel)
})
chatInput.addEventListener("compositionstart", () => { fullChatComposing = true; fullChatCompositionEndedAt = -Infinity })
chatInput.addEventListener("compositionend", () => { fullChatComposing = false; fullChatCompositionEndedAt = performance.now() })
chatInput.addEventListener("input", () => { chatInput.value = truncateChatInput(chatInput.value) })
chatInput.addEventListener("keydown", (event) => {
  event.stopPropagation()
  if (event.key === "Escape" && !event.isComposing) {
    event.preventDefault()
    closeChatDrawer()
  } else if (event.key === "Enter" && (event.isComposing || event.keyCode === 229 || fullChatComposing)) event.preventDefault()
})
publicHubLeave.addEventListener("click", () => {
  multiplayer.leavePublicHub()
  window.setTimeout(() => multiplayer.close(), 80)
  roomConnected = false
  roomSessionActive = false
  inPublicHub = false
  publicHubIsLooking = false
  publicHubParticipantId = null
  publicHubPlayers = []
  blockedPlayerIds.clear()
  mutedPlayerIds.clear()
  chatState.reset()
  closeQuickChat(false)
  closeChatDrawer(false)
  renderChatChrome()
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
  pendingRoomSelection = true
  renderRoleChoice(currentRoomPlayers)
  multiplayer.selectCharacter(characterId)
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
  disposeCharacterVisual(playerView)
  scene.remove(playerView)
  playerView = createCharacter(selectedCharacter)
  scene.add(playerView)
  if (notifyServer && multiplayer.playerId) multiplayer.selectCharacter(selectedCharacter)
  updateUI()
}

helpButton.addEventListener("click", () => openPanel(helpPanel, helpButton))
closeHelp.addEventListener("click", () => closePanel(helpPanel))
replayTutorialButton.addEventListener("click", replayCurrentTutorial)
closeTutorial.addEventListener("click", () => closePanel(tutorialPanel))
tutorialBack.addEventListener("click", () => {
  if (!activeTutorialPlan || activeTutorialLessonIndex === 0) return
  activeTutorialLessonIndex -= 1
  renderTutorialStep()
})
tutorialNext.addEventListener("click", () => {
  if (!activeTutorialPlan) return
  if (activeTutorialLessonIndex < activeTutorialPlan.lessons.length - 1) {
    activeTutorialLessonIndex += 1
    renderTutorialStep()
    return
  }
  finishTutorial()
})
regionMapExpand.addEventListener("click", () => openPanel(fieldMapPanel, regionMapExpand))
closeFieldMap.addEventListener("click", () => closePanel(fieldMapPanel))
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
socialSignIn.addEventListener("click", () => void connectWalletAndRefresh()
  .then(() => { socialStatus.textContent = "Robinhood Wallet connected." })
  .catch((error) => { socialStatus.textContent = error instanceof Error ? error.message : "Unable to connect Robinhood Wallet" }))
socialSignOut.addEventListener("click", () => void disconnectRobinhoodWallet().then(async () => {
  currentSocial = null
  await Promise.all([refreshAccessPanel(), refreshSocialPanel()])
}).catch((error) => { socialStatus.textContent = error instanceof Error ? error.message : "Unable to sign out" }))
walletSignIn.addEventListener("click", () => void connectWalletAndRefresh().catch((error) => {
  accessStatus.textContent = error instanceof Error ? error.message : "Unable to connect Robinhood Wallet"
}))
walletSignOut.addEventListener("click", () => void disconnectRobinhoodWallet().then(async () => {
  currentSocial = null
  await Promise.all([refreshAccessPanel(), refreshSocialPanel()])
}).catch((error) => { accessStatus.textContent = error instanceof Error ? error.message : "Unable to sign out" }))
tokenPassPurchase.addEventListener("click", () => void (async () => {
  const payment = accessState.payment
  if (!payment) return
  tokenPassPurchase.disabled = true
  accessStatus.textContent = `CONFIRM ${payment.amountDisplay} ${payment.tokenSymbol} IN ROBINHOOD WALLET`
  try {
    accessState = await purchaseTokenPass(payment)
    await refreshAccessPanel()
  } catch (error) {
    accessStatus.textContent = error instanceof Error ? error.message : "Token payment could not be verified"
  } finally {
    tokenPassPurchase.disabled = false
  }
})())
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
gameplayAnalyticsSetting.addEventListener("change", () => {
  setProductAnalyticsConsent(gameplayAnalyticsSetting.checked)
  multiplayer.setProductAnalyticsConsent(gameplayAnalyticsSetting.checked)
  settingsStatus.textContent = gameplayAnalyticsSetting.checked
    ? "Anonymous play diagnostics enabled on this device."
    : "Anonymous play diagnostics disabled on this device."
})
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
  if (isChatCapturingInput()) {
    if (event.code === "Escape") {
      event.preventDefault()
      if (quickChatActiveChannel) closeQuickChat()
      else closeChatDrawer()
    }
    return
  }
  const chatHotkeyTarget = event.target === document.body || event.target === renderer.domElement
  if (event.code === "Enter" && chatHotkeyTarget && running && roomConnected && !event.repeat && !event.isComposing && !isModalOpen()) {
    event.preventDefault()
    openQuickChat()
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
  if (!running || isModalOpen() || isMobileSpectator() || isChatCapturingInput()) return
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
  if (running && !isChatCapturingInput()) event.preventDefault()
})

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  applyInputSettings()
  updateUI()
})

window.addEventListener("blur", () => keys.clear())
document.addEventListener("visibilitychange", () => diagnosticReporter?.resetFrameClock())
window.addEventListener("beforeunload", () => unsubscribeLeaderboard?.())
renderer.domElement.addEventListener("webglcontextlost", (event) => {
  event.preventDefault()
  void diagnosticReporter?.report("webgl_context_lost")
  showToast("Graphics paused — restoring Sherwood")
})
renderer.domElement.addEventListener("webglcontextrestored", () => showToast("Sherwood restored"))

renderBindingControls()
applyInputSettings()
updateMissionDebug()
renderChatChrome()
void refreshAccessPanel()
for (const panel of panelElements) panel.setAttribute("aria-hidden", String(panel.classList.contains("hidden")))
updateUI()
syncViews(0, 0.016)
animate()
