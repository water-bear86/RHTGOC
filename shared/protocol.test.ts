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
})
