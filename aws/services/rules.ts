import { createHash, createPublicKey, verify } from "node:crypto";
import { GetCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { z } from "zod";
import { canonicalStringify } from "@robinhood-game/scroll-state-core";
import { badRequest, conflict, forbidden, notFound } from "./errors.js";
import type { CanonicalGameState, RulesResult, ServerGameCommand } from "./domain.js";
import type { GameRulesEngine } from "./ports.js";

export interface ProgressDelta {
  experience: number;
  captures: number;
  rescues: number;
  matches: number;
  achievements: string[];
  fineries: string[];
  unlocks: string[];
  majorMilestone: boolean;
}

export interface SignedEvidenceRecord {
  payloadJson: string;
  signature: string;
}

export interface EvidenceSource {
  get(kind: "match" | "offline_run", evidenceId: string): Promise<SignedEvidenceRecord | null>;
}

export class DynamoEvidenceSource implements EvidenceSource {
  private readonly client: DynamoDBDocumentClient;
  constructor(
    private readonly tableName: string,
    client?: DynamoDBDocumentClient,
  ) {
    this.client = client ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }

  async get(kind: "match" | "offline_run", evidenceId: string): Promise<SignedEvidenceRecord | null> {
    const response = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: `EVIDENCE#${kind.toUpperCase()}#${evidenceId}`, sk: "RESULT" },
        ConsistentRead: true,
      }),
    );
    return (response.Item?.payload as SignedEvidenceRecord | undefined) ?? null;
  }
}

const inputJournalHash = (command: Extract<ServerGameCommand, { kind: "submit_offline_run" }>): string =>
  createHash("sha256")
    .update(
      canonicalStringify({
        runId: command.runId,
        buildId: command.buildId,
        rulesVersion: command.rulesVersion,
        seed: command.seed,
        inputJournal: command.inputJournal,
      }),
    )
    .digest("hex");

export class AuthoritativeRulesEngine implements GameRulesEngine {
  private readonly publicKey;

  constructor(
    private readonly evidence: EvidenceSource,
    publicKeyPem: string,
    private readonly now: () => number = () => Math.floor(Date.now() / 1000),
  ) {
    this.publicKey = createPublicKey(publicKeyPem);
  }

  async apply(state: CanonicalGameState, command: ServerGameCommand, wallet: string): Promise<RulesResult> {
    if (command.kind === "select_equipment") return this.selectEquipment(state, command.itemIds);

    const kind = command.kind === "claim_match_result" ? "match" : "offline_run";
    const evidenceId = command.kind === "claim_match_result" ? command.matchResultId : command.runId;
    const evidence = await this.evidence.get(kind, evidenceId);
    if (!evidence) throw notFound("evidence_not_found", "Server-authoritative result was not found");
    if (!verify(null, Buffer.from(evidence.payloadJson), this.publicKey, Buffer.from(evidence.signature, "base64"))) {
      throw forbidden("invalid_evidence_signature", "Server result signature is invalid");
    }
    const payload = evidencePayloadSchema.parse(JSON.parse(evidence.payloadJson));
    if (payload.wallet.toLowerCase() !== wallet) throw forbidden("evidence_wallet_mismatch", "Result belongs to another wallet");
    if (payload.kind !== kind || payload.evidenceId !== evidenceId) throw badRequest("invalid_evidence", "Evidence binding is invalid");
    if (payload.expiresAt < this.now()) throw conflict("evidence_expired", "Result claim has expired");
    if (command.kind === "submit_offline_run" && payload.inputHash !== inputJournalHash(command)) {
      throw conflict("offline_run_mismatch", "Offline input journal does not match the verified replay");
    }
    return this.applyDelta(state, payload.delta);
  }

  private selectEquipment(state: CanonicalGameState, itemIds: string[]): RulesResult {
    if (itemIds.length > 2) throw badRequest("too_many_equipment_items", "At most two equipment items may be selected");
    const owned = new Set([...state.fineries, ...state.unlocks]);
    for (const itemId of itemIds) {
      if (!owned.has(itemId)) throw forbidden("item_not_owned", `Equipment item ${itemId} is not owned`);
    }
    return {
      state: {
        ...structuredClone(state),
        equipment: { primary: itemIds[0] ?? null, secondary: itemIds[1] ?? null },
      },
      majorMilestone: false,
    };
  }

  private applyDelta(state: CanonicalGameState, delta: ProgressDelta): RulesResult {
    for (const [name, value] of Object.entries(delta)) {
      if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) {
        throw badRequest("invalid_server_delta", `${name} must be a non-negative safe integer`);
      }
    }
    const experience = state.experience + delta.experience;
    // The progression formula is intentionally deterministic and versioned by the evidence issuer.
    const level = Math.max(state.level, Math.floor(Math.sqrt(experience / 100)) + 1);
    return {
      state: {
        ...structuredClone(state),
        experience,
        level,
        achievements: [...new Set([...state.achievements, ...delta.achievements])].sort(),
        fineries: [...new Set([...state.fineries, ...delta.fineries])].sort(),
        unlocks: [...new Set([...state.unlocks, ...delta.unlocks])].sort(),
        stats: {
          captures: state.stats.captures + delta.captures,
          rescues: state.stats.rescues + delta.rescues,
          matches: state.stats.matches + delta.matches,
        },
      },
      majorMilestone: delta.majorMilestone,
    };
  }
}

const nonnegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const deltaSchema = z
  .object({
    experience: nonnegativeSafeInteger,
    captures: nonnegativeSafeInteger,
    rescues: nonnegativeSafeInteger,
    matches: nonnegativeSafeInteger,
    achievements: z.array(z.string().min(1).max(128)).max(256),
    fineries: z.array(z.string().min(1).max(128)).max(256),
    unlocks: z.array(z.string().min(1).max(128)).max(256),
    majorMilestone: z.boolean(),
  })
  .strict();
const evidencePayloadSchema = z
  .object({
    wallet: z.string(),
    kind: z.enum(["match", "offline_run"]),
    evidenceId: z.string().min(1).max(128),
    delta: deltaSchema,
    inputHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    expiresAt: nonnegativeSafeInteger,
  })
  .strict();
