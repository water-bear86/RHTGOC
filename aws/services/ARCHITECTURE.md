# Soulbound Scroll service architecture gate

The services module implements the backend boundary for **Sherwood, the game (on robinhood chain)**. Its public HTTP contract is intentionally independent of the game client implementation.

## Layers

1. **HTTP boundary** parses API Gateway requests, enforces JSON/content limits, applies strict schemas, maps typed errors, and emits structured audit records.
2. **Wallet authentication** issues short-lived one-time nonces, verifies EIP-712 `ScrollSession` signatures against the route wallet and chain/domain, atomically consumes the nonce, and creates a hashed opaque session token.
3. **Application services** authorize ownership, translate route DTOs to server command names, and enforce idempotency/expected-version checks.
4. **State-core port** is the only route to canonicalization, Merkle proofs and game-rule application. The AWS layer never accepts achievement, finery, inventory, experience or equipment grants as authoritative client input.
5. **Persistence ports** expose transactional current-state/amendment/idempotency storage, immutable snapshots, and FIFO publishing. AWS adapters contain SDK-specific code; memory adapters support deterministic tests.
6. **Chain services** verify mint receipts and the exact 50/50 `$ROBIN` transfer split, submit signed checkpoints, poll confirmations, replace stuck transactions within spending limits, and reconcile roots against the contract.

## Required route semantics

| Route | Authentication | Behavior |
|---|---|---|
| `POST /players/register` | EIP-712 challenge/session | Idempotently creates a player shell; never creates a Scroll |
| `POST /players/{wallet}/mint-intent` | wallet session | Returns contract/chain/payment intent data; does not custody payment |
| `POST /players/{wallet}/state` | wallet session | Accepts one allow-listed game command, command ID and expected version |
| `GET /players/{wallet}/state` | wallet session | Returns detailed current state and checkpoint status |
| `GET /players/{wallet}/summary` | public | Returns the current progression summary and an explicit checkpoint-verification flag |
| `GET /players/{wallet}/proof` | public | Returns one member/hash proof and an explicit verification flag; never canonical JSON |
| `POST /checkpoints/flush` | wallet session or internal sweep | Enqueues the newest dirty version; it never sends a chain transaction inline |
| `GET /scrolls/{tokenId}/metadata` | public | Returns standards-compatible metadata; dirty state exposes only the last verified checkpoint fields |

Additional authentication routes are `POST /auth/challenge` and `POST /auth/session`. Challenge transport is `{ wallet, chainId } -> { challengeId, typedData, expiresAt }`; session transport is `{ wallet, challengeId, signature } -> { accessToken, expiresAt }`. Only a SHA-256 hash of the access token is stored.

## State command envelope

```ts
interface StateCommandRequest {
  mutationId: string;      // caller-generated idempotency key
  expectedVersion: number; // optimistic concurrency token
  mutation: {
    kind: "claim_match_result" | "select_equipment" | "submit_offline_run";
    payload: unknown;
  };
}
```

The service derives all XP, achievements, finery unlocks and inventory changes from server-authored, Ed25519-signed evidence records. The canonicalization/Merkle state-core package does not decide awards. Unknown keys are rejected.

## Checkpoint state machine

`idle -> pending -> queued -> submitting -> submitted -> confirmed`

Failure edges are `queued/submitting/submitted -> retrying -> queued` and, after the configured attempt budget, `-> failed`. A later accepted state can supersede any pre-submission version. A submitted transaction is always reconciled even if a newer version exists.

## Failure behavior

- Conditional-write failure maps to `409 stale_version`; the current version is returned.
- Duplicate command ID returns the original result without applying rules again.
- RPC/network/rate-limit/5xx responses are retryable and preserve queue visibility semantics.
- Invalid signatures, used/expired nonces, wallet mismatch, malformed receipts and payment split mismatch fail permanently.
- Ranked multiplayer verification returns `verified`, `quarantine`, or `unavailable`; only `verified` state may supply canonical equipment/unlocks.
