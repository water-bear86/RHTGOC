import { ALL_TUTORIAL_LESSONS, type TutorialCompletionRevisions, type TutorialModuleId, type TutorialPlan } from "./tutorial-content"

export interface TutorialStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface TutorialProgress {
  schemaVersion: typeof TUTORIAL_PROGRESS_SCHEMA_VERSION
  completed: TutorialCompletionRevisions
}

export const TUTORIAL_PROGRESS_STORAGE_KEY = "sherwood:tutorial-progress"
export const TUTORIAL_PROGRESS_SCHEMA_VERSION = 1 as const

const VALID_MODULE_IDS = new Set<TutorialModuleId>(ALL_TUTORIAL_LESSONS.map((lesson) => lesson.moduleId))

function emptyTutorialProgress(): TutorialProgress {
  return { schemaVersion: TUTORIAL_PROGRESS_SCHEMA_VERSION, completed: {} }
}

export function loadTutorialProgress(storage: TutorialStorageLike): TutorialProgress {
  try {
    const raw = storage.getItem(TUTORIAL_PROGRESS_STORAGE_KEY)
    if (!raw) return emptyTutorialProgress()
    const parsed = JSON.parse(raw) as { schemaVersion?: unknown; completed?: unknown }
    if (parsed.schemaVersion !== TUTORIAL_PROGRESS_SCHEMA_VERSION || !parsed.completed || typeof parsed.completed !== "object" || Array.isArray(parsed.completed)) {
      return emptyTutorialProgress()
    }
    const completed: TutorialCompletionRevisions = {}
    for (const [moduleId, revision] of Object.entries(parsed.completed)) {
      if (!VALID_MODULE_IDS.has(moduleId as TutorialModuleId) || !Number.isInteger(revision) || (revision as number) < 1) continue
      completed[moduleId as TutorialModuleId] = revision as number
    }
    return { schemaVersion: TUTORIAL_PROGRESS_SCHEMA_VERSION, completed }
  } catch {
    return emptyTutorialProgress()
  }
}

export function saveTutorialProgress(storage: TutorialStorageLike, progress: TutorialProgress): boolean {
  try {
    storage.setItem(TUTORIAL_PROGRESS_STORAGE_KEY, JSON.stringify(progress))
    return true
  } catch {
    return false
  }
}

export function completeTutorialPlan(progress: TutorialProgress, plan: TutorialPlan): TutorialProgress {
  const completed = { ...progress.completed }
  for (const lesson of plan.lessons) completed[lesson.moduleId] = Math.max(completed[lesson.moduleId] ?? 0, lesson.revision)
  return { schemaVersion: TUTORIAL_PROGRESS_SCHEMA_VERSION, completed }
}
