import { getAddress, isAddress } from "ethers";
import { badRequest } from "./errors.js";

export type NormalizedWallet = `0x${string}`;

export function normalizeWallet(value: unknown): NormalizedWallet {
  if (typeof value !== "string" || !isAddress(value)) {
    throw badRequest("invalid_wallet", "wallet must be a valid EVM address");
  }
  return getAddress(value).toLowerCase() as NormalizedWallet;
}

export function normalizeHash(value: unknown): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw badRequest("invalid_transaction_hash", "transactionHash must be a 32-byte hex value");
  }
  return value.toLowerCase() as `0x${string}`;
}
