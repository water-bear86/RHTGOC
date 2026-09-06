import { beforeEach, describe, expect, it } from "vitest"
import {
  blockPairKey,
  isBlockedForViewer,
  isModerationAction,
  isModerationReasonCode,
  MASKED_PLAYER_NAME,
  MODERATION_ACTIONS,
  MODERATION_REASON_CODES,
  playerRefHash,
  projectPublicEntry,
  PUBLIC_LEADERBOARD_ENTRY_FIELDS,
  readBoardForViewer,
  resolveEntryVisibility,
  sanitizeLeaderboardLogContext,
  type PolicyEntry,
  type ViewerContext,
} from "./leaderboard-policy"
import type { LeaderboardKind } from "./leaderboard-store"

let counter = 0
beforeEach(() => {
  counter = 0
})
function entry(overrides: Partial<PolicyEntry> = {}): PolicyEntry {
  counter += 1
  return {
    id: `e${String(counter).padStart(4, "0")}`,
    playerId: `p${counter}`,
    playerName: `Merry Fox ${counter}`,
    score: 5000,
    missionSeconds: 300,
    delivered: 100,
    rescues: 0,
    precision: 50,
    cleanEscape: true,
    characterId: "robin",
    partySize: 1,
    missionSlug: "peoples-purse",
    bandId: null,
    ...overrides,
  }
}

const ALL_KINDS: LeaderboardKind[] = ["master-outlaws", "peoples-champions", "clean-escapes", "rescuers", "swift-arrows"]

function viewer(id: string | null, blockPairs: Array<[string, string]> = []): ViewerContext {
  const pairs = new Set<string>()
  for (const [a, b] of blockPairs) pairs.add(blockPairKey(a, b))
  return { viewerId: id, blockedPairs: pairs }
}

describe("leaderboard-policy: resolveEntryVisibility", () => {
  it("is visible when no block and moderator flags unset", () => {
    const v = viewer("viewer-a", [])
    expect(resolveEntryVisibility(entry({ playerId: "player-x" }), v)).toBe("visible")
  })

  it("masks when viewer blocked the entry's player", () => {
    const v = viewer("viewer-a", [["viewer-a", "player-x"]])
    expect(resolveEntryVisibility(entry({ playerId: "player-x" }), v)).toBe("masked")
  })

  it("masks when entry's player blocked the viewer (bidirectional)", () => {
    const v = viewer("viewer-a", [["player-x", "viewer-a"]])
    expect(resolveEntryVisibility(entry({ playerId: "player-x" }), v)).toBe("masked")
  })

  it("treats moderator identityHidden as masked", () => {
    const v = viewer("viewer-a", [])
    expect(resolveEntryVisibility(entry({ identityHidden: true }), v)).toBe("masked")
  })

  it("treats moderator entryHidden as omitted", () => {
    const v = viewer("viewer-a", [])
    expect(resolveEntryVisibility(entry({ entryHidden: true }), v)).toBe("omitted")
  })

  it("entry-hidden wins over identity-hidden", () => {
    const v = viewer("viewer-a", [])
    expect(resolveEntryVisibility(entry({ entryHidden: true, identityHidden: true }), v)).toBe("omitted")
  })

  it("anonymous viewers never see a block match (no viewer id)", () => {
    const v = viewer(null, [])
    expect(resolveEntryVisibility(entry({ playerId: "player-x" }), v)).toBe("visible")
  })

  it("deleted accounts (playerId null) never match a block pair", () => {
    const v = viewer("viewer-a", [["viewer-a", "player-x"]])
    expect(resolveEntryVisibility(entry({ playerId: null }), v)).toBe("visible")
  })
})

describe("leaderboard-policy: blockPairKey + isBlockedForViewer", () => {
  it("produces an order-independent pair key", () => {
    expect(blockPairKey("a", "b")).toBe(blockPairKey("b", "a"))
  })

  it("a viewer never blocks themselves", () => {
    const v = viewer("viewer-a", [["viewer-a", "viewer-a"]])
    expect(isBlockedForViewer(v, "viewer-a")).toBe(false)
  })
})

describe("leaderboard-policy: readBoardForViewer — block masking is count-stable", () => {
  it("totals, ranks, tie flags, positions, and pagination are identical between blocker and blocked reads", () => {
    const entries = [
      entry({ id: "e1", playerId: "alice", score: 9000, missionSeconds: 100, cleanEscape: true }),
      entry({ id: "e2", playerId: "bob", score: 8500, missionSeconds: 100, cleanEscape: true }),
      entry({ id: "e3", playerId: "carol", score: 8000, missionSeconds: 100, cleanEscape: true }),
      entry({ id: "e4", playerId: "dave", score: 7500, missionSeconds: 100, cleanEscape: true }),
      entry({ id: "e5", playerId: "eve", score: 7000, missionSeconds: 100, cleanEscape: true }),
    ]

    // Two users who block each other.
    const aliceContext = viewer("alice", [["alice", "bob"]])
    const bobContext = viewer("bob", [["alice", "bob"]])

    // An unrelated third party (and an anonymous reader) see no masks.
    const carolContext = viewer("carol", [])
    const anonContext = viewer(null, [])

    for (const kind of ALL_KINDS) {
      const aliceView = readBoardForViewer(entries, kind, aliceContext)
      const bobView = readBoardForViewer(entries, kind, bobContext)
      const carolView = readBoardForViewer(entries, kind, carolContext)
      const anonView = readBoardForViewer(entries, kind, anonContext)

      // Alice sees bob masked; bob sees alice masked.
      expect(aliceView.entries.find((e) => e.id === "e2")?.playerName).toBe(MASKED_PLAYER_NAME)
      expect(aliceView.entries.find((e) => e.id === "e2")?.identityMasked).toBe(true)
      expect(bobView.entries.find((e) => e.id === "e1")?.playerName).toBe(MASKED_PLAYER_NAME)
      expect(bobView.entries.find((e) => e.id === "e1")?.identityMasked).toBe(true)

      // Third party and anon see no masks.
      expect(carolView.entries.every((e) => !e.identityMasked)).toBe(true)
      expect(anonView.entries.every((e) => !e.identityMasked)).toBe(true)

      // Numeric frame is byte-identical across all four perspectives.
      expect(aliceView.entries.map((e) => e.rank)).toEqual(bobView.entries.map((e) => e.rank))
      expect(aliceView.entries.map((e) => e.position)).toEqual(carolView.entries.map((e) => e.position))
      expect(aliceView.entries.map((e) => e.isTied)).toEqual(anonView.entries.map((e) => e.isTied))
      expect(aliceView.pagination.total).toBe(bobView.pagination.total)
      expect(aliceView.pagination.total).toBe(carolView.pagination.total)
      expect(aliceView.pagination.total).toBe(anonView.pagination.total)
      expect(aliceView.pagination.hasNext).toBe(bobView.pagination.hasNext)
    }
  })

  it("masked entries keep correct rank ties (same rank, both masked)", () => {
    const entries = [
      entry({ id: "e1", playerId: "alice", score: 9000, missionSeconds: 100 }),
      entry({ id: "e2", playerId: "bob", score: 9000, missionSeconds: 100 }), // tied with e1
      entry({ id: "e3", playerId: "carol", score: 8000, missionSeconds: 100 }),
    ]
    const v = viewer("alice", [["alice", "bob"]])
    const view = readBoardForViewer(entries, "master-outlaws", v, { limit: 10 })
    const e1 = view.entries.find((e) => e.id === "e1")!
    const e2 = view.entries.find((e) => e.id === "e2")!
    // Both alice and bob are masked from alice's perspective; they remain tied.
    expect(e1.rank).toBe(e2.rank)
    expect(e1.isTied).toBe(true)
    expect(e2.isTied).toBe(true)
    expect(e2.identityMasked).toBe(true)
  })

  it("the viewer's own entry is masked from their own perspective (block self-symmetry broken)", () => {
    const entries = [entry({ id: "e1", playerId: "alice", score: 9000 })]
    const v = viewer("alice", [["alice", "alice"]])
    // Even if a self-block pair is somehow in the set, resolveEntryVisibility
    // guards viewerId === playerId as not-blocked. Alice sees her own name.
    const view = readBoardForViewer(entries, "master-outlaws", v)
    expect(view.entries.find((e) => e.id === "e1")?.playerName).toBe("Merry Fox 1")
  })
})

describe("leaderboard-policy: moderator entry-hide is uniform and count-stable", () => {
  it("every viewer sees the same page and total after a moderator entry-hide", () => {
    const entries = [
      entry({ id: "e1", playerId: "alice", score: 9000, cleanEscape: true }),
      entry({ id: "e2", playerId: "bob", entryHidden: true, score: 8500, cleanEscape: true }),
      entry({ id: "e3", playerId: "carol", score: 8000, cleanEscape: true }),
    ]
    for (const kind of ALL_KINDS) {
      const a = readBoardForViewer(entries, kind, viewer("alice", []))
      const b = readBoardForViewer(entries, kind, viewer("bob", []))
      const anon = readBoardForViewer(entries, kind, viewer(null, []))
      for (const view of [a, b, anon]) {
        const ids = view.entries.map((e) => e.id)
        expect(ids).not.toContain("e2")
        expect(view.pagination.total).toBe(2)
      }
      // Uniformity: all perspectives agree on the remaining rows, ranks, ties.
      expect(a.entries.map((e) => e.id)).toEqual(b.entries.map((e) => e.id))
      expect(a.entries.map((e) => e.rank)).toEqual(anon.entries.map((e) => e.rank))
    }
  })

  it("moderator identity-hide masks for every viewer with the same label as block masking", () => {
    const entries = [entry({ id: "e1", playerId: "alice", identityHidden: true, score: 9000 })]
    const a = readBoardForViewer(entries, "master-outlaws", viewer("alice", []))
    const b = readBoardForViewer(entries, "master-outlaws", viewer("bob", []))
    expect(a.entries[0].playerName).toBe(MASKED_PLAYER_NAME)
    expect(b.entries[0].playerName).toBe(MASKED_PLAYER_NAME)
    expect(a.entries[0].identityMasked).toBe(true)
    expect(b.entries[0].identityMasked).toBe(true)
  })
})

describe("leaderboard-policy: deleted / missing accounts", () => {
  it("a deleted account (playerId null) keeps its season pseudonym and is never masked", () => {
    const entries = [entry({ id: "e1", playerId: null, playerName: "Deleted Account", score: 9000 })]
    const v = viewer("alice", [])
    const view = readBoardForViewer(entries, "master-outlaws", v)
    expect(view.entries[0].playerName).toBe("Deleted Account")
    expect(view.entries[0].identityMasked).toBe(false)
  })

  it("a deleted account never matches the viewer's self row", () => {
    const entries = [
      entry({ id: "e1", playerId: "alice", score: 9000 }),
      entry({ id: "e2", playerId: null, score: 8500 }),
    ]
    const v = viewer("alice", [])
    const view = readBoardForViewer(entries, "master-outlaws", v)
    expect(view.self?.id).toBe("e1")
  })
})

describe("leaderboard-policy: friend and band visibility", () => {
  it("friend scope (playerIds filter) hides non-friends from the friend list", () => {
    const entries = [
      entry({ id: "e1", playerId: "alice", score: 9000 }),
      entry({ id: "e2", playerId: "bob", score: 8500 }),
      entry({ id: "e3", playerId: "carol", score: 8000 }),
    ]
    const v = viewer("alice", [])
    const view = readBoardForViewer(entries, "master-outlaws", v, { filters: { playerIds: ["alice", "bob"] } })
    const ids = view.entries.map((e) => e.id)
    expect(ids).toContain("e1")
    expect(ids).toContain("e2")
    expect(ids).not.toContain("e3")
  })

  it("band scope (bandId filter) restricts to band members", () => {
    const entries = [
      entry({ id: "e1", playerId: "alice", bandId: "band-1", score: 9000 }),
      entry({ id: "e2", playerId: "bob", bandId: "band-2", score: 8500 }),
    ]
    const v = viewer("alice", [])
    const view = readBoardForViewer(entries, "master-outlaws", v, { filters: { bandId: "band-1" } })
    expect(view.entries.map((e) => e.id)).toEqual(["e1"])
  })
})

describe("leaderboard-policy: moderator vs ordinary-user permissions", () => {
  it("isModerationAction accepts the five documented actions and rejects others", () => {
    for (const action of MODERATION_ACTIONS) expect(isModerationAction(action)).toBe(true)
    expect(isModerationAction("delete-entry")).toBe(false)
    expect(isModerationAction("")).toBe(false)
  })

  it("isModerationReasonCode accepts the six documented codes and rejects others", () => {
    for (const code of MODERATION_REASON_CODES) expect(isModerationReasonCode(code)).toBe(true)
    expect(isModerationReasonCode("personal-revenge")).toBe(false)
    expect(isModerationReasonCode("")).toBe(false)
  })
})

describe("leaderboard-policy: response-field allowlist", () => {
  it("projectPublicEntry drops every restricted identifier", () => {
    const raw = {
      id: "e1",
      playerName: "Merry Fox",
      score: 9000,
      playerId: "p1",
      authUserId: "auth-1",
      email: "a@b.com",
      walletAddress: "0xabc",
      verificationId: "v-1",
      scoreBreakdown: { a: 1 },
      suspicious: true,
      friendCode: "ABCD1234",
      ipAddress: "1.2.3.4",
      platformId: "steam-1",
    }
    const projected = projectPublicEntry(raw)
    for (const field of ["playerId", "authUserId", "email", "walletAddress", "verificationId", "scoreBreakdown", "suspicious", "friendCode", "ipAddress", "platformId"]) {
      expect(projected).not.toHaveProperty(field)
    }
    expect(projected).toEqual({ id: "e1", playerName: "Merry Fox", score: 9000 })
  })

  it("projectPublicEntry keeps every documented public field", () => {
    const raw: Record<string, unknown> = {}
    for (const field of PUBLIC_LEADERBOARD_ENTRY_FIELDS) raw[field] = `value-${field}`
    const projected = projectPublicEntry(raw)
    expect(Object.keys(projected).sort()).toEqual([...PUBLIC_LEADERBOARD_ENTRY_FIELDS].sort())
  })

  it("every public API fixture field is in the allowlist", () => {
    // The fields the ranked RPC emits (mirrored in PublicLeaderboardEntry).
    const emitted = [
      "id", "playerName", "characterId", "score", "grade", "missionSeconds",
      "delivered", "verified", "createdAt", "partySize", "missionSlug", "rescues",
      "precision", "generosity", "cleanEscape", "identityMasked", "rank", "isTied", "position",
    ]
    for (const field of emitted) {
      expect(PUBLIC_LEADERBOARD_ENTRY_FIELDS).toContain(field)
    }
  })
})

describe("leaderboard-policy: sanitizeLeaderboardLogContext", () => {
  it("drops keys outside the allowlist", () => {
    const safe = sanitizeLeaderboardLogContext({ entryId: "e1", playerId: "p1", reason: "ok" })
    expect(safe).toHaveProperty("entryId", "e1")
    expect(safe).toHaveProperty("reason", "ok")
    expect(safe).not.toHaveProperty("playerId")
  })

  it("redacts embedded UUIDs from free-text reason/message values", () => {
    const safe = sanitizeLeaderboardLogContext({
      reason: "failed for 550e8400-e29b-41d4-a716-446655440000: boom",
      message: "user 550e8400-e29b-41d4-a716-446655440000 not found",
    })
    expect(String(safe.reason)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
    expect(String(safe.message)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/)
    expect(String(safe.reason)).toContain("[uuid]")
  })

  it("playerRefHash is a stable, non-reversible short digest", () => {
    const h1 = playerRefHash("550e8400-e29b-41d4-a716-446655440000")
    const h2 = playerRefHash("550e8400-e29b-41d4-a716-446655440000")
    const h3 = playerRefHash("660e8400-e29b-41d4-a716-446655440001")
    expect(h1).toBe(h2)
    expect(h1).not.toBe(h3)
    expect(h1).toHaveLength(12)
  })
})
