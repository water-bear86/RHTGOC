# Scroll state and persistence schemas

## Canonical state

The server validates a strict versioned schema and constructs the canonical projection itself. Clients never submit this complete document as authority.

```json
{
  "wallet": "0x0000000000000000000000000000000000000000",
  "scrollTokenId": "123",
  "schemaVersion": 1,
  "stateVersion": 42,
  "level": 14,
  "experience": 18250,
  "achievements": ["sherwood_defender", "tax_collector"],
  "fineries": ["greenhood_v2", "ironwood_bow"],
  "equipment": {"primary": "ironwood_bow", "secondary": "buckler"},
  "unlocks": ["mission:royal_storehouse"],
  "stats": {"captures": 12, "matches": 21, "rescues": 8}
}
```

Rules:

1. EVM addresses are validated and lowercased.
2. All integer fields are non-negative safe integers; token and chain quantities use decimal strings when they may exceed JavaScript's safe range.
3. Set-like arrays are unique and sorted by UTF-8 byte order.
4. Object keys are serialized in lexicographic order.
5. `updatedAt`, request IDs, trace IDs, queue timestamps, and retry metadata are operational fields and are excluded.
6. `canonicalHash = keccak256(UTF8(canonicalJson))`.

## Merkle commitment

Leaves are domain-separated, ABI-encoded, double-keccak hashes. The tree sorts leaves and pairs by their 32-byte hash. It contains one `state` leaf for `canonicalHash`, then leaves for every achievement, finery, equipment slot, and unlock. Thus the root commits to the complete canonical document while allowing membership proofs.

```text
payloadHash = keccak256(category-specific canonical payload)
inner = keccak256(abi.encode(domainHash, wallet, scrollTokenId, stateVersion, payloadHash))
leaf = keccak256(bytes.concat(inner))
parent = keccak256(sort(bytes32(left), bytes32(right)))
```

The versioned domains are `robinhood.scroll.{state|achievement|finery|equipment|unlock}.v1`. The state payload is the canonical hash; item payloads are the identifier hash; equipment payloads hash canonical `{itemId, slot}` JSON. An odd final node is promoted unchanged. Duplicate semantic leaf hashes are rejected.

## DynamoDB single-table layout

| PK | SK | Purpose |
| --- | --- | --- |
| `PLAYER#<wallet>` | `STATE` | Current canonical document, hashes, version, dirty/checkpoint status. |
| `PLAYER#<wallet>` | `AMEND#<20-digit-version>#<uuid>` | Immutable command, before/after roots, evidence ID and acceptance time. |
| `PLAYER#<wallet>` | `IDEMP#<uuid>` | Idempotent result with bounded TTL. |
| `CHECKPOINT#<wallet>` | `VERSION#<20-digit-version>` | Per-version submission lease. |
| `AUTH#<wallet>` | `NONCE#<random-nonce>` | Single-use EIP-712 challenge with TTL. |
| `AUTH#<wallet>` | `SESSION#<sha256-token>` | Short-lived session; plaintext bearer tokens are never stored. |
| `SCROLL#<tokenId>` | `PLAYER` | Token-to-wallet mapping and verified mint transaction. |
| `TX#<txHash>` | `CHECKPOINT` | Submission, replacement and confirmation state. |
| `EVIDENCE_CLAIM#<kind>#<evidenceId>` | `CLAIM` | Global single-use guard for signed match/offline evidence. |
| `RELAYER_SPEND#<UTC-date>` | `DAILY` | Atomic sponsored-gas total with TTL. |

`STATE` writes use `TransactWriteItems` with `stateVersion = expectedVersion`, a missing mutation key, and a missing amendment key. The checkpoint due-time GSI contains dirty state only. A token GSI resolves metadata by Scroll token ID.

## Immutable S3 snapshots

```text
players/<lowercase-wallet>/v<stateVersion>/<stateRoot>.json
```

The bucket enables versioning, KMS encryption, public-access blocking, a 365-day
governance-mode Object Lock default, and lifecycle archival. Each write uses an SHA-256
transport checksum and `If-None-Match: *`. The service writes the root-addressed
snapshot before committing the DynamoDB projection; a failed conditional transaction
can leave only an unreachable immutable duplicate, never a false current state.

## API error contract

Errors are bounded JSON objects: `code`, `message`, `requestId`, and optional `currentVersion`. No stack trace, RPC payload, signature, secret, or private state enters a client response or structured log.
