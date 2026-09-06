# Scroll security model

The contract is the authority for Scroll ownership, payment economics, and the latest
state root. DynamoDB is the authority for detailed current progression. An authoritative
game-result issuer is the only source of positive reward deltas. Browser state is an
optimistic cache and never an authority.

## Enforced invariants

- A wallet can mint only once in its lifetime. Normal ERC-721 transfer and approval
  entry points always revert.
- Mint transfers an even `$ROBIN` price atomically: exactly half to the configured
  treasury and half to `0x000000000000000000000000000000000000dEaD`. Exact balance
  deltas reject fee-on-transfer behavior.
- Sensitive configuration and unpause require a contract-validated, minimum 48-hour
  timelock. A separate guardian can pause only.
- Checkpoints require an authorized EIP-712 signer and a `RELAYER_ROLE` caller. Owner,
  token, chain, contract, version, root, timestamp, award-array hashes, nonce and
  deadline are bound. Versions increase and replayed digests/nonces fail.
- Normal migration requires both current and destination wallet consent. Exceptional
  recovery requires separate recovery-signer and relayer principals.
- API sessions use one-use, expiring EIP-712 challenges. Only SHA-256 session-token
  hashes are stored; sessions are wallet scoped.
- State writes use strict command schemas, server-side evidence/rules, UUID
  idempotency, optimistic version checks, append-only amendments and immutable S3
  snapshots. Evidence IDs are globally single-use.
- Ranked multiplayer fails closed unless the current canonical root/version exactly
  matches both the recorded checkpoint and the live contract.
- Sponsored transactions have per-transaction and atomic daily cost ceilings,
  confirmation depth, bounded replacement attempts, queue retries and DLQs.

## Key custody and administration

The delivered AWS adapter uses two distinct private keys in one Secrets Manager secret
encrypted by KMS. Only checkpoint and reconciliation workers can read it; public API
Lambdas cannot. This satisfies the brief's Secrets Manager option, but a compromise of
either worker can expose both roles. For production hardening, place checkpoint signing
behind an asymmetric KMS signer or a separate signing service and leave only the funded
relayer key in the worker secret. Application spend ceilings do not constrain an attacker
who has extracted the raw relayer key, so the hot wallet must hold only a deliberately
limited balance and use a separately controlled replenishment policy.

Timelock proposer/executor and treasury should be Safes. Guardian, signer, relayer and
recovery roles should be distinct, monitored addresses. Role, price, treasury,
metadata, pause and migration events are security audit inputs.

## Fail-closed behavior

RPC failure preserves accepted AWS state and retries checkpoint work. Dirty or
mismatched state cannot enter ranked multiplayer. Stale writes return `409` with the
current state; the adapter rebases equipment selection only. Mint confirmation requires
depth plus the Scroll and `$ROBIN` event set. A treasury mismatch blocks new mint
intents until the governed contract change and AWS verifier configuration agree.

## Deployment blockers

- Implement and authorize the match/offline evidence issuer in the existing room
  service; no client may write evidence or deltas.
- Implement `WalletMigrated` event consumption and an atomic DynamoDB state-owner move
  before player migration or recovery is enabled.
- Replace all `.invalid` values, validate the real testnet `$ROBIN`, addresses, origins,
  RPC, alarms and budgets, and complete external contract review.
- Run DynamoDB Local integration, testnet smoke/E2E and operational failure drills.

No security audit, test suite, or timelock eliminates privileged-key and governance
risk. See `THREAT_MODEL.md` for attacker stories and severity calibration.
