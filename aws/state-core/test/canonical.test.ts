import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  StateValidationError,
  canonicalStringify,
  canonicalizeState,
  hashCanonicalState,
  keccak256Utf8,
  normalizeUint256,
  playerStateSchema,
  serializeCanonicalState,
} from "../src/index.js";
import { makeState, NORMALIZED_WALLET } from "./fixtures.js";

function reverseRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).reverse()) as Record<string, T>;
}

describe("canonical state projection", () => {
  it("normalizes wallet/token ID and deterministically sorts all set/map fields", () => {
    const state = canonicalizeState(makeState({ scrollTokenId: 123n }));

    expect(state).toEqual({
      wallet: NORMALIZED_WALLET,
      scrollTokenId: "123",
      schemaVersion: 1,
      stateVersion: 7,
      level: 14,
      experience: 18_250,
      achievements: ["sherwood_defender", "tax_collector"],
      fineries: ["greenhood_v2", "ironwood_bow"],
      equipment: {
        primary: "ironwood_bow",
        secondary: "buckler",
      },
      unlocks: ["ranked_play", "royal_forest"],
      stats: {
        captures: 12,
        matches: 21,
        rescues: 8,
      },
    });
  });

  it("emits the explicit canonical JSON shape", () => {
    expect(serializeCanonicalState(makeState())).toBe(
      '{"achievements":["sherwood_defender","tax_collector"],"equipment":{"primary":"ironwood_bow","secondary":"buckler"},"experience":18250,"fineries":["greenhood_v2","ironwood_bow"],"level":14,"schemaVersion":1,"scrollTokenId":"123","stateVersion":7,"stats":{"captures":12,"matches":21,"rescues":8},"unlocks":["ranked_play","royal_forest"],"wallet":"0xabcdef0123456789abcdef0123456789abcdef01"}',
    );
  });

  it("is invariant to set order, object insertion order, token representation, and address case", () => {
    fc.assert(
      fc.property(
        fc.shuffledSubarray(["tax_collector", "sherwood_defender"], {
          minLength: 2,
          maxLength: 2,
        }),
        fc.shuffledSubarray(["ironwood_bow", "greenhood_v2"], {
          minLength: 2,
          maxLength: 2,
        }),
        fc.shuffledSubarray(["royal_forest", "ranked_play"], {
          minLength: 2,
          maxLength: 2,
        }),
        fc.boolean(),
        fc.boolean(),
        (achievements, fineries, unlocks, reverseEquipment, useNumericToken) => {
          const candidate = makeState({
            wallet: NORMALIZED_WALLET.toUpperCase().replace("0X", "0x"),
            scrollTokenId: useNumericToken ? 123 : "123",
            achievements,
            fineries,
            unlocks,
            equipment: reverseEquipment
              ? reverseRecord(makeState().equipment)
              : makeState().equipment,
            stats: reverseRecord(makeState().stats),
          });
          expect(hashCanonicalState(candidate)).toBe(hashCanonicalState(makeState()));
        },
      ),
      { numRuns: 200 },
    );
  });

  it("excludes every declared nondeterministic field from projection and hash", () => {
    const earlier = makeState({
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: 1,
      lastSavedAt: null,
      lastCheckpointAt: 3,
    });
    const later = makeState({
      createdAt: "2026-09-05T12:00:00.000Z",
      updatedAt: 9_999,
      lastSavedAt: "different-request-time",
      lastCheckpointAt: null,
    });

    expect(canonicalizeState(earlier)).toEqual(canonicalizeState(later));
    expect(hashCanonicalState(earlier)).toBe(hashCanonicalState(later));
    expect(serializeCanonicalState(earlier)).not.toContain("updatedAt");
  });

  it("changes the hash when any deterministic scalar changes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (experience) => {
        const changed = makeState({ experience });
        if (experience === makeState().experience) {
          expect(hashCanonicalState(changed)).toBe(hashCanonicalState(makeState()));
        } else {
          expect(hashCanonicalState(changed)).not.toBe(hashCanonicalState(makeState()));
        }
      }),
      { numRuns: 100 },
    );
  });

  it("rejects duplicate set members instead of silently deduplicating", () => {
    for (const field of ["achievements", "fineries", "unlocks"] as const) {
      expect(() =>
        canonicalizeState(makeState({ [field]: ["duplicate", "duplicate"] })),
      ).toThrow(/duplicate identifier/);
    }
  });

  it.each([
    ["bad address", { wallet: "0x1234" }, /20-byte/],
    ["negative version", { stateVersion: -1 }, /greater than or equal to 0/],
    ["fractional level", { level: 1.5 }, /safe integer/],
    ["negative statistic", { stats: { captures: -1 } }, /greater than or equal to 0/],
    ["unsupported schema", { schemaVersion: 2 }, /unsupported schema version/],
    ["non-ASCII identifier", { achievements: ["défenseur"] }, /printable/],
    ["leading-zero token", { scrollTokenId: "00123" }, /unsigned decimal/],
    ["unsafe numeric token", { scrollTokenId: Number.MAX_SAFE_INTEGER + 1 }, /safe integer/],
    ["invalid ignored timestamp", { updatedAt: Number.POSITIVE_INFINITY }, /finite number/],
  ])("rejects %s", (_label, overrides, expected) => {
    expect(() => canonicalizeState(makeState(overrides))).toThrow(expected as RegExp);
  });

  it("rejects unknown fields so new deterministic data cannot be silently omitted", () => {
    const state = { ...makeState(), inventory: ["unreviewed_new_field"] };
    expect(() => canonicalizeState(state)).toThrow(/unknown field/);
  });

  it("rejects missing required fields", () => {
    const state = { ...makeState() } as Record<string, unknown>;
    delete state.stats;
    expect(() => canonicalizeState(state)).toThrow(/required field is missing/);
  });

  it("rejects prototype-polluting map keys", () => {
    const stats = Object.create(null) as Record<string, number>;
    stats.__proto__ = 1;
    expect(() => canonicalizeState(makeState({ stats }))).toThrow(/unsafe map key/);
  });

  it("accepts initial state version zero and enforces the uint256 range", () => {
    expect(canonicalizeState(makeState({ stateVersion: 0 })).stateVersion).toBe(0);
    expect(normalizeUint256((1n << 256n) - 1n)).toBe(
      ((1n << 256n) - 1n).toString(10),
    );
    expect(() => normalizeUint256(1n << 256n)).toThrow(/fit uint256/);
  });

  it("provides throwing and non-throwing runtime schema entrypoints", () => {
    expect(playerStateSchema.safeParse(makeState())).toMatchObject({ success: true });
    const result = playerStateSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(StateValidationError);
      expect(result.error.path).toBe("state.wallet");
    }
  });
});

describe("canonical JSON and keccak primitives", () => {
  it("sorts nested object keys and preserves ordinary array order", () => {
    expect(
      canonicalStringify({ z: [{ beta: 2, alpha: 1 }, "last"], a: true }),
    ).toBe('{"a":true,"z":[{"alpha":1,"beta":2},"last"]}');
  });

  it("rejects values outside the deterministic JSON profile", () => {
    expect(() => canonicalStringify({ value: 1.25 })).toThrow(/safe integers/);
    expect(() => canonicalStringify({ value: undefined })).toThrow(/unsupported/);
    expect(() => canonicalStringify([, "sparse"])).toThrow(/sparse arrays/);
    expect(() => canonicalStringify(new Date())).toThrow(/plain objects/);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => canonicalStringify(cyclic)).toThrow(/cycles/);
  });

  it("matches established Ethereum keccak256 vectors (not NIST SHA-3)", () => {
    expect(keccak256Utf8("")).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
    expect(keccak256Utf8("abc")).toBe(
      "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    );
  });
});
