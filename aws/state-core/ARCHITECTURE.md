# Scroll state commitment architecture gate

This package is the deterministic state-commitment boundary for **Sherwood, the game (on robinhood chain)**. It does not accept gameplay mutations or decide whether an award is legitimate. Only the trusted state service may pass already-authorized state into this package.

## Security invariants

1. A commitment is scoped to one lowercased 20-byte EVM wallet, one Scroll token ID, and one monotonically increasing state version.
2. The input schema is closed. Unknown fields are rejected so a newly added gameplay field cannot be silently omitted from a commitment.
3. The explicitly nondeterministic fields `createdAt`, `updatedAt`, `lastSavedAt`, and `lastCheckpointAt` are accepted but never enter canonical JSON or a hash.
4. Set-like arrays reject duplicates and are sorted by Unicode code-unit order before serialization.
5. Equipment and statistic maps reject unsafe keys and are serialized with sorted keys.
6. All hashes use EVM `keccak256`, never NIST SHA-3 or SHA-256.
7. Leaves are domain-separated, bound to wallet/token/version, double-hashed, and combined with sorted-pair hashing compatible with OpenZeppelin `MerkleProof`.
8. The on-chain checkpoint value is `stateRoot` (the Merkle root), not the standalone `stateHash`.

## Validated state projection

The accepted state has these canonical fields:

```typescript
interface CanonicalPlayerState {
  wallet: `0x${string}`;              // exactly 20 bytes, lowercase
  scrollTokenId: string;              // normalized unsigned uint256 decimal
  schemaVersion: number;              // supported value is currently exactly 1
  stateVersion: number;               // non-negative safe integer
  level: number;                      // non-negative safe integer
  experience: number;                 // non-negative safe integer
  achievements: string[];             // sorted set
  fineries: string[];                 // sorted set
  equipment: Record<string, string>;  // sorted slot keys
  unlocks: string[];                  // sorted set
  stats: Record<string, number>;      // sorted keys, non-negative safe integers
}
```

Identifiers are non-empty printable ASCII strings of at most 128 characters. Map keys may not be `__proto__`, `constructor`, or `prototype`. `scrollTokenId` accepts an unsigned decimal string, safe integer, or bigint at the API boundary and is normalized to a base-10 string without leading zeroes.

## Canonical JSON contract

`canonicalizeState` first validates and projects the input into the closed schema above. `canonicalStringify` then serializes using these rules:

- object keys are sorted by JavaScript/Unicode UTF-16 code-unit order at every depth;
- set-like arrays are already sorted during projection, while other arrays preserve order;
- strings and property names use standard JSON escaping;
- only finite safe integers are accepted as numbers (`-0` is encoded as `0`);
- `undefined`, `NaN`, infinities, functions, symbols, bigint values, sparse arrays, and cyclic structures are rejected;
- no whitespace is emitted.

This is a deliberately small deterministic JSON profile. Callers must not substitute ordinary `JSON.stringify` on unprojected input.

The standalone canonical state hash is:

```text
stateHash = keccak256(UTF8(canonicalJson))
```

## Leaf encoding

Every leaf uses fixed-width EVM ABI words, so the implementation is equivalent to:

```text
inner = keccak256(abi.encode(
  bytes32 domain,
  address wallet,
  uint256 scrollTokenId,
  uint256 stateVersion,
  bytes32 payloadHash
))
leaf = keccak256(inner)
```

The second hash follows the defensive leaf convention used by OpenZeppelin's standard Merkle trees. Domains are `keccak256(UTF8(domainName))`:

| Proof category | Domain name | `payloadHash` |
| --- | --- | --- |
| Canonical state | `robinhood.scroll.state.v1` | `stateHash` |
| Achievement | `robinhood.scroll.achievement.v1` | `keccak256(UTF8(achievementId))` |
| Finery | `robinhood.scroll.finery.v1` | `keccak256(UTF8(fineryId))` |
| Equipment | `robinhood.scroll.equipment.v1` | `keccak256(UTF8(canonicalJson({ itemId, slot })))` |
| Unlock | `robinhood.scroll.unlock.v1` | `keccak256(UTF8(unlockId))` |

`schemaVersion` is committed inside `stateHash`. All category leaves share the same wallet, Scroll token ID, and state version as the canonical-state leaf.

## Tree and proof rules

Leaves are sorted lexicographically by their 32-byte hashes. At each level, sibling nodes are ordered lexicographically and hashed as:

```text
parent = keccak256(min(left, right) || max(left, right))
```

An unpaired node in an odd-width level is promoted unchanged. Proof verification therefore applies only the supplied siblings, using the same sorted-pair operation. This construction is deterministic and proofs verify with OpenZeppelin `MerkleProof.verify`/`processProof` because every hashed pair is commutative.

The tree always contains the canonical-state leaf, including when all category collections are empty. Duplicate semantic entries are rejected before tree construction. A proof object contains the subject and binding fields needed to recompute its leaf; verification does not blindly trust the serialized `leaf` value.

## Public API boundary

- `canonicalizeState(input)` validates, normalizes, sorts, and removes only the named nondeterministic fields.
- `hashCanonicalState(input)` returns the canonical state `keccak256` hash.
- `createStateCommitment(input)` returns canonical state/JSON, `stateHash`, `stateRoot`, and deterministic leaf descriptors.
- `getProof(commitment, subject)` returns a membership proof for state, an achievement, finery, equipment slot/item pair, or unlock.
- `verifyProof(proof, expectedRoot?)` recomputes the leaf and verifies it against the checkpoint root.

Malformed input throws `StateValidationError`. `verifyProof` is a trust-boundary helper and returns `false` rather than throwing for malformed or tampered proof data.
