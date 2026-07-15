import { describe, expect, it } from "vitest"
import { CHAT_TEXT_MAX_LENGTH, ChatTextSchema, normalizeChatText } from "./chat"

describe("chat text", () => {
  it("normalizes Unicode and whitespace into plain, single-line text", () => {
    expect(normalizeChatText("  Ｒｏｂｉｎ\n\t  is ready  ")).toBe("Robin is ready")
  })

  it("strips control, directional, and zero-width spoofing characters", () => {
    expect(normalizeChatText("safe\u0000\u202eevil\u2069\u200b text")).toBe("safeevil text")
  })

  it("rejects empty and over-limit messages without splitting astral characters", () => {
    expect(normalizeChatText(" \n\t\u202e ")).toBeNull()
    expect(normalizeChatText("a".repeat(CHAT_TEXT_MAX_LENGTH + 1))).toBeNull()
    expect(normalizeChatText("🏹".repeat(CHAT_TEXT_MAX_LENGTH))).not.toBeNull()
    expect(ChatTextSchema.safeParse("🏹".repeat(CHAT_TEXT_MAX_LENGTH)).success).toBe(true)
  })
})
