# Environment and configuration reference

No secret value belongs in source, `.env` files, CDK context, logs, or a client bundle.
Names below describe runtime inputs; they are not populated by this repository.

## Contract deployment inputs

| Name | Required | Meaning and constraint |
| --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | simulation/deploy only | Ephemeral testnet deployer key supplied to Foundry at runtime; never persist it. |
| `TIMELOCK_MIN_DELAY_SECONDS` | yes | At least `172800` seconds. |
| `TIMELOCK_PROPOSER` | yes | Governance Safe/proposer; nonzero. |
| `TIMELOCK_EXECUTOR` | yes | Restricted executor; nonzero. |
| `ROBIN_TOKEN_ADDRESS` | yes | Verified testnet `$ROBIN` contract; constructor requires deployed code. |
| `UPKEEP_TREASURY` | yes | Treasury Safe; cannot be zero, `0x1`, token, Scroll, or dead address. |
| `SCROLL_INITIAL_MINT_PRICE` | yes | Positive, even `$ROBIN` base-unit amount within bounds. |
| `SCROLL_MIN_MINT_PRICE` | yes | Positive, even immutable floor. |
| `SCROLL_MAX_MINT_PRICE` | yes | Even immutable ceiling at or above the floor. |
| `SCROLL_METADATA_BASE_URI` | yes | HTTPS prefix ending in `/scrolls/`. |
| `PAUSE_GUARDIAN` | yes | Emergency guardian; can pause only. |
| `CHECKPOINT_SIGNER` | yes | Dedicated EOA allowed to sign checkpoint EIP-712 messages; must differ from `RELAYER`. |
| `RELAYER` | yes | Separate sponsored transaction sender; must differ from `CHECKPOINT_SIGNER` and `RECOVERY_SIGNER`. |
| `RECOVERY_SIGNER` | yes | Exceptional recovery authority; must differ from relayer. |
| `RPC_URL` | local command | Explicit RPC selected for a simulation; never default to mainnet. |

## CDK context

Supply these with reviewed `-c name=value` inputs or an equivalent controlled app
configuration. Do not pass credential-bearing URLs or private keys in context.

| Context key | Meaning |
| --- | --- |
| `chainId` | `46630` for Robinhood Chain testnet. |
| `scrollContractAddress` | Address produced by the reviewed contract deployment. |
| `robinTokenAddress` | Same verified `$ROBIN` address passed to the contract. |
| `upkeepAddress` | Must equal the contract's current `treasury()`. |
| `rpcUrl` | Non-secret approved testnet RPC URL. Public RPC is smoke-test only. |
| `metadataBaseUrl` | Deployed API stage URL without a trailing slash. |
| `trustedGameOrigins` | JSON array of exact HTTPS browser origins; the stack rejects `*`. |
| `matchReceiptPublicKey` | Ed25519 public key for authoritative match/offline evidence. |

`CDK_DEFAULT_ACCOUNT` and `CDK_DEFAULT_REGION` select the explicitly approved AWS
account and region. The nonfunctional `.invalid`/placeholder defaults exist only so an
offline synth can run; they are deployment blockers.

## Lambda runtime variables

CDK generates resource identifiers and sets these variables. Values labeled default
are initial operating policy and require load/gas review before release.

| Variable | Source/default | Purpose |
| --- | --- | --- |
| `STATE_TABLE_NAME` | CDK | DynamoDB single table. |
| `SNAPSHOT_BUCKET_NAME` | CDK | Object-Locked canonical snapshots. |
| `CHECKPOINT_QUEUE_URL` | CDK | FIFO checkpoint queue. |
| `RECONCILIATION_QUEUE_URL` | CDK | Delayed receipt/replacement queue. |
| `RELAYER_SECRET_ARN` | CDK | KMS-encrypted Secrets Manager secret reference. |
| `ROBINHOOD_RPC_URL` | `rpcUrl` context | Robinhood Chain RPC. Must not contain a secret in production configuration. |
| `CHAIN_ID` | `chainId` context | EIP-712 and RPC chain binding. |
| `SCROLL_CONTRACT_ADDRESS` | context | Contract and auth verifying address. |
| `ROBIN_TOKEN_ADDRESS` | context | `$ROBIN` receipt/allowance address. |
| `ROBIN_TOKEN_DECIMALS` | `18` | Display units only; base-unit math remains integer. |
| `UPKEEP_ADDRESS` | context | Expected receipt recipient; intent fails closed on contract drift. |
| `DEAD_ADDRESS` | fixed | Exactly `0x000000000000000000000000000000000000dEaD`. |
| `CHECKPOINT_AFTER_SECONDS` | `300` | Per-player debounce. |
| `MAX_UNCHECKPOINTED_SECONDS` | `3600` | Maximum dirty-state age. |
| `CHECKPOINT_ON_MAJOR_ACHIEVEMENT` | `true` | Accelerate a milestone batch. |
| `CHECKPOINT_ON_MATCH_RESULT` | `true` | Accelerate an authoritative match batch. |
| `AUTH_DOMAIN_NAME` | product name | EIP-712 wallet-session domain. |
| `AUTH_DOMAIN_VERSION` | `1` | Authentication schema version. |
| `AUTH_CHALLENGE_TTL_SECONDS` | `300` | One-use challenge lifetime. |
| `AUTH_SESSION_TTL_SECONDS` | `3600` | Hashed bearer-session lifetime. |
| `CONFIRMATIONS_REQUIRED` | `12` | Mint/checkpoint confirmation depth. |
| `MAX_RELAYER_GAS_WEI` | `5000000000000000` | Per-transaction sponsored-cost ceiling. |
| `MAX_DAILY_RELAYER_SPEND_WEI` | `100000000000000000` | Atomic UTC-day sponsored-cost ceiling. |
| `MAX_REPLACEMENT_ATTEMPTS` | `3` | Replacement budget per transaction. |
| `REPLACEMENT_AFTER_SECONDS` | `180` | Pending age before replacement. |
| `MATCH_RECEIPT_PUBLIC_KEY` | context | Public verification key only. |
| `METADATA_BASE_URL` | context | Public metadata/API prefix. |
| `TRUSTED_GAME_ORIGINS` | context JSON | Runtime response-origin allowlist. |

The generated secret must contain two different fields, `relayerPrivateKey` and
`checkpointSignerPrivateKey`. Only worker Lambdas receive read permission. A future
KMS `ECC_SECG_P256K1` signer adapter can remove the raw signer-key field without
changing the contract ABI.

## Optional test variables

| Name | Safety boundary |
| --- | --- |
| `DYNAMODB_LOCAL_ENDPOINT` | Enables the integration test only for `localhost`, `127.0.0.1`, or `::1`; the test refuses real AWS endpoints. |
| `RUN_SCROLL_TESTNET_E2E=1` | Enables the read-only testnet smoke test. |
| `ROBINHOOD_TESTNET_RPC_URL` | RPC used only by that read-only smoke test. |
| `SCROLL_TESTNET_CONTRACT_ADDRESS` | Existing reviewed testnet deployment to inspect. |
| `SCROLL_TESTNET_API_URL` | Existing testnet API to read; no write route is called. |
