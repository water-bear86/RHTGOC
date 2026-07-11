import { describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { PUBLIC_HUB_CAPACITY, PUBLIC_HUB_IDLE_MS, PublicHubService } from "./public-hub"

function socket(): WebSocket {
  return { readyState: WebSocket.OPEN, OPEN: WebSocket.OPEN, send: () => undefined } as unknown as WebSocket
}

describe("opt-in public campfire", () => {
  it("caps readable instances and preferentially places accepted friends together", () => {
    const hub = new PublicHubService()
    const friend = hub.join(socket(), "user-friend", "Friend", "marian", [], 1_000)
    let filler = friend
    for (let index = 1; index < PUBLIC_HUB_CAPACITY; index += 1) filler = hub.join(socket(), `user-${index}`, `Player ${index}`, "robin", [], 1_000)
    const overflow = hub.join(socket(), "overflow", "Overflow", "much", [], 1_000)
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
})
