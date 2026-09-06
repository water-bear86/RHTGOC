# Scroll gas and `$ROBIN` economics

## Exact payment split

For an even mint price `P` in `$ROBIN` base units:

```text
upkeepAmount = P / 2
burnedAmount = P / 2
```

Both `transferFrom` operations and the ERC-721 mint occur in one transaction. Any failure reverts all three effects. Gas is paid separately in ETH on Robinhood Chain. The conventional sink is fixed to `0x000000000000000000000000000000000000dEaD`; `0x0000000000000000000000000000000000000001` is forbidden because it is a precompile, not a burn wallet.

## Pricing formula

Only half the purchase reaches upkeep, so the target price must account for that:

```text
checkpointReserveETH = 1000 * measuredCheckpointGas * maxFeePerGasETH * safetyFactor
targetROBIN = ceil(checkpointReserveETH * ETH_USD / (0.50 * ROBIN_USD * (1 - conversionSlippage)))
mintPrice = clamp(immutableMinimum, targetROBIN, immutableMaximum)
```

Recommended governance inputs:

- a rolling p95 checkpoint gas measurement from the exact deployed bytecode;
- p95 Robinhood Chain base fee plus L1 data fee, rather than a single spot gas price;
- a 1.30 safety factor;
- conservative ETH/USD and `$ROBIN`/USD time-weighted prices from documented liquid venues;
- explicit conversion slippage and treasury operating overhead.

The contract intentionally contains no price oracle. A multisig proposes an even price, the timelock delays it, and the contract enforces immutable floor and ceiling bounds.

## Measured contract gas

Foundry 1.8.1 measured the final Solidity 0.8.36, Paris-target bytecode with the
optimizer enabled for 200 runs. The complete 22-test suite, including 512-run fuzz
tests and 128 invariant runs, passed while producing this report:

| Operation | Minimum | Mean | Median | Maximum | Samples |
| --- | ---: | ---: | ---: | ---: | ---: |
| `mint` | 28,560 | 178,734 | 189,497 | 195,627 | 1,183 |
| `submitCheckpoint` | 35,873 | 116,170 | 94,743 | 165,919 | 528 |
| `submitCheckpoints` | 31,759 | 140,666 | 89,890 | 300,349 | 3 |
| `migrateWallet` | 38,414 | 87,155 | 48,082 | 175,810 | 9 |
| `recoverWallet` | 49,864 | 88,360 | 49,876 | 165,340 | 3 |

The `mint` minimum includes reverted or otherwise short paths from fuzz/invariant
sampling; use the 189,497 median and 195,627 observed maximum for successful-path
planning, then add a deployment-specific safety margin. The two-input happy-path
checkpoint batch reached 300,281 gas, demonstrating why multiple players should share
a transaction only within the configured 32-input and block-gas ceilings.

No Robinhood Chain testnet contract was deployed, so `eth_estimateGas` and the L1 data
fee remain intentionally unmeasured. Arbitrum-family fees include an L1 data component;
Foundry gas units alone cannot justify the mint price. Measure the exact deployed
calldata against testnet before setting a production price.

The same build produced 14,102 bytes of deployed runtime bytecode and 19,642 bytes of
creation bytecode, below the EIP-170 and EIP-3860 limits. Constructor arguments add to
the transaction init data and must still be checked in the deployment simulation.

## Operational controls

- Relayer estimated cost is capped per transaction and reserved atomically against a
  daily ETH ceiling; replacement attempts are bounded and use a fixed 15% max-fee bump.
- The delivered worker uses one configured RPC. RPC errors and over-policy fee estimates
  fail closed and retry through the queue. Provider diversity and cross-provider block
  agreement are production-hardening gates, not implemented controls.
- One checkpoint covers all mutations in the debounce window. Major milestones only accelerate the next batch.
- The upkeep calculation is documented and reviewed off-chain; updating the price never executes 1,000 checkpoint transactions.
