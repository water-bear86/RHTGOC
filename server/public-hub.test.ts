import { describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import type { ServerMessage } from "../shared/protocol"
import {
  PUBLIC_HUB_CAPACITY,
  PUBLIC_HUB_CHAT_HISTORY_LIMIT,
  PUBLIC_HUB_CHAT_MAX_AGE_MS,
  PUBLIC_HUB_IDLE_MS,
  PublicHubService,
} from "./public-hub"
import { isSherwoodPlayerPositionBlocked } from "../shared/world-collisions"

function socket(): WebSocket {
  return { readyState: WebSocket.OPEN, OPEN: WebSocket.OPEN, send: () => undefined } as unknown as WebSocket
}

function recordingSocket(): { socket: WebSocket; messages: ServerMessage[] } {
  const messages: ServerMessage[] = []
  return {
    socket: { readyState: WebSocket.OPEN, OPEN: WebSocket.OPEN, send: (value: string) => messages.push(JSON.parse(value) as ServerMessage) } as unknown as WebSocket,
    messages,
  }
}

function latestMessage<T extends ServerMessage["type"]>(recording: ReturnType<typeof recordingSocket>, type: T): Extract<ServerMessage, { type: T }> | undefined {
  for (let index = recording.messages.length - 1; index >= 0; index -= 1) {
    const message = recording.messages[index]
    if (message.type === type) return message as Extract<ServerMessage, { type: T }>
  }
  return undefined
}

describe("opt-in public campfire", () => {
  it("caps readable instances and preferentially places accepted friends together", () => {
    const hub = new PublicHubService()
    const friend = hub.join(socket(), "user-friend", "Friend", "marian", [], 1_000)
    let filler = friend
    for (let index = 1; index < PUBLIC_HUB_CAPACITY; index += 1) filler = hub.join(socket(), `user-${index}`, `Player ${index}`, "robin", [], 1_000)
    const overflow = hub.join(socket(), "overflow", "Overflow", "much", [], 1_000)
    expect([...hub.instances.values()].flatMap((instance) => [...instance.participants.values()]).every((player) => !isSherwoodPlayerPositionBlocked(player.position))).toBe(true)
    hub.leave(filler.id, 1_001)
    expect(hub.instances.size).toBe(2)
    const preferred = hub.join(socket(), "preferred", "Preferred", "little-john", ["user-friend"], 1_002)
    const instanceWithFriend = [...hub.instances.values()].find((instance) => instance.participants.has(friend.id))!
    expect(instanceWithFriend.participants.has(preferred.id)).toBe(true)
    expect([...hub.instances.values()].find((instance) => instance.participants.has(overflow.id))?.participants.has(preferred.id)).toBe(false)
  })

  it("matches fixed-intent players into a private-band assignment with friend priority", () => {
    const hub = new PublicHubService()
    const leader = hub.join(socket(), "leader", "Leader", "robin", ["friend"], 1_000)
    const stranger = hub.join(socket(), "stranger", "Stranger", "much", [], 1_001)
    const friend = hub.join(socket(), "friend", "Friend", "marian", ["leader"], 1_002)
    hub.setIntent(leader.id, true, "peoples-purse", 2, 2_000)
    hub.setIntent(stranger.id, true, "any", 2, 2_001)
    hub.setIntent(friend.id, true, "peoples-purse", 2, 2_002)
    expect(hub.formBand(leader.id, 3_000)?.map((player) => player.userId)).toEqual(["leader", "friend"])
  })

  it("automatically matches compatible players across public-camp instances", () => {
    const hub = new PublicHubService()
    const leader = hub.join(socket(), "leader", "Leader", "robin", [], 1_000)
    for (let index = 1; index < PUBLIC_HUB_CAPACITY; index += 1) hub.join(socket(), `filler-${index}`, `Filler ${index}`, "much", [], 1_000 + index)
    const remote = hub.join(socket(), "remote", "Remote", "marian", [], 1_100)
    hub.setIntent(leader.id, true, "any", 2, 2_000)
    hub.setIntent(remote.id, true, "peoples-purse", 2, 2_001)
    expect(hub.instances.size).toBe(2)
    expect(hub.drainMatches(3_000).map((group) => group.map((player) => player.userId))).toEqual([["leader", "remote"]])
    expect([...hub.instances.values()].flatMap((instance) => [...instance.participants.values()]).some((player) => player.userId === "leader" || player.userId === "remote")).toBe(false)
  })

  it("bounds movement, emote and ping rate, reports fixed reasons, and cleans idle sessions", () => {
    const hub = new PublicHubService()
    const first = hub.join(socket(), "first", "First", "robin", [], 1_000)
    const second = hub.join(socket(), "second", "Second", "marian", [], 1_000)
    expect(hub.move(first.id, 1, { x: 1, z: 1 }, 1_021)).toBe(true)
    expect(hub.move(first.id, 1, { x: 1, z: 1 }, 1_100)).toBe(false)
    expect(hub.emote(first.id, "wave", 2_000)).toBe(true)
    expect(hub.emote(first.id, "cheer", 2_500)).toBe(false)
    expect(hub.ping(first.id, "regroup", 2_000)).toBe(true)
    expect(hub.ping(first.id, "target", 3_000)).toBe(false)
    expect(hub.report(first.id, second.id, "griefing", 3_100)).toMatchObject({ reporterUserId: "first", targetUserId: "second", reason: "griefing" })
    expect(hub.report(first.id, second.id, "griefing", 9_000)).toBeNull()
    expect(hub.reports).toHaveLength(1)
    hub.cleanup(3_100 + PUBLIC_HUB_IDLE_MS + 1)
    expect(hub.instances.size).toBe(0)
  })

  it("waits for the requested party size instead of silently forming a smaller band", () => {
    const hub = new PublicHubService()
    const leader = hub.join(socket(), "leader", "Leader", "robin", [], 1_000)
    const second = hub.join(socket(), "second", "Second", "marian", [], 1_001)
    hub.setIntent(leader.id, true, "any", 3, 2_000)
    hub.setIntent(second.id, true, "any", 3, 2_001)
    expect(hub.formBand(leader.id, 3_000)).toBeNull()
  })

  it("keeps pre-existing block relationships out of the same public projection", () => {
    const hub = new PublicHubService()
    const first = hub.join(socket(), "first", "First", "robin", [], 1_000, ["second"])
    const second = hub.join(socket(), "second", "Second", "marian", [], 1_001)
    expect(hub.instances.size).toBe(2)
    expect([...hub.instances.values()].some((instance) => instance.participants.has(first.id) && instance.participants.has(second.id))).toBe(false)
  })

  it("load-partitions 120 opt-in players into ten readable instances and cleans all idle state", () => {
    const hub = new PublicHubService()
    for (let index = 0; index < 120; index += 1) hub.join(socket(), `load-${index}`, `Outlaw ${index}`, index % 2 ? "robin" : "marian", [], 1_000)
    expect(hub.instances.size).toBe(10)
    expect([...hub.instances.values()].every((instance) => instance.participants.size === PUBLIC_HUB_CAPACITY)).toBe(true)
    hub.cleanup(1_000 + PUBLIC_HUB_IDLE_MS + 1)
    expect(hub.instances.size).toBe(0)
  })

  it("keeps Camp chat disabled unless durable moderation storage explicitly gates it on", () => {
    const recording = recordingSocket()
    const hub = new PublicHubService()
    const participant = hub.join(recording.socket, "authenticated-user", "Outlaw", "robin", [], 1_000)
    expect(recording.messages.some((message) => message.type === "chat_history")).toBe(false)
    expect(hub.sendCampChat(participant.id, "Hello, camp", 2_000)).toMatchObject({ ok: false, code: "NOT_AVAILABLE" })
  })

  it("broadcasts normalized, server-authored messages only inside the current 12-player instance", () => {
    const hub = new PublicHubService({ campChatEnabled: true })
    const firstSocket = recordingSocket()
    const secondSocket = recordingSocket()
    const first = hub.join(firstSocket.socket, "user-first", "First Outlaw", "robin", [], 1_000)
    hub.join(secondSocket.socket, "user-second", "Second Outlaw", "marian", [], 1_001)
    for (let index = 2; index < PUBLIC_HUB_CAPACITY; index += 1) hub.join(socket(), `filler-${index}`, `Filler ${index}`, "much", [], 1_000 + index)
    const overflowSocket = recordingSocket()
    hub.join(overflowSocket.socket, "user-overflow", "Overflow", "little-john", [], 1_100)
    firstSocket.messages.length = 0
    secondSocket.messages.length = 0
    overflowSocket.messages.length = 0

    const result = hub.sendCampChat(first.id, "  Hello\u202e\n   camp  ", 3_000)
    expect(result).toMatchObject({
      ok: true,
      message: {
        channel: "camp",
        sequence: 1,
        sentAt: 3_000,
        sender: { playerId: first.id, displayName: "First Outlaw", characterId: "robin" },
        text: "Hello camp",
      },
    })
    expect(latestMessage(firstSocket, "chat_message")).toMatchObject({ message: { text: "Hello camp" } })
    expect(latestMessage(secondSocket, "chat_message")).toMatchObject({ message: { text: "Hello camp" } })
    expect(latestMessage(overflowSocket, "chat_message")).toBeUndefined()
  })

  it("replays only the current instance's live 30-minute Camp history to a new arrival", () => {
    const hub = new PublicHubService({ campChatEnabled: true })
    const first = hub.join(socket(), "first-user", "First", "robin", [], 1_000)
    const sent = hub.sendCampChat(first.id, "Still by the fire", 3_000)
    expect(sent.ok).toBe(true)

    const newcomerSocket = recordingSocket()
    hub.join(newcomerSocket.socket, "new-user", "Newcomer", "marian", [], 4_000)
    expect(latestMessage(newcomerSocket, "chat_history")?.messages.map((message) => message.text)).toEqual(["Still by the fire"])

    const expiredSocket = recordingSocket()
    hub.join(expiredSocket.socket, "late-user", "Late", "much", [], 3_000 + PUBLIC_HUB_CHAT_MAX_AGE_MS + 1)
    expect(latestMessage(expiredSocket, "chat_history")?.messages).toEqual([])
  })

  it("enforces per-sender pacing, burst limits, duplicate suppression, and bounded history", () => {
    const hub = new PublicHubService({ campChatEnabled: true })
    const participant = hub.join(socket(), "user-first", "First", "robin", [], 1_000)
    expect(hub.sendCampChat(participant.id, "First message", 10_000).ok).toBe(true)
    expect(hub.sendCampChat(participant.id, "Different too soon", 10_500)).toMatchObject({ ok: false, code: "RATE_LIMITED", retryAfterMs: 1_000 })
    expect(hub.sendCampChat(participant.id, "first message", 11_500)).toMatchObject({ ok: false, code: "DUPLICATE" })
    for (let index = 1; index < 8; index += 1) {
      expect(hub.sendCampChat(participant.id, `Message ${index}`, 10_000 + index * 1_500).ok).toBe(true)
    }
    expect(hub.sendCampChat(participant.id, "Ninth message", 22_000)).toMatchObject({ ok: false, code: "RATE_LIMITED" })
    expect(hub.sendCampChat(participant.id, "First message", 40_001).ok).toBe(true)

    const participants = [participant]
    for (let index = 1; index < PUBLIC_HUB_CAPACITY; index += 1) {
      participants.push(hub.join(socket(), `user-${index}`, `User ${index}`, index % 2 ? "marian" : "much", [], 40_002 + index))
    }
    for (let round = 0; round < 9; round += 1) {
      for (let index = 1; index < participants.length; index += 1) {
        const sentAt = 50_000 + round * 31_000 + index
        expect(hub.sendCampChat(participants[index].id, `p${index}-r${round}`, sentAt).ok).toBe(true)
      }
    }
    const instance = [...hub.instances.values()][0]
    expect(instance.chatMessages).toHaveLength(PUBLIC_HUB_CHAT_HISTORY_LIMIT)
  })

  it("removes blocked players' prior and future messages from both Camp projections", () => {
    const hub = new PublicHubService({ campChatEnabled: true })
    const firstSocket = recordingSocket()
    const secondSocket = recordingSocket()
    const first = hub.join(firstSocket.socket, "first-user", "First", "robin", [], 1_000)
    const second = hub.join(secondSocket.socket, "second-user", "Second", "marian", [], 1_001)
    expect(hub.sendCampChat(first.id, "From first", 3_000).ok).toBe(true)
    expect(hub.sendCampChat(second.id, "From second", 3_100).ok).toBe(true)

    expect(hub.block(first.id, second.id, 4_000)).toMatchObject({ blockerUserId: "first-user", blockedUserId: "second-user" })
    expect(latestMessage(firstSocket, "chat_history")?.messages.map((message) => message.text)).toEqual(["From first"])
    expect(latestMessage(secondSocket, "chat_history")?.messages.map((message) => message.text)).toEqual(["From second"])

    firstSocket.messages.length = 0
    expect(hub.sendCampChat(second.id, "Hidden after block", 5_000).ok).toBe(true)
    expect(latestMessage(firstSocket, "chat_message")).toBeUndefined()
  })

  it("resolves reported-message evidence and at most four surrounding messages on the server", () => {
    const hub = new PublicHubService({ campChatEnabled: true })
    const reporter = hub.join(socket(), "reporter-user", "Reporter", "robin", [], 1_000)
    const target = hub.join(socket(), "target-user", "Target", "marian", [], 1_001)
    const sent = [
      hub.sendCampChat(reporter.id, "one", 3_000),
      hub.sendCampChat(target.id, "two", 3_100),
      hub.sendCampChat(reporter.id, "three", 5_000),
      hub.sendCampChat(target.id, "reported four", 5_100),
      hub.sendCampChat(reporter.id, "five", 7_000),
      hub.sendCampChat(target.id, "six", 7_100),
    ]
    expect(sent.every((result) => result.ok)).toBe(true)
    const reported = sent[3]
    if (!reported.ok) throw new Error("expected report target")

    const result = hub.reportCampChat(reporter.id, reported.message.id, "griefing", 12_000)
    expect(result).toMatchObject({
      ok: true,
      evidence: {
        reporterUserId: "reporter-user",
        targetUserId: "target-user",
        messageId: reported.message.id,
        reason: "griefing",
        text: "reported four",
        context: {
          channel: "camp",
          senderParticipantId: target.id,
          senderDisplayName: "Target",
          senderCharacterId: "marian",
        },
      },
    })
    if (!result.ok) throw new Error("expected report evidence")
    expect(result.evidence.context.surroundingMessages.map((message) => message.text)).toEqual(["two", "three", "five", "six"])
    expect(hub.reportCampChat(reporter.id, reported.message.id, "griefing", 18_000)).toMatchObject({ ok: false, code: "DUPLICATE" })
    expect(hub.reportCampChat(target.id, reported.message.id, "harassment", 18_000)).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(hub.reportCampChat(reporter.id, sent[1].ok ? sent[1].message.id : "", "griefing", 3_100 + PUBLIC_HUB_CHAT_MAX_AGE_MS + 1)).toMatchObject({ ok: false, code: "MESSAGE_NOT_FOUND" })
  })
})
