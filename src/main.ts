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
import { loadLeaderboard, submitLeaderboardEntry, subscribeToLeaderboard } from "./leaderboard"
import { MultiplayerClient } from "./multiplayer"
import { SnapshotBuffer } from "./snapshot-buffer"
import type { MissionEvent, MissionSnapshot, PingKind, RoomPlayer, WorldPing } from "../shared/protocol"

const container = document.querySelector<HTMLDivElement>("#game")!
const intro = document.querySelector<HTMLDivElement>("#intro")!
const startButton = document.querySelector<HTMLButtonElement>("#start-button")!
const promptElement = document.querySelector<HTMLDivElement>("#prompt")!
const toastElement = document.querySelector<HTMLDivElement>("#toast")!
const objectiveElement = document.querySelector<HTMLElement>("#objective-text")!
const progressElement = document.querySelector<HTMLElement>("#progress-fill")!
const healthElement = document.querySelector<HTMLElement>("#health")!
const arrowsElement = document.querySelector<HTMLElement>("#arrows")!
const lootElement = document.querySelector<HTMLElement>("#loot")!
const heatWrap = document.querySelector<HTMLElement>("#heat-wrap")!
const heatElement = document.querySelector<HTMLElement>("#heat-fill")!
const helpButton = document.querySelector<HTMLButtonElement>("#help-button")!
const helpPanel = document.querySelector<HTMLDivElement>("#help-panel")!
const closeHelp = document.querySelector<HTMLButtonElement>("#close-help")!
const signatureElement = document.querySelector<HTMLElement>("#signature")!
const leaderboardButton = document.querySelector<HTMLButtonElement>("#leaderboard-button")!
const leaderboardPanel = document.querySelector<HTMLDivElement>("#leaderboard-panel")!
const closeLeaderboard = document.querySelector<HTMLButtonElement>("#close-leaderboard")!
const leaderboardList = document.querySelector<HTMLOListElement>("#leaderboard-list")!
const leaderboardState = document.querySelector<HTMLElement>("#leaderboard-state")!
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
playerNameInput.value = localStorage.getItem("sherwood-rebellion:player-name") ?? "Greenhood"

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x91aa83)
scene.fog = new THREE.FogExp2(0x91aa83, 0.026)

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 140)
camera.position.set(6, 14, 20)

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
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
let localReady = false
let currentRoomPlayers: RoomPlayer[] = []
let lastMissionEventSequence = 0
let localDownedFor = 0

const guardViews: THREE.Group[] = []
const arrowEffects: { line: THREE.Line; age: number }[] = []
interface RemoteView {
  view: THREE.Group
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
  const isHero = isRobin || isMarian
  const tunicColor = isRobin ? palette.green : isMarian ? 0x4d536f : palette.red
  const tunic = mesh(new THREE.CylinderGeometry(0.38, 0.52, 1.35, 8), tunicColor)
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
  if (isHero) {
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
  scene.add(cart)
  return cart
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
    lobbyCode.textContent = roomCode
    missionRoomCode.textContent = roomCode
    roomCodeInput.value = roomCode
    roomLobby.classList.remove("hidden")
    lobbyStatus.textContent = "Share this code, then ready up together."
  },
  onRoomState: (_roomCode, phase, players) => {
    currentRoomPlayers = players
    renderParty(players)
    const localPlayer = players.find((player) => player.id === multiplayer.playerId)
    localReady = localPlayer?.ready ?? false
    if (localPlayer) {
      state.player.health = localPlayer.health
      if (localPlayer.characterId !== selectedCharacter) selectLocalCharacter(localPlayer.characterId, false)
    }
    readyButton.textContent = localReady ? "NOT READY" : "READY UP"
    if (phase === "mission") {
      multiplayerActive = true
      running = true
      intro.scrollTop = 0
      intro.classList.add("closed")
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
    applyMissionSnapshot(mission)
  },
  onError: (message) => {
    lobbyStatus.textContent = message
    showToast(message)
  },
  onConnection: (connected) => {
    lobbyStatus.textContent = connected ? "Connected to Sherwood" : "Connection lost — reconnect with the same code"
  },
})

function applyMissionSnapshot(mission: MissionSnapshot): void {
  state.heat = mission.heat
  state.cartCoin = mission.cartCoin
  state.delivered = mission.delivered
  state.won = mission.status === "succeeded"
  state.lost = mission.status === "failed"
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
}

function showMissionEvent(event: MissionEvent): void {
  const messages: Partial<Record<MissionEvent["type"], string>> = {
    cart_robbed: "THE TAX CART IS OURS — RUN!",
    loot_delivered: "COIN RETURNED TO THE PEOPLE",
    guard_stunned: "Guard stunned",
    player_hit: "The Sheriff strikes!",
    player_downed: "AN OUTLAW IS DOWN",
    player_revived: "OUTLAW RESCUED",
    player_captured: "AN OUTLAW WAS CAPTURED",
    loot_transferred: "COIN HANDED OFF",
    ping_sent: "SIGNAL PLACED",
    signature_used: "SIGNATURE UNLEASHED",
    mission_succeeded: "SHERWOOD RISES",
    mission_failed: "THE BAND HAS FALLEN",
  }
  const message = messages[event.type]
  if (message) showToast(message)
}

function syncPingViews(pings: WorldPing[]): void {
  const activeIds = new Set(pings.map((ping) => ping.id))
  for (const ping of pings) {
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

function renderParty(players: RoomPlayer[]): void {
  partyList.replaceChildren()
  missionPartyList.replaceChildren()
  for (const player of players) {
    const item = document.createElement("li")
    item.classList.toggle("ready", player.ready)
    item.textContent = `${player.ready ? "✓" : "○"} ${player.displayName} · ${player.characterId === "marian" ? "Marian" : "Robin"}${player.connected ? "" : " · reconnecting"}`
    partyList.append(item)

    const compact = document.createElement("li")
    compact.classList.toggle("local", player.id === multiplayer.playerId)
    compact.classList.toggle("disconnected", !player.connected)
    const presence = document.createElement("i")
    presence.className = "presence"
    const identity = document.createElement("span")
    identity.className = "identity"
    identity.textContent = `${player.displayName} · ${player.characterId === "marian" ? "Marian" : "Robin"}`
    const vitality = document.createElement("b")
    vitality.className = "vitality"
    vitality.textContent = player.downedFor > 0 ? `DOWN ${Math.ceil(player.downedFor)}s` : "♥".repeat(Math.max(0, player.health))
    compact.append(presence, identity, vitality)
    missionPartyList.append(compact)
  }
  lobbyStatus.textContent = players.length < 2 ? "Waiting for another outlaw…" : "Ready together to begin."
}

function ensureRemotePlayers(players: RoomPlayer[]): void {
  const activeIds = new Set(players.filter((player) => player.id !== multiplayer.playerId).map((player) => player.id))
  for (const player of players) {
    if (player.id === multiplayer.playerId || remoteViews.has(player.id)) continue
    const view = createCharacter(player.characterId)
    view.position.set(player.position.x, 0, player.position.z)
    scene.add(view)
    const remote: RemoteView = {
      view,
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
        view.clear()
        const ranger = prepareRangerInstance(asset.scene)
        view.add(ranger)
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
  let x = 0
  let z = 0
  if (keys.has("KeyA") || keys.has("ArrowLeft")) x -= 1
  if (keys.has("KeyD") || keys.has("ArrowRight")) x += 1
  if (keys.has("KeyW") || keys.has("ArrowUp")) z -= 1
  if (keys.has("KeyS") || keys.has("ArrowDown")) z += 1
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

function useSignature(): void {
  if (multiplayerActive) {
    multiplayer.sendAction("signature")
    return
  }
  const result = activateSignature(state)
  const messages: Record<string, string> = {
    "marian-veil": "MARIAN'S VEIL — PURSUIT BROKEN",
    "robin-volley": "TWIN SHOT — GUARDS PINNED",
    "volley-missed": "No guards in Twin Shot range",
    "signature-unavailable": `Signature ready in ${Math.ceil(state.player.signatureCooldown)}s`,
  }
  showToast(messages[result.event] ?? result.event)
}

function isModalOpen(): boolean {
  return !helpPanel.classList.contains("hidden") || !leaderboardPanel.classList.contains("hidden")
}

async function openLeaderboard(): Promise<void> {
  leaderboardPanel.classList.remove("hidden")
  leaderboardState.textContent = "Loading the global board…"
  leaderboardList.replaceChildren()
  const board = await loadLeaderboard()
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
    detail.textContent = `${entry.characterId === "marian" ? "Maid Marian" : "Robin Hood"} · ${entry.grade} · ${entry.missionSeconds}s`
    score.textContent = entry.score.toLocaleString()
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
  lootElement.textContent = String(state.player.loot)
  signatureElement.textContent = state.player.signatureCooldown > 0 ? `${Math.ceil(state.player.signatureCooldown)}s` : "READY"
  heatElement.style.width = `${state.heat}%`
  heatWrap.classList.toggle("visible", state.heat > 3)
  progressElement.style.width = `${Math.min(100, (state.delivered / DELIVERY_TARGET) * 100)}%`
  promptElement.textContent = localDownedFor > 0 ? `DOWNED · ${Math.ceil(localDownedFor)}s for a teammate to revive you` : getContextPrompt(state)
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
    : `The guards caught ${state.player.characterId === "marian" ? "Marian" : "Robin"}. Grade ${mastery.grade} · ${mastery.score.toLocaleString()} points. Change your route and time your signature.`
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
  const player = state.player.position
  playerView.position.set(player.x, Math.sin(elapsed * 9) * 0.035, player.z)
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
    view.position.set(guard.position.x, guard.stunnedFor > 0 ? 0.05 : Math.sin(elapsed * 7 + index) * 0.025, guard.position.z)
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
    const pulse = 1 + Math.sin(age * 6) * 0.08
    view.scale.setScalar(pulse)
    const sprite = view.children[1]
    if (sprite) sprite.position.y = 1.55 + Math.sin(age * 4) * 0.12
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
}

function animate(): void {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.05)
  const elapsed = clock.elapsedTime
  if (running && isModalOpen()) {
    syncViews(elapsed, dt)
    renderer.render(scene, camera)
    return
  }
  if (running) {
    const move = getMoveInput()
    let events: string[] = []
    if (multiplayerActive) {
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
    if (state.won || state.lost) showEnding(state.won)
  }
  syncViews(elapsed, dt)
  renderer.render(scene, camera)
}

function predictMultiplayerMovement(move: Vec2, dt: number): void {
  const length = Math.hypot(move.x, move.z)
  if (length <= 0.001 || state.player.health <= 0 || localDownedFor > 0) return
  const speed = state.player.characterId === "marian" ? 6.75 : 6.2
  const lootPenalty = Math.max(0.68, 1 - state.player.loot / 600)
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
  running = true
  intro.scrollTop = 0
  intro.classList.add("closed")
  clock.getDelta()
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

characterButtons.forEach((button) => {
  button.addEventListener("click", () => {
    if (running) return
    selectLocalCharacter(button.dataset.character === "marian" ? "marian" : "robin", true)
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

helpButton.addEventListener("click", () => helpPanel.classList.remove("hidden"))
closeHelp.addEventListener("click", () => helpPanel.classList.add("hidden"))
leaderboardButton.addEventListener("click", () => void openLeaderboard())
closeLeaderboard.addEventListener("click", () => leaderboardPanel.classList.add("hidden"))

window.addEventListener("keydown", (event) => {
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault()
  keys.add(event.code)
  if (!running || event.repeat) return
  if (event.code === "Escape") {
    if (!leaderboardPanel.classList.contains("hidden")) leaderboardPanel.classList.add("hidden")
    else helpPanel.classList.toggle("hidden")
    return
  }
  if (isModalOpen()) return
  if (event.code === "KeyE") handleInteraction()
  if (event.code === "Space") fireArrow()
  if (event.code === "KeyQ") useSignature()
  if (multiplayerActive && event.code === "KeyR") sendSupportAction("revive")
  if (multiplayerActive && event.code === "KeyT") sendSupportAction("transfer_loot")
  if (multiplayerActive) {
    const pingByKey: Partial<Record<string, PingKind>> = {
      Digit1: "danger",
      Digit2: "target",
      Digit3: "route",
      Digit4: "loot",
      Digit5: "regroup",
    }
    const ping = pingByKey[event.code]
    if (ping) multiplayer.sendPing(ping)
  }
})

window.addEventListener("keyup", (event) => keys.delete(event.code))

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (!running || isModalOpen()) return
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(pointer, camera)
  if (raycaster.ray.intersectPlane(groundPlane, clickPoint)) {
    clickTarget = { x: clickPoint.x, z: clickPoint.z }
    destinationMarker.position.set(clickPoint.x, 0.08, clickPoint.z)
    destinationMarker.visible = true
  }
})

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
})

window.addEventListener("blur", () => keys.clear())
window.addEventListener("beforeunload", () => unsubscribeLeaderboard?.())
renderer.domElement.addEventListener("webglcontextlost", (event) => {
  event.preventDefault()
  showToast("Graphics paused — restoring Sherwood")
})
renderer.domElement.addEventListener("webglcontextrestored", () => showToast("Sherwood restored"))

updateUI()
syncViews(0, 0.016)
animate()
