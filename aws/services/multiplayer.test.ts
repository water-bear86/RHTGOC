import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "./adapters/memory.js";
import { ScrollStateCoreAdapter } from "./state-core-adapter.js";
import { MultiplayerVerifier } from "./multiplayer.js";
import type { ChainClient } from "./ports.js";
import type { PlayerRecord } from "./domain.js";

const wallet = "0x0000000000000000000000000000000000000010";

describe("MultiplayerVerifier", () => {
  it("quarantines dirty state even when its older recorded checkpoint is valid on chain", async () => {
    const persistence = new MemoryPersistence();
    const core = new ScrollStateCoreAdapter();
    const state = core.createInitialState(wallet);
    state.scrollTokenId = "9";
    state.version = 3;
    state.unlocks = ["ranked_bow"];
    state.equipment.primary = "ranked_bow";
    const committed = core.commitment(state);
    const oldRoot = `0x${"77".repeat(32)}` as `0x${string}`;
    const player: PlayerRecord = {
      wallet,
      state,
      stateRoot: committed.root,
      canonicalHash: committed.stateHash,
      checkpointStatus: "pending",
      checkpointedVersion: 2,
      checkpointedRoot: oldRoot,
      checkpointedAt: 10,
      checkpointTransactionHash: `0x${"88".repeat(32)}`,
      lastCheckpointAttemptAt: null,
      checkpointErrorCode: null,
      firstUncheckpointedAt: 11,
      checkpointDueAt: 20,
      createdAt: 1,
      updatedAt: 11,
      mintTransactionHash: `0x${"99".repeat(32)}`,
      mintedAt: 2,
    };
    await persistence.createPlayer(player);
    const chain: ChainClient = {
      getScrollTokenId: async () => "9",
      getCheckpoint: async () => ({ version: 2, stateRoot: oldRoot, timestamp: 10 }),
      verifyCheckpoint: async () => true,
      submitCheckpoint: async () => ({ hash: `0x${"11".repeat(32)}`, estimatedCostWei: 1n, chainNonce: 1 }),
      replaceCheckpoint: async () => ({ hash: `0x${"22".repeat(32)}`, estimatedCostWei: 1n, chainNonce: 1 }),
      getReceipt: async (hash) => ({ hash, status: "pending", confirmations: 0 }),
      getAllowance: async () => 0n,
      getMintPrice: async () => 100n,
      getTreasury: async () => "0x0000000000000000000000000000000000000004",
    };
    await expect(new MultiplayerVerifier(persistence, core, chain).verify(wallet)).resolves.toEqual({
      status: "quarantine",
      wallet,
      reason: "root_mismatch",
    });
  });
});
