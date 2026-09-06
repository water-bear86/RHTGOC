import { createHash } from "node:crypto";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ConditionalCheckFailedException, DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { conflict } from "../errors.js";
import type { Amendment, AuthChallenge, PlayerRecord, StoredSession, TransactionRecord } from "../domain.js";
import type {
  AuthPersistence,
  CheckpointQueue,
  PlayerPersistence,
  ReconciliationQueue,
  SnapshotStore,
  RelayerSpendLimiter,
} from "../ports.js";
import { unavailable } from "../errors.js";

const playerKey = (wallet: string) => ({ pk: `PLAYER#${wallet}`, sk: "STATE" });

export class DynamoPersistence implements PlayerPersistence, AuthPersistence {
  private readonly client: DynamoDBDocumentClient;

  constructor(
    private readonly tableName: string,
    client?: DynamoDBDocumentClient,
  ) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async createPlayer(player: PlayerRecord): Promise<{ player: PlayerRecord; created: boolean }> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: this.playerItem(player),
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return { player, created: true };
    } catch (error) {
      if (!(error instanceof ConditionalCheckFailedException) && (error as { name?: string }).name !== "ConditionalCheckFailedException") throw error;
      const existing = await this.getPlayer(player.wallet);
      if (!existing) throw error;
      return { player: existing, created: false };
    }
  }

  async getPlayer(wallet: string): Promise<PlayerRecord | null> {
    const response = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: playerKey(wallet), ConsistentRead: true }),
    );
    return (response.Item?.payload as PlayerRecord | undefined) ?? null;
  }

  async getPlayerByTokenId(tokenId: string): Promise<PlayerRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `SCROLL#${tokenId}`, sk: "PLAYER" },
        ConsistentRead: true,
      }),
    );
    const wallet = response.Item?.wallet;
    return typeof wallet === "string" ? this.getPlayer(wallet) : null;
  }

  async getIdempotentResult(wallet: string, commandId: string): Promise<PlayerRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `PLAYER#${wallet}`, sk: `IDEMP#${commandId}` },
        ConsistentRead: true,
      }),
    );
    return (response.Item?.result as PlayerRecord | undefined) ?? null;
  }

  async applyCommand(
    previousVersion: number,
    player: PlayerRecord,
    amendment: Amendment,
    idempotencyTtl: number,
  ): Promise<PlayerRecord> {
    try {
      await this.client.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.tableName,
                Item: this.playerItem(player),
                ConditionExpression: "#version = :expected",
                ExpressionAttributeNames: { "#version": "version" },
                ExpressionAttributeValues: { ":expected": previousVersion },
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  pk: `PLAYER#${player.wallet}`,
                  sk: `AMEND#${String(amendment.version).padStart(20, "0")}#${amendment.commandId}`,
                  type: "amendment",
                  payload: amendment,
                },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            {
              Put: {
                TableName: this.tableName,
                Item: {
                  pk: `PLAYER#${player.wallet}`,
                  sk: `IDEMP#${amendment.commandId}`,
                  type: "idempotency",
                  result: player,
                  expiresAt: idempotencyTtl,
                },
                ConditionExpression: "attribute_not_exists(pk)",
              },
            },
            ...(amendment.evidenceId
              ? [
                  {
                    Put: {
                      TableName: this.tableName,
                      Item: {
                        pk: `EVIDENCE_CLAIM#${amendment.commandType}#${amendment.evidenceId}`,
                        sk: "CLAIM",
                        type: "evidence_claim",
                        wallet: player.wallet,
                        commandId: amendment.commandId,
                        claimedAt: amendment.acceptedAt,
                      },
                      ConditionExpression: "attribute_not_exists(pk)",
                    },
                  },
                ]
              : []),
          ],
        }),
      );
      return player;
    } catch (error) {
      if ((error as { name?: string }).name !== "TransactionCanceledException") throw error;
      const duplicate = await this.getIdempotentResult(player.wallet, amendment.commandId);
      if (duplicate) return duplicate;
      const current = await this.getPlayer(player.wallet);
      throw conflict("stale_version", "State was updated by another command", {
        currentVersion: current?.state.version ?? null,
      });
    }
  }

  async attachScroll(player: PlayerRecord, transactionHash: `0x${string}`): Promise<PlayerRecord> {
    const tokenId = player.state.scrollTokenId;
    if (!tokenId) throw new Error("scroll_token_id_required");
    await this.client.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: this.tableName,
              Item: this.playerItem(player),
              ConditionExpression: "payload.#state.#token = :empty OR payload.#state.#token = :token",
              ExpressionAttributeNames: { "#state": "state", "#token": "scrollTokenId" },
              ExpressionAttributeValues: { ":empty": null, ":token": tokenId },
            },
          },
          {
            Put: {
              TableName: this.tableName,
              Item: { pk: `SCROLL#${tokenId}`, sk: "PLAYER", type: "scroll_player", wallet: player.wallet, transactionHash },
              ConditionExpression: "attribute_not_exists(pk) OR wallet = :wallet",
              ExpressionAttributeValues: { ":wallet": player.wallet },
            },
          },
        ],
      }),
    );
    return player;
  }

  async markQueued(wallet: string, version: number): Promise<void> {
    await this.updateCheckpointFields(wallet, version, "queued");
  }

  async markSubmitted(wallet: string, version: number, transactionHash: string): Promise<void> {
    const player = await this.requirePlayer(wallet);
    // A newer off-chain version may be accepted while this transaction is being
    // broadcast. Its pending status must not be overwritten by an older submission.
    if (player.state.version !== version) return;
    player.checkpointStatus = "submitted";
    player.lastCheckpointAttemptAt = Math.floor(Date.now() / 1000);
    player.checkpointTransactionHash = transactionHash as `0x${string}`;
    await this.putPlayerConditionally(player, version);
  }

  async markConfirmed(
    wallet: string,
    version: number,
    root: `0x${string}`,
    transactionHash: string,
    checkpointedAt: number,
  ): Promise<void> {
    const player = await this.requirePlayer(wallet);
    player.checkpointedVersion = version;
    player.checkpointedRoot = root;
    player.checkpointedAt = checkpointedAt;
    player.checkpointTransactionHash = transactionHash as `0x${string}`;
    player.checkpointStatus = player.state.version === version ? "confirmed" : "pending";
    if (player.state.version === version) {
      player.firstUncheckpointedAt = null;
      player.checkpointDueAt = null;
    }
    await this.putPlayerConditionally(player, player.state.version);
  }

  async markCheckpointFailure(wallet: string, version: number, retryable: boolean, reason: string): Promise<void> {
    const player = await this.requirePlayer(wallet);
    if (player.state.version === version) {
      player.checkpointStatus = retryable ? "retrying" : "failed";
      player.checkpointErrorCode = reason.slice(0, 96);
    }
    player.lastCheckpointAttemptAt = Math.floor(Date.now() / 1000);
    await this.putPlayerConditionally(player, player.state.version);
  }

  async listCheckpointDue(now: number, _maxAgeCutoff: number, limit: number): Promise<PlayerRecord[]> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "CheckpointDueIndex",
        KeyConditionExpression: "checkpointBucket = :bucket AND checkpointDueAt <= :now",
        ExpressionAttributeValues: { ":bucket": "DUE", ":now": now },
        Limit: limit,
      }),
    );
    return (response.Items ?? []).map((item) => item.payload as PlayerRecord);
  }

  async putTransaction(transaction: TransactionRecord): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: { pk: `TX#${transaction.transactionHash}`, sk: "CHECKPOINT", type: "transaction", payload: transaction },
          ConditionExpression: "attribute_not_exists(pk)",
        }),
      );
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  }

  async claimCheckpoint(wallet: string, version: number, now: number, leaseSeconds: number): Promise<boolean> {
    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            pk: `CHECKPOINT#${wallet}`,
            sk: `VERSION#${String(version).padStart(20, "0")}`,
            type: "checkpoint_claim",
            expiresAt: now + leaseSeconds,
          },
          ConditionExpression: "attribute_not_exists(pk) OR expiresAt < :now",
          ExpressionAttributeValues: { ":now": now },
        }),
      );
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  }

  async getTransaction(transactionHash: string): Promise<TransactionRecord | null> {
    const response = await this.client.send(
      new GetCommand({ TableName: this.tableName, Key: { pk: `TX#${transactionHash}`, sk: "CHECKPOINT" } }),
    );
    return (response.Item?.payload as TransactionRecord | undefined) ?? null;
  }

  async updateTransaction(transaction: TransactionRecord): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { pk: `TX#${transaction.transactionHash}`, sk: "CHECKPOINT", type: "transaction", payload: transaction },
      }),
    );
  }

  async putChallenge(challenge: AuthChallenge): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `AUTH#${challenge.wallet}`,
          sk: `NONCE#${challenge.nonce}`,
          type: "auth_nonce",
          payload: challenge,
          expiresAt: challenge.expiresAt,
        },
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
  }

  async consumeChallenge(wallet: string, nonce: string, now: number): Promise<AuthChallenge | null> {
    try {
      const response = await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { pk: `AUTH#${wallet}`, sk: `NONCE#${nonce}` },
          ConditionExpression: "expiresAt >= :now",
          ExpressionAttributeValues: { ":now": now },
          ReturnValues: "ALL_OLD",
        }),
      );
      return (response.Attributes?.payload as AuthChallenge | undefined) ?? null;
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") return null;
      throw error;
    }
  }

  async putSession(session: StoredSession): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          pk: `AUTH#${session.wallet}`,
          sk: `SESSION#${session.tokenHash}`,
          type: "auth_session",
          payload: session,
          expiresAt: session.expiresAt,
        },
      }),
    );
  }

  async getSession(wallet: string, tokenHash: string, now: number): Promise<StoredSession | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `AUTH#${wallet}`, sk: `SESSION#${tokenHash}` },
        ConsistentRead: true,
      }),
    );
    const session = response.Item?.payload as StoredSession | undefined;
    return session && session.expiresAt >= now ? session : null;
  }

  private playerItem(player: PlayerRecord) {
    const checkpointEligible =
      player.checkpointDueAt !== null && ["pending", "retrying", "failed"].includes(player.checkpointStatus);
    return {
      ...playerKey(player.wallet),
      type: "player",
      version: player.state.version,
      ...(checkpointEligible ? { checkpointBucket: "DUE", checkpointDueAt: player.checkpointDueAt } : {}),
      payload: player,
    };
  }

  private async requirePlayer(wallet: string): Promise<PlayerRecord> {
    const player = await this.getPlayer(wallet);
    if (!player) throw new Error("player_not_found");
    return player;
  }

  private async putPlayerConditionally(player: PlayerRecord, version: number): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: this.playerItem(player),
        ConditionExpression: "#version = :version",
        ExpressionAttributeNames: { "#version": "version" },
        ExpressionAttributeValues: { ":version": version },
      }),
    );
  }

  private async updateCheckpointFields(wallet: string, version: number, status: string): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: playerKey(wallet),
        UpdateExpression: "SET payload.checkpointStatus = :status REMOVE checkpointBucket, checkpointDueAt",
        ConditionExpression: "#version = :version",
        ExpressionAttributeNames: { "#version": "version" },
        ExpressionAttributeValues: { ":status": status, ":version": version },
      }),
    );
  }
}

export class S3SnapshotStore implements SnapshotStore {
  constructor(
    private readonly bucket: string,
    private readonly client = new S3Client({}),
  ) {}

  async putImmutable(wallet: string, version: number, root: `0x${string}`, canonicalJson: string): Promise<string> {
    const key = `players/${wallet}/v${version}/${root}.json`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: canonicalJson,
        ContentType: "application/json",
        ChecksumSHA256: createHash("sha256").update(canonicalJson).digest("base64"),
        IfNoneMatch: "*",
      }),
    );
    return key;
  }
}

export class SqsCheckpointQueue implements CheckpointQueue {
  constructor(
    private readonly queueUrl: string,
    private readonly client = new SQSClient({}),
  ) {}

  async enqueue(wallet: string, version: number, reason: "debounce" | "milestone" | "match" | "manual" | "max_age") {
    await this.client.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: JSON.stringify({ wallet, version, reason }),
        MessageGroupId: wallet,
        MessageDeduplicationId: `${wallet}:${version}`,
      }),
    );
  }
}

export class SqsReconciliationQueue implements ReconciliationQueue {
  constructor(
    private readonly queueUrl: string,
    private readonly client = new SQSClient({}),
  ) {}

  async enqueue(transactionHash: `0x${string}`, delaySeconds: number) {
    await this.client.send(
      new SendMessageCommand({ QueueUrl: this.queueUrl, MessageBody: JSON.stringify({ transactionHash }), DelaySeconds: delaySeconds }),
    );
  }
}

export class DynamoRelayerSpendLimiter implements RelayerSpendLimiter {
  private readonly client: DynamoDBDocumentClient;
  constructor(
    private readonly tableName: string,
    client?: DynamoDBDocumentClient,
  ) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async reserve(utcDay: string, amountWei: bigint, maximumWei: bigint): Promise<void> {
    if (amountWei > maximumWei) throw unavailable("relayer_daily_limit", "Transaction exceeds the daily sponsored-gas limit");
    try {
      await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk: `RELAYER_SPEND#${utcDay}`, sk: "DAILY" },
          UpdateExpression: "SET spentWei = if_not_exists(spentWei, :zero) + :amount, expiresAt = :expiresAt",
          ConditionExpression: "attribute_not_exists(spentWei) OR spentWei <= :remaining",
          ExpressionAttributeValues: {
            ":zero": 0n,
            ":amount": amountWei,
            ":remaining": maximumWei - amountWei,
            ":expiresAt": Math.floor(Date.now() / 1000) + 8 * 24 * 3600,
          },
        }),
      );
    } catch (error) {
      if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
        throw unavailable("relayer_daily_limit", "Daily sponsored-gas limit has been reached");
      }
      throw error;
    }
  }
}
