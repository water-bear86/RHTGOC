import {
  applyScrollDeeds,
  canonicalScrollPayload,
  deriveAchievements,
  emptyScrollRecord,
  levelForExperience,
  normalizeOutlawName,
  normalizeWallet,
  SCROLL_DEED_KINDS,
  SCROLL_GRADES,
  SCROLL_SCHEMA_VERSION,
  type ScrollDeed,
  type ScrollGrade,
  type ScrollRecord,
} from "../shared/scroll-record"

/**
 * The Scroll save file.
 *
 * A player's record lives in three places, in increasing order of authority:
 *
 *   1. this browser (localStorage)  — always writable, always available,
 *   2. the game service             — authoritative for what was actually earned,
 *   3. the Scroll checkpoint on chain — a periodic hash of (2).
 *
 * The rules that follow from that:
 *
 *  - Gameplay never blocks on (2) or (3). Deeds are folded in locally at once
 *    and queued for the service; a player with no wallet and no network still
 *    has a complete, working save file.
 *  - Local state is *provisional*. When the service answers, its record wins
 *    outright — we never merge a local claim into an authoritative record.
 *  - An imported or hand-edited save file cannot grant anything: achievements
 *    and level are recomputed from stats on every load, and stats only move
 *    through deeds the service will re-derive itself.
 */

export const SCROLL_STORAGE_KEY = "sherwood:scroll-record"
export const SCROLL_QUEUE_STORAGE_KEY = "sherwood:scroll-queue"
export const SCROLL_EXPORT_KIND = "sherwood-scroll-save"
/** Deeds waiting on the service. Beyond this the oldest are dropped. */
export const SCROLL_QUEUE_LIMIT = 200

export interface ScrollStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/**
 * How far the player's record has travelled toward being permanent.
 * This is what the scroll's wax seal renders.
 */
export type ScrollCheckpointStatus =
  /** No wallet. The record is real and playable but lives only in this browser. */
  | "unbound"
  /** Wallet connected, no Scroll minted yet. */
  | "unsealed"
  /** Changes are folded in locally and waiting to reach the service. */
  | "pending"
  /** The service has the record; it is queued for the next on-chain checkpoint. */
  | "recorded"
  /** The on-chain checkpoint matches the record exactly. */
  | "sealed"
  /** The on-chain checkpoint disagrees with the record. Needs reconciliation. */
  | "diverged"

/** The on-chain anchor, as reported by the Scroll adapter. */
export interface ScrollAnchor {
  tokenId: string
  version: number
  stateRoot: string
  timestamp: number
}

export interface ScrollSyncState {
  status: ScrollCheckpointStatus
  anchor: ScrollAnchor | null
  /** Deeds not yet acknowledged by the service. */
  queuedDeeds: number
  /** Last successful service sync, ms since epoch, or null. */
  syncedAt: number | null
  /** Present when the last sync attempt failed. Never blocks play. */
  lastError: string | null
}

/**
 * The narrow port the Scroll adapter fulfils. Declared here so the UI can be
 * built and tested against it before the adapter package exists, and so the
 * client never imports chain or AWS specifics directly.
 */
export interface ScrollBackend {
  /** Authoritative record for a wallet, or null if the wallet has no Scroll. */
  fetchRecord(wallet: string): Promise<ScrollRecord | null>
  /** Submit queued deeds. Resolves to the authoritative record afterwards. */
  submitDeeds(wallet: string, deeds: readonly ScrollDeed[]): Promise<ScrollRecord>
  /** Latest on-chain checkpoint for the wallet's Scroll, or null. */
  fetchAnchor(wallet: string): Promise<ScrollAnchor | null>
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

function finiteInt(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
}

function stringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== "string" || entry.length === 0 || entry.length > 64) continue
    seen.add(entry)
    if (seen.size >= limit) break
  }
  return [...seen].sort()
}

function grade(value: unknown): ScrollGrade | null {
  return typeof value === "string" && (SCROLL_GRADES as readonly string[]).includes(value) ? (value as ScrollGrade) : null
}

/**
 * Coerce untrusted JSON into a record. Anything unrecognised is dropped rather
 * than rejected, so a partially-corrupt save still yields a playable scroll —
 * but level and achievements are always recomputed, never taken from input.
 */
export function parseScrollRecord(value: unknown): ScrollRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== SCROLL_SCHEMA_VERSION) return null

  const rawStats = (raw.stats && typeof raw.stats === "object" && !Array.isArray(raw.stats) ? raw.stats : {}) as Record<string, unknown>
  const base = emptyScrollRecord(typeof raw.outlawName === "string" ? raw.outlawName : undefined)

  const record: ScrollRecord = {
    ...base,
    wallet: normalizeWallet(raw.wallet as string | null | undefined),
    scrollTokenId: typeof raw.scrollTokenId === "string" && /^[0-9]{1,78}$/.test(raw.scrollTokenId) ? raw.scrollTokenId : null,
    experience: finiteInt(raw.experience),
    fineries: stringArray(raw.fineries, 64),
    sealedDeeds: stringArray(raw.sealedDeeds, 400),
    stats: {
      matches: finiteInt(rawStats.matches),
      captures: finiteInt(rawStats.captures),
      rescues: finiteInt(rawStats.rescues),
      coinReturned: finiteInt(rawStats.coinReturned),
      cleanEscapes: finiteInt(rawStats.cleanEscapes),
      regionsExplored: Math.min(25, finiteInt(rawStats.regionsExplored)),
      bestScore: finiteInt(rawStats.bestScore),
      bestGrade: grade(rawStats.bestGrade),
      largestBand: Math.min(4, finiteInt(rawStats.largestBand)),
    },
    chronicle: parseChronicle(raw.chronicle),
    updatedAt: finiteInt(raw.updatedAt),
  }

  // Never trust stored level or achievements — always re-derive.
  record.level = levelForExperience(record.experience)
  record.achievements = deriveAchievements(record)
  return record
}

function parseChronicle(value: unknown): ScrollRecord["chronicle"] {
  if (!Array.isArray(value)) return []
  const entries: ScrollRecord["chronicle"] = []
  for (const entry of value.slice(-60)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
    const raw = entry as Record<string, unknown>
    if (typeof raw.id !== "string" || typeof raw.text !== "string") continue
    if (!SCROLL_DEED_KINDS.includes(raw.kind as never)) continue
    entries.push({ id: raw.id.slice(0, 64), kind: raw.kind as ScrollDeed["kind"], at: finiteInt(raw.at), text: raw.text.slice(0, 200) })
  }
  return entries
}

export function parseScrollDeed(value: unknown): ScrollDeed | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== "string" || raw.id.length === 0 || raw.id.length > 64) return null
  if (!SCROLL_DEED_KINDS.includes(raw.kind as never)) return null
  const deed: ScrollDeed = { id: raw.id, kind: raw.kind as ScrollDeed["kind"], at: finiteInt(raw.at) }
  if (raw.amount !== undefined) deed.amount = finiteInt(raw.amount)
  if (typeof raw.missionId === "string") deed.missionId = raw.missionId.slice(0, 64)
  const parsedGrade = grade(raw.grade)
  if (parsedGrade) deed.grade = parsedGrade
  if (raw.score !== undefined) deed.score = finiteInt(raw.score)
  if (raw.partySize !== undefined) deed.partySize = Math.max(1, Math.min(4, finiteInt(raw.partySize, 1)))
  if (typeof raw.characterId === "string") deed.characterId = raw.characterId.slice(0, 32)
  if (typeof raw.fineryId === "string") deed.fineryId = raw.fineryId.slice(0, 64)
  return deed
}

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

export function loadScrollRecord(storage: ScrollStorageLike): ScrollRecord {
  try {
    const raw = storage.getItem(SCROLL_STORAGE_KEY)
    if (!raw) return emptyScrollRecord()
    return parseScrollRecord(JSON.parse(raw)) ?? emptyScrollRecord()
  } catch {
    return emptyScrollRecord()
  }
}

export function saveScrollRecord(storage: ScrollStorageLike, record: ScrollRecord): boolean {
  try {
    storage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(record))
    return true
  } catch {
    return false
  }
}

export function loadScrollQueue(storage: ScrollStorageLike): ScrollDeed[] {
  try {
    const raw = storage.getItem(SCROLL_QUEUE_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const deeds: ScrollDeed[] = []
    for (const entry of parsed) {
      const deed = parseScrollDeed(entry)
      if (deed) deeds.push(deed)
    }
    return deeds.slice(-SCROLL_QUEUE_LIMIT)
  } catch {
    return []
  }
}

export function saveScrollQueue(storage: ScrollStorageLike, deeds: readonly ScrollDeed[]): boolean {
  try {
    storage.setItem(SCROLL_QUEUE_STORAGE_KEY, JSON.stringify(deeds.slice(-SCROLL_QUEUE_LIMIT)))
    return true
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * Export / import — the portable save file
 * ------------------------------------------------------------------ */

export interface ScrollExportFile {
  kind: typeof SCROLL_EXPORT_KIND
  schemaVersion: typeof SCROLL_SCHEMA_VERSION
  exportedAt: number
  /** Canonical payload of the record, so tampering is detectable on import. */
  canonical: string
  record: ScrollRecord
}

export function exportScrollFile(record: ScrollRecord, now = Date.now()): string {
  const file: ScrollExportFile = {
    kind: SCROLL_EXPORT_KIND,
    schemaVersion: SCROLL_SCHEMA_VERSION,
    exportedAt: now,
    canonical: canonicalScrollPayload(record),
    record,
  }
  return JSON.stringify(file, null, 2)
}

export interface ScrollImportResult {
  record: ScrollRecord
  /** True when the file's own canonical payload matched the record it carried. */
  intact: boolean
}

/**
 * Import a save file. A file that has been edited still imports — the record is
 * re-derived and cannot claim anything unearned — but it is reported as not
 * intact so the UI can say the seal is broken.
 */
export function importScrollFile(text: string): ScrollImportResult | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const file = parsed as Record<string, unknown>
  if (file.kind !== SCROLL_EXPORT_KIND) return null
  const record = parseScrollRecord(file.record)
  if (!record) return null
  return { record, intact: file.canonical === canonicalScrollPayload(record) }
}

/* ------------------------------------------------------------------ *
 * Sync
 * ------------------------------------------------------------------ */

/**
 * SHA-256 of the canonical payload, hex, `0x`-prefixed — the state root the
 * checkpoint commits to. Uses WebCrypto; returns null where it is unavailable
 * (an insecure origin), which downgrades the seal rather than breaking play.
 */
export async function scrollStateRoot(record: ScrollRecord): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) return null
  try {
    const bytes = new TextEncoder().encode(canonicalScrollPayload(record))
    const digest = await subtle.digest("SHA-256", bytes)
    return `0x${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`
  } catch {
    return null
  }
}

export function scrollSyncStatus(options: {
  record: ScrollRecord
  anchor: ScrollAnchor | null
  queuedDeeds: number
  stateRoot: string | null
  syncedAt: number | null
}): ScrollCheckpointStatus {
  if (!options.record.wallet) return "unbound"
  if (!options.record.scrollTokenId) return "unsealed"
  if (options.queuedDeeds > 0) return "pending"
  if (!options.anchor) return "recorded"
  if (options.stateRoot === null) return "recorded"
  return options.anchor.stateRoot.toLowerCase() === options.stateRoot.toLowerCase() ? "sealed" : "diverged"
}

/**
 * Reconcile a local record against the authoritative one.
 *
 * The service record wins on everything it owns. Local deeds the service has
 * not yet seen are re-folded on top so the player does not watch progress
 * vanish, but they stay queued until the service confirms them.
 */
export function reconcileScrollRecord(
  local: ScrollRecord,
  authoritative: ScrollRecord,
  queued: readonly ScrollDeed[],
): { record: ScrollRecord; stillQueued: ScrollDeed[] } {
  const sealed = new Set(authoritative.sealedDeeds)
  const stillQueued = queued.filter((deed) => !sealed.has(deed.id))
  const record = applyScrollDeeds(
    { ...authoritative, outlawName: normalizeOutlawName(local.outlawName) },
    stillQueued,
  )
  return { record, stillQueued }
}
