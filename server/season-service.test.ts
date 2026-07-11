import { describe, expect, it } from "vitest"
import { SherwoodSeasonService } from "./season-service"
import { campaignRotationWindow } from "../shared/sherwood-season"
import { rotationWindowAt } from "../shared/sheriff-rotation"

function mission(eventId: string, project: "granary" | "infirmary" | "watchtower" = "granary", communityCoin = 600) {
  return { eventId, occurredAt: 2_000, status: "succeeded" as const, project, communityCoin, rescues: 1, cleanEscape: true, tacticalScore: 8_000, rotationId: "daily-2p" }
}

describe("Sherwood seasonal campaign", () => {
  it("aggregates only idempotent authoritative mission and contribution events", () => {
    const service = new SherwoodSeasonService(1_000)
    expect(service.recordMission(mission("mission-1"))).toBe(true)
    expect(service.recordMission(mission("mission-1"))).toBe(false)
    expect(service.recordContribution({ eventId: "contribution-1", occurredAt: 2_100, type: "safe-house" })).toBe(true)
    expect(service.recordContribution({ eventId: "contribution-1", occurredAt: 2_100, type: "safe-house" })).toBe(false)
    const snapshot = service.snapshot(2_200)
    expect(snapshot.projects.granary).toMatchObject({ total: 600, tier: 1 })
    expect(snapshot.projects.infirmary.total).toBe(25)
    expect(snapshot.recognition).toEqual({ generosity: 600, rescues: 1, cleanEscapes: 1, tactical: 8_000 })
  })

  it("advances three visible project tiers and resolves explicit finale success", () => {
    const service = new SherwoodSeasonService(1_000)
    for (const project of ["granary", "infirmary", "watchtower"] as const) {
      for (let index = 0; index < 6; index += 1) service.recordMission(mission(`${project}-${index}`, project))
    }
    expect(service.snapshot(3_000).phase).toBe("finale")
    for (let index = 0; index < 3; index += 1) service.recordMission(mission(`finale-${index}`, "granary", 0))
    expect(service.snapshot(4_000)).toMatchObject({ phase: "succeeded", finale: { attempts: 3, successes: 3 } })
    service.archive(5_000)
    const archived = service.snapshot(5_001)
    service.start({ slug: "season-one", name: "Season One", startsAt: 6_000, endsAt: 10_000 }, 6_000)
    expect(service.snapshot(6_001)).toMatchObject({ slug: "season-one", phase: "active", archivedAt: null, recognition: archived.recognition })
  })

  it("resolves finale failure and makes archival an immutable campaign boundary", () => {
    const service = new SherwoodSeasonService(1_000)
    const end = service.snapshot(1_000).endsAt
    expect(service.snapshot(end).phase).toBe("finale")
    for (let index = 0; index < 5; index += 1) service.recordMission({ ...mission(`failed-${index}`), status: "failed", project: null, communityCoin: 0, rotationId: null })
    expect(service.snapshot(end + 1).phase).toBe("failed")
    service.archive(end + 2)
    expect(service.snapshot(end + 2).phase).toBe("archived")
    expect(() => service.rollback(end + 3)).toThrow("ARCHIVED_SEASON_IMMUTABLE")
    expect(service.snapshot(end + 3).phase).toBe("archived")
    expect(service.recordMission({ ...mission("failed-4"), status: "failed", project: null, communityCoin: 0, rotationId: null })).toBe(false)
  })

  it("adds bounded pressure modifiers only when the mission package supports them", () => {
    const service = new SherwoodSeasonService(1_000)
    for (let index = 0; index < 6; index += 1) service.recordMission({ ...mission(`loss-${index}`), status: "failed", project: null, communityCoin: 0, rotationId: null })
    const season = service.snapshot(2_000)
    const window = campaignRotationWindow(rotationWindowAt(2_000), season)
    expect(season.pressure).toBe(80)
    expect(window.current.every((rotation) => rotation.modifierIds.length <= 3 && new Set(rotation.modifierIds).size === rotation.modifierIds.length)).toBe(true)
  })

  it("pauses, extends, resumes, and retains replay-safe load state", () => {
    const service = new SherwoodSeasonService(1_000)
    const originalEnd = service.snapshot(1_000).endsAt
    service.pause(2_000)
    expect(service.snapshot(2_000).phase).toBe("paused")
    service.extend(originalEnd + 86_400_000, 2_100)
    service.resume(2_200)
    expect(service.snapshot(2_200)).toMatchObject({ phase: "active", endsAt: originalEnd + 86_400_000 })
    expect(service.drainTransitions().map((transition) => transition.eventType)).toEqual(["operator", "operator", "operator", "operator"])
  })

  it("holds idempotency and bounded pressure under a replay-heavy event load", () => {
    const service = new SherwoodSeasonService(1_000)
    for (let index = 0; index < 500; index += 1) {
      const outcome = { ...mission(`load-${index}`), status: "failed" as const, project: null, communityCoin: 0, rotationId: null }
      expect(service.recordMission(outcome)).toBe(true)
      expect(service.recordMission(outcome)).toBe(false)
    }
    expect(service.snapshot(5_000)).toMatchObject({ phase: "active", pressure: 100, revision: 501 })
    expect(service.drainTransitions()).toHaveLength(501)
  })

  it("recovers a persisted snapshot and rejects already-applied events after restart", () => {
    const first = new SherwoodSeasonService(1_000)
    first.recordMission(mission("persisted-mission"))
    const recovered = new SherwoodSeasonService(2_000)
    recovered.hydrate(first.snapshot(2_000), ["persisted-mission"], 2)
    expect(recovered.recordMission(mission("persisted-mission"))).toBe(false)
    expect(recovered.recordMission(mission("new-mission"))).toBe(true)
    expect(recovered.snapshot(3_000)).toMatchObject({ revision: 3, projects: { granary: { total: 1_200, tier: 1 } } })
    expect(recovered.drainTransitions()).toEqual([expect.objectContaining({ sequence: 3, eventId: "new-mission" })])
  })

  it("recovers an archived campaign and starts the successor at its own first sequence", () => {
    const first = new SherwoodSeasonService(1_000)
    const archived = { ...first.snapshot(2_000), phase: "archived" as const, archivedAt: 2_000 }
    const recovered = new SherwoodSeasonService(3_000)
    recovered.hydrate(archived, [], 17)
    recovered.start({ slug: "season-one", name: "Season One", startsAt: 4_000, endsAt: 8_000 }, 4_000)
    expect(recovered.snapshot(4_001)).toMatchObject({ slug: "season-one", phase: "active", archivedAt: null })
    expect(recovered.drainTransitions()).toEqual([expect.objectContaining({ sequence: 1, eventType: "operator", payload: { operation: "start" } })])
    expect(() => recovered.rollback(4_100)).toThrow("CROSS_CAMPAIGN_ROLLBACK_FORBIDDEN")
  })
})
