import { canonicalStringify, canonicalizeState } from "./canonical.js";
import {
  concatBytes,
  hashCanonicalState,
  hexToBytes32,
  keccak256Bytes,
  keccak256Utf8,
} from "./hash.js";
import { normalizeUint256, normalizeWallet, validateIdentifier } from "./schema.js";
import type {
  CanonicalPlayerState,
  CanonicalStateMerkleProof,
  CategoryMerkleProof,
  CommitmentLeaf,
  Hex32,
  PlayerStateInput,
  ProofCategory,
  ProofSubject,
  StateCommitment,
  StateMerkleProof,
} from "./types.js";
import { StateValidationError } from "./types.js";

export const LEAF_DOMAINS: Readonly<Record<ProofCategory, string>> = {
  state: "robinhood.scroll.state.v1",
  achievement: "robinhood.scroll.achievement.v1",
  finery: "robinhood.scroll.finery.v1",
  equipment: "robinhood.scroll.equipment.v1",
  unlock: "robinhood.scroll.unlock.v1",
};

function compareHex(left: Hex32, right: Hex32): number {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
}

function uint256Word(value: string): Uint8Array {
  const parsed = BigInt(value);
  const output = new Uint8Array(32);
  let remaining = parsed;
  for (let index = output.length - 1; index >= 0; index -= 1) {
    output[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return output;
}

function addressWord(wallet: string): Uint8Array {
  const normalized = normalizeWallet(wallet, "proof.wallet");
  const output = new Uint8Array(32);
  for (let index = 0; index < 20; index += 1) {
    output[12 + index] = Number.parseInt(
      normalized.slice(2 + index * 2, 4 + index * 2),
      16,
    );
  }
  return output;
}

function makeLeaf(
  category: ProofCategory,
  wallet: string,
  scrollTokenId: string,
  stateVersion: number,
  payloadHash: Hex32,
): Hex32 {
  const domainHash = keccak256Utf8(LEAF_DOMAINS[category]);
  const abiEncoded = concatBytes(
    hexToBytes32(domainHash),
    addressWord(wallet),
    uint256Word(scrollTokenId),
    uint256Word(normalizeUint256(stateVersion, "proof.stateVersion")),
    hexToBytes32(payloadHash, "proof.payloadHash"),
  );
  const inner = keccak256Bytes(abiEncoded);
  return keccak256Bytes(hexToBytes32(inner));
}

function subjectPayloadHash(subject: ProofSubject, stateHash?: Hex32): Hex32 {
  switch (subject.category) {
    case "state": {
      if (stateHash === undefined) {
        throw new StateValidationError("proof.stateHash", "required for canonical state proof");
      }
      return stateHash;
    }
    case "achievement":
      return keccak256Utf8(validateIdentifier(subject.id, "proof.subject.id"));
    case "finery":
      return keccak256Utf8(validateIdentifier(subject.id, "proof.subject.id"));
    case "unlock":
      return keccak256Utf8(validateIdentifier(subject.id, "proof.subject.id"));
    case "equipment": {
      const slot = validateIdentifier(subject.slot, "proof.subject.slot");
      const itemId = validateIdentifier(subject.itemId, "proof.subject.itemId");
      return keccak256Utf8(canonicalStringify({ itemId, slot }));
    }
  }
}

function leafForSubject(
  state: CanonicalPlayerState,
  stateHash: Hex32,
  subject: ProofSubject,
): CommitmentLeaf {
  return {
    subject,
    hash: makeLeaf(
      subject.category,
      state.wallet,
      state.scrollTokenId,
      state.stateVersion,
      subjectPayloadHash(subject, stateHash),
    ),
  };
}

function subjectsForState(state: CanonicalPlayerState): ProofSubject[] {
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

export function hashPair(left: Hex32, right: Hex32): Hex32 {
  hexToBytes32(left, "left");
  hexToBytes32(right, "right");
  const [first, second] = compareHex(left, right) <= 0 ? [left, right] : [right, left];
  return keccak256Bytes(concatBytes(hexToBytes32(first), hexToBytes32(second)));
}

function nextLevel(nodes: readonly Hex32[]): Hex32[] {
  const parents: Hex32[] = [];
  for (let index = 0; index < nodes.length; index += 2) {
    const left = nodes[index];
    if (left === undefined) {
      throw new StateValidationError("tree", "missing left node");
    }
    const right = nodes[index + 1];
    parents.push(right === undefined ? left : hashPair(left, right));
  }
  return parents;
}

function buildLevels(leaves: readonly Hex32[]): readonly (readonly Hex32[])[] {
  if (leaves.length === 0) {
    throw new StateValidationError("tree", "must contain at least one leaf");
  }
  const levels: Hex32[][] = [[...leaves].sort(compareHex)];
  while ((levels.at(-1)?.length ?? 0) > 1) {
    const current = levels.at(-1);
    if (current === undefined) {
      throw new StateValidationError("tree", "missing tree level");
    }
    levels.push(nextLevel(current));
  }
  return levels;
}

function sameSubject(left: ProofSubject, right: ProofSubject): boolean {
  if (left.category !== right.category) {
    return false;
  }
  switch (left.category) {
    case "state":
      return true;
    case "achievement":
    case "finery":
    case "unlock":
      return left.id === (right as typeof left).id;
    case "equipment": {
      const other = right as Extract<ProofSubject, { category: "equipment" }>;
      return left.slot === other.slot && left.itemId === other.itemId;
    }
  }
}

function cloneSubject(subject: ProofSubject): ProofSubject {
  switch (subject.category) {
    case "state":
      return { category: "state" };
    case "achievement":
      return { category: "achievement", id: subject.id };
    case "finery":
      return { category: "finery", id: subject.id };
    case "unlock":
      return { category: "unlock", id: subject.id };
    case "equipment":
      return { category: "equipment", slot: subject.slot, itemId: subject.itemId };
  }
}

function assertSubjectExists(state: CanonicalPlayerState, subject: ProofSubject): void {
  switch (subject.category) {
    case "state":
      return;
    case "achievement":
      validateIdentifier(subject.id, "proof.subject.id");
      if (!state.achievements.includes(subject.id)) {
        throw new StateValidationError("proof.subject", "achievement is not committed");
      }
      return;
    case "finery":
      validateIdentifier(subject.id, "proof.subject.id");
      if (!state.fineries.includes(subject.id)) {
        throw new StateValidationError("proof.subject", "finery is not committed");
      }
      return;
    case "unlock":
      validateIdentifier(subject.id, "proof.subject.id");
      if (!state.unlocks.includes(subject.id)) {
        throw new StateValidationError("proof.subject", "unlock is not committed");
      }
      return;
    case "equipment":
      validateIdentifier(subject.slot, "proof.subject.slot");
      validateIdentifier(subject.itemId, "proof.subject.itemId");
      if (state.equipment[subject.slot] !== subject.itemId) {
        throw new StateValidationError("proof.subject", "equipment slot and item are not committed");
      }
  }
}

export function createStateCommitment(
  input: PlayerStateInput | CanonicalPlayerState | unknown,
): StateCommitment {
  const canonicalState = canonicalizeState(input);
  const canonicalJson = canonicalStringify(canonicalState);
  const stateHash = hashCanonicalState(canonicalState);
  const leaves = subjectsForState(canonicalState)
    .map((subject) => leafForSubject(canonicalState, stateHash, subject))
    .sort((left, right) => compareHex(left.hash, right.hash));

  for (let index = 1; index < leaves.length; index += 1) {
    if (leaves[index - 1]?.hash === leaves[index]?.hash) {
      throw new StateValidationError("tree", "duplicate leaf hash");
    }
  }

  const levels = buildLevels(leaves.map(({ hash }) => hash));
  const stateRoot = levels.at(-1)?.[0];
  if (stateRoot === undefined) {
    throw new StateValidationError("tree", "failed to construct Merkle root");
  }

  return { canonicalState, canonicalJson, stateHash, stateRoot, leaves };
}

export function getProof(
  commitment: StateCommitment,
  subject: Extract<ProofSubject, { category: "state" }>,
): CanonicalStateMerkleProof;
export function getProof(
  commitment: StateCommitment,
  subject: Exclude<ProofSubject, { category: "state" }>,
): CategoryMerkleProof;
export function getProof(
  commitment: StateCommitment,
  subject: ProofSubject,
): StateMerkleProof {
  const rebuilt = createStateCommitment(commitment.canonicalState);
  if (
    rebuilt.stateHash !== commitment.stateHash ||
    rebuilt.stateRoot !== commitment.stateRoot ||
    rebuilt.canonicalJson !== commitment.canonicalJson
  ) {
    throw new StateValidationError("commitment", "commitment does not match canonical state");
  }
  assertSubjectExists(rebuilt.canonicalState, subject);

  const target = rebuilt.leaves.find((candidate) => sameSubject(candidate.subject, subject));
  if (target === undefined) {
    throw new StateValidationError("proof.subject", "subject leaf is missing");
  }
  const levels = buildLevels(rebuilt.leaves.map(({ hash }) => hash));
  let index = levels[0]?.indexOf(target.hash) ?? -1;
  if (index < 0) {
    throw new StateValidationError("proof.subject", "subject leaf is missing from tree");
  }

  const siblings: Hex32[] = [];
  for (let levelIndex = 0; levelIndex < levels.length - 1; levelIndex += 1) {
    const level = levels[levelIndex];
    if (level === undefined) {
      throw new StateValidationError("tree", "missing proof level");
    }
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    const sibling = level[siblingIndex];
    if (sibling !== undefined) {
      siblings.push(sibling);
    }
    index = Math.floor(index / 2);
  }

  const commonProof = {
    wallet: rebuilt.canonicalState.wallet,
    scrollTokenId: rebuilt.canonicalState.scrollTokenId,
    stateVersion: rebuilt.canonicalState.stateVersion,
    stateRoot: rebuilt.stateRoot,
    subject: cloneSubject(subject),
    leaf: target.hash,
    siblings,
  };
  return subject.category === "state"
    ? {
        ...commonProof,
        subject: { category: "state" },
        stateHash: rebuilt.stateHash,
      }
    : {
        ...commonProof,
        subject: cloneSubject(subject) as Exclude<ProofSubject, { category: "state" }>,
      };
}

export function verifyProof(proof: StateMerkleProof, expectedRoot?: Hex32): boolean {
  try {
    const wallet = normalizeWallet(proof.wallet, "proof.wallet");
    const scrollTokenId = normalizeUint256(proof.scrollTokenId, "proof.scrollTokenId");
    const stateVersion = Number(normalizeUint256(proof.stateVersion, "proof.stateVersion"));
    if (!Number.isSafeInteger(stateVersion)) {
      return false;
    }
    const root = (expectedRoot ?? proof.stateRoot).toLowerCase() as Hex32;
    hexToBytes32(root, "proof.expectedRoot");
    if (proof.stateRoot.toLowerCase() !== root) {
      return false;
    }

    let stateHash: Hex32 | undefined;
    if (proof.subject.category === "state") {
      if (!("stateHash" in proof)) {
        return false;
      }
      stateHash = proof.stateHash;
    }

    const computedLeaf = makeLeaf(
      proof.subject.category,
      wallet,
      scrollTokenId,
      stateVersion,
      subjectPayloadHash(proof.subject, stateHash),
    );
    if (computedLeaf !== proof.leaf.toLowerCase()) {
      return false;
    }

    let computed = computedLeaf;
    for (const sibling of proof.siblings) {
      computed = hashPair(computed, sibling);
    }
    return computed === root;
  } catch {
    return false;
  }
}
