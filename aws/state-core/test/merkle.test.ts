import { keccak_256 } from "@noble/hashes/sha3";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  LEAF_DOMAINS,
  StateValidationError,
  bytesToHex,
  createStateCommitment,
  getProof,
  hexToBytes32,
  verifyProof,
} from "../src/index.js";
import type {
  Hex32,
  PlayerStateInput,
  ProofSubject,
  StateMerkleProof,
} from "../src/index.js";
import { makeState } from "./fixtures.js";

function flipLastNibble(value: Hex32): Hex32 {
  const last = value.at(-1);
  return `${value.slice(0, -1)}${last === "0" ? "1" : "0"}` as Hex32;
}

function openZeppelinStyleProcessProof(
  leaf: Hex32,
  siblings: readonly Hex32[],
): Hex32 {
  let computed = hexToBytes32(leaf);
  for (const siblingHex of siblings) {
    const sibling = hexToBytes32(siblingHex);
    const computedHex = bytesToHex(computed);
    const siblingComparable = bytesToHex(sibling);
    const combined = new Uint8Array(64);
    if (computedHex <= siblingComparable) {
      combined.set(computed, 0);
      combined.set(sibling, 32);
    } else {
      combined.set(sibling, 0);
      combined.set(computed, 32);
    }
    computed = keccak_256(combined);
  }
  return bytesToHex(computed);
}

function allSubjects(state: PlayerStateInput): ProofSubject[] {
  return [
    { category: "state" },
    ...state.achievements.map((id): ProofSubject => ({ category: "achievement", id })),
    ...state.fineries.map((id): ProofSubject => ({ category: "finery", id })),
    ...Object.entries(state.equipment).map(
      ([slot, itemId]): ProofSubject => ({ category: "equipment", slot, itemId }),
    ),
    ...state.unlocks.map((id): ProofSubject => ({ category: "unlock", id })),
  ];
}

describe("state commitment", () => {
  it("creates one shared checkpoint root for state and every proof category", () => {
    const state = makeState();
    const commitment = createStateCommitment(state);
    const subjects = allSubjects(state);

    expect(commitment.leaves).toHaveLength(subjects.length);
    for (const subject of subjects) {
      const proof =
        subject.category === "state"
          ? getProof(commitment, subject)
          : getProof(commitment, subject);
      expect(proof.stateRoot).toBe(commitment.stateRoot);
      expect(verifyProof(proof, commitment.stateRoot)).toBe(true);
      expect(openZeppelinStyleProcessProof(proof.leaf, proof.siblings)).toBe(
        commitment.stateRoot,
      );
    }
  });

  it("has distinct domain-separated leaves even when category identifiers match", () => {
    const commitment = createStateCommitment(
      makeState({
        achievements: ["same_id"],
        fineries: ["same_id"],
        equipment: { same_slot: "same_id" },
        unlocks: ["same_id"],
      }),
    );
    const hashes = commitment.leaves.map(({ hash }) => hash);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(new Set(Object.values(LEAF_DOMAINS)).size).toBe(5);
  });

  it("uses the sole canonical-state leaf as the root for an otherwise empty state", () => {
    const commitment = createStateCommitment(
      makeState({ achievements: [], fineries: [], equipment: {}, unlocks: [] }),
    );
    expect(commitment.leaves).toHaveLength(1);
    expect(commitment.stateRoot).toBe(commitment.leaves[0]?.hash);
    const proof = getProof(commitment, { category: "state" });
    expect(proof.siblings).toEqual([]);
    expect(verifyProof(proof)).toBe(true);
  });

  it("produces valid proofs for odd-width trees without duplicating the promoted node", () => {
    const commitment = createStateCommitment(makeState());
    expect(commitment.leaves.length % 2).toBe(1);

    const proofLengths = allSubjects(makeState()).map((subject) => {
      const proof =
        subject.category === "state"
          ? getProof(commitment, subject)
          : getProof(commitment, subject);
      expect(verifyProof(proof)).toBe(true);
      return proof.siblings.length;
    });
    expect(new Set(proofLengths).size).toBeGreaterThan(1);
  });

  it("is invariant to every allowed collection ordering", () => {
    const expected = createStateCommitment(makeState()).stateRoot;
    fc.assert(
      fc.property(
        fc.shuffledSubarray([...makeState().achievements], { minLength: 2, maxLength: 2 }),
        fc.shuffledSubarray([...makeState().fineries], { minLength: 2, maxLength: 2 }),
        fc.shuffledSubarray([...makeState().unlocks], { minLength: 2, maxLength: 2 }),
        fc.boolean(),
        (achievements, fineries, unlocks, reverseMaps) => {
          const state = makeState({
            achievements,
            fineries,
            unlocks,
            equipment: reverseMaps
              ? Object.fromEntries(Object.entries(makeState().equipment).reverse())
              : makeState().equipment,
            stats: reverseMaps
              ? Object.fromEntries(Object.entries(makeState().stats).reverse())
              : makeState().stats,
          });
          expect(createStateCommitment(state).stateRoot).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("changes the root when committed progress changes", () => {
    const original = createStateCommitment(makeState());
    expect(createStateCommitment(makeState({ experience: 18_251 })).stateRoot).not.toBe(
      original.stateRoot,
    );
    expect(
      createStateCommitment(
        makeState({ achievements: [...makeState().achievements, "new_achievement"] }),
      ).stateRoot,
    ).not.toBe(original.stateRoot);
    expect(createStateCommitment(makeState({ updatedAt: 999 })).stateRoot).toBe(
      original.stateRoot,
    );
  });

  it("locks the canonical state hash and state root as regression vectors", () => {
    const commitment = createStateCommitment(makeState());
    expect(commitment.stateHash).toBe(
      "0xc2e11e38aa2e2442ac7b1fdb0e159d0d1b499ef9cd8af556fa8b4b4d74826b23",
    );
    expect(commitment.stateRoot).toBe(
      "0x79b3f00130cfdec86236ea36bb4329474f04deda28e6e9eff13ab1718bdf18ab",
    );
  });
});

describe("proof verification and tamper rejection", () => {
  it("rejects tampered binding fields, leaf, sibling, root, state hash, and expected root", () => {
    const commitment = createStateCommitment(makeState());
    const proof = getProof(commitment, { category: "state" });
    const differentWallet = "0x1111111111111111111111111111111111111111";

    expect(verifyProof({ ...proof, wallet: differentWallet })).toBe(false);
    expect(verifyProof({ ...proof, scrollTokenId: "124" })).toBe(false);
    expect(verifyProof({ ...proof, stateVersion: proof.stateVersion + 1 })).toBe(false);
    expect(verifyProof({ ...proof, stateHash: flipLastNibble(proof.stateHash) })).toBe(false);
    expect(verifyProof({ ...proof, leaf: flipLastNibble(proof.leaf) })).toBe(false);
    expect(verifyProof({ ...proof, stateRoot: flipLastNibble(proof.stateRoot) })).toBe(false);
    expect(
      verifyProof(
        { ...proof, siblings: [flipLastNibble(proof.siblings[0] ?? proof.leaf)] },
        commitment.stateRoot,
      ),
    ).toBe(false);
    expect(verifyProof(proof, flipLastNibble(commitment.stateRoot))).toBe(false);
  });

  it.each([
    { category: "achievement", id: "tax_collector" } as const,
    { category: "finery", id: "ironwood_bow" } as const,
    { category: "equipment", slot: "primary", itemId: "ironwood_bow" } as const,
    { category: "unlock", id: "ranked_play" } as const,
  ])("rejects a tampered $category subject", (subject) => {
    const commitment = createStateCommitment(makeState());
    const proof = getProof(commitment, subject);
    let tamperedSubject: ProofSubject;
    if (subject.category === "equipment") {
      tamperedSubject = { ...subject, itemId: `${subject.itemId}_tampered` };
    } else {
      tamperedSubject = { ...subject, id: `${subject.id}_tampered` };
    }
    expect(
      verifyProof({ ...proof, subject: tamperedSubject } as StateMerkleProof),
    ).toBe(false);
  });

  it("returns false rather than throwing for malformed proof input", () => {
    const proof = getProof(createStateCommitment(makeState()), {
      category: "achievement",
      id: "tax_collector",
    });
    expect(verifyProof({ ...proof, leaf: "0x1234" as Hex32 })).toBe(false);
    expect(
      verifyProof({ ...proof, siblings: ["not-hex" as Hex32] }),
    ).toBe(false);
  });

  it("refuses to generate a proof for an uncommitted semantic claim", () => {
    const commitment = createStateCommitment(makeState());
    expect(() =>
      getProof(commitment, { category: "achievement", id: "client_awarded" }),
    ).toThrow(/not committed/);
    expect(() =>
      getProof(commitment, {
        category: "equipment",
        slot: "primary",
        itemId: "client_supplied_bow",
      }),
    ).toThrow(/not committed/);
  });

  it("rebuilds and validates commitment bindings before issuing proofs", () => {
    const commitment = createStateCommitment(makeState());
    expect(() =>
      getProof(
        { ...commitment, stateRoot: flipLastNibble(commitment.stateRoot) },
        { category: "state" },
      ),
    ).toThrow(StateValidationError);
  });
});
