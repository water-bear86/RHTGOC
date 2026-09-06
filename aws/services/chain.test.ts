import { describe, expect, it } from "vitest";
import type { ServiceConfig } from "./config.js";
import { EthersRobinhoodChainClient, relayerFeeEnvelope } from "./chain.js";

const config: ServiceConfig = {
  tableName: "test",
  snapshotBucket: "test",
  checkpointQueueUrl: "https://example.invalid/checkpoints",
  reconciliationQueueUrl: "https://example.invalid/reconciliation",
  relayerSecretArn: "test-secret",
  rpcUrl: "https://rpc.example.invalid",
  chainId: 46630,
  scrollContractAddress: "0x0000000000000000000000000000000000000010",
  robinTokenAddress: "0x0000000000000000000000000000000000000020",
  robinTokenDecimals: 18,
  upkeepAddress: "0x0000000000000000000000000000000000000030",
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
  maxDailyRelayerSpendWei: 1n,
  maxReplacementAttempts: 3,
  replacementAfterSeconds: 180,
  matchReceiptPublicKey: "unused",
  metadataBaseUrl: "https://example.invalid/scrolls",
};

describe("EthersRobinhoodChainClient key separation", () => {
  it("reserves the full gas-limit and replacement-fee envelope", () => {
    expect(relayerFeeEnvelope(100n, 1_000n, false)).toEqual({
      gasLimit: 120n,
      submissionMaxFeePerGas: 1_000n,
      maximumCostWei: 120_000n,
    });
    expect(relayerFeeEnvelope(100n, 1_000n, true)).toEqual({
      gasLimit: 120n,
      submissionMaxFeePerGas: 1_150n,
      maximumCostWei: 138_000n,
    });
  });

  it("fails before RPC use when the checkpoint signer and relayer keys match", async () => {
    const testKey = `0x${"11".repeat(32)}`;
    const secrets = {
      send: async () => ({
        SecretString: JSON.stringify({
          relayerPrivateKey: testKey,
          checkpointSignerPrivateKey: testKey,
        }),
      }),
    };
    const spendLimiter = { reserve: async () => undefined };
    const client = new EthersRobinhoodChainClient(config, spendLimiter, secrets as never);

    await expect(
      client.submitCheckpoint("1", 1, `0x${"22".repeat(32)}`),
    ).rejects.toThrow("Checkpoint signer and relayer must use different keys");
  });

  it("fails closed before contract reads when the RPC reports another chain", async () => {
    const client = new EthersRobinhoodChainClient(
      config,
      { reserve: async () => undefined },
      { send: async () => ({}) } as never,
    );
    (client as unknown as { provider: { send(method: string): Promise<string> } }).provider = {
      send: async () => "0x1",
    };

    await expect(client.getMintPrice()).rejects.toMatchObject({ code: "rpc_wrong_chain" });
  });
});
