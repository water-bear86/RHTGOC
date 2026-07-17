export const GAME_ACTIONS = [
  "moveUp", "moveDown", "moveLeft", "moveRight",
  "cameraLeft", "cameraRight",
  "interact", "fire", "signature", "rescue", "transferLoot",
  "pingDanger", "pingTarget", "pingRoute", "pingLoot", "pingRegroup",
] as const

export type GameAction = typeof GAME_ACTIONS[number]
export type PointerAction = "move" | Exclude<GameAction, "moveUp" | "moveDown" | "moveLeft" | "moveRight">

export interface InputSettings {
  keyboard: Record<GameAction, string>
  controller: Record<Exclude<GameAction, "moveUp" | "moveDown" | "moveLeft" | "moveRight">, number>
  pointer: Record<"primary" | "middle" | "secondary", PointerAction>
  reducedMotion: boolean
  highContrast: boolean
  captions: boolean
  readableText: boolean
  mobileSpectator: boolean
}

export const ACTION_LABELS: Record<GameAction, string> = {
  moveUp: "Move forward",
  moveDown: "Move backward",
  moveLeft: "Move left",
  moveRight: "Move right",
  cameraLeft: "Rotate camera left",
  cameraRight: "Rotate camera right",
  interact: "Interact / give",
  fire: "Loose arrow",
  signature: "Signature",
  rescue: "Free seized outlaw",
  transferLoot: "Share coin",
  pingDanger: "Danger signal",
  pingTarget: "Target signal",
  pingRoute: "Route signal",
  pingLoot: "Loot signal",
  pingRegroup: "Regroup signal",
}

export const DEFAULT_INPUT_SETTINGS: InputSettings = {
  keyboard: {
    moveUp: "KeyW",
    moveDown: "KeyS",
    moveLeft: "KeyA",
    moveRight: "KeyD",
    cameraLeft: "KeyZ",
    cameraRight: "KeyX",
    interact: "KeyE",
    fire: "Space",
    signature: "KeyQ",
    rescue: "KeyR",
    transferLoot: "KeyT",
    pingDanger: "Digit1",
    pingTarget: "Digit2",
    pingRoute: "Digit3",
    pingLoot: "Digit4",
    pingRegroup: "Digit5",
  },
  controller: {
    cameraLeft: 10,
    cameraRight: 11,
    interact: 0,
    fire: 1,
    signature: 2,
    rescue: 3,
    transferLoot: 4,
    pingDanger: 5,
    pingTarget: 6,
    pingRoute: 7,
    pingLoot: 8,
    pingRegroup: 9,
  },
  pointer: { primary: "move", middle: "pingDanger", secondary: "fire" },
  reducedMotion: false,
  highContrast: false,
  captions: true,
  readableText: false,
  mobileSpectator: true,
}

const STORAGE_KEY = "sherwood:input-settings:v1"
const POINTER_ACTIONS = new Set<PointerAction>(["move", ...GAME_ACTIONS.filter((action) => !action.startsWith("move")) as PointerAction[]])

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function copyDefaults(): InputSettings {
  return {
    ...DEFAULT_INPUT_SETTINGS,
    keyboard: { ...DEFAULT_INPUT_SETTINGS.keyboard },
    controller: { ...DEFAULT_INPUT_SETTINGS.controller },
    pointer: { ...DEFAULT_INPUT_SETTINGS.pointer },
  }
}

export function loadInputSettings(storage: StorageLike): InputSettings {
  const defaults = copyDefaults()
  let raw: unknown
  try { raw = JSON.parse(storage.getItem(STORAGE_KEY) ?? "null") }
  catch { return defaults }
  if (!raw || typeof raw !== "object") return defaults
  const value = raw as Partial<InputSettings>
  if (value.keyboard && typeof value.keyboard === "object") {
    for (const action of GAME_ACTIONS) {
      const code = value.keyboard[action]
      if (typeof code === "string" && /^[A-Za-z0-9]+$/.test(code) && code.length <= 24) defaults.keyboard[action] = code
    }
  }
  if (value.controller && typeof value.controller === "object") {
    for (const action of GAME_ACTIONS.filter((candidate) => !candidate.startsWith("move")) as Array<keyof InputSettings["controller"]>) {
      const button = value.controller[action]
      if (Number.isInteger(button) && Number(button) >= 0 && Number(button) <= 31) defaults.controller[action] = Number(button)
    }
  }
  if (value.pointer && typeof value.pointer === "object") {
    for (const button of ["primary", "middle", "secondary"] as const) {
      const action = value.pointer[button]
      if (typeof action === "string" && POINTER_ACTIONS.has(action as PointerAction)) defaults.pointer[button] = action as PointerAction
    }
  }
  for (const option of ["reducedMotion", "highContrast", "captions", "readableText", "mobileSpectator"] as const) {
    if (typeof value[option] === "boolean") defaults[option] = value[option]
  }
  return defaults
}

export function saveInputSettings(storage: StorageLike, settings: InputSettings): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function keyLabel(code: string): string {
  if (code === "Space") return "SPACE"
  if (code.startsWith("Key")) return code.slice(3)
  if (code.startsWith("Digit")) return code.slice(5)
  if (code.startsWith("Arrow")) return code.slice(5).toUpperCase()
  return code.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase()
}
