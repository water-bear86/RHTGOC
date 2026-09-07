import type { PlayerStateInput } from "../src/index.js";

export const MIXED_CASE_WALLET = "0xAbCdEf0123456789aBCDef0123456789ABCdEf01";
export const NORMALIZED_WALLET = "0xabcdef0123456789abcdef0123456789abcdef01";

export function makeState(
  overrides: Partial<PlayerStateInput> = {},
): PlayerStateInput {
  return {
    wallet: MIXED_CASE_WALLET,
    scrollTokenId: "123",
    schemaVersion: 1,
    stateVersion: 7,
    level: 14,
    experience: 18_250,
    achievements: ["tax_collector", "sherwood_defender"],
    fineries: ["ironwood_bow", "greenhood_v2"],
    equipment: {
      secondary: "buckler",
      primary: "ironwood_bow",
    },
    unlocks: ["royal_forest", "ranked_play"],
    stats: {
      rescues: 8,
      matches: 21,
      captures: 12,
    },
    updatedAt: 1_750_000_000_000,
    ...overrides,
  };
}
