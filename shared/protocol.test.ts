import { describe, expect, it } from "vitest"
import { PROTOCOL_VERSION, parseClientMessage } from "./protocol"

describe("Merry Band protocol", () => {
  it("accepts a versioned create-room message", () => {
    expect(parseClientMessage({ type: "create_room", version: PROTOCOL_VERSION, displayName: "Oakheart", characterId: "marian" })).toEqual({
      type: "create_room",
      version: PROTOCOL_VERSION,
      displayName: "Oakheart",
      characterId: "marian",
    })
  })

  it("rejects malformed names, room codes, and movement", () => {
    expect(parseClientMessage({ type: "create_room", version: PROTOCOL_VERSION, displayName: "<script>", characterId: "robin" })).toBeNull()
    expect(parseClientMessage({ type: "join_room", version: PROTOCOL_VERSION, roomCode: "abc", displayName: "Robin", characterId: "robin" })).toBeNull()
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
})
