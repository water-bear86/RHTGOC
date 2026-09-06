import { describe, expect, it } from "vitest"
import {
  applyScrollDeeds,
  emptyScrollRecord,
  experienceForLevel,
  SCROLL_ACHIEVEMENTS,
  type ScrollDeed,
  type ScrollRecord,
} from "../shared/scroll-record"
import { buildScrollView } from "./scroll-panel"
import type { ScrollCheckpointStatus, ScrollSyncState } from "./scroll-store"

const NOW = 1_700_000_000_000

function sync(overrides: Partial<ScrollSyncState> = {}): ScrollSyncState {
  return { status: "unbound", anchor: null, queuedDeeds: 0, syncedAt: null, lastError: null, ...overrides }
}

function deed(overrides: Partial<ScrollDeed> & Pick<ScrollDeed, "id" | "kind">): ScrollDeed {
  return { at: NOW - 60_000, ...overrides }
}

describe("empty scroll", () => {
  it("reads as blank and says so", () => {
    const view = buildScrollView(emptyScrollRecord("Greenhood"), sync(), NOW)
    expect(view.empty).toBe(true)
    expect(view.outlawName).toBe("Greenhood")
    expect(view.levelLabel).toBe("Level 1")
    expect(view.chronicle).toEqual([])
    expect(view.earnedCount).toBe(0)
  })

  it("still lists every achievement, unearned, with real progress", () => {
    const view = buildScrollView(emptyScrollRecord(), sync(), NOW)
    expect(view.achievements).toHaveLength(SCROLL_ACHIEVEMENTS.length)
    expect(view.achievements.every((a) => !a.earned)).toBe(true)
    expect(view.achievements.every((a) => a.progress >= 0 && a.progress <= 1)).toBe(true)
  })
})

describe("identity block", () => {
  it("says the record is not bound when there is no wallet", () => {
    const view = buildScrollView(emptyScrollRecord(), sync(), NOW)
    expect(view.identity.find((line) => line.label === "Wallet")?.value).toBe("Not bound")
    expect(view.identity.find((line) => line.label === "Scroll")?.value).toBe("Not minted")
  })

  it("does not show a token id while the wallet is unbound", () => {
    const orphaned: ScrollRecord = { ...emptyScrollRecord(), wallet: null, scrollTokenId: "128" }
    const view = buildScrollView(orphaned, sync(), NOW)
    expect(view.identity.find((line) => line.label === "Scroll")?.value).toBe("Not minted")
  })

  it("abbreviates the wallet rather than showing it whole", () => {
    const wallet = "0x1234567890abcdef1234567890abcdef12345678"
    const record: ScrollRecord = { ...emptyScrollRecord(), wallet }
    const value = buildScrollView(record, sync({ status: "unsealed" }), NOW).identity.find((l) => l.label === "Wallet")?.value
    expect(value).toBe("0x1234…5678")
    expect(value).not.toContain("90abcdef")
  })

  it("shows the checkpoint version and a truncated state root once anchored", () => {
    const record: ScrollRecord = { ...emptyScrollRecord(), wallet: "0x" + "a".repeat(40), scrollTokenId: "77" }
    const anchor = { tokenId: "77", version: 12, stateRoot: "0x" + "b".repeat(64), timestamp: NOW }
    const view = buildScrollView(record, sync({ status: "sealed", anchor, syncedAt: NOW }), NOW)
    expect(view.identity.find((l) => l.label === "Scroll")?.value).toBe("#77")
    expect(view.identity.find((l) => l.label === "Checkpoint")?.value).toBe("v12")
    const root = view.identity.find((l) => l.label === "State root")?.value ?? ""
    expect(root).toContain("…")
    expect(root.length).toBeLessThan(anchor.stateRoot.length)
  })

  it("counts deeds still waiting to be lodged, with correct plurals", () => {
    const record = emptyScrollRecord()
    expect(buildScrollView(record, sync({ queuedDeeds: 1 }), NOW).identity.find((l) => l.label === "Awaiting lodging")?.value).toBe("1 deed")
    expect(buildScrollView(record, sync({ queuedDeeds: 4 }), NOW).identity.find((l) => l.label === "Awaiting lodging")?.value).toBe("4 deeds")
    expect(buildScrollView(record, sync({ queuedDeeds: 0 }), NOW).identity.some((l) => l.label === "Awaiting lodging")).toBe(false)
  })
})

describe("status", () => {
  const ALL: ScrollCheckpointStatus[] = ["unbound", "unsealed", "pending", "recorded", "sealed", "diverged"]

  it("explains every status in plain language", () => {
    for (const status of ALL) {
      const view = buildScrollView(emptyScrollRecord(), sync({ status }), NOW)
      expect(view.statusHelp.length).toBeGreaterThan(20)
      expect(view.statusLabel.length).toBeGreaterThan(0)
    }
  })

  it("reassures the player that free play still keeps a record", () => {
    const view = buildScrollView(emptyScrollRecord(), sync({ status: "unbound" }), NOW)
    expect(view.statusHelp).toContain("no wallet")
    expect(view.statusHelp.toLowerCase()).toContain("export")
  })

  it("surfaces a sync error alongside the status without hiding the status", () => {
    const view = buildScrollView(emptyScrollRecord(), sync({ status: "pending", lastError: "service unreachable" }), NOW)
    expect(view.statusLabel).toContain("Pending")
    expect(view.statusLabel).toContain("service unreachable")
  })
})

describe("stats and level", () => {
  it("summarises a played record", () => {
    const record = applyScrollDeeds(emptyScrollRecord("Marian"), [
      deed({ id: "m1", kind: "mission-completed", grade: "A", score: 7_400, partySize: 3 }),
      deed({ id: "c1", kind: "guard-captured", amount: 9 }),
      deed({ id: "r1", kind: "ally-rescued", amount: 2 }),
      deed({ id: "g1", kind: "coin-returned", amount: 1_250 }),
    ])
    const view = buildScrollView(record, sync({ status: "recorded" }), NOW)
    const value = (label: string) => view.stats.find((line) => line.label === label)?.value
    expect(value("Missions ridden")).toBe("1")
    expect(value("Guards bested")).toBe("9")
    expect(value("Allies freed")).toBe("2")
    expect(value("Coin returned")).toBe("1,250")
    expect(value("Finest hour")).toBe("A · 7,400")
    expect(value("Largest band")).toBe("3")
    expect(view.empty).toBe(false)
  })

  it("shows an em dash rather than a zero for an unearned best grade", () => {
    const view = buildScrollView(emptyScrollRecord(), sync(), NOW)
    expect(view.stats.find((l) => l.label === "Finest hour")?.value).toBe("—")
    expect(view.stats.find((l) => l.label === "Largest band")?.value).toBe("—")
  })

  it("reports renown remaining to the next level", () => {
    const record: ScrollRecord = { ...emptyScrollRecord(), experience: experienceForLevel(5) }
    const view = buildScrollView(record, sync(), NOW)
    expect(view.levelLabel).toBe("Level 5")
    expect(view.levelDetail).toContain("to level 6")
    expect(view.levelFraction).toBe(0)
  })

  it("names the top of the ladder instead of an impossible next level", () => {
    const record: ScrollRecord = { ...emptyScrollRecord(), experience: experienceForLevel(60) }
    const view = buildScrollView(record, sync(), NOW)
    expect(view.levelLabel).toContain("Legend of Sherwood")
    expect(view.levelDetail).not.toContain("to level")
    expect(view.levelFraction).toBe(1)
  })
})

describe("chronicle", () => {
  it("is newest first and timestamped in relative terms", () => {
    const record = applyScrollDeeds(emptyScrollRecord(), [
      deed({ id: "old", kind: "clean-escape", at: NOW - 7_200_000 }),
      deed({ id: "new", kind: "ally-rescued", amount: 1, at: NOW - 30_000 }),
    ])
    const view = buildScrollView(record, sync(), NOW)
    expect(view.chronicle[0]?.id).toBe("new")
    expect(view.chronicle[0]?.when).toBe("just now")
    expect(view.chronicle[1]?.when).toBe("2h ago")
  })

  it("writes readable prose, not raw deed data", () => {
    const record = applyScrollDeeds(emptyScrollRecord(), [deed({ id: "g", kind: "coin-returned", amount: 2_400 })])
    expect(view(record).chronicle[0]?.text).toBe("Returned 2,400 coin to the people.")
  })

  function view(record: ScrollRecord) {
    return buildScrollView(record, sync(), NOW)
  }
})

describe("achievements display", () => {
  it("marks earned ones as sealed and shows a percentage for the rest", () => {
    const record = applyScrollDeeds(emptyScrollRecord(), [
      deed({ id: "m1", kind: "mission-completed", grade: "B", score: 6_000 }),
      deed({ id: "m2", kind: "mission-completed", grade: "B", score: 6_000, at: NOW - 50_000 }),
    ])
    const view = buildScrollView(record, sync(), NOW)
    const firstTake = view.achievements.find((a) => a.id === "first_take")
    expect(firstTake?.earned).toBe(true)
    expect(firstTake?.progressLabel).toBe("Sealed")
    const defender = view.achievements.find((a) => a.id === "sherwood_defender")
    expect(defender?.earned).toBe(false)
    expect(defender?.progressLabel).toBe("20%")
  })
})
