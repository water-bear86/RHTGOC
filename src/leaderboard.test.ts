import { describe, expect, it } from "vitest"
import { filterAndSortLeaderboardEntries, type LeaderboardEntry, type LeaderboardKind } from "./leaderboard"

function entry(id: string, overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    id,
    playerId: `player-${id}`,
    playerName: `Outlaw ${id}`,
    characterId: "robin",
    score: 7_000,
    grade: "B",
    missionSeconds: 180,
    delivered: 300,
    verified: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    partySize: 2,
    missionSlug: "peoples-purse",
    bandId: "band-oak",
    rescues: 0,
    precision: 50,
    generosity: 50,
    cleanEscape: true,
    ...overrides,
  }
}

function ranked(kind: LeaderboardKind, entries: LeaderboardEntry[]): string[] {
  return filterAndSortLeaderboardEntries(entries, { kind }).map((candidate) => candidate.id)
}

describe("leaderboard board semantics", () => {
  it("ranks redistributed wealth rather than generosity ratio for People's Champions", () => {
    expect(ranked("peoples-champions", [
      entry("ratio", { delivered: 100, generosity: 100, score: 9_000 }),
      entry("wealth", { delivered: 900, generosity: 10, score: 7_000 }),
    ])).toEqual(["wealth", "ratio"])
  })

  it("ranks high-value clean escapes before merely fast low-value runs", () => {
    expect(ranked("clean-escapes", [
      entry("fast", { delivered: 100, score: 6_000, missionSeconds: 60 }),
      entry("valuable", { delivered: 900, score: 8_000, missionSeconds: 240 }),
      entry("damaged", { delivered: 1_000, score: 9_000, missionSeconds: 50, cleanEscape: false }),
    ])).toEqual(["valuable", "fast"])
  })

  it("ranks Swift Arrows by time before precision", () => {
    expect(ranked("swift-arrows", [
      entry("precise", { missionSeconds: 200, precision: 100, score: 9_000 }),
      entry("swift", { missionSeconds: 100, precision: 20, score: 7_000 }),
    ])).toEqual(["swift", "precise"])
  })

  it("applies social, band, mission, party, character, and block filters before ranking", () => {
    const visible = entry("visible", { playerId: "friend", bandId: "band-oak", characterId: "marian", partySize: 4, missionSlug: "prison-wagon" })
    const blocked = entry("blocked", { playerId: "blocked", bandId: "band-oak", characterId: "marian", partySize: 4, missionSlug: "prison-wagon", score: 10_000 })
    expect(filterAndSortLeaderboardEntries([visible, blocked, entry("other")], {
      kind: "master-outlaws",
      playerIds: ["friend", "blocked"],
      excludedPlayerIds: ["blocked"],
      bandId: "band-oak",
      characterId: "marian",
      partySize: 4,
      missionSlug: "prison-wagon",
    })).toEqual([visible])
  })
})
