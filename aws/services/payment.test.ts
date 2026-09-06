import { describe, expect, it } from "vitest";
import { Interface, zeroPadValue, toBeHex } from "ethers";
import { MintPaymentVerifier } from "./payment.js";
import type { ChainReceipt } from "./ports.js";

const scrollAddress = "0x0000000000000000000000000000000000000002";
const robinAddress = "0x0000000000000000000000000000000000000003";
const upkeep = "0x0000000000000000000000000000000000000004";
const dead = "0x000000000000000000000000000000000000dEaD";
const wallet = "0x0000000000000000000000000000000000000010";
const scroll = new Interface([
  "event ScrollMinted(uint256 indexed tokenId,address indexed owner,uint256 robinPaid)",
  "event ScrollPaymentSplit(uint256 indexed tokenId,address indexed buyer,uint256 totalPaid,uint256 upkeepAmount,uint256 burnedAmount)",
]);
const token = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);

const log = (address: string, encoded: ReturnType<Interface["encodeEventLog"]>) => ({
  address,
  topics: encoded.topics,
  data: encoded.data,
});

const receipt = (burnAmount = 50n): ChainReceipt => ({
  hash: `0x${"ab".repeat(32)}`,
  status: "success",
  confirmations: 12,
  logs: [
    log(scrollAddress, scroll.encodeEventLog("ScrollMinted", [1n, wallet, 100n])),
    log(scrollAddress, scroll.encodeEventLog("ScrollPaymentSplit", [1n, wallet, 100n, 50n, 50n])),
    log(robinAddress, token.encodeEventLog("Transfer", [wallet, upkeep, 50n])),
    log(robinAddress, token.encodeEventLog("Transfer", [wallet, dead, burnAmount])),
  ],
});

describe("MintPaymentVerifier", () => {
  const verifier = new MintPaymentVerifier({
    scrollContractAddress: scrollAddress,
    robinTokenAddress: robinAddress,
    upkeepAddress: upkeep,
    deadAddress: dead,
  });

  it("accepts the exact 50/50 upkeep and dead-address transfer", () => {
    expect(verifier.verify(receipt(), wallet)).toEqual({ tokenId: "1", paid: 100n });
  });

  it("rejects a payment that did not reach the verified dead address", () => {
    expect(() => verifier.verify(receipt(49n), wallet)).toThrowError(/50\/50/);
  });
});
