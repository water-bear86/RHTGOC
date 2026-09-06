import { describe, expect, it } from "vitest"
import {
  applyScrollDeed,
  applyScrollDeeds,
  canonicalScrollPayload,
  CHRONICLE_LIMIT,
  deriveAchievements,
  emptyScrollRecord,
  experienceForDeed,
  experienceForLevel,
  levelForExperience,
  MAX_SCROLL_LEVEL,
  normalizeOutlawName,
  normalizeWallet,
  scrollLevelProgress,
  scrollRecordsAgree,
  SCROLL_ACHIEVEMENTS,
  SCROLL_SCHEMA_VERSION,
  type ScrollDeed,
  type ScrollRecord,
} from "./scroll-record"

function deed(overrides: Partial<ScrollDeed> & Pick<ScrollDeed, "id" | "kind">): ScrollDeed {
  return { at: 1_000, ...overrides }
}

describe("levels", () => {
  it("starts at level one with no experience", () => {
    expect(levelForExperience(0)).toBe(1)
    expect(levelForExperience(-500)).toBe(1)
    expect(experienceForLevel(1)).toBe(0)
  })

  it("is the inverse of the level threshold", () => {
    for (let level = 1; level <= 20; level += 1) {
      expect(levelForExperience(experienceForLevel(level))).toBe(level)
      expect(levelForExperience(experienceForLevel(level) - 1)).toBe(Math.max(1, level - 1))
    }
  })

  it("clamps at the maximum level", () => {
    expect(levelForExperience(Number.MAX_SAFE_INTEGER)).toBe(MAX_SCROLL_LEVEL)
    const progress = scrollLevelProgress(Number.MAX_SAFE_INTEGER)
    expect(progress.atMax).toBe(true)
    expect(progress.fraction).toBe(1)
  })

  it("reports fractional progress inside a level", () => {
    const floor = experienceForLevel(4)
    const ceiling = experienceForLevel(5)
    const progress = scrollLevelProgress(floor + Math.floor((ceiling - floor) / 2))
    expect(progress.level).toBe(4)
    expect(progress.fraction).toBeGreaterThan(0.4)
    expect(progress.fraction).toBeLessThan(0.6)
  })
})

describe("deeds", () => {
  it("never awards negative experience", () => {
    for (const kind of ["guard-captured", "coin-returned", "region-explored"] as const) {
      expect(experienceForDeed(deed({ id: "x", kind, amount: -99 }))).toBeGreaterThanOrEqual(0)
    }
  })

  it("is idempotent — replaying a sealed deed changes nothing", () => {
    const base = emptyScrollRecord()
    const once = applyScrollDeed(base, deed({ id: "d1", kind: "guard-captured", amount: 3 }))
    const twice = applyScrollDeed(once, deed({ id: "d1", kind: "guard-captured", amount: 3 }))
    expect(twice).toBe(once)
    expect(twice.stats.captures).toBe(3)
  })

  it("orders a batch deterministically regardless of input order", () => {
    const base = emptyScrollRecord()
    const deeds: ScrollDeed[] = [
      deed({ id: "b", kind: "guard-captured", amount: 2, at: 3_000 }),
      deed({ id: "a", kind: "ally-rescued", amount: 1, at: 2_000 }),
      deed({ id: "c", kind: "clean-escape", at: 1_000 }),
    ]
    const forward = applyScrollDeeds(base, deeds)
    const reversed = applyScrollDeeds(base, [...deeds].reverse())
    expect(canonicalScrollPayload(forward)).toBe(canonicalScrollPayload(reversed))
  })

  it("keeps the best grade and score, never a worse one", () => {
    let record = emptyScrollRecord()
    record = applyScrollDeed(record, deed({ id: "m1", kind: "mission-completed", grade: "A", score: 7_100 }))
    record = applyScrollDeed(record, deed({ id: "m2", kind: "mission-completed", grade: "D", score: 900 }))
    expect(record.stats.bestGrade).toBe("A")
    expect(record.stats.bestScore).toBe(7_100)
    record = applyScrollDeed(record, deed({ id: "m3", kind: "mission-completed", grade: "S", score: 9_000 }))
    expect(record.stats.bestGrade).toBe("S")
    expect(record.stats.bestScore).toBe(9_000)
    expect(record.stats.matches).toBe(3)
  })

  it("caps regions explored at the twenty-five region map", () => {
    let record = emptyScrollRecord()
    for (let i = 0; i < 40; i += 1) {
      record = applyScrollDeed(record, deed({ id: `r${i}`, kind: "region-explored", amount: 1 }))
    }
    expect(record.stats.regionsExplored).toBe(25)
  })

  it("caps the chronicle without losing the newest entries", () => {
    let record = emptyScrollRecord()
    for (let i = 0; i < CHRONICLE_LIMIT + 20; i += 1) {
      record = applyScrollDeed(record, deed({ id: `d${i}`, kind: "clean-escape", at: i }))
    }
    expect(record.chronicle).toHaveLength(CHRONICLE_LIMIT)
    expect(record.chronicle.at(-1)?.id).toBe(`d${CHRONICLE_LIMIT + 19}`)
  })

  it("ignores an unknown deed kind", () => {
    const base = emptyScrollRecord()
    const next = applyScrollDeed(base, { id: "bogus", kind: "not-a-deed" as never, at: 1 })
    expect(next).toBe(base)
  })
})

describe("achievements are derived, not assigned", () => {
  it("discards achievements the stats do not justify", () => {
    const forged: ScrollRecord = {
      ...emptyScrollRecord(),
      achievements: SCROLL_ACHIEVEMENTS.map((a) => a.id),
    }
    const next = applyScrollDeed(forged, deed({ id: "d1", kind: "clean-escape" }))
    // A clean escape is not a completed mission, so nothing is earned yet.
    expect(next.achievements).toEqual([])
  })

  it("awards an achievement once its threshold is met", () => {
    let record = emptyScrollRecord()
    record = applyScrollDeed(record, deed({ id: "m1", kind: "mission-completed", grade: "B", score: 6_000 }))
    expect(record.achievements).toContain("first_take")
    expect(record.achievements).not.toContain("sherwood_defender")
  })

  it("returns a sorted, unique set", () => {
    let record = emptyScrollRecord()
    for (let i = 0; i < 12; i += 1) {
      record = applyScrollDeed(record, deed({ id: `m${i}`, kind: "mission-completed", grade: "S", score: 9_000, partySize: 4 }))
    }
    const derived = deriveAchievements(record)
    expect(derived).toEqual([...new Set(derived)].sort())
    expect(derived).toContain("sherwood_defender")
    expect(derived).toContain("master_of_the_bow")
    expect(derived).toContain("merry_band")
  })

  it("reports progress between zero and one for every achievement", () => {
    const record = emptyScrollRecord()
    for (const achievement of SCROLL_ACHIEVEMENTS) {
      const value = achievement.progress(record)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })
})

describe("canonicalization", () => {
  it("excludes the clock, the name, and the chronicle prose", () => {
    const base = applyScrollDeed(emptyScrollRecord("Greenhood"), deed({ id: "d1", kind: "clean-escape" }))
    const cosmeticallyDifferent: ScrollRecord = {
      ...base,
      outlawName: "Someone Else",
      updatedAt: base.updatedAt + 500_000,
      chronicle: base.chronicle.map((entry) => ({ ...entry, text: "rewritten prose" })),
    }
    expect(scrollRecordsAgree(base, cosmeticallyDifferent)).toBe(true)
  })

  it("changes when a stat changes", () => {
    const base = emptyScrollRecord()
    const withDeed = applyScrollDeed(base, deed({ id: "d1", kind: "guard-captured", amount: 1 }))
    expect(scrollRecordsAgree(base, withDeed)).toBe(false)
  })

  it("is insensitive to array order but sensitive to array content", () => {
    const base = applyScrollDeeds(emptyScrollRecord(), [
      deed({ id: "a", kind: "finery-unlocked", fineryId: "fox-plume" }),
      deed({ id: "b", kind: "finery-unlocked", fineryId: "kings-ransom-trail" }),
    ])
    const shuffled: ScrollRecord = { ...base, fineries: [...base.fineries].reverse(), sealedDeeds: [...base.sealedDeeds].reverse() }
    expect(scrollRecordsAgree(base, shuffled)).toBe(true)
    const extra: ScrollRecord = { ...base, fineries: [...base.fineries, "sherwood-fireflies"] }
    expect(scrollRecordsAgree(base, extra)).toBe(false)
  })

  it("normalizes wallet case so the same wallet hashes identically", () => {
    const lower: ScrollRecord = { ...emptyScrollRecord(), wallet: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" }
    const upper: ScrollRecord = { ...emptyScrollRecord(), wallet: "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD" }
    expect(scrollRecordsAgree(lower, upper)).toBe(true)
  })

  it("pins the schema version into the payload", () => {
    expect(canonicalScrollPayload(emptyScrollRecord())).toContain(String(SCROLL_SCHEMA_VERSION))
  })
})

describe("normalizers", () => {
  it("rejects malformed wallets", () => {
    expect(normalizeWallet("not-a-wallet")).toBeNull()
    expect(normalizeWallet(undefined)).toBeNull()
    expect(normalizeWallet("0x1234")).toBeNull()
    expect(normalizeWallet("0xABCDEFabcdef0123456789ABCDEFabcdef012345")).toBe("0xabcdefabcdef0123456789abcdefabcdef012345")
  })

  it("falls back to a default outlaw name", () => {
    expect(normalizeOutlawName("   ")).toBe("Greenhood")
    expect(normalizeOutlawName("  Will   Scarlet  ")).toBe("Will Scarlet")
    expect(normalizeOutlawName("x".repeat(80))).toHaveLength(20)
  })
})
