import {
  createStateCommitment,
  getProof,
  type PlayerStateInput,
  type ProofSubject,
} from "@robinhood-game/scroll-state-core";
import type { CanonicalGameState, Commitment } from "./domain.js";
import type { MerkleProof, ProofKind, StateCorePort } from "./ports.js";
import { badRequest } from "./errors.js";

const inputFor = (state: CanonicalGameState): PlayerStateInput => ({
  wallet: state.wallet,
  scrollTokenId: state.scrollTokenId ?? "0",
  schemaVersion: state.schemaVersion,
  stateVersion: state.version,
  level: state.level,
  experience: state.experience,
  achievements: state.achievements,
  fineries: state.fineries,
  equipment: Object.fromEntries(Object.entries(state.equipment).filter((entry): entry is [string, string] => entry[1] !== null)),
  unlocks: state.unlocks,
  stats: state.stats,
  updatedAt: state.updatedAt,
});

export class ScrollStateCoreAdapter implements StateCorePort {
  createInitialState(wallet: string): CanonicalGameState {
    return {
      wallet,
      scrollTokenId: null,
      schemaVersion: 1,
      version: 1,
      level: 1,
      experience: 0,
      achievements: [],
      fineries: [],
      equipment: { primary: null, secondary: null },
      unlocks: [],
      stats: { captures: 0, rescues: 0, matches: 0 },
      updatedAt: Math.floor(Date.now() / 1000),
    };
  }

  commitment(state: CanonicalGameState): Commitment {
    const commitment = createStateCommitment(inputFor(state));
    return {
      canonicalJson: commitment.canonicalJson,
      stateHash: commitment.stateHash,
      root: commitment.stateRoot,
      leaves: Object.fromEntries(commitment.leaves.map((leaf) => [JSON.stringify(leaf.subject), leaf.hash])),
    };
  }

  proof(state: CanonicalGameState, kind: ProofKind, id: string): MerkleProof {
    const commitment = createStateCommitment(inputFor(state));
    let subject: ProofSubject;
    if (kind === "state") subject = { category: "state" };
    else if (kind === "equipment") {
      const itemId = state.equipment[id];
      if (!itemId) throw badRequest("proof_not_found", `No equipment is selected in slot ${id}`);
      subject = { category: "equipment", slot: id, itemId };
    } else {
      subject = { category: kind, id };
    }
    const proof = getProof(commitment, subject as never);
    const value =
      subject.category === "state"
        ? commitment.stateHash
        : subject.category === "equipment"
          ? subject.itemId
          : subject.id;
    return {
      kind,
      id,
      leaf: proof.leaf,
      root: proof.stateRoot,
      proof: [...proof.siblings],
      value,
      canonicalHash: commitment.stateHash,
    };
  }
}
