# `@robinhood-game/scroll-state-core`

Strict, deterministic canonical state hashing and Merkle membership proofs for RobinHoodScroll checkpoints used by **Sherwood, the game (on robinhood chain)**.

```typescript
import {
  createStateCommitment,
  getProof,
  verifyProof,
} from "@robinhood-game/scroll-state-core";

const commitment = createStateCommitment(trustedServerState);
const proof = getProof(commitment, {
  category: "equipment",
  slot: "primary",
  itemId: "ironwood_bow",
});

verifyProof(proof, commitment.stateRoot); // true
```

The package only commits trusted, already-authorized server state. It is not a game-rules engine and must never be used to legitimize a client-awarded achievement, finery, equipment item, or unlock.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the exact canonical JSON and leaf-encoding contracts.

## Local verification

```bash
npm install
npm run typecheck
npm test
npm run build
```
