import type {
  CanonicalPlayerState,
  EvmAddress,
  RuntimeSchema,
  SchemaFailure,
  SchemaSuccess,
  Uint256Input,
} from "./types.js";
import { StateValidationError } from "./types.js";

export const SUPPORTED_SCHEMA_VERSION = 1 as const;

export const NONDETERMINISTIC_STATE_FIELDS = [
  "createdAt",
  "updatedAt",
  "lastSavedAt",
  "lastCheckpointAt",
] as const;

const CANONICAL_FIELDS = [
  "wallet",
  "scrollTokenId",
  "schemaVersion",
  "stateVersion",
  "level",
  "experience",
  "achievements",
  "fineries",
  "equipment",
  "unlocks",
  "stats",
] as const;

export const PLAYER_STATE_FIELDS = [
  ...CANONICAL_FIELDS,
  ...NONDETERMINISTIC_STATE_FIELDS,
] as const;

const ALLOWED_FIELDS = new Set<string>(PLAYER_STATE_FIELDS);
const IDENTIFIER_PATTERN = /^[\x21-\x7e]{1,128}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const UINT256_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_UINT256 = (1n << 256n) - 1n;
const UNSAFE_MAP_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function fail(path: string, message: string): never {
  throw new StateValidationError(path, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function assertClosedObject(value: unknown): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    fail("state", "must be a plain object");
  }
  for (const key of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(key)) {
      fail(`state.${key}`, "unknown field");
    }
  }
  for (const field of CANONICAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      fail(`state.${field}`, "required field is missing");
    }
  }
}

export function normalizeWallet(value: unknown, path = "state.wallet"): EvmAddress {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    return fail(path, "must be a 20-byte 0x-prefixed EVM address");
  }
  return value.toLowerCase() as EvmAddress;
}

export function normalizeUint256(
  value: Uint256Input | unknown,
  path = "state.scrollTokenId",
): string {
  let parsed: bigint;
  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      return fail(path, "must be a non-negative safe integer");
    }
    parsed = BigInt(value);
  } else if (typeof value === "string" && UINT256_PATTERN.test(value)) {
    parsed = BigInt(value);
  } else {
    return fail(path, "must be an unsigned decimal string, safe integer, or bigint");
  }

  if (parsed < 0n || parsed > MAX_UINT256) {
    return fail(path, "must fit uint256");
  }
  return parsed.toString(10);
}

function parseSafeInteger(
  value: unknown,
  path: string,
  minimum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    return fail(path, `must be a safe integer greater than or equal to ${minimum}`);
  }
  return value as number;
}

export function validateIdentifier(value: unknown, path: string): string {
  if (typeof value !== "string" || !IDENTIFIER_PATTERN.test(value)) {
    return fail(path, "must be 1-128 printable non-space ASCII characters");
  }
  return value;
}

function parseSet(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    return fail(path, "must be an array");
  }
  const seen = new Set<string>();
  const parsed = value.map((entry, index) => {
    const identifier = validateIdentifier(entry, `${path}[${index}]`);
    if (seen.has(identifier)) {
      return fail(`${path}[${index}]`, `duplicate identifier ${JSON.stringify(identifier)}`);
    }
    seen.add(identifier);
    return identifier;
  });
  return parsed.sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseEquipment(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) {
    return fail("state.equipment", "must be a plain object");
  }
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of Object.keys(value).sort(compareStrings)) {
    validateMapKey(key, `state.equipment.${key}`);
    result[key] = validateIdentifier(value[key], `state.equipment.${key}`);
  }
  return result;
}

function parseStats(value: unknown): Readonly<Record<string, number>> {
  if (!isRecord(value)) {
    return fail("state.stats", "must be a plain object");
  }
  const result: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const key of Object.keys(value).sort(compareStrings)) {
    validateMapKey(key, `state.stats.${key}`);
    result[key] = parseSafeInteger(value[key], `state.stats.${key}`, 0);
  }
  return result;
}

function validateMapKey(key: string, path: string): void {
  validateIdentifier(key, path);
  if (UNSAFE_MAP_KEYS.has(key)) {
    fail(path, "unsafe map key");
  }
}

function validateIgnoredTimestamps(value: Record<string, unknown>): void {
  for (const field of NONDETERMINISTIC_STATE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      continue;
    }
    const timestamp = value[field] as unknown;
    if (
      timestamp !== null &&
      typeof timestamp !== "string" &&
      !(typeof timestamp === "number" && Number.isFinite(timestamp))
    ) {
      fail(`state.${field}`, "must be a string, finite number, or null when present");
    }
  }
}

export function parsePlayerState(value: unknown): CanonicalPlayerState {
  assertClosedObject(value);
  validateIgnoredTimestamps(value);

  const schemaVersion = parseSafeInteger(value.schemaVersion, "state.schemaVersion", 1);
  if (schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    fail(
      "state.schemaVersion",
      `unsupported schema version ${schemaVersion}; expected ${SUPPORTED_SCHEMA_VERSION}`,
    );
  }

  return {
    wallet: normalizeWallet(value.wallet),
    scrollTokenId: normalizeUint256(value.scrollTokenId),
    schemaVersion,
    stateVersion: parseSafeInteger(value.stateVersion, "state.stateVersion", 0),
    level: parseSafeInteger(value.level, "state.level", 0),
    experience: parseSafeInteger(value.experience, "state.experience", 0),
    achievements: parseSet(value.achievements, "state.achievements"),
    fineries: parseSet(value.fineries, "state.fineries"),
    equipment: parseEquipment(value.equipment),
    unlocks: parseSet(value.unlocks, "state.unlocks"),
    stats: parseStats(value.stats),
  };
}

function safeParse(value: unknown): SchemaSuccess<CanonicalPlayerState> | SchemaFailure {
  try {
    return { success: true, data: parsePlayerState(value) };
  } catch (error) {
    if (error instanceof StateValidationError) {
      return { success: false, error };
    }
    throw error;
  }
}

export const playerStateSchema: RuntimeSchema<CanonicalPlayerState> = {
  parse: parsePlayerState,
  safeParse,
};
