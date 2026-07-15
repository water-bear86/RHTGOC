# Robin Hood: The Game (On Chain) · RHTGOC

A true-3D cooperative browser game built around the Robin Hood fantasy: form a Merry Band, rob the Sheriff, survive the pursuit, rescue allies, and redistribute the haul.

## Permanent playtest

**[Play Robin Hood: The Game (On Chain)](https://sherwood-rebellion.16h6bw5cfk6jc.ca-central-1.cs.amazonlightsail.com/)**

The same AWS Lightsail HTTPS origin serves the 3D client, health endpoint, and Merry Band WebSocket rooms.

## Release status

| Plane | Current state |
| --- | --- |
| Live production | The existing single-node AWS Lightsail alpha remains the player-facing release until the release checks below pass and a new image is promoted. |
| Development branch | The current browser build adds Robinhood Wallet entry, token-pass wiring, richer shared topography, collision-aligned boulders, build-aware protocol diagnostics, and privacy-safe gameplay analytics. |
| Edge/domain | Route 53, private S3, CloudFront, sticky canaries, and `rhtgoc.site` are fully specified but are not created until DNS delegation and application allowlists are ready. |

The next feature sprint does not begin until #9, #10, #14, and the releasable-mainline gate #39 pass. The ordered M9 backlog is #39–#50.

## Run locally

Install dependencies and copy `.env.example` to `.env.local`. Never put a secret or service-role key in a `VITE_` variable.

Start the authoritative room service in one terminal:

```bash
npm install
npm run server
```

Start Vite in a second terminal:

```bash
npm run dev
```

Open the URL Vite prints. Controls are WASD or click to move, `E` to interact, Space to fire, and `Q` to use the selected outlaw's signature ability. Append `?render=degraded` to force the lower rendering profile during local QA.

## Wallet sign-in and the optional Sherwood pass

Robinhood Wallet sign-in uses WalletConnect through Reown AppKit and Supabase Web3 Auth. Set `VITE_REOWN_PROJECT_ID`, choose `VITE_ROBINHOOD_CHAIN=testnet` or `mainnet`, enable the Ethereum Web3 provider in the hosted Supabase project, and apply the checked-in migrations before testing authenticated social or access flows. The sign-in prompt proves wallet ownership without moving funds.

The approximately $6, 30-day token pass is controlled exclusively by the server-side `TOKEN_ACCESS_GATE_ENABLED` switch:

- `false` or unset: open play; wallet sign-in remains optional.
- `true`, `1`, or `on`: create/join/public-hub access requires an authenticated wallet with an unexpired verified token pass.

Configure `ROBINHOOD_CHAIN`, a production RPC in `ROBINHOOD_RPC_URL`, the exact minted `TOKEN_CONTRACT_ADDRESS`, `TOKEN_TREASURY_ADDRESS`, `TOKEN_SYMBOL`, `TOKEN_DECIMALS`, and an operator-set `TOKEN_ACCESS_AMOUNT` that currently approximates USD $6. A wallet-approved ERC-20 transfer buys `TOKEN_ACCESS_DAYS` (30 by default). The server independently verifies the chain, receipt status, confirmations, signed-in sender, token contract, treasury, and amount before recording the unique transaction hash. Reusing a transaction is rejected. If verification, persistence, or configuration is unavailable while the switch is on, authoritative entry fails closed.

## Multiplayer and persistence

Private rooms support two to four players. Robin, Maid Marian, Little John, and Much are playable across three versioned missions, with shared guards, pings, loot, Wanted pressure, revives, redistribution, rotations, rescue follow-ups, preparations, and seasonal campaign state.

The Supabase schema is in [`supabase/migrations`](./supabase/migrations); generated types are in [`src/database.types.ts`](./src/database.types.ts). Browser clients use only the publishable key. The authoritative room service requires `SUPABASE_SECRET_KEY` for durable band, rescue, contribution, campaign, social, token-access, and verified leaderboard writes. Without it, persistence remains unavailable; paid access also remains unavailable when its switch is on. Private Band chat remains in memory. Authenticated, instance-local Camp chat additionally requires `PUBLIC_CAMP_CHAT_ENABLED=true` and a successful startup probe of the private moderation-evidence RPC, so it fails closed when evidence retention is not ready.

Global boards are read through a privacy-filtered RPC. Clients never write ranked scores directly. Production activation and proofs remain tracked in #9, #10, and #14.

## Release analytics and experiments

The room server can aggregate consented play at 1 Hz into 8 m cells and five-minute windows. Durable rows contain build, mission, map, phase, optional experiment assignment, and fixed counters only—never wallet/Auth IDs, names, room codes, IPs, raw coordinates, movement paths, or error text. Persistence and experiment loading stay off unless `GAMEPLAY_ANALYTICS_ENABLED=true` and the server-only Supabase credentials are present.

Every client and server release carries a bounded build ID. HTML is non-cacheable, hashed Vite bundles are immutable, and stable-name GLBs receive the client build query. `/ready` returns `503` while the room process drains so a future load balancer can stop new sessions without cutting active rooms immediately.

The deterministic village portrait is available locally at `/family-photo.html`; the checked-in 1920×1080 capture is [`output/marketing/sherwood-family-photo-1920x1080.png`](./output/marketing/sherwood-family-photo-1920x1080.png).

## Verify

Core gate:

```bash
npm run validate:assets
npm run validate:missions
npm test
npm run build
```

Multiplayer and operations checks:

```bash
npm run test:reconnect
npm run test:hub
npm run test:operator
npm run test:load
```

The asset gate includes official byte-level Khronos validation, license-evidence hashes, SPDX validation, renderer-accurate transparent submissions, and portable lockfile-pinned conversion tooling.

## Documents

- [Product requirements](./PRD.md)
- [Current game plan](./GAME_PLAN.md)
- [Sprint boundary — 2026-07-11](./docs/product/sprint-boundary-2026-07-11.md)
- [3D asset pipeline](./docs/operations/3d-assets.md)
- [Persistence operations](./docs/operations/persistence.md)
- [Leaderboard operations](./docs/operations/leaderboards.md)
- [Gameplay analytics and experiment operations](./docs/operations/gameplay-analytics.md)
- [AWS deployment](./deploy/aws/README.md)
- [`rhtgoc.site` DNS, edge, and canary runbook](./docs/operations/rhtgoc-domain.md)
