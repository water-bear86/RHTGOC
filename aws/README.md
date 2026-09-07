# Sherwood Soulbound Scroll AWS backend

This directory contains the AWS persistence and checkpoint service for **Sherwood, the game (on robinhood chain)**. It is a standalone TypeScript package and AWS CDK v2 application. Nothing in this module deploys automatically.

## What is included

- Twelve Lambda entry points: the eight brief-required API routes, two wallet-auth routes, and the adapter-required Scroll lookup and mint-confirmation routes.
- Separate checkpoint submission, reconciliation, and max-age sweep workers.
- DynamoDB transactional state, append-only amendments, idempotency records, one-use auth nonces, hashed sessions, authoritative-evidence claims, transaction records, checkpoint leases, and relayer spend counters.
- S3 versioned snapshots with KMS encryption, Object Lock, public access blocking, and create-only writes.
- FIFO checkpoint batching with per-wallet ordering and deduplication, a standard delayed reconciliation queue, and separate DLQs.
- EIP-712 wallet authentication and checkpoint authorization, exact `$ROBIN` receipt/split verification, RPC outage handling, replacement attempts, WAF, alarms, structured audit logs, and least-privilege grants.

## Local verification

Use Node.js 24 or newer for parity with the Lambda runtime.

```sh
cd aws
npm ci
npm run check
npm test
npm run synth -- --quiet
```

Tests and synthesis do not contact AWS or Robinhood Chain. `npm run synth` only writes a local `cdk.out` assembly, which is ignored.

## Route contract

```text
POST /auth/challenge
POST /auth/session
POST /players/register
POST /players/{wallet}/mint-intent
POST /players/{wallet}/mint-confirmation
POST /players/{wallet}/state
GET  /players/{wallet}/state
GET  /players/{wallet}/summary
GET  /players/{wallet}/proof?category=<category>&key=<key>
GET  /players/{wallet}/scroll
POST /checkpoints/flush
GET  /scrolls/{tokenId}/metadata
```

Private routes use `Authorization: Bearer <accessToken>`. Mutations use the adapter contract `{ mutationId, expectedVersion, mutation }`; a successful mutation returns `{ state: PlayerState }`. Errors use `{ code, message, ...safeDetails }`. Raw state patches and client-awarded inventory/achievements are rejected by closed schemas.

## Deployment preparation (do not skip)

The CDK app contains unmistakable nonfunctional synthesis defaults. Before any reviewed testnet deployment, supply context values for chain ID, deployed contract/token/treasury addresses, RPC URL, metadata base URL, the exact trusted browser origins, and the Ed25519 public key used by the authoritative result issuer. CORS allows credentials, `Authorization`, and `Content-Type` only for those explicit origins; the stack rejects `*`. The mint price is read from the contract at request time, and mint intents fail closed if the on-chain treasury differs from the configured receipt-verification treasury.

Populate the generated relayer secret with JSON fields `relayerPrivateKey` and `checkpointSignerPrivateKey`. They must be different keys and must match the contract's `RELAYER_ROLE` and `CHECKPOINT_SIGNER_ROLE`. Runtime IAM allows only the two worker Lambdas to read this secret. For a higher-assurance production deployment, replace the Secrets Manager signer adapter with an AWS KMS `ECC_SECG_P256K1` signer.

Never put keys in CDK context, CloudFormation parameters, environment variables, source files, logs, or client bundles. Configure budgets/alarms, WAF thresholds, confirmation depth, gas ceilings, daily sponsored-gas limit, and DLQ alert destinations before enabling event sources. Deploy only to an explicitly approved Robinhood Chain testnet/AWS account; this repository does not authorize a mainnet or paid deployment.

Detailed design decisions are in [infra/ARCHITECTURE.md](infra/ARCHITECTURE.md) and [services/ARCHITECTURE.md](services/ARCHITECTURE.md).
