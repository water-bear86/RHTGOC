import { z } from "zod";

const identifier = z.string().trim().min(1).max(128).regex(/^[\x20-\x7e]+$/);
const boundedString = z.string().min(1).max(512);

const matchClaimSchema = z
  .object({ kind: z.literal("claim_match_result"), matchResultId: identifier })
  .strict();

const equipmentSelectionSchema = z
  .object({ kind: z.literal("select_equipment"), itemIds: z.array(identifier).max(16) })
  .strict()
  .refine((value) => new Set(value.itemIds).size === value.itemIds.length, "itemIds must be unique");

const journalEntrySchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    tick: z.number().int().nonnegative(),
    action: identifier,
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

const offlineRunSchema = z
  .object({
    kind: z.literal("submit_offline_run"),
    runId: identifier,
    buildId: identifier,
    rulesVersion: identifier,
    seed: boundedString,
    inputJournal: z.array(journalEntrySchema).max(20_000),
  })
  .strict()
  .refine(
    (value) => value.inputJournal.every((entry, index) => entry.sequence === index),
    "inputJournal sequence must be contiguous and start at zero",
  );

export const stateMutationSchema = z
  .object({
    mutationId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    mutation: z.union([matchClaimSchema, equipmentSelectionSchema, offlineRunSchema]),
  })
  .strict();

export const registerSchema = z.object({ wallet: z.string() }).strict();
export const walletOnlySchema = z.object({ wallet: z.string() }).strict();
export const mintConfirmationSchema = z
  .object({ intentId: z.string().uuid(), transactionHash: z.string() })
  .strict();
export const flushSchema = z.object({ wallet: z.string() }).strict();
export const challengeSchema = z.object({ wallet: z.string(), chainId: z.number().int().positive() }).strict();
export const sessionSchema = z
  .object({ wallet: z.string(), challengeId: z.string().min(32).max(128), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) })
  .strict();

export type StateMutationInput = z.infer<typeof stateMutationSchema>;
