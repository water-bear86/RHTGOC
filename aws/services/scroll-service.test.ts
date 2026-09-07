import { describe, expect, it } from "vitest";
import type { ServiceConfig } from "./config.js";
import { MemoryCheckpointQueue, MemoryPersistence, MemorySnapshotStore } from "./adapters/memory.js";
import { ScrollStateCoreAdapter } from "./state-core-adapter.js";
import { MintPaymentVerifier } from "./payment.js";
import { ScrollService } from "./scroll-service.js";
import type { ChainClient, GameRulesEngine } from "./ports.js";
import type { ServerGameCommand } from "./domain.js";

const address = "0x0000000000000000000000000000000000000010";
const config: ServiceConfig = {
  tableName: "table",
  snapshotBucket: "bucket",
  checkpointQueueUrl: "queue",
  reconciliationQueueUrl: "reconcile",
  relayerSecretArn: "secret",
  rpcUrl: "http://localhost",
  chainId: 1,
  scrollContractAddress: "0x0000000000000000000000000000000000000002",
  robinTokenAddress: "0x0000000000000000000000000000000000000003",
  robinTokenDecimals: 18,
  upkeepAddress: "0x0000000000000000000000000000000000000004",
  deadAddress: "0x000000000000000000000000000000000000dEaD",
  checkpointAfterSeconds: 300,
  maxUncheckpointedSeconds: 3600,
  checkpointOnMajorAchievement: true,
  checkpointOnMatchResult: true,
  authDomainName: "Sherwood, the game (on robinhood chain)",
  authDomainVersion: "1",
  challengeTtlSeconds: 300,
  sessionTtlSeconds: 3600,
  confirmationsRequired: 12,
  maxRelayerGasWei: 1n,
  maxDailyRelayerSpendWei: 2n,
  maxReplacementAttempts: 3,
  replacementAfterSeconds: 180,
  matchReceiptPublicKey: "test",
  metadataBaseUrl: "https://example.test/v1",
};

const chain: ChainClient = {
  getScrollTokenId: async () => null,
  getCheckpoint: async () => ({ version: 0, stateRoot: `0x${"00".repeat(32)}`, timestamp: 0 }),
  verifyCheckpoint: async () => false,
  submitCheckpoint: async () => ({ hash: `0x${"11".repeat(32)}`, estimatedCostWei: 1n, chainNonce: 1 }),
  replaceCheckpoint: async () => ({ hash: `0x${"22".repeat(32)}`, estimatedCostWei: 1n, chainNonce: 1 }),
  getReceipt: async (hash) => ({ hash, status: "pending", confirmations: 0 }),
  getAllowance: async () => 0n,
  getMintPrice: async () => 100n,
  getTreasury: async () => config.upkeepAddress,
};

const rules: GameRulesEngine = {
  apply: async (state, command: ServerGameCommand) => ({
    state: command.kind === "select_equipment" ? { ...state, equipment: { primary: command.itemIds[0] ?? null, secondary: null } } : state,
    majorMilestone: false,
  }),
};

const harness = (chainClient: ChainClient = chain) => {
  const persistence = new MemoryPersistence();
  const snapshots = new MemorySnapshotStore();
  const queue = new MemoryCheckpointQueue();
  const core = new ScrollStateCoreAdapter();
  let now = 1000;
  const service = new ScrollService(
    persistence,
    snapshots,
    queue,
    core,
    rules,
    chainClient,
    new MintPaymentVerifier({
      scrollContractAddress: config.scrollContractAddress,
      robinTokenAddress: config.robinTokenAddress,
      upkeepAddress: config.upkeepAddress,
      deadAddress: config.deadAddress,
    }),
    { now: () => now },
    config,
  );
  return { persistence, snapshots, queue, core, service, setNow: (value: number) => (now = value) };
};

describe("ScrollService", () => {
  it("registers idempotently and refuses canonical progression without a Scroll", async () => {
    const { service } = harness();
    expect((await service.register(address)).created).toBe(true);
    expect((await service.register(address)).created).toBe(false);
    await expect(
      service.mutate(address, "550e8400-e29b-41d4-a716-446655440000", 1, { kind: "select_equipment", itemIds: [] }),
    ).rejects.toMatchObject({ code: "scroll_required" });
  });

  it("persists immutable state, is idempotent, and rejects stale versions", async () => {
    const { service, persistence, snapshots, core } = harness();
    await service.register(address);
    const player = await persistence.getPlayer(address);
    if (!player) throw new Error("missing player");
    player.state.scrollTokenId = "7";
    player.state.version = 2;
    player.mintTransactionHash = `0x${"44".repeat(32)}`;
    player.mintedAt = 1000;
    const commitment = core.commitment(player.state);
    player.stateRoot = commitment.root;
    player.canonicalHash = commitment.stateHash;
    await persistence.attachScroll(player, player.mintTransactionHash);

    const id = "550e8400-e29b-41d4-a716-446655440000";
    const first = await service.mutate(address, id, 2, { kind: "select_equipment", itemIds: [] });
    const duplicate = await service.mutate(address, id, 2, { kind: "select_equipment", itemIds: [] });
    expect(first.stateVersion).toBe(3);
    expect(duplicate.stateVersion).toBe(3);
    expect(snapshots.snapshots.size).toBe(1);
    await expect(
      service.mutate(address, "550e8400-e29b-41d4-a716-446655440001", 2, { kind: "select_equipment", itemIds: [] }),
    ).rejects.toMatchObject({ code: "stale_version", details: { currentVersion: 3 } });
  });

  it("reads mint economics from chain and fails closed if governance configuration drifted", async () => {
    const live = { ...chain, getMintPrice: async () => 246n };
    const { service } = harness(live);
    await service.register(address);
    await expect(service.requestMint(address)).resolves.toMatchObject({
      totalPriceBaseUnits: "246",
      upkeepAmountBaseUnits: "123",
      burnedAmountBaseUnits: "123",
      upkeepTreasury: config.upkeepAddress,
    });

    const drifted = { ...chain, getTreasury: async () => "0x0000000000000000000000000000000000000005" };
    const driftHarness = harness(drifted);
    await driftHarness.service.register(address);
    await expect(driftHarness.service.requestMint(address)).rejects.toMatchObject({ code: "mint_configuration_drift" });
  });
});
