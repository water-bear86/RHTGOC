/**
 * The Scroll: canonical, procedurally-kept record of a player's deeds.
 *
 * This module is the single source of truth for what a player's record *is*
 * and how it is derived. Client and server both import it so that:
 *
 *  - the client can render and hash a record without a round trip, and
 *  - the server can recompute the identical record from the same deeds and
 *    reject anything a client claims that the rules do not produce.
 *
 * Nothing here talks to storage, the network, or the chain. Awards are always
 * *derived* from recorded deeds — never set directly — so a client cannot
 * grant itself an achievement, a level, or a finery by editing its save file.
 *
 * The canonical serialization is stable and deterministic: it is what gets
 * hashed into the on-chain checkpoint state root, so any change to
 * `canonicalScrollPayload` is a breaking schema change and must bump
 * SCROLL_SCHEMA_VERSION.
 */

export const SCROLL_SCHEMA_VERSION = 1 as const

/** Deeds are the only way a record changes. Each is idempotent by `id`. */
export const SCROLL_DEED_KINDS = [
  "mission-completed",
  "guard-captured",
  "ally-rescued",
  "coin-returned",
  "region-explored",
  "clean-escape",
  "finery-unlocked",
] as const
export type ScrollDeedKind = (typeof SCROLL_DEED_KINDS)[number]

export type ScrollGrade = "S" | "A" | "B" | "C" | "D"
export const SCROLL_GRADES: readonly ScrollGrade[] = ["S", "A", "B", "C", "D"]

export interface ScrollDeed {
  /** Stable unique id. Replaying the same id is a no-op (idempotency). */
  id: string
  kind: ScrollDeedKind
  /** Milliseconds since epoch. Ordering only; excluded from the state hash. */
  at: number
  /** Countable magnitude: guards captured, coin returned, regions seen. */
  amount?: number
  /** Mission slug for mission-completed deeds. */
  missionId?: string
  grade?: ScrollGrade
  score?: number
  /** Players in the band, including the player. 1 = solo. */
  partySize?: number
  characterId?: string
  /** Finery id for finery-unlocked deeds. */
  fineryId?: string
}

export interface ScrollStats {
  matches: number
  captures: number
  rescues: number
  coinReturned: number
  cleanEscapes: number
  regionsExplored: number
  bestScore: number
  bestGrade: ScrollGrade | null
  largestBand: number
}

export interface ScrollRecord {
  schemaVersion: typeof SCROLL_SCHEMA_VERSION
  /** Lowercase 0x address, or null while the player is a guest. */
  wallet: string | null
  /** Set once a Scroll is minted; null means this record is unanchored. */
  scrollTokenId: string | null
  outlawName: string
  level: number
  experience: number
  /** Sorted, unique. Derived from stats — never assigned directly. */
  achievements: string[]
  /** Sorted, unique. Server-confirmed cosmetic unlocks. */
  fineries: string[]
  stats: ScrollStats
  /** Append-only ledger, newest last, capped at CHRONICLE_LIMIT. */
  chronicle: ScrollChronicleEntry[]
  /** Deed ids already folded in, sorted. Guarantees idempotent replay. */
  sealedDeeds: string[]
  /** Wall clock of the last change. Excluded from the canonical hash. */
  updatedAt: number
}

export interface ScrollChronicleEntry {
  id: string
  kind: ScrollDeedKind
  at: number
  text: string
}

export const CHRONICLE_LIMIT = 60
/**
 * Every accepted deed id is retained permanently, so replaying any historical
 * deed id stays a no-op for the life of the record. Idempotency is a
 * correctness guarantee and must not be traded away to bound this array; the
 * set only grows with genuinely new deeds, since duplicates never fold in.
 */

/* ------------------------------------------------------------------ *
 * Levels
 * ------------------------------------------------------------------ */

/**
 * Experience needed to *reach* a level. Quadratic so early levels come fast
 * and later ones are a real commitment. Level 1 is the starting level.
 */
export function experienceForLevel(level: number): number {
  if (!Number.isFinite(level) || level <= 1) return 0
  const steps = Math.floor(level) - 1
  return 50 * steps * (steps + 1)
}

export function levelForExperience(experience: number): number {
  if (!Number.isFinite(experience) || experience <= 0) return 1
  let level = 1
  while (level < MAX_SCROLL_LEVEL && experienceForLevel(level + 1) <= experience) level += 1
  return level
}

export const MAX_SCROLL_LEVEL = 60

export interface ScrollLevelProgress {
  level: number
  intoLevel: number
  neededForNext: number
  fraction: number
  atMax: boolean
}

export function scrollLevelProgress(experience: number): ScrollLevelProgress {
  const level = levelForExperience(experience)
  if (level >= MAX_SCROLL_LEVEL) {
    return { level, intoLevel: 0, neededForNext: 0, fraction: 1, atMax: true }
  }
  const floor = experienceForLevel(level)
  const ceiling = experienceForLevel(level + 1)
  const span = Math.max(1, ceiling - floor)
  const intoLevel = Math.max(0, Math.min(span, Math.floor(experience) - floor))
  return { level, intoLevel, neededForNext: span, fraction: intoLevel / span, atMax: false }
}

/* ------------------------------------------------------------------ *
 * Experience awards
 * ------------------------------------------------------------------ */

const GRADE_BONUS: Record<ScrollGrade, number> = { S: 400, A: 260, B: 160, C: 90, D: 40 }

/** Deterministic experience value of a deed. Never negative. */
export function experienceForDeed(deed: ScrollDeed): number {
  const amount = Math.max(0, Math.floor(deed.amount ?? 0))
  switch (deed.kind) {
    case "mission-completed":
      return 120 + (deed.grade ? GRADE_BONUS[deed.grade] : 0)
    case "guard-captured":
      return 12 * amount
    case "ally-rescued":
      return 45 * amount
    case "coin-returned":
      return Math.floor(amount / 10)
    case "region-explored":
      return 20 * amount
    case "clean-escape":
      return 80
    case "finery-unlocked":
      return 0
  }
}

/* ------------------------------------------------------------------ *
 * Achievements — derived, never assigned
 * ------------------------------------------------------------------ */

export interface ScrollAchievement {
  id: string
  name: string
  /** Shown on the scroll under the name. */
  description: string
  /** True when the record's stats satisfy the achievement. */
  earned: (record: ScrollRecord) => boolean
  /** 0..1 progress toward earning it, for the not-yet-earned display. */
  progress: (record: ScrollRecord) => number
}

function ratio(value: number, target: number): number {
  if (target <= 0) return 1
  return Math.max(0, Math.min(1, value / target))
}

export const SCROLL_ACHIEVEMENTS: readonly ScrollAchievement[] = [
  {
    id: "first_take",
    name: "First Take",
    description: "Complete a mission.",
    earned: (r) => r.stats.matches >= 1,
    progress: (r) => ratio(r.stats.matches, 1),
  },
  {
    id: "sherwood_defender",
    name: "Sherwood Defender",
    description: "Complete ten missions.",
    earned: (r) => r.stats.matches >= 10,
    progress: (r) => ratio(r.stats.matches, 10),
  },
  {
    id: "tax_collector",
    name: "Tax Collector",
    description: "Return five thousand coin to the people.",
    earned: (r) => r.stats.coinReturned >= 5_000,
    progress: (r) => ratio(r.stats.coinReturned, 5_000),
  },
  {
    id: "ghost_of_the_greenwood",
    name: "Ghost of the Greenwood",
    description: "Escape five times without being seen.",
    earned: (r) => r.stats.cleanEscapes >= 5,
    progress: (r) => ratio(r.stats.cleanEscapes, 5),
  },
  {
    id: "iron_road_breaker",
    name: "Breaker of the Iron Road",
    description: "Free five allies from the Sheriff's wagons.",
    earned: (r) => r.stats.rescues >= 5,
    progress: (r) => ratio(r.stats.rescues, 5),
  },
  {
    id: "master_of_the_bow",
    name: "Master of the Bow",
    description: "Earn an S on any mission.",
    earned: (r) => r.stats.bestGrade === "S",
    progress: (r) => (r.stats.bestGrade === "S" ? 1 : ratio(r.stats.bestScore, 8_200)),
  },
  {
    id: "cartographer",
    name: "Cartographer of Sherwood",
    description: "Walk all twenty-five regions.",
    earned: (r) => r.stats.regionsExplored >= 25,
    progress: (r) => ratio(r.stats.regionsExplored, 25),
  },
  {
    id: "hundred_hands",
    name: "Hundred Hands",
    description: "Take a hundred of the Sheriff's guards out of the fight.",
    earned: (r) => r.stats.captures >= 100,
    progress: (r) => ratio(r.stats.captures, 100),
  },
  {
    id: "merry_band",
    name: "A Merry Band",
    description: "Ride out with a full band of four.",
    earned: (r) => r.stats.largestBand >= 4,
    progress: (r) => ratio(r.stats.largestBand, 4),
  },
  {
    id: "evergreen",
    name: "Evergreen",
    description: "Reach the tenth level of renown.",
    earned: (r) => r.level >= 10,
    progress: (r) => ratio(r.level, 10),
  },
]

const ACHIEVEMENTS_BY_ID = new Map(SCROLL_ACHIEVEMENTS.map((a) => [a.id, a]))

export function scrollAchievement(id: string): ScrollAchievement | null {
  return ACHIEVEMENTS_BY_ID.get(id) ?? null
}

/** Recompute the full achievement set from stats. Order is stable (sorted). */
export function deriveAchievements(record: ScrollRecord): string[] {
  return SCROLL_ACHIEVEMENTS.filter((a) => a.earned(record)).map((a) => a.id).sort()
}

/* ------------------------------------------------------------------ *
 * Records and deeds
 * ------------------------------------------------------------------ */

export function emptyScrollRecord(outlawName = "Greenhood"): ScrollRecord {
  return {
    schemaVersion: SCROLL_SCHEMA_VERSION,
    wallet: null,
    scrollTokenId: null,
    outlawName: normalizeOutlawName(outlawName),
    level: 1,
    experience: 0,
    achievements: [],
    fineries: [],
    stats: {
      matches: 0,
      captures: 0,
      rescues: 0,
      coinReturned: 0,
      cleanEscapes: 0,
      regionsExplored: 0,
      bestScore: 0,
      bestGrade: null,
      largestBand: 0,
    },
    chronicle: [],
    sealedDeeds: [],
    updatedAt: 0,
  }
}

export function normalizeOutlawName(name: string): string {
  const trimmed = (name ?? "").replace(/\s+/g, " ").trim().slice(0, 20)
  return trimmed.length > 0 ? trimmed : "Greenhood"
}

export function normalizeWallet(wallet: string | null | undefined): string | null {
  if (typeof wallet !== "string") return null
  const candidate = wallet.trim().toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(candidate) ? candidate : null
}

function gradeRank(grade: ScrollGrade | null): number {
  return grade === null ? -1 : SCROLL_GRADES.length - SCROLL_GRADES.indexOf(grade)
}

function chronicleText(deed: ScrollDeed): string {
  const amount = Math.max(0, Math.floor(deed.amount ?? 0))
  switch (deed.kind) {
    case "mission-completed":
      return `Rode out on ${deed.missionId ?? "a mission"} and came home with a ${deed.grade ?? "—"}.`
    case "guard-captured":
      return amount === 1 ? "Took a guard out of the fight." : `Took ${amount} guards out of the fight.`
    case "ally-rescued":
      return amount === 1 ? "Freed an ally from the Sheriff." : `Freed ${amount} allies from the Sheriff.`
    case "coin-returned":
      return `Returned ${amount.toLocaleString("en-GB")} coin to the people.`
    case "region-explored":
      return amount === 1 ? "Walked into unmapped Sherwood." : `Walked ${amount} unmapped stretches of Sherwood.`
    case "clean-escape":
      return "Slipped away without ever being seen."
    case "finery-unlocked":
      return `Took up the ${deed.fineryId ?? "finery"}.`
  }
}

/**
 * Fold one deed into a record. Pure and idempotent: replaying a deed whose id
 * is already sealed returns the same record instance.
 *
 * Achievements and level are always recomputed from the resulting stats, so a
 * tampered `achievements` array in an incoming record cannot survive a fold.
 */
export function applyScrollDeed(record: ScrollRecord, deed: ScrollDeed): ScrollRecord {
  if (record.sealedDeeds.includes(deed.id)) return record
  if (!SCROLL_DEED_KINDS.includes(deed.kind)) return record

  const amount = Math.max(0, Math.floor(deed.amount ?? 0))
  const stats: ScrollStats = { ...record.stats }
  const fineries = new Set(record.fineries)

  switch (deed.kind) {
    case "mission-completed": {
      stats.matches += 1
      if (typeof deed.score === "number" && Number.isFinite(deed.score)) {
        stats.bestScore = Math.max(stats.bestScore, Math.floor(deed.score))
      }
      if (deed.grade && gradeRank(deed.grade) > gradeRank(stats.bestGrade)) stats.bestGrade = deed.grade
      if (typeof deed.partySize === "number" && Number.isFinite(deed.partySize)) {
        stats.largestBand = Math.max(stats.largestBand, Math.max(1, Math.min(4, Math.floor(deed.partySize))))
      }
      break
    }
    case "guard-captured":
      stats.captures += amount
      break
    case "ally-rescued":
      stats.rescues += amount
      break
    case "coin-returned":
      stats.coinReturned += amount
      break
    case "region-explored":
      stats.regionsExplored = Math.max(stats.regionsExplored, Math.min(25, stats.regionsExplored + amount))
      break
    case "clean-escape":
      stats.cleanEscapes += 1
      break
    case "finery-unlocked":
      if (deed.fineryId) fineries.add(deed.fineryId)
      break
  }

  const experience = record.experience + experienceForDeed(deed)
  const chronicle = [...record.chronicle, { id: deed.id, kind: deed.kind, at: deed.at, text: chronicleText(deed) }]
  const sealedDeeds = [...record.sealedDeeds, deed.id]

  const next: ScrollRecord = {
    ...record,
    experience,
    level: levelForExperience(experience),
    fineries: [...fineries].sort(),
    stats,
    chronicle: chronicle.slice(-CHRONICLE_LIMIT),
    sealedDeeds: sealedDeeds.sort(),
    updatedAt: Math.max(record.updatedAt, deed.at),
  }
  next.achievements = deriveAchievements(next)
  return next
}

export function applyScrollDeeds(record: ScrollRecord, deeds: readonly ScrollDeed[]): ScrollRecord {
  return [...deeds].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id)).reduce(applyScrollDeed, record)
}

/* ------------------------------------------------------------------ *
 * Canonicalization — what gets hashed into the on-chain state root
 * ------------------------------------------------------------------ */

/**
 * Deterministic serialization of a record.
 *
 * Rules, matching the Scroll checkpoint contract:
 *  - object keys in a fixed, explicit order (never `Object.keys` order),
 *  - arrays sorted,
 *  - the wallet lowercased,
 *  - nondeterministic and presentational fields excluded (`updatedAt`,
 *    `chronicle` text, `outlawName`),
 *  - the schema version included, so a schema change changes every root.
 *
 * The chronicle is excluded deliberately: it is a human-readable rendering of
 * deeds we already commit to via `sealedDeeds`, and its prose could otherwise
 * make two identical records hash differently across client versions.
 */
export function canonicalScrollPayload(record: ScrollRecord): string {
  const stats = record.stats
  return JSON.stringify([
    "sherwood-scroll",
    record.schemaVersion,
    normalizeWallet(record.wallet),
    record.scrollTokenId ?? null,
    Math.max(0, Math.floor(record.experience)),
    levelForExperience(record.experience),
    [...record.achievements].sort(),
    [...record.fineries].sort(),
    [
      Math.floor(stats.matches),
      Math.floor(stats.captures),
      Math.floor(stats.rescues),
      Math.floor(stats.coinReturned),
      Math.floor(stats.cleanEscapes),
      Math.floor(stats.regionsExplored),
      Math.floor(stats.bestScore),
      stats.bestGrade ?? null,
      Math.floor(stats.largestBand),
    ],
    [...record.sealedDeeds].sort(),
  ])
}

/**
 * True when two records would produce the same on-chain state root, ignoring
 * presentation and clocks.
 */
export function scrollRecordsAgree(a: ScrollRecord, b: ScrollRecord): boolean {
  return canonicalScrollPayload(a) === canonicalScrollPayload(b)
}
