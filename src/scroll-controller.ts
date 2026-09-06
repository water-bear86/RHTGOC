import { applyScrollDeed, normalizeOutlawName, normalizeWallet, type ScrollDeed, type ScrollRecord } from "../shared/scroll-record"
import { renderScrollPanel, type ScrollPanelElements } from "./scroll-panel"
import {
  exportScrollFile,
  importScrollFile,
  loadScrollQueue,
  loadScrollRecord,
  reconcileScrollRecord,
  saveScrollQueue,
  saveScrollRecord,
  scrollStateRoot,
  scrollSyncStatus,
  type ScrollAnchor,
  type ScrollBackend,
  type ScrollStorageLike,
  type ScrollSyncState,
} from "./scroll-store"

/**
 * Owns the Scroll's state and its panel, so `main.ts` only has to say when a
 * deed happened and when the player's identity changed.
 *
 * Deliberately standalone: the Scroll never blocks gameplay, never throws into
 * a caller, and works with no wallet, no network, and no backend attached. The
 * backend is injected once the Scroll adapter is available; until then the
 * record is a complete local save file and reports itself honestly as unbound.
 */

export interface ScrollControllerOptions {
  storage?: ScrollStorageLike
  /** Injected once the Scroll adapter package is wired up. */
  backend?: ScrollBackend | null
  /** Called whenever the player should be told something short. */
  notify?: (message: string) => void
}

export interface ScrollController {
  /** Fold a deed in immediately and queue it for the service. */
  record(deed: ScrollDeed): void
  setWallet(wallet: string | null): void
  setOutlawName(name: string): void
  attachBackend(backend: ScrollBackend | null): void
  /** Re-render if the panel is open. */
  refresh(): void
  open(): void
  isOpen(): boolean
  snapshot(): ScrollRecord
}

function query<T extends HTMLElement>(selector: string): T | null {
  return document.querySelector<T>(selector)
}

export function createScrollController(options: ScrollControllerOptions = {}): ScrollController | null {
  const panel = query<HTMLDivElement>("#scroll-panel")
  const button = query<HTMLButtonElement>("#scroll-button")
  if (!panel || !button) return null

  const elements: ScrollPanelElements | null = (() => {
    const illumination = query<HTMLElement>("#scroll-illumination")
    const seal = query<HTMLElement>("#scroll-seal")
    const name = query<HTMLElement>("#scroll-name")
    const level = query<HTMLElement>("#scroll-level")
    const levelDetail = query<HTMLElement>("#scroll-level-detail")
    const levelFill = query<HTMLElement>("#scroll-level-fill")
    const status = query<HTMLElement>("#scroll-status")
    const statusHelp = query<HTMLElement>("#scroll-status-help")
    const identity = query<HTMLElement>("#scroll-identity")
    const stats = query<HTMLElement>("#scroll-stats")
    const achievements = query<HTMLElement>("#scroll-deeds")
    const achievementsCount = query<HTMLElement>("#scroll-deeds-count")
    const chronicle = query<HTMLElement>("#scroll-chronicle")
    if (!illumination || !seal || !name || !level || !levelDetail || !levelFill) return null
    if (!status || !statusHelp || !identity || !stats || !achievements || !achievementsCount || !chronicle) return null
    return { illumination, seal, name, level, levelDetail, levelFill, status, statusHelp, identity, stats, achievements, achievementsCount, chronicle }
  })()
  if (!elements) return null

  // Bind the narrowed values so the closures below keep the non-null types.
  const panelElement = panel
  const panelParts = elements

  const storage: ScrollStorageLike = options.storage ?? safeLocalStorage()
  const notify = options.notify ?? (() => {})
  let backend = options.backend ?? null

  let record = loadScrollRecord(storage)
  let queue = loadScrollQueue(storage)
  let anchor: ScrollAnchor | null = null
  let stateRoot: string | null = null
  let syncedAt: number | null = null
  let lastError: string | null = null
  let syncing = false

  function sync(): ScrollSyncState {
    return {
      status: scrollSyncStatus({ record, anchor, queuedDeeds: queue.length, stateRoot, syncedAt }),
      anchor,
      queuedDeeds: queue.length,
      syncedAt,
      lastError,
    }
  }

  function persist(): void {
    saveScrollRecord(storage, record)
    saveScrollQueue(storage, queue)
  }

  function render(): void {
    if (panelElement.classList.contains("hidden")) return
    renderScrollPanel(panelParts, record, sync())
  }

  /** Recompute the state root off the critical path, then re-render. */
  function refreshStateRoot(): void {
    void scrollStateRoot(record)
      .then((root) => {
        stateRoot = root
        render()
      })
      .catch(() => {})
  }

  /**
   * Push queued deeds to the service. Failures are recorded and retried on the
   * next deed or panel open — never surfaced as an error the player must act on,
   * because play does not depend on this succeeding.
   */
  function flush(): void {
    if (syncing || !backend || queue.length === 0) return
    const wallet = record.wallet
    if (!wallet) return
    syncing = true
    const submitted = [...queue]
    void backend
      .submitDeeds(wallet, submitted)
      .then(async (authoritative) => {
        const reconciled = reconcileScrollRecord(record, authoritative, queue)
        record = reconciled.record
        queue = reconciled.stillQueued
        syncedAt = Date.now()
        lastError = null
        anchor = await backend!.fetchAnchor(wallet).catch(() => anchor)
        persist()
        refreshStateRoot()
        render()
      })
      .catch((error: unknown) => {
        lastError = error instanceof Error ? error.message : "could not reach the Scroll service"
        render()
      })
      .finally(() => {
        syncing = false
      })
  }

  const controller: ScrollController = {
    record(deed) {
      const next = applyScrollDeed(record, deed)
      if (next === record) return
      const earnedBefore = new Set(record.achievements)
      record = next
      queue = [...queue, deed]
      persist()
      for (const achievement of record.achievements) {
        if (!earnedBefore.has(achievement)) notify("A new deed is written on your scroll")
      }
      refreshStateRoot()
      render()
      flush()
    },
    setWallet(wallet) {
      const normalized = normalizeWallet(wallet)
      if (normalized === record.wallet) return
      record = { ...record, wallet: normalized }
      if (!normalized) {
        anchor = null
        syncedAt = null
      }
      persist()
      refreshStateRoot()
      render()
      flush()
    },
    setOutlawName(name) {
      const normalized = normalizeOutlawName(name)
      if (normalized === record.outlawName) return
      record = { ...record, outlawName: normalized }
      persist()
      render()
    },
    attachBackend(next) {
      backend = next
      flush()
    },
    refresh: render,
    open() {
      render()
    },
    isOpen() {
      return !panelElement.classList.contains("hidden")
    },
    snapshot() {
      return record
    },
  }

  /* ---- export / import -------------------------------------------- */

  const exportButton = query<HTMLButtonElement>("#scroll-export")
  const importButton = query<HTMLButtonElement>("#scroll-import")
  const importFile = query<HTMLInputElement>("#scroll-import-file")
  const note = query<HTMLElement>("#scroll-note")

  exportButton?.addEventListener("click", () => {
    try {
      const blob = new Blob([exportScrollFile(record)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `sherwood-scroll-${record.outlawName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`
      link.click()
      URL.revokeObjectURL(url)
      if (note) note.textContent = "Scroll saved. Keep the file safe — it restores this record on any device."
    } catch {
      if (note) note.textContent = "This browser would not let the scroll be saved."
    }
  })

  importButton?.addEventListener("click", () => importFile?.click())

  importFile?.addEventListener("change", () => {
    const file = importFile.files?.[0]
    if (!file) return
    void file
      .text()
      .then((text) => {
        const imported = importScrollFile(text)
        if (!imported) {
          if (note) note.textContent = "That file is not a Sherwood scroll."
          return
        }
        record = imported.record
        queue = []
        persist()
        refreshStateRoot()
        render()
        if (note) {
          note.textContent = imported.intact
            ? "Scroll restored."
            : "Scroll restored, but its seal was broken — anything unearned has been left off."
        }
      })
      .catch(() => {
        if (note) note.textContent = "That file could not be read."
      })
      .finally(() => {
        importFile.value = ""
      })
  })

  refreshStateRoot()
  return controller
}

function safeLocalStorage(): ScrollStorageLike {
  try {
    const probe = "sherwood:scroll-probe"
    window.localStorage.setItem(probe, "1")
    window.localStorage.removeItem(probe)
    return window.localStorage
  } catch {
    // Private browsing, or storage disabled. The scroll still works for the
    // session; it just cannot outlive the tab.
    const memory = new Map<string, string>()
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => void memory.set(key, value),
      removeItem: (key) => void memory.delete(key),
    }
  }
}
