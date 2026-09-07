# RobinHoodScroll architecture gate

Status: approved implementation boundary for **Sherwood, the game (on robinhood chain)**.

This document freezes the contract-facing interface, economics, trust boundaries, and
deployment assumptions before implementation. The contract is intentionally small: AWS
holds canonical saves and immutable history; Robinhood Chain holds ownership and the
latest commitment only.

## Contract and governance

- `RobinHoodScroll` is a non-upgradeable ERC-721 compiled with Solidity `0.8.36`
  and using OpenZeppelin Contracts `5.4.0`. OpenZeppelin `5.6.1` was evaluated but
  requires the Cancun `MCOPY` opcode through ERC-721's `Strings` dependency; `5.4.0`
  preserves conservative Paris EVM compatibility until Robinhood Chain confirms Cancun.
- `$ROBIN`, the dead address, and price bounds are immutable.
- The accepted dead address is exactly
  `0x000000000000000000000000000000000000dEaD`. Zero, `0x1`, the treasury,
  `$ROBIN`, and the Scroll contract itself are rejected wherever relevant.
- `TIMELOCK_ADMIN_ROLE` is held by a deployed `TimelockController`, not an EOA. It is
  the admin of every role and is the only role allowed to change the price, treasury,
  or metadata base URI, or to unpause.
- The configured controller must expose `getMinDelay()` and enforce at least a 48-hour
  delay. This prevents a generic contract or zero-delay controller from satisfying only
  the superficial contract-address check.
- `PAUSE_GUARDIAN_ROLE` may pause immediately but cannot unpause.
- `CHECKPOINT_SIGNER_ROLE` signs server-validated checkpoint authorizations but cannot
  submit them.
- `RELAYER_ROLE` is the only role that submits sponsored checkpoints and recoveries.
  This makes checkpointing a two-key operation.
- `RECOVERY_SIGNER_ROLE` signs exceptional lost-wallet recoveries. Recovery submission
  additionally requires a different account with `RELAYER_ROLE`.

Role grants and revocations are therefore delayed by the external timelock. Deployment
creates the timelock first and passes its address to the Scroll constructor.

## Mint economics

`mint()` mints to and charges `msg.sender` exactly once per wallet lifetime.

1. Price must be even and remain inside immutable, even min/max bounds.
2. `price / 2` is transferred directly from the buyer to the current treasury.
3. `price / 2` is transferred directly from the buyer to the verified dead address.
4. Recipient balance deltas must exactly match both halves. Fee-on-transfer, rebasing,
   or otherwise non-exact `$ROBIN` implementations are rejected.
5. Only after both payments succeed is the Scroll safely minted. Any failure reverts the
   complete transaction atomically.

Gas is outside the token price. No native currency is accepted. There is no withdrawal
path because successful mint funds never remain in the Scroll contract.

## Soulbound identity and recovery

Normal `approve`, `setApprovalForAll`, `transferFrom`, and both `safeTransferFrom`
variants always revert. Internal ERC-721 updates also reject all post-mint movement
unless the contract has entered its private, single-operation migration path.

`migrateWallet` requires unexpired EIP-712 authorization from both the current owner
and destination wallet over the same digest, preventing typo/black-hole migrations,
and may be submitted only by an authorized relayer. `recoverWallet` is the
lost-key path: it requires an unexpired EIP-712 authorization from a
`RECOVERY_SIGNER_ROLE` account and submission by a *different* `RELAYER_ROLE` account.
Both operations bind token id, current owner, destination, nonce, deadline, chain id,
and verifying contract. Nonces and used-digest tracking prevent replay.

Destinations cannot be zero, `0x1`, the burn address, `$ROBIN`, the Scroll contract,
the current owner, or any wallet that has ever held a Scroll. A migrated-from wallet
cannot mint again. This preserves one-Scroll-per-wallet for the wallet's lifetime while
allowing a single Scroll identity to survive a wallet change.

## Checkpoints and event batches

The stored value is only:

```solidity
struct Checkpoint {
    uint256 version;
    bytes32 stateRoot;
    uint256 timestamp;
}
```

`submitCheckpoint` and `submitCheckpoints` accept a signed `CheckpointInput`. The
EIP-712 payload binds:

- token id and current owner;
- monotonically increasing version;
- nonzero canonical state root and non-regressing timestamp;
- hashes of sorted, unique achievement and finery id arrays;
- exact per-token nonce and deadline.

The caller must hold `RELAYER_ROLE`; the recovered signer must independently hold
`CHECKPOINT_SIGNER_ROLE` and must be a different address from the caller, even if
governance accidentally assigns both roles to one account. Up to 32 player checkpoints can be
submitted in one transaction. Each player checkpoint may announce up to 64 new
achievement ids and 64 new finery ids. Awards are never separate contract calls: their
events are emitted only as part of a verified checkpoint. The arrays are not retained
in storage; AWS/Merkle proofs carry the detailed history.

The checkpoint timestamp is signer-provided but cannot be zero, regress, or be in the
future. Version, nonce, used digest, and deadline checks independently reject stale or
replayed authorizations. Migration changes the bound owner, invalidating outstanding
checkpoint signatures for the previous wallet.

## Public interface

- ERC-721: `ownerOf(tokenId)`
- Identity: `scrollOf(player)`, `hasScroll(player)`, `hasEverHeldScroll(player)`
- Mint: `mint()`
- State: `latestCheckpoint(tokenId)`,
  `verifyCheckpoint(tokenId, version, stateRoot)`
- Metadata: `currentTokenURI(tokenId)`, standard `tokenURI(tokenId)`
- Checkpointing: `submitCheckpoint(input)`, `submitCheckpoints(inputs)`,
  `checkpointDigest(input)`
- Wallet change: `migrateWallet(...)`, `recoverWallet(...)`, plus digest helpers
- Timelocked configuration: `setMintPrice`, `setTreasury`, `setBaseMetadataURI`,
  `unpause`, and AccessControl role management
- Emergency action: `pause`

Required mint, payment, checkpoint, achievement, and finery events use the signatures
from the product brief. Configuration, pause, migration, and recovery also emit explicit
events for operational auditability.

## Metadata endpoint contract

The timelocked `baseMetadataURI` is the prefix through and including `/scrolls/`.
`currentTokenURI(tokenId)` returns `<baseMetadataURI><tokenId>/metadata`. That endpoint
must serve the current AWS-verified player summary; it must not trust client-awarded
inventory or achievements.

## Explicit non-goals

- No full save, inventory, metadata history, or Merkle leaves in contract storage.
- No client-signed achievement or inventory authorization.
- No transaction per gameplay mutation, achievement, or finery unlock.
- No proxy, privileged token withdrawal, arbitrary transfer, or admin recovery shortcut.
- No deployment or creation of real AWS resources in this change.

## Principal risks and controls

| Risk | Contract control | Operational control |
| --- | --- | --- |
| Compromised checkpoint signer | Independent relayer required, role revocation, pause, monotonic versions | Isolated signer, CloudWatch alarms, timelocked replacement |
| Compromised recovery signer | Distinct relayer also required; destination is validated | Separate signing principals and secret access, manual recovery evidence; this remains a privileged immediate recovery path |
| Malicious/stale client save | Only server signer can authorize a root | Server-side rules, optimistic concurrency, immutable S3 snapshots |
| Signature replay/cross-chain use | EIP-712 domain, owner binding, nonce, deadline, used digest | Short deadlines, reconciliation |
| Fee-on-transfer token breaks split | Exact recipient balance-delta checks | Deploy only with verified `$ROBIN` address |
| Governance takeover | External timelock is sole role admin | Safe proposers/executors, delay monitoring |
| Event/gas denial of service | Strictly sorted unique arrays and batch caps | Worker chunks checkpoints below gas limits |
