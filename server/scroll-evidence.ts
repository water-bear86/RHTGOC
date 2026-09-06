import { createPrivateKey, createHash, sign as edSign } from "node:crypto"
import { experienceForDeed, type ScrollGrade } from "../shared/scroll-record"
import type { VerifiedRun } from "./leaderboard-store"

/**
 * Server-side issuer of signed progression evidence for the Soulbound Scroll.
 *
 * The Scroll's AWS backend never trusts a client's claim of what it earned. It
 * accepts progression only when the game's own authoritative server has signed
 * an evidence record with an Ed25519 key whose public half the backend holds
 * (`matchReceiptPublicKey`). This module is that signer: it turns a completed,
 * server-validated mission run into exactly the record the backend verifies.
 *
 * It is deliberately inert unless a signing key is configured, so it is safe to
 * ship before the backend exists — no key, no evidence, no behaviour change.
 *
 * The wire contract MUST match `aws/services/rules.ts` on the backend:
 *   - the signature is Ed25519 over the raw UTF-8 bytes of `payloadJson`;
 *   - `payloadJson` parses to { wallet, kind, evidenceId, delta, inputHash?, expiresAt };
 *   - the record stored/delivered is { payloadJson, signature } with signature base64.
 * The compatibility test asserts this against a copy of the backend's own schema
 * and verify call, so a drift on either side fails a test rather than production.
 */

/** The progression delta shape the backend applies. Field-for-field with `ProgressDelta` there. */
export interface ScrollProgressDelta {
  experience: number
  captures: number
  rescues: number
  matches: number
  achievements: string[]
  fineries: string[]
  unlocks: string[]
  majorMilestone: boolean
}

export interface ScrollEvidencePayload {
  wallet: string
  kind: "match"
  evidenceId: string
  delta: ScrollProgressDelta
  expiresAt: number
}

export interface SignedEvidenceRecord {
  payloadJson: string
  signature: string
}

export interface ScrollEvidence {
  evidenceId: string
  wallet: string
  record: SignedEvidenceRecord
}

/**
 * Derive the authoritative progression delta for one player's completed run.
 *
 * Experience reuses the same per-deed values as the client-facing Scroll model
 * (`shared/scroll-record.ts`) so the provisional number the player sees in the
 * game and the authoritative number the backend banks agree. Achievements and
 * fineries are intentionally empty here: they are cumulative-threshold awards
 * the backend can derive from banked stats, never granted per mission by the
 * client's request, and never invented by this issuer.
 */
export function deriveScrollDelta(run: VerifiedRun): ScrollProgressDelta {
  const grade = run.result.grade as ScrollGrade
  const rescues = Math.max(0, Math.floor(run.rescues))
  const delivered = Math.max(0, Math.floor(run.delivered))
  const experience =
    experienceForDeed({ id: "m", kind: "mission-completed", at: 0, grade }) +
    experienceForDeed({ id: "c", kind: "coin-returned", at: 0, amount: delivered }) +
    experienceForDeed({ id: "r", kind: "ally-rescued", at: 0, amount: rescues }) +
    (run.cleanEscape ? experienceForDeed({ id: "e", kind: "clean-escape", at: 0 }) : 0)
  return {
    experience,
    captures: 0,
    rescues,
    matches: 1,
    achievements: [],
    fineries: [],
    unlocks: [],
    // Accelerate the next on-chain checkpoint after a standout run, matching the
    // backend's CHECKPOINT_ON_MAJOR_ACHIEVEMENT contract.
    majorMilestone: grade === "S" || grade === "A",
  }
}

/**
 * Deterministic, single-use evidence id for a (mission, wallet) pair. The
 * backend enforces global single-use, so re-delivering the same id after a
 * transient failure is idempotent rather than double-crediting.
 */
export function evidenceIdFor(missionId: string, wallet: string): string {
  return createHash("sha256").update(`match:${missionId}:${wallet.toLowerCase()}`).digest("hex")
}

export function buildEvidencePayload(options: {
  wallet: string
  run: VerifiedRun
  ttlSeconds: number
  now: number
}): ScrollEvidencePayload {
  const wallet = options.wallet.toLowerCase()
  return {
    wallet,
    kind: "match",
    evidenceId: evidenceIdFor(options.run.missionId, wallet),
    delta: deriveScrollDelta(options.run),
    expiresAt: Math.floor(options.now / 1000) + options.ttlSeconds,
  }
}

export function signEvidencePayload(payload: ScrollEvidencePayload, privateKeyPem: string): SignedEvidenceRecord {
  const key = createPrivateKey(privateKeyPem)
  const payloadJson = JSON.stringify(payload)
  const signature = edSign(null, Buffer.from(payloadJson, "utf8"), key).toString("base64")
  return { payloadJson, signature }
}

/** Where signed evidence is delivered so the backend can read it back. */
export interface EvidenceSink {
  deliver(evidence: ScrollEvidence): Promise<void>
}

/**
 * The default sink: does not deliver anywhere. Used until a concrete sink (a
 * DynamoDB writer, or an authenticated POST to an ingestion endpoint) is wired
 * at deployment. It records that evidence was produced without depending on any
 * cloud resource, so the issuer is exercisable and safe in every environment.
 */
export class InertEvidenceSink implements EvidenceSink {
  readonly delivered: ScrollEvidence[] = []
  constructor(private readonly onDeliver?: (evidence: ScrollEvidence) => void) {}
  async deliver(evidence: ScrollEvidence): Promise<void> {
    this.delivered.push(evidence)
    this.onDeliver?.(evidence)
  }
}

/**
 * The production default when no concrete sink is configured: evidence is
 * signed but not stored anywhere, so the issuer never accumulates an unbounded
 * in-memory backlog over the server's lifetime. A real deployment MUST supply a
 * durable sink; without one the issuer produces nothing to bank, by design.
 */
export class DiscardingEvidenceSink implements EvidenceSink {
  async deliver(): Promise<void> {}
}

export interface ScrollEvidenceIssuerConfig {
  /** PEM-encoded Ed25519 private key. Absent → the issuer is disabled and inert. */
  signingKeyPem?: string | undefined
  /** Seconds a claim stays valid. Defaults to one hour. */
  ttlSeconds?: number
  sink?: EvidenceSink
  now?: () => number
}

export interface ScrollEvidenceIssuer {
  readonly enabled: boolean
  /**
   * Sign and deliver evidence for one authoritative run. Resolves to the
   * evidence when issued, or null when the issuer is disabled or the run has no
   * wallet to credit. Rejects if delivery fails, so the (detached) caller can
   * report it; because the caller invokes this without awaiting, a failure is
   * logged but never blocks or fails the mission for the player.
   */
  issue(wallet: string | null | undefined, run: VerifiedRun): Promise<ScrollEvidence | null>
}


export function createScrollEvidenceIssuer(config: ScrollEvidenceIssuerConfig): ScrollEvidenceIssuer {
  const signingKeyPem = config.signingKeyPem?.trim()
  const enabled = Boolean(signingKeyPem)
  const ttlSeconds = config.ttlSeconds ?? 3_600
  const sink = config.sink ?? new DiscardingEvidenceSink()
  const now = config.now ?? (() => Date.now())

  return {
    enabled,
    async issue(wallet, run) {
      if (!enabled || !signingKeyPem) return null
      const normalized = typeof wallet === "string" ? wallet.trim().toLowerCase() : ""
      if (!/^0x[0-9a-f]{40}$/.test(normalized)) return null
      const payload = buildEvidencePayload({ wallet: normalized, run, ttlSeconds, now: now() })
      const record = signEvidencePayload(payload, signingKeyPem)
      const evidence: ScrollEvidence = { evidenceId: payload.evidenceId, wallet: normalized, record }
      // Let a delivery failure reject: the sole caller invokes issue() detached
      // (`void issue(...).catch(...)`), so the failure is logged as
      // scroll_evidence_failed without ever blocking or failing the mission.
      // Swallowing it here would drop signed progression with no signal.
      await sink.deliver(evidence)
      return evidence
    },
  }
}
