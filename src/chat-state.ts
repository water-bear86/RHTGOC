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
  unread: boolean
}

interface ChannelState {
  available: boolean
  messages: StoredChatMessage[]
}

const HISTORY_LIMITS: Record<ChatChannel, number> = { band: 50, camp: 100 }

function emptyChannel(): ChannelState {
  return { available: false, messages: [] }
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
    if (!available) this.markRead(channel)
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
        .map((message) => ({ message, receivedAt: null, unread: false })),
    }
  }

  append(message: ChatMessage, receivedAt: number, read: boolean): boolean {
    const channel = this.channels[message.channel]
    channel.available = true
    if (channel.messages.some((entry) => entry.message.id === message.id)) return false
    channel.messages.push({ message, receivedAt, unread: !read })
    channel.messages.sort((left, right) => left.message.sequence - right.message.sequence || left.message.sentAt - right.message.sentAt)
    channel.messages.splice(0, Math.max(0, channel.messages.length - HISTORY_LIMITS[message.channel]))
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
    for (const entry of this.channels[channel].messages) entry.unread = false
  }

  markPlayerRead(playerId: string): void {
    for (const channel of CHAT_CHANNELS) {
      for (const entry of this.channels[channel].messages) {
        if (entry.message.sender.playerId === playerId) entry.unread = false
      }
    }
  }

  unread(channel: ChatChannel): number {
    return this.channels[channel].messages.filter((entry) => entry.unread).length
  }

  totalUnread(): number {
    return CHAT_CHANNELS.reduce((total, channel) => total + this.unread(channel), 0)
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
    return this.recentEntries(channel, now, hiddenPlayerIds, limit)
      .map((entry) => entry.message)
  }

  nextRecentExpiry(
    channel: ChatChannel,
    now: number,
    hiddenPlayerIds: ReadonlySet<string> = new Set(),
    limit = 2,
  ): number | null {
    let expiry: number | null = null
    for (const entry of this.recentEntries(channel, now, hiddenPlayerIds, limit)) {
      if (entry.receivedAt === null) continue
      const candidate = entry.receivedAt + CHAT_PEEK_DURATION_MS
      expiry = expiry === null ? candidate : Math.min(expiry, candidate)
    }
    return expiry
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

  private recentEntries(
    channel: ChatChannel,
    now: number,
    hiddenPlayerIds: ReadonlySet<string>,
    limit: number,
  ): StoredChatMessage[] {
    return this.channels[channel].messages
      .filter((entry) => entry.receivedAt !== null && now - entry.receivedAt <= CHAT_PEEK_DURATION_MS)
      .filter((entry) => !hiddenPlayerIds.has(entry.message.sender.playerId))
      .slice(-limit)
  }
}
