import { keccak_256 } from "@noble/hashes/sha3";
import { utf8ToBytes } from "@noble/hashes/utils";

import { serializeCanonicalState } from "./canonical.js";
import type { CanonicalPlayerState, Hex32, PlayerStateInput } from "./types.js";
import { StateValidationError } from "./types.js";

const HEX_32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
export function bytesToHex(bytes: Uint8Array): Hex32 {
  if (bytes.length !== 32) {
    throw new StateValidationError("bytes", "must contain exactly 32 bytes");
  }
  let encoded = "0x";
  for (const byte of bytes) {
    encoded += byte.toString(16).padStart(2, "0");
  }
  return encoded as Hex32;
}

export function hexToBytes32(value: unknown, path = "hash"): Uint8Array {
  if (typeof value !== "string" || !HEX_32_PATTERN.test(value)) {
    throw new StateValidationError(path, "must be a 32-byte 0x-prefixed hex value");
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < 32; index += 1) {
    bytes[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return bytes;
}

export function keccak256Bytes(value: Uint8Array): Hex32 {
  return bytesToHex(keccak_256(value));
}

export function keccak256Utf8(value: string): Hex32 {
  return keccak256Bytes(utf8ToBytes(value));
}

export function hashCanonicalState(
  input: PlayerStateInput | CanonicalPlayerState | unknown,
): Hex32 {
  return keccak256Utf8(serializeCanonicalState(input));
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
