import { randomUUID } from "node:crypto"
import { WebSocket } from "ws"
import type { CharacterId, PublicHubPlayer, ServerMessage } from "../shared/protocol"
import { normalizeChatText, type ChatErrorCode, type ChatMessage, type ChatReportReason } from "../shared/chat"
import { PUBLIC_HUB_WORLD_BOUNDS, resolveSherwoodPlayerMovement } from "../shared/world-collisions"
import type { HubChatReportEvidence } from "./social-store"

export const PUBLIC_HUB_CAPACITY = 12
export const PUBLIC_HUB_IDLE_MS = 60_000
export const PUBLIC_HUB_CHAT_HISTORY_LIMIT = 100
export const PUBLIC_HUB_CHAT_MAX_AGE_MS = 30 * 60_000
export const PUBLIC_HUB_CHAT_MIN_INTERVAL_MS = 1_500
export const PUBLIC_HUB_CHAT_RATE_WINDOW_MS = 30_000
export const PUBLIC_HUB_CHAT_RATE_LIMIT = 8
export const PUBLIC_HUB_CHAT_DUPLICATE_WINDOW_MS = 30_000

interface CampChatRecord {
  message: ChatMessage
  senderUserId: string
}

export type CampChatSendResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; code: ChatErrorCode; message: string; retryAfterMs?: number }

export type CampChatReportResult =
  | { ok: true; evidence: HubChatReportEvidence }
  | { ok: false; code: ChatErrorCode; message: string; retryAfterMs?: number }

export interface PublicHubServiceOptions {
  campChatEnabled?: boolean
}

export interface HubParticipant extends PublicHubPlayer {
  userId: string
  friendUserIds: Set<string>
  blockedUserIds: Set<string>
  socket: WebSocket
  lastActivityAt: number
  lookingSinceAt: number | null
  lastSequence: number
  lastEmoteAt: number
  lastPingAt: number
  lastReportAt: number
  reportedUserIds: Set<string>
  chatSentAt: number[]
  recentChatTexts: Map<string, number>
  reportedChatMessageIds: Set<string>
}

interface HubInstance {
  id: string
  participants: Map<string, HubParticipant>
  chatSequence: number
  chatMessages: CampChatRecord[]
}

export class PublicHubService {
  readonly instances = new Map<string, HubInstance>()
  readonly reports: Array<{ at: number; reporterUserId: string; targetUserId: string; reason: string }> = []
  readonly blockedPairs = new Set<string>()
  campChatEnabled: boolean
  private readonly participants = new Map<string, HubParticipant>()
  private readonly participantInstanceIds = new Map<string, string>()

  constructor(options: PublicHubServiceOptions = {}) {
    this.campChatEnabled = options.campChatEnabled === true
  }

  setCampChatEnabled(enabled: boolean): void {
    this.campChatEnabled = enabled
  }

  join(socket: WebSocket, userId: string, displayName: string, characterId: CharacterId, friendUserIds: string[], now = Date.now(), blockedUserIds: string[] = []): HubParticipant {
    this.cleanup(now)
    const blocked = new Set(blockedUserIds)
    const candidates = [...this.instances.values()].filter((instance) => instance.participants.size < PUBLIC_HUB_CAPACITY && [...instance.participants.values()].every((player) => !blocked.has(player.userId) && !player.blockedUserIds.has(userId)))
    const instance = candidates.sort((left, right) => {
      const leftFriends = [...left.participants.values()].filter((player) => friendUserIds.includes(player.userId)).length
      const rightFriends = [...right.participants.values()].filter((player) => friendUserIds.includes(player.userId)).length
      return rightFriends - leftFriends || right.participants.size - left.participants.size
    })[0] ?? this.createInstance()
    const index = instance.participants.size
    const angle = index / PUBLIC_HUB_CAPACITY * Math.PI * 2
    const spawn = resolveSherwoodPlayerMovement({
      x: -11 + Math.cos(angle) * 4.5,
      z: 9 + Math.sin(angle) * 4.5,
    }, { x: 0, z: 0 }, PUBLIC_HUB_WORLD_BOUNDS)
    const participant: HubParticipant = {
      id: randomUUID(), userId, friendUserIds: new Set(friendUserIds), blockedUserIds: blocked, socket, displayName, characterId,
      position: spawn,
      looking: false, targetPreference: "any", desiredPartySize: 2,
      emote: null, emoteExpiresAt: 0, ping: null, pingExpiresAt: 0,
      lastActivityAt: now, lookingSinceAt: null, lastSequence: 0, lastEmoteAt: 0, lastPingAt: 0, lastReportAt: 0, reportedUserIds: new Set(),
      chatSentAt: [], recentChatTexts: new Map(), reportedChatMessageIds: new Set(),
    }
    instance.participants.set(participant.id, participant)
    this.participants.set(participant.id, participant)
    this.participantInstanceIds.set(participant.id, instance.id)
    this.send(socket, { type: "hub_welcome", instanceId: instance.id, participantId: participant.id, capacity: PUBLIC_HUB_CAPACITY })
    if (this.campChatEnabled) this.sendChatHistory(instance, participant, now)
    this.broadcast(instance, now)
    return participant
  }

  leave(participantId: string, now = Date.now()): void {
    const instance = this.instanceFor(participantId)
    if (!instance) return
    instance.participants.delete(participantId)
    this.participants.delete(participantId)
    this.participantInstanceIds.delete(participantId)
    if (instance.participants.size === 0) this.instances.delete(instance.id)
    else this.broadcast(instance, now)
  }

  setIntent(participantId: string, looking: boolean, targetPreference: PublicHubPlayer["targetPreference"], desiredPartySize: 2 | 3 | 4, now = Date.now()): boolean {
    const participant = this.participant(participantId)
    const instance = this.instanceFor(participantId)
    if (!participant || !instance) return false
    if (looking && !participant.looking) participant.lookingSinceAt = now
    if (!looking) participant.lookingSinceAt = null
    participant.looking = looking
    participant.targetPreference = targetPreference
    participant.desiredPartySize = desiredPartySize
    participant.lastActivityAt = now
    this.broadcast(instance, now)
    return true
  }

  move(participantId: string, sequence: number, move: { x: number; z: number }, now = Date.now()): boolean {
    const participant = this.participant(participantId)
    if (!participant || sequence <= participant.lastSequence || now - participant.lastActivityAt < 20) return false
    const length = Math.hypot(move.x, move.z) || 1
    const resolved = resolveSherwoodPlayerMovement(participant.position, {
      x: move.x / Math.max(1, length) * 0.35,
      z: move.z / Math.max(1, length) * 0.35,
    }, PUBLIC_HUB_WORLD_BOUNDS)
    participant.position.x = resolved.x
    participant.position.z = resolved.z
    participant.lastSequence = sequence
    participant.lastActivityAt = now
    return true
  }

  emote(participantId: string, kind: "wave" | "cheer" | "bow", now = Date.now()): boolean {
    const participant = this.participant(participantId)
    const instance = this.instanceFor(participantId)
    if (!participant || !instance || now - participant.lastEmoteAt < 1_000) return false
    participant.emote = kind; participant.emoteExpiresAt = now + 2_500; participant.lastEmoteAt = now; participant.lastActivityAt = now
    this.broadcast(instance, now)
    return true
  }

  ping(participantId: string, kind: "regroup" | "target", now = Date.now()): boolean {
    const participant = this.participant(participantId)
    const instance = this.instanceFor(participantId)
    if (!participant || !instance || now - participant.lastPingAt < 2_000) return false
    participant.ping = kind; participant.pingExpiresAt = now + 3_000; participant.lastPingAt = now; participant.lastActivityAt = now
    this.broadcast(instance, now)
    return true
  }

  sendCampChat(participantId: string, text: string, now = Date.now()): CampChatSendResult {
    if (!this.campChatEnabled) return this.chatFailure("NOT_AVAILABLE", "Camp chat is unavailable until moderation storage is ready.")
    const participant = this.participant(participantId)
    const instance = this.instanceFor(participantId)
    if (!participant || !instance) return this.chatFailure("FORBIDDEN", "Join a public camp before sending a Camp message.")
    const normalizedText = normalizeChatText(text)
    if (normalizedText === null) return this.chatFailure("INVALID_MESSAGE", "Camp messages must contain 1-160 visible characters.")

    this.pruneChat(instance, now)
    participant.chatSentAt = participant.chatSentAt.filter((sentAt) => now - sentAt < PUBLIC_HUB_CHAT_RATE_WINDOW_MS)
    for (const [recentText, sentAt] of participant.recentChatTexts) {
      if (now - sentAt >= PUBLIC_HUB_CHAT_DUPLICATE_WINDOW_MS) participant.recentChatTexts.delete(recentText)
    }

    const previousSentAt = participant.chatSentAt.at(-1)
    if (previousSentAt !== undefined && now - previousSentAt < PUBLIC_HUB_CHAT_MIN_INTERVAL_MS) {
      return this.chatFailure("RATE_LIMITED", "Give the campfire a moment before sending again.", PUBLIC_HUB_CHAT_MIN_INTERVAL_MS - (now - previousSentAt))
    }
    if (participant.chatSentAt.length >= PUBLIC_HUB_CHAT_RATE_LIMIT) {
      const retryAfterMs = PUBLIC_HUB_CHAT_RATE_WINDOW_MS - (now - participant.chatSentAt[0])
      return this.chatFailure("RATE_LIMITED", "Too many Camp messages. Let the conversation breathe.", retryAfterMs)
    }
    const duplicateKey = normalizedText.toLowerCase()
    const duplicateSentAt = participant.recentChatTexts.get(duplicateKey)
    if (duplicateSentAt !== undefined && now - duplicateSentAt < PUBLIC_HUB_CHAT_DUPLICATE_WINDOW_MS) {
      return this.chatFailure("DUPLICATE", "That message was already sent recently.", PUBLIC_HUB_CHAT_DUPLICATE_WINDOW_MS - (now - duplicateSentAt))
    }

    const message: ChatMessage = {
      id: randomUUID(),
      channel: "camp",
      sequence: ++instance.chatSequence,
      sentAt: now,
      sender: {
        playerId: participant.id,
        displayName: participant.displayName,
        characterId: participant.characterId,
      },
      text: normalizedText,
    }
    instance.chatMessages.push({ message, senderUserId: participant.userId })
    if (instance.chatMessages.length > PUBLIC_HUB_CHAT_HISTORY_LIMIT) {
      instance.chatMessages.splice(0, instance.chatMessages.length - PUBLIC_HUB_CHAT_HISTORY_LIMIT)
    }
    participant.chatSentAt.push(now)
    participant.recentChatTexts.set(duplicateKey, now)
    participant.lastActivityAt = now
    this.broadcastCampChat(instance, { message, senderUserId: participant.userId })
    return { ok: true, message }
  }

  reportCampChat(reporterId: string, messageId: string, reason: ChatReportReason, now = Date.now()): CampChatReportResult {
    if (!this.campChatEnabled) return this.chatFailure("NOT_AVAILABLE", "Camp chat reporting is unavailable.")
    const reporter = this.participant(reporterId)
    const instance = this.instanceFor(reporterId)
    if (!reporter || !instance) return this.chatFailure("FORBIDDEN", "Join a public camp before reporting a message.")
    this.pruneChat(instance, now)
    const record = instance.chatMessages.find((candidate) => candidate.message.id === messageId)
    if (!record || !this.isChatVisibleTo(reporter, record.senderUserId)) {
      return this.chatFailure("MESSAGE_NOT_FOUND", "That Camp message is no longer available.")
    }
    if (record.senderUserId === reporter.userId) return this.chatFailure("FORBIDDEN", "You cannot report your own message.")
    if (reporter.reportedChatMessageIds.has(messageId)) return this.chatFailure("DUPLICATE", "That message has already been reported.")
    if (reporter.lastReportAt > 0 && now - reporter.lastReportAt < 5_000) {
      return this.chatFailure("RATE_LIMITED", "Wait before filing another report.", 5_000 - (now - reporter.lastReportAt))
    }

    const visibleRecords = instance.chatMessages.filter((candidate) => this.isChatVisibleTo(reporter, candidate.senderUserId))
    const reportedIndex = visibleRecords.findIndex((candidate) => candidate.message.id === messageId)
    const surroundingRecords = [
      ...visibleRecords.slice(Math.max(0, reportedIndex - 2), reportedIndex),
      ...visibleRecords.slice(reportedIndex + 1, reportedIndex + 3),
    ]
    const evidence: HubChatReportEvidence = {
      reporterUserId: reporter.userId,
      targetUserId: record.senderUserId,
      messageId: record.message.id,
      instanceId: instance.id,
      reason,
      text: record.message.text,
      messageSentAt: record.message.sentAt,
      context: {
        channel: "camp",
        senderParticipantId: record.message.sender.playerId,
        senderDisplayName: record.message.sender.displayName,
        senderCharacterId: record.message.sender.characterId,
        surroundingMessages: surroundingRecords.map((candidate) => ({
          messageId: candidate.message.id,
          senderParticipantId: candidate.message.sender.playerId,
          senderDisplayName: candidate.message.sender.displayName,
          senderCharacterId: candidate.message.sender.characterId,
          text: candidate.message.text,
          sentAt: candidate.message.sentAt,
        })),
      },
    }
    reporter.lastReportAt = now
    reporter.lastActivityAt = now
    reporter.reportedChatMessageIds.add(messageId)
    return { ok: true, evidence }
  }

  releaseCampChatReport(reporterId: string, messageId: string): void {
    const reporter = this.participant(reporterId)
    if (!reporter?.reportedChatMessageIds.delete(messageId)) return
    reporter.lastReportAt = 0
  }

  formBand(participantId: string, now = Date.now()): HubParticipant[] | null {
    const leader = this.participant(participantId)
    if (!leader || !leader.looking) return null
    const matches = [...this.participants.values()]
      .filter((candidate) => candidate.id !== participantId && this.compatible(leader, candidate))
      .sort((left, right) => Number(leader.friendUserIds.has(right.userId)) - Number(leader.friendUserIds.has(left.userId)) || left.lastActivityAt - right.lastActivityAt)
    if (matches.length < leader.desiredPartySize - 1) return null
    const group = [leader]
    for (const candidate of matches) {
      if (group.every((member) => this.compatible(member, candidate))) group.push(candidate)
      if (group.length === leader.desiredPartySize) break
    }
    if (group.length < leader.desiredPartySize) return null
    this.removeMatched(group, now)
    return group
  }

  drainMatches(now = Date.now()): HubParticipant[][] {
    const waiting = [...this.participants.values()]
      .filter((participant) => participant.looking)
      .sort((left, right) => (left.lookingSinceAt ?? now) - (right.lookingSinceAt ?? now) || left.lastActivityAt - right.lastActivityAt)
    const claimed = new Set<string>()
    const groups: HubParticipant[][] = []
    for (const leader of waiting) {
      if (claimed.has(leader.id)) continue
      const group = [leader]
      const candidates = waiting
        .filter((candidate) => candidate.id !== leader.id && !claimed.has(candidate.id) && this.compatible(leader, candidate))
        .sort((left, right) => Number(leader.friendUserIds.has(right.userId)) - Number(leader.friendUserIds.has(left.userId)) || (left.lookingSinceAt ?? now) - (right.lookingSinceAt ?? now))
      for (const candidate of candidates) {
        if (group.every((member) => this.compatible(member, candidate))) group.push(candidate)
        if (group.length === leader.desiredPartySize) break
      }
      if (group.length !== leader.desiredPartySize) continue
      for (const participant of group) claimed.add(participant.id)
      groups.push(group)
    }
    for (const group of groups) this.removeMatched(group, now)
    return groups
  }

  report(reporterId: string, targetId: string, reason: string, now = Date.now()): { reporterUserId: string; targetUserId: string; reason: string } | null {
    const reporter = this.participant(reporterId)
    const target = this.participant(targetId)
    if (!reporter || !target || reporter.id === target.id || this.instanceFor(reporterId)?.id !== this.instanceFor(targetId)?.id || (reporter.lastReportAt > 0 && now - reporter.lastReportAt < 5_000) || reporter.reportedUserIds.has(target.userId)) return null
    reporter.lastReportAt = now
    reporter.reportedUserIds.add(target.userId)
    reporter.lastActivityAt = now
    this.reports.push({ at: now, reporterUserId: reporter.userId, targetUserId: target.userId, reason })
    return { reporterUserId: reporter.userId, targetUserId: target.userId, reason }
  }

  block(blockerId: string, targetId: string, now = Date.now()): { blockerUserId: string; blockedUserId: string } | null {
    const blocker = this.participant(blockerId)
    const target = this.participant(targetId)
    const instance = this.instanceFor(blockerId)
    if (!blocker || !target || !instance || blockerId === targetId || instance.id !== this.instanceFor(targetId)?.id) return null
    this.blockedPairs.add(`${blocker.userId}:${target.userId}`)
    blocker.blockedUserIds.add(target.userId)
    blocker.lastActivityAt = now
    this.broadcast(instance, now)
    if (this.campChatEnabled) this.broadcastChatHistories(instance, now)
    return { blockerUserId: blocker.userId, blockedUserId: target.userId }
  }

  cleanup(now = Date.now()): void {
    for (const instance of this.instances.values()) {
      this.pruneChat(instance, now)
      for (const participant of instance.participants.values()) if (now - participant.lastActivityAt > PUBLIC_HUB_IDLE_MS || participant.socket.readyState !== WebSocket.OPEN) {
        instance.participants.delete(participant.id)
        this.participants.delete(participant.id)
        this.participantInstanceIds.delete(participant.id)
      }
      if (instance.participants.size === 0) this.instances.delete(instance.id)
      else this.broadcast(instance, now)
    }
  }

  broadcastAll(now = Date.now()): void {
    for (const instance of this.instances.values()) this.broadcast(instance, now)
  }

  private createInstance(): HubInstance {
    const instance = { id: randomUUID(), participants: new Map<string, HubParticipant>(), chatSequence: 0, chatMessages: [] }
    this.instances.set(instance.id, instance)
    return instance
  }

  private participant(id: string): HubParticipant | null {
    return this.participants.get(id) ?? null
  }

  private instanceFor(participantId: string): HubInstance | null {
    const instanceId = this.participantInstanceIds.get(participantId)
    return instanceId ? this.instances.get(instanceId) ?? null : null
  }

  private compatible(left: HubParticipant, right: HubParticipant): boolean {
    return left.id !== right.id
      && left.looking && right.looking
      && left.desiredPartySize === right.desiredPartySize
      && (left.targetPreference === "any" || right.targetPreference === "any" || left.targetPreference === right.targetPreference)
      && !left.blockedUserIds.has(right.userId) && !right.blockedUserIds.has(left.userId)
      && !this.blockedPairs.has(`${left.userId}:${right.userId}`) && !this.blockedPairs.has(`${right.userId}:${left.userId}`)
  }

  private removeMatched(group: HubParticipant[], now: number): void {
    const changedInstances = new Set<string>()
    for (const participant of group) {
      const instanceId = this.participantInstanceIds.get(participant.id)
      const instance = instanceId ? this.instances.get(instanceId) : null
      if (instance) {
        instance.participants.delete(participant.id)
        changedInstances.add(instance.id)
      }
      this.participants.delete(participant.id)
      this.participantInstanceIds.delete(participant.id)
    }
    for (const instanceId of changedInstances) {
      const instance = this.instances.get(instanceId)
      if (!instance) continue
      if (instance.participants.size === 0) this.instances.delete(instanceId)
      else this.broadcast(instance, now)
    }
  }

  private broadcast(instance: HubInstance, now: number): void {
    const players = [...instance.participants.values()].map((participant) => ({
      id: participant.id, displayName: participant.displayName, characterId: participant.characterId, position: { ...participant.position }, looking: participant.looking,
      targetPreference: participant.targetPreference, desiredPartySize: participant.desiredPartySize,
      emote: participant.emoteExpiresAt > now ? participant.emote : null, emoteExpiresAt: participant.emoteExpiresAt,
      ping: participant.pingExpiresAt > now ? participant.ping : null, pingExpiresAt: participant.pingExpiresAt,
    }))
    for (const participant of instance.participants.values()) {
      const visible = players.filter((player) => {
        const other = instance.participants.get(player.id)!
        return !participant.blockedUserIds.has(other.userId) && !other.blockedUserIds.has(participant.userId)
          && !this.blockedPairs.has(`${participant.userId}:${other.userId}`) && !this.blockedPairs.has(`${other.userId}:${participant.userId}`)
      })
      this.send(participant.socket, { type: "hub_state", instanceId: instance.id, players: visible })
    }
  }

  private broadcastCampChat(instance: HubInstance, record: CampChatRecord): void {
    for (const participant of instance.participants.values()) {
      if (this.isChatVisibleTo(participant, record.senderUserId)) {
        this.send(participant.socket, { type: "chat_message", message: record.message })
      }
    }
  }

  private broadcastChatHistories(instance: HubInstance, now: number): void {
    this.pruneChat(instance, now)
    for (const participant of instance.participants.values()) this.sendChatHistory(instance, participant, now)
  }

  private sendChatHistory(instance: HubInstance, participant: HubParticipant, now: number): void {
    this.pruneChat(instance, now)
    const messages = instance.chatMessages
      .filter((record) => this.isChatVisibleTo(participant, record.senderUserId))
      .map((record) => record.message)
    this.send(participant.socket, { type: "chat_history", channel: "camp", messages })
  }

  private isChatVisibleTo(recipient: HubParticipant, senderUserId: string): boolean {
    if (recipient.userId === senderUserId) return true
    const sender = [...this.participants.values()].find((candidate) => candidate.userId === senderUserId)
    return !recipient.blockedUserIds.has(senderUserId)
      && !sender?.blockedUserIds.has(recipient.userId)
      && !this.blockedPairs.has(`${recipient.userId}:${senderUserId}`)
      && !this.blockedPairs.has(`${senderUserId}:${recipient.userId}`)
  }

  private pruneChat(instance: HubInstance, now: number): void {
    const cutoff = now - PUBLIC_HUB_CHAT_MAX_AGE_MS
    instance.chatMessages = instance.chatMessages.filter((record) => record.message.sentAt > cutoff)
    if (instance.chatMessages.length > PUBLIC_HUB_CHAT_HISTORY_LIMIT) {
      instance.chatMessages.splice(0, instance.chatMessages.length - PUBLIC_HUB_CHAT_HISTORY_LIMIT)
    }
  }

  private chatFailure(code: ChatErrorCode, message: string, retryAfterMs?: number): { ok: false; code: ChatErrorCode; message: string; retryAfterMs?: number } {
    return retryAfterMs === undefined ? { ok: false, code, message } : { ok: false, code, message, retryAfterMs: Math.max(0, Math.ceil(retryAfterMs)) }
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }
}
