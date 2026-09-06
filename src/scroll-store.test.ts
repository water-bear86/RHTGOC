import { describe, expect, it } from "vitest"
import {
  applyScrollDeed,
  applyScrollDeeds,
  emptyScrollRecord,
  SCROLL_SCHEMA_VERSION,
  type ScrollDeed,
  type ScrollRecord,
} from "../shared/scroll-record"
import {
  exportScrollFile,
  importScrollFile,
  loadScrollQueue,
  loadScrollRecord,
  parseScrollDeed,
  parseScrollRecord,
  reconcileScrollRecord,
  saveScrollQueue,
  saveScrollRecord,
  scrollSyncStatus,
  SCROLL_QUEUE_LIMIT,
  SCROLL_QUEUE_STORAGE_KEY,
  SCROLL_STORAGE_KEY,
  type ScrollAnchor,
  type ScrollStorageLike,
} from "./scroll-store"

class MemoryStorage implements ScrollStorageLike {
  private readonly map = new Map<string, string>()
  constructor(readonly failWrites = false) {}
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("quota exceeded")
    this.map.set(key, value)
  }
  removeItem(key: string): void {
    this.map.delete(key)
  }
}

function deed(overrides: Partial<ScrollDeed> & Pick<ScrollDeed, "id" | "kind">): ScrollDeed {
  return { at: 1_000, ...overrides }
}

describe("record round trip", () => {
  it("survives save and load", () => {
    const storage = new MemoryStorage()
    const record = applyScrollDeeds(emptyScrollRecord("Will Scarlet"), [
      deed({ id: "m1", kind: "mission-completed", grade: "A", score: 7_000, partySize: 3 }),
      deed({ id: "c1", kind: "guard-captured", amount: 6 }),
    ])
    expect(saveScrollRecord(storage, record)).toBe(true)
    const loaded = loadScrollRecord(storage)
    expect(loaded.stats.captures).toBe(6)
    expect(loaded.stats.matches).toBe(1)
    expect(loaded.outlawName).toBe("Will Scarlet")
    expect(loaded.achievements).toContain("first_take")
  })

  it("returns an empty record for missing, corrupt, or foreign data", () => {
    const storage = new MemoryStorage()
    expect(loadScrollRecord(storage).stats.matches).toBe(0)
    storage.setItem(SCROLL_STORAGE_KEY, "{not json")
    expect(loadScrollRecord(storage).stats.matches).toBe(0)
    storage.setItem(SCROLL_STORAGE_KEY, JSON.stringify({ schemaVersion: 999, experience: 100_000 }))
    expect(loadScrollRecord(storage).experience).toBe(0)
  })

  it("does not throw when storage refuses writes", () => {
    const storage = new MemoryStorage(true)
    expect(saveScrollRecord(storage, emptyScrollRecord())).toBe(false)
    expect(saveScrollQueue(storage, [])).toBe(false)
  })
})

describe("a hand-edited save cannot grant anything", () => {
  it("recomputes level from experience", () => {
    const parsed = parseScrollRecord({ ...emptyScrollRecord(), experience: 0, level: 55 })
    expect(parsed?.level).toBe(1)
  })

  it("drops achievements the stats do not justify", () => {
    const parsed = parseScrollRecord({
      ...emptyScrollRecord(),
      achievements: ["master_of_the_bow", "cartographer", "hundred_hands"],
    })
    expect(parsed?.achievements).toEqual([])
  })

  it("clamps impossible stats", () => {
    const parsed = parseScrollRecord({
      ...emptyScrollRecord(),
      stats: { ...emptyScrollRecord().stats, regionsExplored: 9_999, largestBand: 40, captures: -12 },
    })
    expect(parsed?.stats.regionsExplored).toBe(25)
    expect(parsed?.stats.largestBand).toBe(4)
    expect(parsed?.stats.captures).toBe(0)
  })

  it("rejects a forged wallet or token id", () => {
    const parsed = parseScrollRecord({ ...emptyScrollRecord(), wallet: "definitely-a-wallet", scrollTokenId: "abc" })
    expect(parsed?.wallet).toBeNull()
    expect(parsed?.scrollTokenId).toBeNull()
  })

  it("rejects a record with no schema version", () => {
    expect(parseScrollRecord({ experience: 10 })).toBeNull()
    expect(parseScrollRecord(null)).toBeNull()
    expect(parseScrollRecord([])).toBeNull()
  })
})

describe("export and import", () => {
  it("round trips an intact file", () => {
    const record = applyScrollDeed(emptyScrollRecord("Much"), deed({ id: "m1", kind: "mission-completed", grade: "S", score: 9_100 }))
    const imported = importScrollFile(exportScrollFile(record))
    expect(imported?.intact).toBe(true)
    expect(imported?.record.stats.bestGrade).toBe("S")
    expect(imported?.record.outlawName).toBe("Much")
  })

  it("neutralizes a tampered file: identity only, no claimed progression", () => {
    const record = applyScrollDeed(emptyScrollRecord("Marian"), deed({ id: "m1", kind: "mission-completed", grade: "D", score: 900 }))
    const file = JSON.parse(exportScrollFile(record)) as { record: ScrollRecord }
    file.record.experience = 5_000_000
    file.record.achievements = ["cartographer"]
    file.record.stats.captures = 999
    const imported = importScrollFile(JSON.stringify({ ...file, kind: "sherwood-scroll-save", schemaVersion: SCROLL_SCHEMA_VERSION }))
    expect(imported).not.toBeNull()
    expect(imported?.intact).toBe(false)
    // A broken seal installs no claimed values — not the experience, level,
    // achievements, stats, or sealed deeds — only the identity.
    expect(imported?.record.outlawName).toBe("Marian")
    expect(imported?.record.experience).toBe(0)
    expect(imported?.record.level).toBe(1)
    expect(imported?.record.achievements).toEqual([])
    expect(imported?.record.stats.captures).toBe(0)
    expect(imported?.record.sealedDeeds).toEqual([])
  })

  it("rejects files that are not scroll saves", () => {
    expect(importScrollFile("{not json")).toBeNull()
    expect(importScrollFile(JSON.stringify({ kind: "something-else" }))).toBeNull()
    expect(importScrollFile(JSON.stringify({ kind: "sherwood-scroll-save", record: null }))).toBeNull()
  })
})

describe("offline deed queue", () => {
  it("round trips and drops malformed deeds", () => {
    const storage = new MemoryStorage()
    saveScrollQueue(storage, [deed({ id: "a", kind: "clean-escape" })])
    expect(loadScrollQueue(storage)).toHaveLength(1)
    storage.setItem(SCROLL_QUEUE_STORAGE_KEY, JSON.stringify([{ id: "b", kind: "nonsense" }, { kind: "clean-escape" }]))
    expect(loadScrollQueue(storage)).toEqual([])
  })

  it("preserves every unsent deed across a save/load round trip", () => {
    const storage = new MemoryStorage()
    const deeds = Array.from({ length: SCROLL_QUEUE_LIMIT + 25 }, (_, i) => deed({ id: `d${i}`, kind: "clean-escape", at: i }))
    saveScrollQueue(storage, deeds)
    const loaded = loadScrollQueue(storage)
    // The queue must never drop unsent deeds; losing them would permanently
    // forfeit progression the service has not yet re-derived.
    expect(loaded).toHaveLength(deeds.length)
    expect(loaded.at(0)?.id).toBe("d0")
    expect(loaded.at(-1)?.id).toBe(`d${SCROLL_QUEUE_LIMIT + 24}`)
  })

  it("keeps a wallet's queue separate from a guest's in the same browser", () => {
    const storage = new MemoryStorage()
    saveScrollQueue(storage, [deed({ id: "guest", kind: "clean-escape", at: 1 })])
    saveScrollQueue(storage, [deed({ id: "walleted", kind: "clean-escape", at: 2 })], "0x000000000000000000000000000000000000dEaD")
    expect(loadScrollQueue(storage).map((d) => d.id)).toEqual(["guest"])
    expect(loadScrollQueue(storage, "0x000000000000000000000000000000000000dead").map((d) => d.id)).toEqual(["walleted"])
  })

  it("parses only well-formed deeds", () => {
    expect(parseScrollDeed({ id: "a", kind: "clean-escape", at: 5 })).not.toBeNull()
    expect(parseScrollDeed({ id: "", kind: "clean-escape" })).toBeNull()
    expect(parseScrollDeed({ id: "a", kind: "made-up" })).toBeNull()
    expect(parseScrollDeed(null)).toBeNull()
    expect(parseScrollDeed({ id: "a", kind: "mission-completed", partySize: 99 })?.partySize).toBe(4)
  })
})

describe("sync status", () => {
  const anchor = (stateRoot: string): ScrollAnchor => ({ tokenId: "12", version: 3, stateRoot, timestamp: 1 })
  const withWallet: ScrollRecord = { ...emptyScrollRecord(), wallet: "0x" + "a".repeat(40) }
  const withScroll: ScrollRecord = { ...withWallet, scrollTokenId: "12" }

  it("is unbound without a wallet", () => {
    expect(scrollSyncStatus({ record: emptyScrollRecord(), anchor: null, queuedDeeds: 0, stateRoot: "0xab", syncedAt: null })).toBe("unbound")
  })

  it("is unsealed with a wallet but no minted scroll", () => {
    expect(scrollSyncStatus({ record: withWallet, anchor: null, queuedDeeds: 0, stateRoot: "0xab", syncedAt: null })).toBe("unsealed")
  })

  it("is pending while deeds are queued", () => {
    expect(scrollSyncStatus({ record: withScroll, anchor: anchor("0xab"), queuedDeeds: 2, stateRoot: "0xab", syncedAt: 1 })).toBe("pending")
  })

  it("is recorded when nothing is queued but no anchor is known yet", () => {
    expect(scrollSyncStatus({ record: withScroll, anchor: null, queuedDeeds: 0, stateRoot: "0xab", syncedAt: 1 })).toBe("recorded")
  })

  it("is sealed when the anchor matches, case-insensitively", () => {
    expect(scrollSyncStatus({ record: withScroll, anchor: anchor("0xAB"), queuedDeeds: 0, stateRoot: "0xab", syncedAt: 1 })).toBe("sealed")
  })

  it("is diverged when the anchor disagrees", () => {
    expect(scrollSyncStatus({ record: withScroll, anchor: anchor("0xcd"), queuedDeeds: 0, stateRoot: "0xab", syncedAt: 1 })).toBe("diverged")
  })

  it("does not claim to be sealed when the state root could not be computed", () => {
    expect(scrollSyncStatus({ record: withScroll, anchor: anchor("0xab"), queuedDeeds: 0, stateRoot: null, syncedAt: 1 })).toBe("recorded")
  })
})

describe("reconciliation", () => {
  it("lets the authoritative record win and re-folds unseen deeds", () => {
    const local = applyScrollDeeds(emptyScrollRecord("Marian"), [
      deed({ id: "seen", kind: "guard-captured", amount: 4 }),
      deed({ id: "unseen", kind: "ally-rescued", amount: 1, at: 2_000 }),
    ])
    const authoritative = applyScrollDeeds({ ...emptyScrollRecord("Marian"), wallet: "0x" + "b".repeat(40) }, [
      deed({ id: "seen", kind: "guard-captured", amount: 4 }),
      deed({ id: "service-only", kind: "coin-returned", amount: 900, at: 1_500 }),
    ])
    const queued = [deed({ id: "unseen", kind: "ally-rescued", amount: 1, at: 2_000 })]

    const { record, stillQueued } = reconcileScrollRecord(local, authoritative, queued)
    expect(record.wallet).toBe("0x" + "b".repeat(40))
    expect(record.stats.coinReturned).toBe(900)
    expect(record.stats.rescues).toBe(1)
    expect(record.outlawName).toBe("Marian")
    expect(stillQueued.map((d) => d.id)).toEqual(["unseen"])
  })

  it("clears a deed from the queue once the service has sealed it", () => {
    const authoritative = applyScrollDeed({ ...emptyScrollRecord(), wallet: "0x" + "c".repeat(40) }, deed({ id: "done", kind: "clean-escape" }))
    const { stillQueued } = reconcileScrollRecord(emptyScrollRecord(), authoritative, [deed({ id: "done", kind: "clean-escape" })])
    expect(stillQueued).toEqual([])
  })

  it("discards a local claim the service does not know about and did not queue", () => {
    const local = applyScrollDeed(emptyScrollRecord(), deed({ id: "forged", kind: "coin-returned", amount: 999_999 }))
    const authoritative: ScrollRecord = { ...emptyScrollRecord(), wallet: "0x" + "d".repeat(40) }
    const { record } = reconcileScrollRecord(local, authoritative, [])
    expect(record.stats.coinReturned).toBe(0)
    expect(record.experience).toBe(0)
  })
})
