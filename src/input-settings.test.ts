import { describe, expect, it } from "vitest"
import { DEFAULT_INPUT_SETTINGS, keyLabel, loadInputSettings, saveInputSettings } from "./input-settings"

function memoryStorage(seed: string | null = null) {
  let value = seed
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next },
    value: () => value,
  }
}

describe("input and accessibility settings", () => {
  it("uses safe defaults for corrupt storage", () => {
    expect(loadInputSettings(memoryStorage("not-json"))).toEqual(DEFAULT_INPUT_SETTINGS)
  })

  it("sanitizes remapped keys, controller buttons, and pointer actions", () => {
    const storage = memoryStorage(JSON.stringify({
      keyboard: { fire: "KeyF", interact: "<script>" },
      controller: { fire: 12, signature: 99 },
      pointer: { primary: "interact", secondary: "erase-database" },
      highContrast: true,
    }))
    const settings = loadInputSettings(storage)
    expect(settings.keyboard.fire).toBe("KeyF")
    expect(settings.keyboard.interact).toBe(DEFAULT_INPUT_SETTINGS.keyboard.interact)
    expect(settings.controller.fire).toBe(12)
    expect(settings.controller.signature).toBe(DEFAULT_INPUT_SETTINGS.controller.signature)
    expect(settings.pointer.primary).toBe("interact")
    expect(settings.pointer.secondary).toBe(DEFAULT_INPUT_SETTINGS.pointer.secondary)
    expect(settings.highContrast).toBe(true)
  })

  it("round-trips settings and formats physical key labels", () => {
    const storage = memoryStorage()
    const settings = loadInputSettings(storage)
    settings.keyboard.signature = "ArrowUp"
    saveInputSettings(storage, settings)
    expect(loadInputSettings(storage).keyboard.signature).toBe("ArrowUp")
    expect(keyLabel("Space")).toBe("SPACE")
    expect(keyLabel("KeyQ")).toBe("Q")
  })
})
