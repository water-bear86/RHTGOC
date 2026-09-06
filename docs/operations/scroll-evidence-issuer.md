# Scroll progression evidence issuer

The Soulbound Scroll's AWS backend never trusts a client's claim of what it
earned. It advances a player's progression only when the game's own
authoritative room server has signed an *evidence record* with an Ed25519 key
whose public half the backend holds. This document describes the game-server
half of that contract (`server/scroll-evidence.ts`) and the steps to turn it on.

## What the server does

When a mission completes and the room server produces its authoritative
`VerifiedRun` list (`Room.claimVerifiedRuns()`), the issuer, for each
authenticated player that presented a wallet:

1. derives a progression delta from the run (`deriveScrollDelta`) — experience
   uses the same per-deed values as the client-facing Scroll (`shared/scroll-record.ts`)
   so the number the player sees in-game and the number the backend banks agree;
2. builds a payload `{ wallet, kind: "match", evidenceId, delta, expiresAt }`
   with a deterministic, single-use `evidenceId = sha256("match:<missionId>:<wallet>")`;
3. signs the payload JSON with Ed25519 and hands `{ payloadJson, signature }` to
   an **evidence sink**.

The backend (`aws/services/rules.ts`) later verifies the signature against
`matchReceiptPublicKey`, checks the wallet/kind/evidenceId binding and expiry,
enforces global single-use, and applies the delta. The client only ever sends
`{ kind: "claim_match_result", matchResultId: <evidenceId> }` — it carries no
rewards itself.

`server/scroll-evidence.test.ts` proves the signed record verifies and parses
against a byte-for-byte copy of the backend's own schema and verify call, so a
drift on either side fails a test rather than production.

## It is inert until configured

With no `SCROLL_EVIDENCE_SIGNING_KEY`, the issuer reports `enabled === false`
and produces nothing. This is the safe default and is why the code can ship
before the Scroll backend exists: no key, no evidence, no behaviour change.

## Turning it on (deployment)

1. **Generate a keypair** (never commit either half):

   ```bash
   openssl genpkey -algorithm ed25519 -out scroll-evidence.key
   openssl pkey -in scroll-evidence.key -pubout -out scroll-evidence.pub
   ```

2. **Private half → the room server** as `SCROLL_EVIDENCE_SIGNING_KEY` (PEM),
   via the Lightsail container secret store — not `.env`, not the image, not a
   `VITE_` variable.

3. **Public half → the AWS backend** as `matchReceiptPublicKey`
   (`docs/scroll/ENVIRONMENT.md`).

4. **Wire a concrete evidence sink.** The default `InertEvidenceSink` delivers
   nowhere. A real deployment needs the signed record to reach the backend's
   evidence store — either a DynamoDB `PutItem` to
   `EVIDENCE#MATCH#<evidenceId>` / `sk = RESULT` with `payload = { payloadJson, signature }`,
   or an authenticated POST to an ingestion endpoint the backend exposes. Pass
   the sink into `createScrollEvidenceIssuer({ signingKeyPem, sink })`.

## Still open before rewards are live

- **The sink.** No delivery path exists yet (the backend currently exposes no
  evidence-ingestion route). This is the last integration step.
- **The client bridge.** The in-game Scroll (`src/scroll-controller.ts`) is
  built against a narrow `ScrollBackend` port; a shim adapting it to the
  deployed Scroll adapter's `saveProgress(wallet, { kind: "claim_match_result", … })`
  is needed so the client actually claims the evidence this server issues.
- **Cumulative achievements.** The per-mission delta grants no achievements or
  fineries by design; awarding cumulative-threshold achievements from banked
  stats is a backend concern for a later pass.
- **Key isolation.** Keep the evidence signing key distinct from the checkpoint
  signer and relayer keys, per the Scroll threat model.
