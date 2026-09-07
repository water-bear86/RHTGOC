import { parsePlayerState } from "./schema.js";
import type { CanonicalPlayerState, PlayerStateInput } from "./types.js";
import { StateValidationError } from "./types.js";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function serialize(value: unknown, path: string, ancestors: Set<object>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new StateValidationError(path, "canonical JSON numbers must be safe integers");
    }
    return Object.is(value, -0) ? "0" : String(value);
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) {
      throw new StateValidationError(path, "canonical JSON cannot contain cycles");
    }
    ancestors.add(value);
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new StateValidationError(`${path}[${index}]`, "sparse arrays are not allowed");
      }
      items.push(serialize(value[index], `${path}[${index}]`, ancestors));
    }
    ancestors.delete(value);
    return `[${items.join(",")}]`;
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new StateValidationError(path, "canonical JSON objects must be plain objects");
    }
    if (ancestors.has(value)) {
      throw new StateValidationError(path, "canonical JSON cannot contain cycles");
    }
    ancestors.add(value);
    const objectValue = value as Record<string, unknown>;
    const entries = Object.keys(objectValue)
      .sort(compareStrings)
      .map((key) => {
        const encoded = serialize(objectValue[key], `${path}.${key}`, ancestors);
        return `${JSON.stringify(key)}:${encoded}`;
      });
    ancestors.delete(value);
    return `{${entries.join(",")}}`;
  }
  throw new StateValidationError(
    path,
    `unsupported canonical JSON value type ${typeof value}`,
  );
}

export function canonicalStringify(value: unknown): string {
  return serialize(value, "$", new Set<object>());
}

export function canonicalizeState(
  input: PlayerStateInput | CanonicalPlayerState | unknown,
): CanonicalPlayerState {
  return parsePlayerState(input);
}

export function serializeCanonicalState(
  input: PlayerStateInput | CanonicalPlayerState | unknown,
): string {
  return canonicalStringify(canonicalizeState(input));
}
