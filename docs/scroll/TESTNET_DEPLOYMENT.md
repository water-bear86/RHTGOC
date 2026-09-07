# Robinhood Chain testnet deployment runbook

This is a manual, testnet-only runbook. It does not authorize mainnet, AWS creation,
funding, or broadcast. Robinhood's current documentation lists testnet chain ID
`46630`, ETH for gas, the public RPC
`https://rpc.testnet.chain.robinhood.com`, and explorer
`https://explorer.testnet.chain.robinhood.com`. The public RPC is rate-limited and is
not a production dependency; use it only for smoke testing.

Official references:

- <https://docs.robinhood.com/chain/connecting/>
- <https://docs.robinhood.com/chain/deploy-smart-contracts/>

## 1. Reproduce locally

```sh
cd contracts
npm ci --ignore-scripts
forge fmt --check
forge build
forge test
forge test --gas-report
```

Confirm the generated ABI equals `contracts/abi/RobinHoodScroll.json`, bytecode stays
below EIP-170, and the measured gas table remains within the reviewed policy.

## 2. Resolve deployment inputs

Independently verify the `$ROBIN` testnet contract and decimals. Record the exact
treasury Safe, proposer, executor, pause guardian, checkpoint signer, relayer, and
recovery signer. Check that the signer/relayer/recovery principals are distinct and the
timelock delay is at least 48 hours. Select even immutable min/max/current prices using
the gas model; do not estimate by sending 1,000 transactions.

The metadata base must be the future testnet API prefix through `/scrolls/`. Do not use
mainnet addresses, a production treasury, or a reusable funded deployer.

## 3. Simulate without broadcasting

Load secrets into the operator shell through an approved secret workflow. Never paste
them into a file, command history, chat, or CI log.

```sh
forge script script/DeployScroll.s.sol:DeployScroll \
  --rpc-url "$RPC_URL"
```

Review the simulated timelock and Scroll constructor arguments, role holders, payment
addresses, gas, and expected emitted events. The deploy script has no automatic
`--broadcast` and no npm deploy hook.

## 4. Explicit operator-only broadcast

An authorized operator may add `--broadcast` only after account/network confirmation,
change review, adequate testnet ETH, and multisig approval. Record both contract
addresses and transaction hashes. This build did not perform that step.

Afterward, verify `RobinHoodScroll` on the testnet Blockscout API documented by
Robinhood and read back:

- chain ID and bytecode;
- `robinToken`, `burnAddress`, `treasury`, `mintPrice`, `minMintPrice`, `maxMintPrice`;
- every role holder/admin and the timelock minimum delay;
- metadata base URI and pause state.

Stop if any readback differs.

## 5. Prepare AWS without deploying

Fill the CDK context listed in `ENVIRONMENT.md`, using the read-back contract values and
exact browser origin. Populate neither private keys nor credential-bearing RPC URLs in
context. Run:

```sh
cd aws
npm ci
npm run check
npm test
npm run synth -- --quiet
```

Review the synthesized template, IAM, resource-retention policies, Object Lock,
trusted-origin CORS, WAF thresholds, alarms, queue/DLQ settings and cost estimate. A
separate AWS approval is required before `cdk deploy`; this repository never runs it.

## 6. Post-deployment test sequence

Only after both explicit deployments exist:

1. Populate the generated relayer secret through Secrets Manager and confirm the two
   public addresses match their contract roles.
2. Keep queue event sources disabled while reading configuration and testing auth.
3. Run the opt-in read-only smoke test:

   ```sh
   RUN_SCROLL_TESTNET_E2E=1 npm run test:e2e:testnet
   ```

4. Exercise wallet auth, registration, one small approved test mint, receipt
   confirmation, multiple off-chain mutations, one flush, and reconciliation.
5. Confirm one checkpoint covers the entire mutation burst and that the 50/50 token
   transfers reached treasury and `0x...dEaD` exactly.
6. Test RPC outage, DLQ alarm, paused contract behavior, stale version, replayed
   signature and transaction replacement using expendable testnet accounts only.

Do not enable wallet migration/recovery for players until the AWS `WalletMigrated`
event reconciliation workflow described in the threat model is implemented and tested.
