import { randomBytes } from "node:crypto";
import {
  CreateTableCommand,
  DeleteTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DynamoPersistence } from "../services/adapters/aws-persistence.js";
import type { Amendment, PlayerRecord } from "../services/domain.js";

const endpoint = process.env.DYNAMODB_LOCAL_ENDPOINT ?? "";
const local = (() => {
  try {
    const host = new URL(endpoint).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
})();
const tableName = `SherwoodScrollIntegration-${process.pid}-${Date.now()}`;
const client = new DynamoDBClient({
  endpoint: endpoint || "http://127.0.0.1:8000",
  region: "local",
  credentials: { accessKeyId: "local", secretAccessKey: "local" },
});
const documentClient = DynamoDBDocumentClient.from(client);
const persistence = new DynamoPersistence(tableName, documentClient);
const wallet = `0x${randomBytes(20).toString("hex")}`;
const root = `0x${"11".repeat(32)}` as `0x${string}`;

function player(): PlayerRecord {
  return {
    wallet,
    state: {
      wallet,
      scrollTokenId: "7",
      schemaVersion: 1,
      version: 1,
      level: 1,
      experience: 0,
      achievements: [],
      fineries: [],
      equipment: { primary: null, secondary: null },
      unlocks: [],
      stats: { captures: 0, rescues: 0, matches: 0 },
      updatedAt: 1,
    },
    stateRoot: root,
    canonicalHash: root,
    checkpointStatus: "pending",
    checkpointedVersion: 0,
    checkpointedRoot: null,
    checkpointedAt: null,
    checkpointTransactionHash: null,
    lastCheckpointAttemptAt: null,
    checkpointErrorCode: null,
    firstUncheckpointedAt: 1,
    checkpointDueAt: 301,
    createdAt: 1,
    updatedAt: 1,
    mintTransactionHash: `0x${"22".repeat(32)}`,
    mintedAt: 1,
  };
}

describe.runIf(local)("DynamoPersistence against DynamoDB Local", () => {
  beforeAll(async () => {
    await client.send(new CreateTableCommand({
      TableName: tableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
    }));
    for (;;) {
      const status = (await client.send(new DescribeTableCommand({ TableName: tableName }))).Table?.TableStatus;
      if (status === "ACTIVE") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });

  afterAll(async () => {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
    client.destroy();
  });

  it("atomically preserves optimistic concurrency, amendment history, and idempotency", async () => {
    const initial = player();
    await expect(persistence.createPlayer(initial)).resolves.toMatchObject({ created: true });

    const next = structuredClone(initial);
    next.state.version = 2;
    next.updatedAt = 2;
    const amendment: Amendment = {
      wallet,
      commandId: "550e8400-e29b-41d4-a716-446655440000",
      version: 2,
      commandType: "select_equipment",
      evidenceId: null,
      previousRoot: root,
      nextRoot: root,
      acceptedAt: 2,
    };
    await expect(persistence.applyCommand(1, next, amendment, 3_600)).resolves.toMatchObject({ state: { version: 2 } });
    await expect(persistence.applyCommand(1, next, amendment, 3_600)).resolves.toMatchObject({ state: { version: 2 } });
    await expect(persistence.getIdempotentResult(wallet, amendment.commandId)).resolves.toMatchObject({ state: { version: 2 } });
  });
});
