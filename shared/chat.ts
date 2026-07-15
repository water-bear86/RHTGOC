import { z } from "zod"

export const CHAT_TEXT_MAX_LENGTH = 160

export const ChatChannelSchema = z.enum(["band", "camp"])
export type ChatChannel = z.infer<typeof ChatChannelSchema>

export const ChatReportReasonSchema = z.enum(["harassment", "griefing", "unsafe-name", "cheating"])
export type ChatReportReason = z.infer<typeof ChatReportReasonSchema>

const CHAT_CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu
const CHAT_DIRECTIONAL_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu
const CHAT_ZERO_WIDTH_CHARACTERS = /[\u200b-\u200d\u2060\ufeff]/gu

/**
 * Produces the single-line, display-safe text that every chat surface uses.
 * A null result means the message is empty or exceeds the public contract.
 */
export function normalizeChatText(value: string): string | null {
  const normalized = value
    .normalize("NFKC")
    .replace(CHAT_CONTROL_CHARACTERS, "")
    .replace(CHAT_DIRECTIONAL_CONTROLS, "")
    .replace(CHAT_ZERO_WIDTH_CHARACTERS, "")
    .replace(/\s+/gu, " ")
    .trim()

  const codePointLength = Array.from(normalized).length
  return codePointLength > 0 && codePointLength <= CHAT_TEXT_MAX_LENGTH ? normalized : null
}

export const ChatTextSchema = z.string().max(640).transform((value, context) => {
  const normalized = normalizeChatText(value)
  if (normalized === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Chat messages must contain 1-${CHAT_TEXT_MAX_LENGTH} visible characters`,
    })
    return z.NEVER
  }
  return normalized
})

export interface ChatMessage {
  id: string
  channel: ChatChannel
  sequence: number
  sentAt: number
  sender: {
    playerId: string
    displayName: string
    characterId: "robin" | "marian" | "little-john" | "much"
  }
  text: string
}

export type ChatErrorCode = "NOT_AVAILABLE" | "INVALID_MESSAGE" | "RATE_LIMITED" | "DUPLICATE" | "MESSAGE_NOT_FOUND" | "FORBIDDEN"
