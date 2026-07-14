import { describe, expect, it } from "vitest"
import { buildTutorialPlan } from "./tutorial-content"
import { TUTORIAL_PROGRESS_STORAGE_KEY, completeTutorialPlan, loadTutorialProgress, saveTutorialProgress, type TutorialStorageLike } from "./tutorial-progress"

class MemoryStorage implements TutorialStorageLike {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

class FailingStorage extends MemoryStorage {
  override setItem(): void { throw new Error("storage unavailable") }
}

describe("tutorial progress", () => {
  it("round-trips revisioned independent completion", () => {
    const storage = new MemoryStorage()
    const plan = buildTutorialPlan("much", "prison-wagon")!
    const completed = completeTutorialPlan(loadTutorialProgress(storage), plan)
    expect(saveTutorialProgress(storage, completed)).toBe(true)
    expect(loadTutorialProgress(storage)).toEqual(completed)
  })

  it("recovers safely from corrupt or future-schema storage", () => {
    const storage = new MemoryStorage()
    storage.values.set(TUTORIAL_PROGRESS_STORAGE_KEY, "not json")
    expect(loadTutorialProgress(storage).completed).toEqual({})
    storage.values.set(TUTORIAL_PROGRESS_STORAGE_KEY, JSON.stringify({ schemaVersion: 99, completed: { fieldcraft: 999 } }))
    expect(loadTutorialProgress(storage).completed).toEqual({})
  })

  it("drops unknown modules and invalid revisions", () => {
    const storage = new MemoryStorage()
    storage.values.set(TUTORIAL_PROGRESS_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      completed: { fieldcraft: 1, "character:robin": 0, "mission:made-up": 4, prototype: 3 },
    }))
    expect(loadTutorialProgress(storage).completed).toEqual({ fieldcraft: 1 })
  })

  it("does not mutate the prior progress object", () => {
    const progress = loadTutorialProgress(new MemoryStorage())
    const plan = buildTutorialPlan("robin", "tax-cart")!
    const completed = completeTutorialPlan(progress, plan)
    expect(progress.completed).toEqual({})
    expect(completed.completed).not.toBe(progress.completed)
  })

  it("keeps completed session progress usable when persistence fails", () => {
    const storage = new FailingStorage()
    const plan = buildTutorialPlan("robin", "tax-cart")!
    const sessionProgress = completeTutorialPlan(loadTutorialProgress(storage), plan)
    expect(saveTutorialProgress(storage, sessionProgress)).toBe(false)
    expect(buildTutorialPlan("robin", "tax-cart", sessionProgress.completed)).toBeNull()
  })
})
