import { describe, expect, it } from "vitest";
import { MemoryPersistence, MemoryReconciliationQueue } from "./adapters/memory.js";
import { CheckpointReconciler, CheckpointRelayer } from "./relayer.js";
import type { ChainClient } from "./ports.js";
import type { PlayerRecord } from "./domain.js";

const hash = `0x${"11".repeat(32)}` as `0x${string}`;
const root = `0x${"22".repeat(32)}` as `0x${string}`;
const wallet = "0x0000000000000000000000000000000000000010";
const player: PlayerRecord = {
  wallet,
  state: { wallet, scrollTokenId: "7", schemaVersion: 1, version: 4, level: 1, experience: 0, achievements: [], fineries: [], equipment: { primary: null, secondary: null }, unlocks: [], stats: { captures: 0, rescues: 0, matches: 0 }, updatedAt: 100 },
  stateRoot: root,
  canonicalHash: root,
  checkpointStatus: "queued",
  checkpointedVersion: 3,
  checkpointedRoot: root,
  checkpointedAt: 90,
  checkpointTransactionHash: null,
  lastCheckpointAttemptAt: null,
  checkpointErrorCode: null,
  firstUncheckpointedAt: 100,
  checkpointDueAt: 200,
  createdAt: 1,
  updatedAt: 100,
  mintTransactionHash: hash,
  mintedAt: 1,
};

const chain = (status: "pending" | "success" | "reverted" = "success"): ChainClient => ({
  getScrollTokenId: async () => "7",
  getCheckpoint: async () => ({ version: 4, stateRoot: root, timestamp: 100 }),
  verifyCheckpoint: async () => true,
  submitCheckpoint: async () => ({ hash, estimatedCostWei: 1n, chainNonce: 8 }),
  replaceCheckpoint: async () => ({ hash: `0x${"33".repeat(32)}`, estimatedCostWei: 1n, chainNonce: 8 }),
  getReceipt: async () => ({ hash, status, confirmations: status === "success" ? 12 : 0 }),
  getAllowance: async () => 0n,
  getMintPrice: async () => 100n,
  getTreasury: async () => "0x0000000000000000000000000000000000000004",
});

describe("checkpoint workers", () => {
  it("coalesces and deduplicates checkpoint submissions", async () => {
    const persistence = new MemoryPersistence();
    await persistence.createPlayer(player);
    const queue = new MemoryReconciliationQueue();
    const relayer = new CheckpointRelayer(persistence, chain(), queue, { now: () => 200 });
    await expect(relayer.process({ wallet, version: 2 })).resolves.toBe("submitted");
    await expect(relayer.process({ wallet, version: 4 })).resolves.toBe("duplicate");
    expect(queue.messages).toEqual([{ transactionHash: hash, delaySeconds: 15 }]);
  });

  it("confirms only after receipt depth and on-chain root verification", async () => {
    const persistence = new MemoryPersistence();
    await persistence.createPlayer(player);
    const queue = new MemoryReconciliationQueue();
    const relayer = new CheckpointRelayer(persistence, chain(), queue, { now: () => 200 });
    await relayer.process({ wallet, version: 4 });
    const reconciler = new CheckpointReconciler(persistence, chain(), queue, { now: () => 220 }, {
      confirmationsRequired: 12,
      maxReplacementAttempts: 3,
      replacementAfterSeconds: 180,
    });
    await expect(reconciler.process(hash)).resolves.toBe("confirmed");
    expect((await persistence.getPlayer(wallet))?.checkpointedVersion).toBe(4);
    expect((await persistence.getPlayer(wallet))?.checkpointedAt).toBe(100);
  });

  it("coalesces a burst of amendments into one chain submission", async () => {
    const persistence = new MemoryPersistence();
    await persistence.createPlayer(player);
    const queue = new MemoryReconciliationQueue();
    let submissions = 0;
    const burstChain = chain();
    burstChain.submitCheckpoint = async () => {
      submissions += 1;
      return { hash, estimatedCostWei: 1n, chainNonce: 8 };
    };
    const relayer = new CheckpointRelayer(persistence, burstChain, queue, { now: () => 200 });
    const results = await Promise.all(Array.from({ length: 1_000 }, () => relayer.process({ wallet, version: 1 })));
    expect(submissions).toBe(1);
    expect(results.filter((result) => result === "submitted")).toHaveLength(1);
    expect(results.filter((result) => result === "duplicate")).toHaveLength(999);
  });

  it("leaves an RPC outage retryable without rolling back state", async () => {
    const persistence = new MemoryPersistence();
    await persistence.createPlayer(player);
    const outage = chain();
    outage.submitCheckpoint = async () => {
      throw new Error("rpc timeout");
    };
    const relayer = new CheckpointRelayer(persistence, outage, new MemoryReconciliationQueue(), { now: () => 200 });
    await expect(relayer.process({ wallet, version: 4 })).rejects.toThrow("rpc timeout");
    expect((await persistence.getPlayer(wallet))?.checkpointStatus).toBe("retrying");
    expect((await persistence.getPlayer(wallet))?.state.version).toBe(4);
  });

  it("marks a reverted transaction failed after the replacement budget is exhausted", async () => {
    const persistence = new MemoryPersistence();
    await persistence.createPlayer(player);
    const queue = new MemoryReconciliationQueue();
    const revertedChain = chain("reverted");
    revertedChain.getCheckpoint = async () => ({ version: 3, stateRoot: root, timestamp: 90 });
    const relayer = new CheckpointRelayer(persistence, revertedChain, queue, { now: () => 200 });
    await relayer.process({ wallet, version: 4 });
    const reconciler = new CheckpointReconciler(persistence, revertedChain, queue, { now: () => 400 }, {
      confirmationsRequired: 12,
      maxReplacementAttempts: 1,
      replacementAfterSeconds: 180,
    });

    await expect(reconciler.process(hash)).resolves.toBe("failed");
    expect((await persistence.getPlayer(wallet))?.checkpointStatus).toBe("failed");
    expect((await persistence.getPlayer(wallet))?.checkpointErrorCode).toBe("checkpoint_reverted");
  });
});
