import { Contract, JsonRpcProvider, getAddress } from "ethers";
import { describe, expect, it } from "vitest";

const enabled = process.env.RUN_SCROLL_TESTNET_E2E === "1";
const rpcUrl = process.env.ROBINHOOD_TESTNET_RPC_URL ?? "";
const contractAddress = process.env.SCROLL_TESTNET_CONTRACT_ADDRESS ?? "";
const apiBaseUrl = (process.env.SCROLL_TESTNET_API_URL ?? "").replace(/\/$/, "");
const abi = [
  "function burnAddress() view returns (address)",
  "function mintPrice() view returns (uint256)",
  "function minMintPrice() view returns (uint256)",
  "function maxMintPrice() view returns (uint256)",
  "function treasury() view returns (address)",
] as const;

describe.runIf(enabled)("Robinhood Chain testnet read-only smoke", () => {
  it("binds the deployed API and contract to safe testnet economics", async () => {
    if (!rpcUrl || !contractAddress || !apiBaseUrl) {
      throw new Error("ROBINHOOD_TESTNET_RPC_URL, SCROLL_TESTNET_CONTRACT_ADDRESS, and SCROLL_TESTNET_API_URL are required");
    }
    const provider = new JsonRpcProvider(rpcUrl, 46_630, { staticNetwork: true });
    expect((await provider.getNetwork()).chainId).toBe(46_630n);
    expect(await provider.getCode(contractAddress)).not.toBe("0x");

    const scroll = new Contract(contractAddress, abi, provider);
    expect(getAddress(await scroll.getFunction("burnAddress")())).toBe("0x000000000000000000000000000000000000dEaD");
    const [price, minimum, maximum, treasury] = await Promise.all([
      scroll.getFunction("mintPrice")(),
      scroll.getFunction("minMintPrice")(),
      scroll.getFunction("maxMintPrice")(),
      scroll.getFunction("treasury")(),
    ]);
    expect(price % 2n).toBe(0n);
    expect(price).toBeGreaterThanOrEqual(minimum);
    expect(price).toBeLessThanOrEqual(maximum);
    expect(getAddress(treasury)).not.toBe("0x0000000000000000000000000000000000000000");

    const response = await fetch(`${apiBaseUrl}/scrolls/1/metadata`);
    expect([200, 404]).toContain(response.status);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
