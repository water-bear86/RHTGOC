import { describe, expect, it } from "vitest";
import { Wallet } from "ethers";
import { MemoryPersistence } from "./adapters/memory.js";
import { WalletAuthService } from "./auth.js";

describe("WalletAuthService", () => {
  it("verifies EIP-712 and makes a nonce single-use", async () => {
    const wallet = Wallet.createRandom();
    const persistence = new MemoryPersistence();
    const clock = { now: () => 1_700_000_000 };
    const service = new WalletAuthService(persistence, clock, {
      chainId: 1,
      verifyingContract: "0x0000000000000000000000000000000000000002",
      domainName: "Sherwood, the game (on robinhood chain)",
      domainVersion: "1",
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    });
    const challenge = await service.challenge(wallet.address, 1);
    const signature = await wallet.signTypedData(
      challenge.typedData.domain,
      challenge.typedData.types,
      challenge.typedData.message,
    );
    const session = await service.createSession(wallet.address, challenge.challengeId, signature);
    await expect(service.authenticate(wallet.address, `Bearer ${session.accessToken}`)).resolves.toBe(wallet.address.toLowerCase());
    await expect(service.createSession(wallet.address, challenge.challengeId, signature)).rejects.toMatchObject({ code: "invalid_nonce" });
  });

  it("consumes a challenge even when its signature is invalid", async () => {
    const wallet = Wallet.createRandom();
    const persistence = new MemoryPersistence();
    const service = new WalletAuthService(persistence, { now: () => 10 }, {
      chainId: 1,
      verifyingContract: "0x0000000000000000000000000000000000000002",
      domainName: "Sherwood, the game (on robinhood chain)",
      domainVersion: "1",
      challengeTtlSeconds: 300,
      sessionTtlSeconds: 3600,
    });
    const challenge = await service.challenge(wallet.address, 1);
    await expect(service.createSession(wallet.address, challenge.challengeId, "0xdead")).rejects.toMatchObject({ code: "invalid_signature" });
    await expect(service.createSession(wallet.address, challenge.challengeId, "0xdead")).rejects.toMatchObject({ code: "invalid_nonce" });
  });
});
