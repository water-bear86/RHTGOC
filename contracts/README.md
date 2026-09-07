# RobinHoodScroll contracts

Production-oriented, non-upgradeable soulbound Scroll contract for **Sherwood, the game
(on robinhood chain)**. Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) before changing the
economics, signer model, recovery path, or storage boundary.

Checkpoint submission is intentionally two-key: `CHECKPOINT_SIGNER_ROLE` signs the
EIP-712 authorization and a separate `RELAYER_ROLE` account is the only permitted
submitter.

## Toolchain

- Solidity `0.8.36`
- Foundry `1.8.1` or newer
- OpenZeppelin Contracts `5.4.0` (exact npm lock)
- EVM target: Paris

OpenZeppelin `5.6.1` cannot currently be used with the conservative Paris target because
its ERC-721 dependency graph uses Cancun's `MCOPY` opcode. Upgrade only after Robinhood
Chain confirms Cancun support and the full suite passes against that network runtime.

```sh
cd contracts
npm ci --ignore-scripts
forge fmt --check
forge build
forge test
forge test --gas-report
```

Generate a consumer ABI from the verified build:

```sh
forge inspect RobinHoodScroll abi
```

The Foundry JSON artifact is written to
`out/RobinHoodScroll.sol/RobinHoodScroll.json`. Generated build output is deliberately
not committed.

## Deployment

`script/DeployScroll.s.sol` deploys an OpenZeppelin `TimelockController` first, with no
bootstrap admin, then deploys `RobinHoodScroll` with that controller as its sole role
administrator. Required environment variables:

- `DEPLOYER_PRIVATE_KEY` (Foundry reads it at runtime; never put it in a file)
- `TIMELOCK_MIN_DELAY_SECONDS` (at least 172800 / 48 hours)
- `TIMELOCK_PROPOSER`
- `TIMELOCK_EXECUTOR`
- `ROBIN_TOKEN_ADDRESS`
- `UPKEEP_TREASURY`
- `SCROLL_INITIAL_MINT_PRICE`
- `SCROLL_MIN_MINT_PRICE`
- `SCROLL_MAX_MINT_PRICE`
- `SCROLL_METADATA_BASE_URI` (for example, `https://api.example/scrolls/`)
- `PAUSE_GUARDIAN`
- `CHECKPOINT_SIGNER`
- `RELAYER`
- `RECOVERY_SIGNER` (must differ from the relayer)

Always simulate before broadcasting. This repository does not deploy automatically:

```sh
forge script script/DeployScroll.s.sol:DeployScroll --rpc-url "$RPC_URL"
```

Only after reviewing addresses, roles, gas, bytecode, and the simulation should an
authorized operator separately consider a broadcast. Mainnet deployment is outside the
scope of this build.
