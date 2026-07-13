import { randomUUID } from "node:crypto"
import { WebSocket } from "ws"
import type { CharacterId, PublicHubPlayer, ServerMessage } from "../shared/protocol"
import { PUBLIC_HUB_WORLD_BOUNDS, resolveSherwoodPlayerMovement } from "../shared/world-collisions"

export const PUBLIC_HUB_CAPACITY = 12
export const PUBLIC_HUB_IDLE_MS = 60_000

interface HubParticipant extends PublicHubPlayer {
  userId: string
  friendUserIds: Set<string>
  blockedUserIds: Set<string>
  socket: WebSocket
  lastActivityAt: number
  lastSequence: number
  lastEmoteAt: number
  lastPingAt: number
  lastReportAt: number
  reportedUserIds: Set<string>
}

interface HubInstance {
  id: string
  participants: Map<string, HubParticipant>
}

export class PublicHubService {
  readonly instances = new Map<string, HubInstance>()
  readonly reports: Array<{ at: number; reporterUserId: string; targetUserId: string; reason: string }> = []
  readonly blockedPairs = new Set<string>()

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
      lastActivityAt: now, lastSequence: 0, lastEmoteAt: 0, lastPingAt: 0, lastReportAt: 0, reportedUserIds: new Set(),
    }
    instance.participants.set(participant.id, participant)
    this.send(socket, { type: "hub_welcome", instanceId: instance.id, participantId: participant.id, capacity: PUBLIC_HUB_CAPACITY })
    this.broadcast(instance, now)
    return participant
  }

  leave(participantId: string, now = Date.now()): void {
    const instance = this.instanceFor(participantId)
    if (!instance) return
    instance.participants.delete(participantId)
    if (instance.participants.size === 0) this.instances.delete(instance.id)
    else this.broadcast(instance, now)
  }

  setIntent(participantId: string, looking: boolean, targetPreference: PublicHubPlayer["targetPreference"], desiredPartySize: 2 | 3 | 4, now = Date.now()): boolean {
    const participant = this.participant(participantId)
    const instance = this.instanceFor(participantId)
    if (!participant || !instance) return false
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

  formBand(participantId: string, now = Date.now()): HubParticipant[] | null {
    const leader = this.participant(participantId)
    const instance = this.instanceFor(participantId)
    if (!leader || !instance || !leader.looking) return null
    const matches = [...instance.participants.values()]
      .filter((candidate) => candidate.id !== participantId && candidate.looking && candidate.desiredPartySize === leader.desiredPartySize && (leader.targetPreference === "any" || candidate.targetPreference === "any" || candidate.targetPreference === leader.targetPreference))
      .sort((left, right) => Number(leader.friendUserIds.has(right.userId)) - Number(leader.friendUserIds.has(left.userId)) || left.lastActivityAt - right.lastActivityAt)
    if (matches.length < leader.desiredPartySize - 1) return null
    const group = [leader, ...matches.slice(0, leader.desiredPartySize - 1)]
    for (const participant of group) instance.participants.delete(participant.id)
    if (instance.participants.size === 0) this.instances.delete(instance.id)
    else this.broadcast(instance, now)
    return group
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
    return { blockerUserId: blocker.userId, blockedUserId: target.userId }
  }

  cleanup(now = Date.now()): void {
    for (const instance of this.instances.values()) {
      for (const participant of instance.participants.values()) if (now - participant.lastActivityAt > PUBLIC_HUB_IDLE_MS || participant.socket.readyState !== WebSocket.OPEN) instance.participants.delete(participant.id)
      if (instance.participants.size === 0) this.instances.delete(instance.id)
      else this.broadcast(instance, now)
    }
  }

  broadcastAll(now = Date.now()): void {
    for (const instance of this.instances.values()) this.broadcast(instance, now)
  }

  private createInstance(): HubInstance {
    const instance = { id: randomUUID(), participants: new Map<string, HubParticipant>() }
    this.instances.set(instance.id, instance)
    return instance
  }

  private participant(id: string): HubParticipant | null {
    return this.instanceFor(id)?.participants.get(id) ?? null
  }

  private instanceFor(participantId: string): HubInstance | null {
    return [...this.instances.values()].find((instance) => instance.participants.has(participantId)) ?? null
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

  private send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }
}
