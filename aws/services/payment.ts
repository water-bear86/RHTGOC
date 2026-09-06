import { Interface, getAddress } from "ethers";
import { conflict, notFound } from "./errors.js";
import type { ChainReceipt } from "./ports.js";

const scrollEvents = new Interface([
  "event ScrollMinted(uint256 indexed tokenId,address indexed owner,uint256 robinPaid)",
  "event ScrollPaymentSplit(uint256 indexed tokenId,address indexed buyer,uint256 totalPaid,uint256 upkeepAmount,uint256 burnedAmount)",
]);
const erc20Events = new Interface(["event Transfer(address indexed from,address indexed to,uint256 value)"]);

export interface MintVerificationConfig {
  scrollContractAddress: string;
  robinTokenAddress: string;
  upkeepAddress: string;
  deadAddress: string;
}

export interface VerifiedMint {
  tokenId: string;
  paid: bigint;
}

const sameAddress = (left: string, right: string) => getAddress(left) === getAddress(right);

export class MintPaymentVerifier {
  constructor(private readonly config: MintVerificationConfig) {}

  verify(receipt: ChainReceipt, wallet: string): VerifiedMint {
    if (receipt.status === "pending" || receipt.status === "not_found") throw conflict("mint_pending", "Mint is not confirmed yet");
    if (receipt.status !== "success" || !receipt.logs) throw conflict("mint_failed", "Mint transaction reverted");

    let minted: VerifiedMint | null = null;
    let split: { total: bigint; upkeep: bigint; burned: bigint } | null = null;
    let upkeepTransfers = 0n;
    let burnTransfers = 0n;
    for (const log of receipt.logs) {
      if (sameAddress(log.address, this.config.scrollContractAddress)) {
        try {
          const parsed = scrollEvents.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "ScrollMinted" && sameAddress(String(parsed.args.owner), wallet)) {
            minted = { tokenId: String(parsed.args.tokenId), paid: BigInt(parsed.args.robinPaid) };
          }
          if (parsed?.name === "ScrollPaymentSplit" && sameAddress(String(parsed.args.buyer), wallet)) {
            split = {
              total: BigInt(parsed.args.totalPaid),
              upkeep: BigInt(parsed.args.upkeepAmount),
              burned: BigInt(parsed.args.burnedAmount),
            };
          }
        } catch {
          // An unrelated contract event is expected to fail this ABI parser.
        }
      }
      if (sameAddress(log.address, this.config.robinTokenAddress)) {
        try {
          const parsed = erc20Events.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "Transfer" && sameAddress(String(parsed.args.from), wallet)) {
            const value = BigInt(parsed.args.value);
            if (sameAddress(String(parsed.args.to), this.config.upkeepAddress)) upkeepTransfers += value;
            if (sameAddress(String(parsed.args.to), this.config.deadAddress)) burnTransfers += value;
          }
        } catch {
          // Ignore non-Transfer token logs.
        }
      }
    }
    if (!minted || !split) throw notFound("mint_events_missing", "Required mint events were not found");
    if (minted.paid <= 0n || minted.paid % 2n !== 0n || split.total !== minted.paid) {
      throw conflict("payment_split_mismatch", "Mint did not report a positive, even $ROBIN payment");
    }
    const half = minted.paid / 2n;
    if (
      split.upkeep !== half ||
      split.burned !== half ||
      upkeepTransfers !== split.upkeep ||
      burnTransfers !== split.burned
    ) {
      throw conflict("payment_split_mismatch", "Mint did not perform the configured 50/50 $ROBIN split");
    }
    return minted;
  }
}
