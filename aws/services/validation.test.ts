import { describe, expect, it } from "vitest";
import { stateMutationSchema } from "./validation.js";

describe("state mutation validation", () => {
  it("rejects client-awarded achievements and arbitrary state patches", () => {
    expect(
      stateMutationSchema.safeParse({
        mutationId: "550e8400-e29b-41d4-a716-446655440000",
        expectedVersion: 1,
        mutation: { kind: "award_achievement", achievement: "instant_win" },
      }).success,
    ).toBe(false);
    expect(
      stateMutationSchema.safeParse({
        mutationId: "550e8400-e29b-41d4-a716-446655440000",
        expectedVersion: 1,
        mutation: { kind: "select_equipment", itemIds: [], achievements: ["instant_win"] },
      }).success,
    ).toBe(false);
  });

  it("requires contiguous offline input journals", () => {
    const parsed = stateMutationSchema.safeParse({
      mutationId: "550e8400-e29b-41d4-a716-446655440000",
      expectedVersion: 2,
      mutation: {
        kind: "submit_offline_run",
        runId: "run-1",
        buildId: "build-1",
        rulesVersion: "rules-1",
        seed: "seed",
        inputJournal: [{ sequence: 2, tick: 1, action: "move", payload: {} }],
      },
    });
    expect(parsed.success).toBe(false);
  });
});
