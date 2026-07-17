import { describe, expect, it } from "vitest"
import { PROTOCOL_VERSION, parseClientMessage, type ServerMessage } from "./protocol"

const handshake = { version: PROTOCOL_VERSION, buildId: "test-build", productAnalytics: true } as const

describe("Merry Band protocol", () => {
  it("requires the authoritative bow-action snapshot protocol", () => {
    expect(PROTOCOL_VERSION).toBe(15)
  })

  it("carries authoritative bow cooldown seconds in mission snapshots", () => {
    type SnapshotPlayer = Extract<ServerMessage, { type: "snapshot" }>["players"][number]
    const bowCooldown: SnapshotPlayer["bowCooldown"] = 0.3
    expect(bowCooldown).toBe(0.3)
  })

  it("accepts a versioned create-room message", () => {
    expect(parseClientMessage({ type: "create_room", ...handshake, displayName: "Oakheart", characterId: "marian" })).toEqual({
      type: "create_room",
      ...handshake,
      displayName: "Oakheart",
      characterId: "marian",
    })
  })

  it("accepts bounded Supabase access tokens without trusting user ids from clients", () => {
    expect(parseClientMessage({ type: "create_room", ...handshake, displayName: "Oakheart", characterId: "marian", accessToken: "header.payload.signature.long-enough" })).not.toBeNull()
    expect(parseClientMessage({ type: "create_room", ...handshake, displayName: "Oakheart", characterId: "marian", accessToken: "short" })).toBeNull()
  })

  it("accepts the four authored outlaw roles", () => {
    for (const characterId of ["robin", "marian", "little-john", "much"]) {
      expect(parseClientMessage({ type: "create_room", ...handshake, displayName: "Oakheart", characterId })).not.toBeNull()
    }
  })

  it("accepts bounded hub mission, loadout, and return intents", () => {
    expect(parseClientMessage({ type: "set_ready", ready: true, expectedMissionSlug: "peoples-purse", expectedCharacterId: "marian" })).toEqual({
      type: "set_ready",
      ready: true,
      expectedMissionSlug: "peoples-purse",
      expectedCharacterId: "marian",
    })
    expect(parseClientMessage({ type: "select_mission", missionSlug: "peoples-purse" })).not.toBeNull()
    expect(parseClientMessage({ type: "select_rotation", rotationId: "sheriff-2026-07-10-p2-v1" })).not.toBeNull()
    expect(parseClientMessage({ type: "select_rotation", rotationId: "../../forged" })).toBeNull()
    expect(parseClientMessage({ type: "select_mission", missionSlug: "../unsafe" })).toBeNull()
    expect(parseClientMessage({ type: "select_loadout", loadoutId: "smoke" })).not.toBeNull()
    expect(parseClientMessage({ type: "select_loadout", loadoutId: "pay-to-win" })).toBeNull()
    expect(parseClientMessage({ type: "return_to_hub" })).toEqual({ type: "return_to_hub" })
    expect(parseClientMessage({ type: "accept_rescue", offerId: "8c02777e-2bb5-5afd-9f42-7a7b1ca4c622" })).not.toBeNull()
    expect(parseClientMessage({ type: "abandon_rescue", offerId: "not-a-uuid" })).toBeNull()
    expect(parseClientMessage({ type: "deposit_contribution", contributionType: "safe-house" })).toEqual({ type: "deposit_contribution", contributionType: "safe-house" })
    expect(parseClientMessage({ type: "deposit_contribution", contributionType: "unlimited-gold" })).toBeNull()
    expect(parseClientMessage({ type: "toggle_contribution", contributionId: "8c02777e-2bb5-5afd-9f42-7a7b1ca4c622" })).not.toBeNull()
    expect(parseClientMessage({ type: "revoke_contribution", contributionId: "../../forged" })).toBeNull()
    expect(parseClientMessage({ type: "offer_band_membership", targetPlayerId: "8c02777e-2bb5-5afd-9f42-7a7b1ca4c622" })).not.toBeNull()
    expect(parseClientMessage({ type: "respond_band_membership", accept: true })).toEqual({ type: "respond_band_membership", accept: true })
    expect(parseClientMessage({ type: "update_band_identity", name: "Green Bough", bannerId: "stag" })).not.toBeNull()
    expect(parseClientMessage({ type: "update_band_identity", name: "<script>", bannerId: "freeform" })).toBeNull()
  })

  it("rejects malformed names, room codes, and movement", () => {
    expect(parseClientMessage({ type: "create_room", ...handshake, displayName: "<script>", characterId: "robin" })).toBeNull()
    expect(parseClientMessage({ type: "join_room", ...handshake, roomCode: "abc", displayName: "Robin", characterId: "robin" })).toBeNull()
    expect(parseClientMessage({ type: "input", sequence: 1, move: { x: 99, z: 0 } })).toBeNull()
  })

  it("accepts bounded cooperative intents and rejects unknown ping kinds", () => {
    expect(parseClientMessage({ type: "action", action: "revive", targetPlayerId: "f7870cde-771f-4d25-aa85-85c20c862a49" })).toEqual({
      type: "action",
      action: "revive",
      targetPlayerId: "f7870cde-771f-4d25-aa85-85c20c862a49",
    })
    expect(parseClientMessage({ type: "world_ping", kind: "danger" })).toEqual({ type: "world_ping", kind: "danger" })
    expect(parseClientMessage({ type: "world_ping", kind: "admin" })).toBeNull()
    expect(parseClientMessage({ type: "redistribution_vote", choice: "granary" })).toEqual({ type: "redistribution_vote", choice: "granary" })
    expect(parseClientMessage({ type: "redistribution_vote", choice: "personal_wallet" })).toBeNull()
    expect(parseClientMessage({ type: "moderation", action: "report", targetPlayerId: "f7870cde-771f-4d25-aa85-85c20c862a49", reason: "griefing" })).not.toBeNull()
    expect(parseClientMessage({ type: "moderation", action: "report", targetPlayerId: "f7870cde-771f-4d25-aa85-85c20c862a49", reason: "free-text" })).toBeNull()
  })

  it("accepts a bounded action request id for authoritative shot acknowledgement", () => {
    expect(parseClientMessage({ type: "action", action: "shoot", requestId: 42 })).toEqual({
      type: "action",
      action: "shoot",
      requestId: 42,
    })
    expect(parseClientMessage({ type: "action", action: "shoot", requestId: -1 })).toBeNull()
    expect(parseClientMessage({ type: "action", action: "shoot", requestId: 2_147_483_648 })).toBeNull()
  })

  it("normalizes bounded chat sends and accepts message-id reports with fixed reasons", () => {
    expect(parseClientMessage({ type: "chat_send", channel: "band", text: "  Ready\n at the oak!  " })).toEqual({
      type: "chat_send",
      channel: "band",
      text: "Ready at the oak!",
    })
    expect(parseClientMessage({ type: "chat_send", channel: "camp", text: "🏹".repeat(160) })).not.toBeNull()
    expect(parseClientMessage({ type: "chat_send", channel: "global", text: "nope" })).toBeNull()
    expect(parseClientMessage({ type: "chat_send", channel: "band", text: "a".repeat(161) })).toBeNull()
    expect(parseClientMessage({
      type: "chat_report",
      channel: "camp",
      messageId: "8c02777e-2bb5-5afd-9f42-7a7b1ca4c622",
      reason: "harassment",
    })).not.toBeNull()
    expect(parseClientMessage({
      type: "chat_report",
      channel: "camp",
      messageId: "free-text",
      reason: "hate",
    })).toBeNull()
  })

  it("accepts only fixed, bounded public-camp discovery intents", () => {
    expect(parseClientMessage({ type: "join_public_hub", ...handshake, displayName: "Oakheart", characterId: "robin", accessToken: "header.payload.signature.long-enough" })).not.toBeNull()
    expect(parseClientMessage({ type: "hub_intent", looking: true, targetPreference: "peoples-purse", desiredPartySize: 4 })).not.toBeNull()
    expect(parseClientMessage({ type: "hub_intent", looking: true, targetPreference: "unreleased", desiredPartySize: 20 })).toBeNull()
    expect(parseClientMessage({ type: "hub_emote", kind: "wave" })).not.toBeNull()
    expect(parseClientMessage({ type: "hub_emote", kind: "free-text" })).toBeNull()
    expect(parseClientMessage({ type: "hub_block", targetParticipantId: "8c02777e-2bb5-5afd-9f42-7a7b1ca4c622" })).not.toBeNull()
  })

  it("accepts privacy-safe desync telemetry only within bounded ranges", () => {
    expect(parseClientMessage({ type: "set_product_analytics", consented: false })).toEqual({ type: "set_product_analytics", consented: false })
    expect(parseClientMessage({ type: "client_metrics", inputBacklog: 4, snapshotGapMs: 102 })).not.toBeNull()
    expect(parseClientMessage({ type: "client_metrics", inputBacklog: 99_999, snapshotGapMs: 102 })).toBeNull()
    expect(parseClientMessage({ type: "client_metrics", inputBacklog: 4, snapshotGapMs: -1 })).toBeNull()
  })

  it("accepts only fixed diagnostic codes and locally hashed fingerprints", () => {
    expect(parseClientMessage({ type: "client_diagnostic", code: "webgl_context_lost", fingerprint: "a".repeat(64), renderProfile: "degraded", browserFamily: "safari", browserMajor: 19 })).not.toBeNull()
    expect(parseClientMessage({ type: "client_diagnostic", code: "freeform_error", message: "raw stack", renderProfile: "standard", browserFamily: "chromium" })).toBeNull()
    expect(parseClientMessage({ type: "client_diagnostic", code: "uncaught_error", fingerprint: "not-a-hash", renderProfile: "standard", browserFamily: "other" })).toBeNull()
  })
})
