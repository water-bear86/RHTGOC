# `@robinhood-game/scroll-adapter`

Offline-first client boundary for the Soulbound Scroll used by **Sherwood, the game (on robinhood chain)**.

The adapter applies a narrow mutation command to local state immediately, persists the command in IndexedDB, and synchronizes it asynchronously. It never exposes a mutation that grants an achievement, finery, item, experience, or match result. Those changes require authoritative server validation.

```ts
import { createScrollAdapter } from "@robinhood-game/scroll-adapter"

const scrolls = createScrollAdapter({
  apiBaseUrl: "https://scroll-api.example.invalid",
  chainId: 46630,
  walletProvider,
})

const state = await scrolls.getPlayerState(wallet)
const update = scrolls.saveProgress(wallet, {
  kind: "select_equipment",
  itemIds: ["ironwood_bow", "buckler"],
})

renderImmediately(update.localState)
```

See `examples/browser-integration.ts` and `src/types.ts`. The UI should treat `CheckpointStatus.Pending`, `Submitting`, and `Confirming` as normal asynchronous states. Guest sessions can read summaries, proofs, and public Scroll metadata but cannot load or mutate private canonical state.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
```

The package references the sibling `@robinhood-game/scroll-state-core` package for local commitment and proof verification. No dependency is added to the game's root `package.json`.
