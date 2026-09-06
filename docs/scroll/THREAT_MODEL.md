# Soulbound Scroll threat model

## 1. Overview

This threat model covers the Soulbound Scroll system for **Sherwood, the game (on
robinhood chain)** as implemented in `contracts/`, `aws/`, and
`packages/scroll-adapter/`. It evaluates the code in this branch; no AWS resources or
contracts have been deployed, so operational findings are conditional on a future
deployment.

The system protects four primary assets:

| Asset | Security property | Source of authority |
| --- | --- | --- |
| Scroll ownership and mint economics | One Scroll per wallet lifetime; soulbound; exact 50/50 `$ROBIN` split | `RobinHoodScroll` (`contracts/src/RobinHoodScroll.sol:162-188`, `contracts/src/RobinHoodScroll.sol:327-361`) |
| Detailed player progression | Only server-validated commands may advance a monotonic state version | DynamoDB transactions and rules (`aws/services/scroll-service.ts:97-161`, `aws/services/adapters/aws-persistence.ts:86-160`) |
| Public state commitment | Latest confirmed version/root is authentic, replay-resistant, and wallet/token-bound | EIP-712 checkpoint plus Merkle commitment (`contracts/src/RobinHoodScroll.sol:226-240`, `aws/state-core/src/merkle.ts:61-78`) |
| Signing and relayer authority | Keys cannot be read or used by public API functions; sponsored spend is bounded | Secrets Manager/KMS, worker IAM and atomic spend records (`aws/infra/lib/scroll-backend-stack.ts:49-60`, `aws/services/adapters/aws-persistence.ts:456-488`) |

Runtime data flows from a wallet-authenticated browser through API Gateway to strict
command validation, an optimistic DynamoDB transaction, and an immutable S3 snapshot.
A per-wallet FIFO queue batches checkpoint work. A signer authorizes the commitment,
a separate relayer submits it, and reconciliation confirms it before the state is
reported as verified (`docs/scroll/ARCHITECTURE.md:20-42`).

The public summary, proof, Scroll, and metadata routes deliberately disclose selected
progression data. Detailed state remains wallet-authenticated. Metadata omits the
uncheckpointed level and root when the record is dirty (`aws/infra/lib/scroll-backend-stack.ts:281-305`,
`aws/services/scroll-service.ts:285-305`). This is a product privacy choice, not a
confidentiality guarantee for achievements requested through public proofs.

## 2. Threat Model, Trust Boundaries, and Assumptions

### Actors and trust boundaries

| Boundary or actor | Trust level | Security-relevant behavior |
| --- | --- | --- |
| Browser, local storage, and public caller | Untrusted | Can fabricate requests, cached state, IDs, journals, paths, headers, timing, and RPC responses visible to the browser. |
| Wallet | Authenticates wallet control only | EIP-712 login does not prove a game result. The adapter checks wallet, chain, nonce, type, and expiry before asking for a signature (`packages/scroll-adapter/src/http-client.ts:29-55`, `packages/scroll-adapter/src/http-client.ts:91-116`). |
| API Gateway and Lambda request handlers | Partially trusted | Must reject malformed input, enforce wallet/path equality, and never accept raw reward deltas. Strict schemas expose only three command forms (`aws/services/validation.ts:6-45`). |
| Authoritative game-result issuer | Highly trusted, external prerequisite | Its Ed25519-signed match/offline evidence may award progression. The existing game server is outside this branch and must be wired before rewards are enabled. |
| DynamoDB and S3 | Trusted persistence with distinct failure modes | DynamoDB owns current state and idempotency; S3 keeps encrypted, versioned, Object-Locked snapshots (`aws/infra/lib/scroll-backend-stack.ts:62-86`). |
| SQS workers and chain RPC | Workers are privileged; RPC is untrusted for availability | FIFO ordering, leases, contract nonces, confirmation depth, retries, replacement limits, and reconciliation contain duplication and transient chain failures. |
| Checkpoint signer and relayer | Privileged and intended to be distinct | Both raw keys currently occupy one KMS-encrypted secret readable by two workers. Compromise of either worker may expose both keys (`aws/infra/lib/scroll-backend-stack.ts:56-60`, `aws/infra/lib/scroll-backend-stack.ts:261-262`). |
| Timelock, guardian, recovery signer, and Safes | Privileged governance | The contract enforces a minimum 48-hour timelock for sensitive administration; the guardian can pause but cannot unpause or alter economics. |

### Assumptions

- The deployed `$ROBIN` token address, decimals, and semantics are independently
  validated. Fee-on-transfer or rebasing behavior is unsupported and fails exact
  balance-delta checks.
- Timelock proposer/executor, treasury, guardian, relayer, checkpoint signer, and
  recovery signer are distinct, monitored production principals. Governance and
  treasury principals are multisigs.
- The configured private RPC is chain-correct and sufficiently available. RPC data is
  rechecked through confirmations and reconciliation; a single RPC remains an
  availability and temporary-view dependency.
- The match/offline evidence issuer keeps its signing key outside clients and creates
  receipts from authoritative simulation or match results. Until that service exists,
  positive reward commands must remain disabled.
- Production does not enable wallet migration or recovery until a `WalletMigrated`
  consumer can atomically move the DynamoDB identity. Both entry points are
  relayer-only, so this is enforceable operationally (`contracts/src/RobinHoodScroll.sol:246-304`).
- TLS, AWS account controls, CloudTrail, budgets, alarm routing, key rotation, backups,
  and operator incident procedures are configured outside this source tree.

### Existing controls and residual exposure

- Authentication challenges are single-use and expiring; only token hashes are stored
  and sessions are wallet-scoped (`aws/services/auth.ts:35-81`). Credentialed CORS
  rejects empty or wildcard origin configuration, and WAF plus API throttles limit
  common abuse (`aws/infra/lib/scroll-backend-stack.ts:45-47`,
  `aws/infra/lib/scroll-backend-stack.ts:127-165`,
  `aws/infra/lib/scroll-backend-stack.ts:307-327`). CORS is not authorization; non-browser
  clients can call all public endpoints.
- Mutation IDs, expected versions, append-only amendments, and global evidence claims
  share one DynamoDB transaction. This prevents duplicate awards and lost updates
  under normal DynamoDB semantics (`aws/services/adapters/aws-persistence.ts:86-160`).
- Merkle leaves bind domain, wallet, token, version, and payload; leaves and parent pairs
  are deterministically ordered (`aws/state-core/src/merkle.ts:24-30`,
  `aws/state-core/src/merkle.ts:61-78`, `aws/state-core/src/merkle.ts:131-163`).
- Ranked multiplayer fails closed unless the current canonical state equals both the
  recorded and live on-chain checkpoint. Dirty or divergent players are quarantined
  rather than silently downgraded (`aws/services/multiplayer.ts:15-49`).
- Every Lambda currently receives table-wide read permission and write-capable
  functions receive table-wide write permission. This is resource/action scoped but
  not DynamoDB leading-key scoped, leaving a larger blast radius after a Lambda
  compromise (`aws/infra/lib/scroll-backend-stack.ts:239-250`).

## 3. Attack Surface, Mitigations, and Attacker Stories

| Attacker story | Preconditions and path | Impact | Implemented mitigation | Residual risk / required action |
| --- | --- | --- | --- | --- |
| A modified client awards itself XP, achievements, or finery. | Attacker controls browser requests and sends arbitrary JSON or replays another result ID. | Fraudulent canonical progression and checkpoint. | Strict union accepts only match claims, equipment selection, or replayable offline journals; server rules calculate deltas; evidence IDs are atomically single-use (`aws/services/validation.ts:6-45`, `aws/services/scroll-service.ts:97-141`). | **High if evidence issuer is absent or compromised.** Keep reward paths disabled until the authoritative issuer is implemented and its key isolated. |
| A caller replays a checkpoint or substitutes another owner/root. | Attacker obtains a prior signature or races workers. | Rollback, cross-wallet state substitution, duplicate awards. | Typed data binds owner, token, version, root, event hashes, nonce, deadline, chain, and contract; only the relayer role can submit; contract versions are monotonic and digests are single-use. | Low residual under signer security. A signer-role compromise can authorize arbitrary newer roots and is covered separately. |
| A checkpoint worker or secret reader is compromised. | Lambda code execution, IAM credential theft, or secret disclosure. | Attacker obtains both signer and funded relayer keys, forges state roots, and can spend the relayer's entire prefunded balance. | For ordinary worker execution, contract pausing, role revocation, maximum-fee reservations, transaction/daily caps, replacement limits, DLQs, and alarms bound misuse (`aws/services/chain.ts:175-193`, `aws/services/adapters/aws-persistence.ts:456-488`, `aws/infra/lib/scroll-backend-stack.ts:334-349`). A stolen raw key bypasses application limits. | **High.** Before mainnet, move checkpoint signing behind asymmetric KMS or an isolated signer service, keep only a minimal hot relayer balance, and use a separate replenishment policy. |
| A malicious or faulty RPC causes stale nonces, fake receipts, or prolonged outage. | Single configured RPC lies, forks, rate-limits, or is unavailable. | Delayed checkpoints, wasted gas, or temporary incorrect confirmation view. | Receipt depth, live contract version/nonce reads, pending/replacement tracking, bounded replacements, reconciliation, spend caps, retry queues, and DLQs fail closed. Accepted off-chain state is not discarded. | **Medium availability / Low integrity** if reconciliation uses the same faulty provider. Add provider diversity and compare finalized block hashes for production. |
| A user replays or races state commands. | Reuses a mutation UUID, evidence ID, or stale version across requests/wallets. | Double credit or lost update. | Consistent idempotency lookup plus conditional DynamoDB transaction writes current state, amendment, idempotency result, and global evidence claim atomically (`aws/services/adapters/aws-persistence.ts:75-160`). | Low. Retain amendment/evidence records for the full economic dispute horizon; the seven-day idempotency record alone is not the global evidence defense. |
| A phishing API asks the wallet to sign a challenge for another wallet or chain. | Compromised API origin, DNS, or adapter configuration returns substituted typed data. | Session for an unintended wallet/chain or confusing wallet prompt. | Adapter independently checks connected chain, primary type, typed wallet, challenge nonce, and expiry; backend verifies its configured EIP-712 domain and recovered wallet (`packages/scroll-adapter/src/http-client.ts:29-55`, `aws/services/auth.ts:54-72`). | **Medium** under origin/DNS compromise. Pin the production API URL, use trusted HTTPS origins, monitor certificate/DNS changes, and show human-readable wallet prompts. |
| A public reader harvests player progression. | Enumerates known wallets/token IDs and calls summary/proof/metadata routes. | Privacy loss or targeted profiling. | Detailed state is authenticated; dirty metadata reveals only the confirmed root/version and omits unverified level (`aws/services/scroll-service.ts:285-305`). | **Accepted product risk.** Summaries and requested proof members are public by design. Do not put secrets or sensitive personal data in canonical state. |
| An operator changes treasury or price but forgets backend configuration. | Timelocked contract change completes while AWS still has old treasury configuration. | Incorrect mint instructions or payment-verification outage. | Mint price is read live; on-chain treasury must match configured receipt verifier or mint intent fails closed (`aws/services/scroll-service.ts:164-199`). | Low integrity / Medium availability. Coordinate timelocked changes with a rehearsed configuration runbook. |
| A player migrates the NFT while DynamoDB still maps state to the old wallet. | Relayer enables migration/recovery before an event consumer exists. | New owner lacks state access; old session may retain off-chain access; metadata/ownership diverge. | Both wallets sign migration, recovery has separate signer, and both submissions require `RELAYER_ROLE`, allowing the feature to remain closed (`contracts/src/RobinHoodScroll.sol:246-304`). | **Medium deployment blocker.** Implement reorg-aware `WalletMigrated` consumption and atomic identity/session invalidation before granting operational access to migration. |
| A compromised Lambda overwrites audit history or steals credentials. | Code execution in a write-capable function. | State corruption, snapshot spam, or lateral movement. | S3 is encrypted, versioned, Block Public Access enabled, and Object Locked for 365 days; runtime secret writes and KMS grant creation are explicitly denied (`aws/infra/lib/scroll-backend-stack.ts:62-74`, `aws/infra/lib/scroll-backend-stack.ts:352-359`). | **Medium.** DynamoDB table permissions are broader than item prefixes; split tables or add leading-key IAM conditions where operational access patterns permit. |
| Queue flooding creates one transaction per achievement or exhausts funds. | Attacker creates many valid mutations or repeatedly flushes. | Gas/resource exhaustion and delayed checkpoints. | State changes are debounced/batched per wallet, events ride the checkpoint transaction, FIFO and maximum-age sweep coalesce work, and atomic daily/per-transaction caps bound sponsorship (`docs/scroll/ARCHITECTURE.md:13-17`, `aws/services/adapters/aws-persistence.ts:456-488`). | Medium availability. Add wallet/account quotas and alert on flush-to-confirm ratios before public launch. |

The highest-value abuse chain is: compromise or impersonate the authoritative evidence
issuer, award plausible state through valid commands, then rely on the legitimate
checkpoint workers to commit the fraudulent root. Isolating the evidence key, binding
receipts to wallet/match/build/rules version, global replay claims, and anomaly detection
are therefore as important as contract correctness.

## 4. Severity Calibration

Severity combines impact with realistic exploitability for this system:

| Severity | Project-specific meaning | Examples | Counterexample |
| --- | --- | --- | --- |
| Critical | Permissionless or readily exploitable loss of treasury/player funds, irreversible destruction of the one-Scroll identity, or unrestricted contract takeover affecting most users. | A public path that drains `$ROBIN`; bypassing soulbound rules without consent; zero-delay role takeover. | A worker compromise limited by role revocation and spend caps is serious but not automatically Critical. |
| High | Forging economically meaningful progression/checkpoints at scale, exposing privileged signing material, or repeatable cross-user authorization failure. | Compromise of the combined signer/relayer secret; accepting unsigned client-authored rewards; replayable wallet sessions across wallets. | A temporary RPC outage with no integrity loss is not High. |
| Medium | Requires a privileged/configuration mistake or constrained precondition and causes bounded integrity loss, meaningful privacy loss, or sustained service outage. | Enabling migration before its event consumer; phishing through a compromised configured origin; table-wide Lambda blast radius; prolonged single-provider outage. | Intentionally public checkpoint roots are not a vulnerability. |
| Low | Limited, recoverable, hard-to-exploit behavior with no direct economic or authorization impact. | Temporary stale status, bounded metadata inconsistency, or excess request cost within throttles. | Any path that can award unearned progression is at least High, not Low. |

Deployment prerequisites are not downgraded because the system is currently undeployed.
They must be closed before the relevant feature is enabled. The authoritative evidence
issuer, migration consumer, production key separation, real address/token validation,
DynamoDB Local integration run, testnet read-only smoke test, failure drills, and an
external contract review remain explicit release gates (`docs/scroll/SECURITY_MODEL.md:53-61`).
