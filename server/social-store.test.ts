import { describe, expect, it, vi } from "vitest"
import type { RpcClient } from "./band-store"
import { SupabaseSocialStore, type HubChatReportEvidence } from "./social-store"

const chatReport: HubChatReportEvidence = {
  reporterUserId: "66778899-aabb-4cdd-8eef-001122334455",
  targetUserId: "778899aa-bbcc-4dee-8ff0-112233445566",
  messageId: "8899aabb-ccdd-4eff-8011-223344556677",
  instanceId: "99aabbcc-ddee-4f00-8122-334455667788",
  reason: "harassment",
  text: "Reported camp message",
  messageSentAt: Date.parse("2026-07-15T20:00:00.000Z"),
  context: {
    channel: "camp",
    senderParticipantId: "hub-participant-2",
    senderDisplayName: "Outlaw Two",
    senderCharacterId: "marian",
    surroundingMessages: [{
      messageId: "aabbccdd-eeff-4001-8233-445566778899",
      senderParticipantId: "hub-participant-1",
      senderDisplayName: "Outlaw One",
      senderCharacterId: "robin",
      text: "Message before the report",
      sentAt: Date.parse("2026-07-15T19:59:58.000Z"),
    }],
  },
}

describe("recent-player persistence", () => {
  it("submits one authoritative mission identity and verified user set", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const store = new SupabaseSocialStore({ rpc } as RpcClient)
    await expect(store.recordRecentPlayers("66778899-aabb-4cdd-8eef-001122334455", ["778899aa-bbcc-4dee-8ff0-112233445566", "8899aabb-ccdd-4eff-8011-223344556677"])).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith("record_recent_band_players", { p_mission_id: "66778899-aabb-4cdd-8eef-001122334455", p_user_ids: ["778899aa-bbcc-4dee-8ff0-112233445566", "8899aabb-ccdd-4eff-8011-223344556677"] })
  })

  it("loads accepted friend ids for capacity-aware hub placement", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ["778899aa-bbcc-4dee-8ff0-112233445566"], error: null })
    const store = new SupabaseSocialStore({ rpc } as RpcClient)
    await expect(store.getAcceptedFriendIds("66778899-aabb-4cdd-8eef-001122334455")).resolves.toEqual(["778899aa-bbcc-4dee-8ff0-112233445566"])
  })
  it("persists a verified in-hub block without accepting client user ids", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const store = new SupabaseSocialStore({ rpc } as RpcClient)
    await expect(store.recordHubBlock("66778899-aabb-4cdd-8eef-001122334455", "778899aa-bbcc-4dee-8ff0-112233445566")).resolves.toBe(true)
  })

  it("loads both directions of persistent hub blocks before placement", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ["778899aa-bbcc-4dee-8ff0-112233445566"], error: null })
    const store = new SupabaseSocialStore({ rpc } as RpcClient)
    await expect(store.getHubBlockedIds("66778899-aabb-4cdd-8eef-001122334455")).resolves.toEqual(["778899aa-bbcc-4dee-8ff0-112233445566"])
  })

  it("persists fixed-reason reports with verified server identities", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const store = new SupabaseSocialStore({ rpc } as RpcClient)
    await expect(store.recordHubReport("66778899-aabb-4cdd-8eef-001122334455", "778899aa-bbcc-4dee-8ff0-112233445566", "griefing")).resolves.toBe(true)
  })

  it("persists server-resolved camp message evidence without accepting arbitrary metadata", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null })
    const store = new SupabaseSocialStore({ rpc } as RpcClient)
    await expect(store.recordHubChatReport(chatReport)).resolves.toBe(true)
    expect(rpc).toHaveBeenCalledWith("record_public_hub_chat_report", {
      p_reporter_id: chatReport.reporterUserId,
      p_target_id: chatReport.targetUserId,
      p_message_id: chatReport.messageId,
      p_instance_id: chatReport.instanceId,
      p_reason: "harassment",
      p_message_text: "Reported camp message",
      p_message_sent_at: "2026-07-15T20:00:00.000Z",
      p_context: chatReport.context,
    })
  })

  it("prunes expired report evidence through a privileged RPC and validates its response", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 4, error: null })
    const store = new SupabaseSocialStore({ rpc } as RpcClient)
    await expect(store.pruneHubChatReports(new Date("2026-08-15T20:00:00.000Z"))).resolves.toBe(4)
    expect(rpc).toHaveBeenCalledWith("prune_public_hub_chat_reports", { p_before: "2026-08-15T20:00:00.000Z" })

    const malformed = new SupabaseSocialStore({ rpc: vi.fn().mockResolvedValue({ data: "4", error: null }) } as RpcClient)
    await expect(malformed.pruneHubChatReports()).rejects.toThrow("invalid response")
  })
})
