import { describe, expect, it } from "vitest"
import { generateKeyPairSync, verify as edVerify } from "node:crypto"
import { z } from "zod"
import type { MissionResult } from "../shared/protocol"
import type { VerifiedRun } from "./leaderboard-store"
import {
  buildEvidencePayload,
  createScrollEvidenceIssuer,
  deriveScrollDelta,
  evidenceIdFor,
  InertEvidenceSink,
  signEvidencePayload,
} from "./scroll-evidence"

/**
 * A byte-for-byte copy of the acceptance rule from the Scroll backend
 * (aws/services/rules.ts). If the backend's schema or verify step changes, or
 * this issuer drifts from it, this test fails instead of production. It is the
 * contract seam between the game server and the AWS rules engine.
 */
const nonnegativeSafeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const backendDeltaSchema = z
  .object({
    experience: nonnegativeSafeInteger,
    captures: nonnegativeSafeInteger,
    rescues: nonnegativeSafeInteger,
    matches: nonnegativeSafeInteger,
    achievements: z.array(z.string().min(1).max(128)).max(256),
    fineries: z.array(z.string().min(1).max(128)).max(256),
    unlocks: z.array(z.string().min(1).max(128)).max(256),
    majorMilestone: z.boolean(),
  })
  .strict()
const backendEvidencePayloadSchema = z
  .object({
    wallet: z.string(),
    kind: z.enum(["match", "offline_run"]),
    evidenceId: z.string().min(1).max(128),
    delta: backendDeltaSchema,
    inputHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    expiresAt: nonnegativeSafeInteger,
  })
  .strict()

/** The backend accepts a record iff the signature verifies AND the payload parses. */
function backendAccepts(record: { payloadJson: string; signature: string }, publicKeyPem: string): boolean {
  if (!edVerify(null, Buffer.from(record.payloadJson, "utf8"), publicKeyPem, Buffer.from(record.signature, "base64"))) {
    return false
  }
  return backendEvidencePayloadSchema.safeParse(JSON.parse(record.payloadJson)).success
}

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  return {
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  }
}

function run(overrides: Partial<VerifiedRun> = {}): VerifiedRun {
  const result: MissionResult = {
    score: 8_800,
    grade: "S",
    breakdown: { speed: 90, stealth: 80, precision: 88, survival: 76, rescues: 40, generosity: 70 },
    thresholds: { S: 9000, A: 7500, B: 6000, C: 0 },
    communityCoin: 1_400,
    personalRenown: 300,
  }
  return {
    missionId: "mission-abc",
    playerId: "player-1",
    authUserId: "00000000-0000-0000-0000-000000000001",
    characterId: "robin",
    partySize: 3,
    missionSeconds: 220,
    delivered: 1_400,
    rescues: 2,
    damageTaken: 1,
    missionVersion: "v1",
    missionContentHash: "hash",
    missionSlug: "peoples-purse",
    seasonSlug: "season-zero",
    missionStartedAt: 1_700_000_000_000,
    cleanEscape: true,
    result,
    ...overrides,
  }
}

const WALLET = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"

describe("delta derivation", () => {
  it("banks one match with non-negative integer counters", () => {
    const delta = deriveScrollDelta(run())
    expect(delta.matches).toBe(1)
    expect(delta.rescues).toBe(2)
    expect(delta.experience).toBeGreaterThan(0)
    expect(Number.isSafeInteger(delta.experience)).toBe(true)
    for (const value of [delta.experience, delta.captures, delta.rescues, delta.matches]) {
      expect(value).toBeGreaterThanOrEqual(0)
    }
  })

  it("never grants achievements, fineries, or unlocks from a single run", () => {
    const delta = deriveScrollDelta(run({ result: { ...run().result, grade: "S" } }))
    expect(delta.achievements).toEqual([])
    expect(delta.fineries).toEqual([])
    expect(delta.unlocks).toEqual([])
  })

  it("flags a standout run as a major milestone, a middling one not", () => {
    expect(deriveScrollDelta(run({ result: { ...run().result, grade: "S" } })).majorMilestone).toBe(true)
    expect(deriveScrollDelta(run({ result: { ...run().result, grade: "A" } })).majorMilestone).toBe(true)
    expect(deriveScrollDelta(run({ result: { ...run().result, grade: "B" } })).majorMilestone).toBe(false)
  })

  it("rewards a clean escape over a messy one", () => {
    const clean = deriveScrollDelta(run({ cleanEscape: true }))
    const messy = deriveScrollDelta(run({ cleanEscape: false }))
    expect(clean.experience).toBeGreaterThan(messy.experience)
  })

  it("clamps hostile run counters instead of propagating them", () => {
    const delta = deriveScrollDelta(run({ rescues: -5, delivered: -100 }))
    expect(delta.rescues).toBe(0)
    expect(delta.experience).toBeGreaterThanOrEqual(0)
  })
})

describe("evidence id", () => {
  it("is stable per mission and wallet, and case-insensitive on the wallet", () => {
    expect(evidenceIdFor("m1", WALLET)).toBe(evidenceIdFor("m1", WALLET.toUpperCase()))
    expect(evidenceIdFor("m1", WALLET)).not.toBe(evidenceIdFor("m2", WALLET))
  })
})

describe("signed record is accepted by the backend's own rule", () => {
  it("verifies and parses against a copy of the backend schema", () => {
    const { publicPem, privatePem } = keypair()
    const payload = buildEvidencePayload({ wallet: WALLET, run: run(), ttlSeconds: 3_600, now: 1_700_000_000_000 })
    const record = signEvidencePayload(payload, privatePem)
    expect(backendAccepts(record, publicPem)).toBe(true)
  })

  it("is rejected under the wrong public key", () => {
    const signer = keypair()
    const other = keypair()
    const payload = buildEvidencePayload({ wallet: WALLET, run: run(), ttlSeconds: 3_600, now: 1_700_000_000_000 })
    const record = signEvidencePayload(payload, signer.privatePem)
    expect(backendAccepts(record, other.publicPem)).toBe(false)
  })

  it("is rejected if the payload is tampered after signing", () => {
    const { publicPem, privatePem } = keypair()
    const payload = buildEvidencePayload({ wallet: WALLET, run: run(), ttlSeconds: 3_600, now: 1_700_000_000_000 })
    const record = signEvidencePayload(payload, privatePem)
    const forged = { ...record, payloadJson: record.payloadJson.replace(/"experience":\d+/, '"experience":9999999') }
    expect(backendAccepts(forged, publicPem)).toBe(false)
  })

  it("binds the lowercased wallet and a match kind into the payload", () => {
    const payload = buildEvidencePayload({ wallet: WALLET.toUpperCase(), run: run(), ttlSeconds: 3_600, now: 1_700_000_000_000 })
    expect(payload.wallet).toBe(WALLET)
    expect(payload.kind).toBe("match")
    expect(payload.expiresAt).toBe(1_700_000_000 + 3_600)
  })
})

describe("issuer", () => {
  it("is disabled and inert with no signing key", async () => {
    const sink = new InertEvidenceSink()
    const issuer = createScrollEvidenceIssuer({ sink })
    expect(issuer.enabled).toBe(false)
    expect(await issuer.issue(WALLET, run())).toBeNull()
    expect(sink.delivered).toHaveLength(0)
  })

  it("signs and delivers exactly one record for a walleted run", async () => {
    const { publicPem, privatePem } = keypair()
    const sink = new InertEvidenceSink()
    const issuer = createScrollEvidenceIssuer({ signingKeyPem: privatePem, sink, now: () => 1_700_000_000_000 })
    expect(issuer.enabled).toBe(true)
    const evidence = await issuer.issue(WALLET, run())
    expect(evidence).not.toBeNull()
    expect(sink.delivered).toHaveLength(1)
    expect(backendAccepts(sink.delivered[0]!.record, publicPem)).toBe(true)
    expect(sink.delivered[0]!.evidenceId).toBe(evidenceIdFor("mission-abc", WALLET))
  })

  it("skips a run with no bound wallet rather than crediting a guest", async () => {
    const { privatePem } = keypair()
    const sink = new InertEvidenceSink()
    const issuer = createScrollEvidenceIssuer({ signingKeyPem: privatePem, sink })
    expect(await issuer.issue(null, run())).toBeNull()
    expect(await issuer.issue("not-a-wallet", run())).toBeNull()
    expect(sink.delivered).toHaveLength(0)
  })

  it("does not throw into the caller when delivery fails, but still returns the evidence", async () => {
    const { privatePem } = keypair()
    const failing = { deliver: async () => { throw new Error("dynamo down") } }
    const issuer = createScrollEvidenceIssuer({ signingKeyPem: privatePem, sink: failing })
    const evidence = await issuer.issue(WALLET, run())
    expect(evidence).not.toBeNull()
    expect(evidence!.evidenceId).toBeTruthy()
  })
})
