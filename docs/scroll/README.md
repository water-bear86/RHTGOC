# Soulbound Scroll delivery

This directory is the implementation and operations index for the Soulbound Scroll in
**Sherwood, the game (on robinhood chain)**. The Scroll is optional for play and
required only for saved or canonical multiplayer progression. No deployment is part of
this change.

## Delivered modules

| Module | Purpose | Primary verification |
| --- | --- | --- |
| `contracts/` | `RobinHoodScroll`, timelock deploy script, tracked ABI, Foundry tests | `forge test`, `forge test --gas-report` |
| `aws/state-core/` | Closed canonical schema, canonical JSON, keccak and Merkle proofs | 38 Vitest tests, package build |
| `packages/scroll-adapter/` | Public UI types, wallet auth, offline queue, optimistic projection, proof verification | 16 Vitest tests, package build |
| `aws/services/` | Twelve HTTP handlers, rules, persistence, mint verification, relayer and reconciliation | 24 unit/infra tests |
| `aws/infra/` | CDK stack for API Gateway, WAF, Lambda, DynamoDB, S3, SQS, EventBridge, KMS, Secrets and alarms | offline CDK synth |

Read the gate documents before integration:

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [CONTRACT_INTERFACE.md](./CONTRACT_INTERFACE.md)
- [DATA_SCHEMAS.md](./DATA_SCHEMAS.md)
- [GAS_AND_ECONOMICS.md](./GAS_AND_ECONOMICS.md)
- [SECURITY_MODEL.md](./SECURITY_MODEL.md)
- [THREAT_MODEL.md](./THREAT_MODEL.md)
- [ENVIRONMENT.md](./ENVIRONMENT.md)
- [TESTNET_DEPLOYMENT.md](./TESTNET_DEPLOYMENT.md)

## Local verification

```sh
cd contracts
npm ci --ignore-scripts
forge fmt --check
forge build
forge test
forge test --gas-report

cd ../aws/state-core
npm ci
npm run typecheck
npm test
npm run build

cd ../../../packages/scroll-adapter
npm ci
npm run typecheck
npm test
npm run build

cd ../../aws
npm ci
npm run check
npm test
npm run synth -- --quiet
```

The root game package is deliberately unchanged. The other session can integrate the
adapter through `packages/scroll-adapter/src/types.ts` and
`packages/scroll-adapter/examples/browser-integration.ts` without depending on AWS or
contract implementation details.

## Integration prerequisites

Two authorities intentionally live outside these new paths and must be wired before a
testnet release: the room/offline verifier must issue signed evidence records, and an
operator-owned migration reconciler must move AWS state after a contract
`WalletMigrated` event. Until the second workflow exists, migration/recovery roles must
not be enabled for player use. These are explicit trust-boundary prerequisites, not
client responsibilities.
