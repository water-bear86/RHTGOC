import { describe, expect, it } from "vitest"
import type { ChatChannel, ChatMessage } from "../shared/chat"
import { CHAT_MESSAGE_MAX_LENGTH, CHAT_PEEK_DURATION_MS, ChatState, truncateChatInput } from "./chat-state"

function message(id: string, channel: ChatChannel, sequence: number, playerId = "player-2"): ChatMessage {
  return {
    id,
    channel,
    sequence,
    sentAt: 1_000 + sequence,
    sender: { playerId, displayName: "Will Scarlet", characterId: "much" },
    text: `Message ${id}`,
  }
}

describe("client chat state", () => {
  it("limits input by Unicode code point without splitting emoji", () => {
    const value = "🏹".repeat(CHAT_MESSAGE_MAX_LENGTH + 1)
    const truncated = truncateChatInput(value)

    expect(Array.from(truncated)).toHaveLength(CHAT_MESSAGE_MAX_LENGTH)
    expect(truncated).toBe("🏹".repeat(CHAT_MESSAGE_MAX_LENGTH))
  })

  it("loads ordered history without treating it as new or unread", () => {
    const state = new ChatState()
    state.replaceHistory("band", [message("second", "band", 2), message("first", "band", 1)])

    expect(state.isAvailable("band")).toBe(true)
    expect(state.messages("band").map(({ id }) => id)).toEqual(["first", "second"])
    expect(state.unread("band")).toBe(0)
    expect(state.recent("band", 2_000)).toEqual([])
  })

  it("deduplicates live messages and tracks unread per channel", () => {
    const state = new ChatState()
    const live = message("live", "camp", 4)

    expect(state.append(live, 2_000, false)).toBe(true)
    expect(state.append(live, 2_001, false)).toBe(false)
    expect(state.unread("camp")).toBe(1)
    expect(state.totalUnread()).toBe(1)

    state.markRead("camp")
    expect(state.totalUnread()).toBe(0)
  })

  it("shows only the last two recent visible messages for six seconds", () => {
    const state = new ChatState()
    state.append(message("one", "band", 1), 1_000, false)
    state.append(message("two", "band", 2, "muted"), 1_500, false)
    state.append(message("three", "band", 3), 2_000, false)
    state.append(message("four", "band", 4), 2_500, false)

    expect(state.recent("band", 2_600, new Set(["muted"])).map(({ id }) => id)).toEqual(["three", "four"])
    expect(state.recent("band", 1_000 + CHAT_PEEK_DURATION_MS + 1, new Set(["muted"])).map(({ id }) => id)).toEqual(["three", "four"])
    expect(state.recent("band", 2_500 + CHAT_PEEK_DURATION_MS + 1)).toEqual([])
  })

  it("filters all prior messages from muted or blocked senders", () => {
    const state = new ChatState()
    state.replaceHistory("camp", [message("visible", "camp", 1), message("hidden", "camp", 2, "blocked")])

    expect(state.messages("camp", new Set(["blocked"])).map(({ id }) => id)).toEqual(["visible"])
  })

  it("refuses unavailable channel selection and clears availability on reset", () => {
    const state = new ChatState()
    expect(state.selectChannel("camp")).toBe(false)
    state.replaceHistory("camp", [])
    expect(state.selectChannel("camp")).toBe(true)

    state.reset("camp")
    expect(state.isAvailable("camp")).toBe(false)
    expect(state.unread("camp")).toBe(0)
  })
})
