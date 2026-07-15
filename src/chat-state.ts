import { CHAT_TEXT_MAX_LENGTH, type ChatChannel, type ChatMessage } from "../shared/chat"

export const CHAT_CHANNELS = ["band", "camp"] as const satisfies readonly ChatChannel[]
export const CHAT_MESSAGE_MAX_LENGTH = CHAT_TEXT_MAX_LENGTH
export const CHAT_PEEK_DURATION_MS = 6_000

export function truncateChatInput(value: string): string {
  return Array.from(value).slice(0, CHAT_MESSAGE_MAX_LENGTH).join("")
}

interface StoredChatMessage {
  message: ChatMessage
  receivedAt: number | null
}

interface ChannelState {
  available: boolean
  messages: StoredChatMessage[]
  unread: number
}

const HISTORY_LIMITS: Record<ChatChannel, number> = { band: 50, camp: 100 }

function emptyChannel(): ChannelState {
  return { available: false, messages: [], unread: 0 }
}

function orderedUnique(messages: readonly ChatMessage[]): ChatMessage[] {
  const unique = new Map(messages.map((message) => [message.id, message]))
  return [...unique.values()].sort((left, right) => left.sequence - right.sequence || left.sentAt - right.sentAt)
}

export class ChatState {
  private readonly channels: Record<ChatChannel, ChannelState> = {
    band: emptyChannel(),
    camp: emptyChannel(),
  }

  activeChannel: ChatChannel = "band"
  drawerOpen = false

  setAvailability(channel: ChatChannel, available: boolean): void {
    this.channels[channel].available = available
    if (!available) this.channels[channel].unread = 0
  }

  isAvailable(channel: ChatChannel): boolean {
    return this.channels[channel].available
  }

  replaceHistory(channel: ChatChannel, messages: readonly ChatMessage[]): void {
    const limit = HISTORY_LIMITS[channel]
    this.channels[channel] = {
      available: true,
      messages: orderedUnique(messages)
        .filter((message) => message.channel === channel)
        .slice(-limit)
        .map((message) => ({ message, receivedAt: null })),
      unread: 0,
    }
  }

  append(message: ChatMessage, receivedAt: number, read: boolean): boolean {
    const channel = this.channels[message.channel]
    channel.available = true
    if (channel.messages.some((entry) => entry.message.id === message.id)) return false
    channel.messages.push({ message, receivedAt })
    channel.messages.sort((left, right) => left.message.sequence - right.message.sequence || left.message.sentAt - right.message.sentAt)
    channel.messages.splice(0, Math.max(0, channel.messages.length - HISTORY_LIMITS[message.channel]))
    if (!read) channel.unread += 1
    return true
  }

  selectChannel(channel: ChatChannel): boolean {
    if (!this.channels[channel].available) return false
    this.activeChannel = channel
    return true
  }

  setDrawerOpen(open: boolean): void {
    this.drawerOpen = open
    if (open) this.markRead(this.activeChannel)
  }

  markRead(channel: ChatChannel): void {
    this.channels[channel].unread = 0
  }

  unread(channel: ChatChannel): number {
    return this.channels[channel].unread
  }

  totalUnread(): number {
    return CHAT_CHANNELS.reduce((total, channel) => total + this.channels[channel].unread, 0)
  }

  messages(channel: ChatChannel, hiddenPlayerIds: ReadonlySet<string> = new Set()): ChatMessage[] {
    return this.channels[channel].messages
      .map((entry) => entry.message)
      .filter((message) => !hiddenPlayerIds.has(message.sender.playerId))
  }

  recent(
    channel: ChatChannel,
    now: number,
    hiddenPlayerIds: ReadonlySet<string> = new Set(),
    limit = 2,
  ): ChatMessage[] {
    return this.channels[channel].messages
      .filter((entry) => entry.receivedAt !== null && now - entry.receivedAt <= CHAT_PEEK_DURATION_MS)
      .map((entry) => entry.message)
      .filter((message) => !hiddenPlayerIds.has(message.sender.playerId))
      .slice(-limit)
  }

  reset(channel?: ChatChannel): void {
    if (channel) this.channels[channel] = emptyChannel()
    else {
      this.channels.band = emptyChannel()
      this.channels.camp = emptyChannel()
      this.activeChannel = "band"
      this.drawerOpen = false
    }
  }
}
