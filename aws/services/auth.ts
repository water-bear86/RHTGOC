import { createHash, randomBytes, randomUUID } from "node:crypto";
import { verifyTypedData } from "ethers";
import type { AuthPersistence, Clock } from "./ports.js";
import { normalizeWallet } from "./wallet.js";
import { unauthorized } from "./errors.js";

const sessionTypes: Record<string, Array<{ name: string; type: string }>> = {
  ScrollSession: [
    { name: "wallet", type: "address" },
    { name: "nonce", type: "string" },
    { name: "issuedAt", type: "uint64" },
    { name: "expiresAt", type: "uint64" },
    { name: "requestId", type: "string" },
  ],
};

export interface WalletAuthConfig {
  chainId: number;
  verifyingContract: string;
  domainName: string;
  domainVersion: string;
  challengeTtlSeconds: number;
  sessionTtlSeconds: number;
}

const tokenHash = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

export class WalletAuthService {
  constructor(
    private readonly persistence: AuthPersistence,
    private readonly clock: Clock,
    private readonly config: WalletAuthConfig,
  ) {}

  async challenge(rawWallet: unknown, requestedChainId: number) {
    const wallet = normalizeWallet(rawWallet);
    if (requestedChainId !== this.config.chainId) throw unauthorized("wrong_chain", "Requested chain does not match the Scroll contract");
    const issuedAt = this.clock.now();
    const challenge = {
      wallet,
      nonce: randomBytes(32).toString("base64url"),
      issuedAt,
      expiresAt: issuedAt + this.config.challengeTtlSeconds,
      requestId: randomUUID(),
    };
    await this.persistence.putChallenge(challenge);
    return {
      challengeId: challenge.nonce,
      expiresAt: new Date(challenge.expiresAt * 1000).toISOString(),
      typedData: this.typedData(challenge),
    };
  }

  async createSession(rawWallet: unknown, challengeId: string, signature: string) {
    const wallet = normalizeWallet(rawWallet);
    // Consume before verification: every challenge is single-use even for an invalid signature.
    const challenge = await this.persistence.consumeChallenge(wallet, challengeId, this.clock.now());
    if (!challenge) throw unauthorized("invalid_nonce", "Nonce is expired, unknown, or already used");

    let recovered: string;
    try {
      recovered = normalizeWallet(verifyTypedData(this.domain(), sessionTypes, challenge, signature));
    } catch {
      throw unauthorized("invalid_signature", "Wallet signature is invalid");
    }
    if (recovered !== wallet) throw unauthorized("wallet_mismatch", "Signature does not match wallet");

    const rawToken = randomBytes(32).toString("base64url");
    const createdAt = this.clock.now();
    const expiresAt = createdAt + this.config.sessionTtlSeconds;
    await this.persistence.putSession({ wallet, tokenHash: tokenHash(rawToken), createdAt, expiresAt });
    return { accessToken: rawToken, expiresAt: new Date(expiresAt * 1000).toISOString() };
  }

  async authenticate(rawWallet: unknown, authorization: string | undefined): Promise<`0x${string}`> {
    const wallet = normalizeWallet(rawWallet);
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,128})$/);
    if (!match?.[1]) throw unauthorized();
    const session = await this.persistence.getSession(wallet, tokenHash(match[1]), this.clock.now());
    if (!session) throw unauthorized("invalid_session", "Session is expired or invalid");
    return wallet;
  }

  private domain() {
    return {
      name: this.config.domainName,
      version: this.config.domainVersion,
      chainId: this.config.chainId,
      verifyingContract: this.config.verifyingContract,
    };
  }

  private typedData(challenge: { wallet: string; nonce: string; issuedAt: number; expiresAt: number; requestId: string }) {
    return { domain: this.domain(), types: sessionTypes, primaryType: "ScrollSession", message: challenge };
  }
}
