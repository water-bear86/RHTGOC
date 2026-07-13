import { describe, expect, it } from "vitest"
import { EXPERIMENT_BUCKETS, assignRoomExperiment, parseGameplayExperimentDefinition } from "./experiments"

const experiment = {
  id: "road-density",
  revision: 3,
  salt: "road-density-r3",
  allocationBps: 10_000,
  variants: [
    { id: "control", weightBps: 5_000, config: { roadDensity: 1, extraSigns: false } },
    { id: "treatment", weightBps: 5_000, config: { roadDensity: 1.25, extraSigns: true } },
  ],
}

describe("room-scoped gameplay experiments", () => {
  it("returns the same assignment for every player in the same room", () => {
    const first = assignRoomExperiment(experiment, "room-runtime-scope")
    const second = assignRoomExperiment(structuredClone(experiment), "room-runtime-scope")
    expect(second).toEqual(first)
    expect(JSON.stringify(first)).not.toContain("room-runtime-scope")
  })

  it("produces a stable, approximately weighted spread across room scopes", () => {
    const counts = new Map<string, number>()
    for (let index = 0; index < 20_000; index += 1) {
      const assignment = assignRoomExperiment(experiment, `room-${index}`)!
      counts.set(assignment.variantId, (counts.get(assignment.variantId) ?? 0) + 1)
    }
    expect(counts.get("control")).toBeGreaterThan(9_500)
    expect(counts.get("control")).toBeLessThan(10_500)
    expect(counts.get("treatment")).toBe(20_000 - counts.get("control")!)
  })

  it("uses a separate enrollment bucket for partial rollouts", () => {
    const partial = { ...experiment, allocationBps: 2_500 }
    const enrolled = Array.from({ length: 10_000 }, (_, index) => assignRoomExperiment(partial, `partial-${index}`)).filter(Boolean)
    expect(enrolled.length).toBeGreaterThan(2_300)
    expect(enrolled.length).toBeLessThan(2_700)
    expect(enrolled.every((assignment) => assignment!.enrollmentBucket < 2_500)).toBe(true)
  })

  it("rejects malformed definitions and nested or oversized config", () => {
    expect(() => parseGameplayExperimentDefinition({ ...experiment, variants: experiment.variants.map((variant) => ({ ...variant, weightBps: 4_000 })) })).toThrow(`total ${EXPERIMENT_BUCKETS}`)
    expect(() => parseGameplayExperimentDefinition({ ...experiment, playerId: "nope" })).toThrow("unsupported fields")
    expect(() => parseGameplayExperimentDefinition({ ...experiment, variants: [{ ...experiment.variants[0], config: { nested: { nope: true } } }, experiment.variants[1]] })).toThrow("scalar")
  })
})
