# Sherwood Rebellion

A true-3D cooperative browser game built around the Robin Hood fantasy: form a Merry Band, rob the Sheriff, survive the pursuit, rescue allies, and redistribute the haul.

## Permanent playtest

**[Play Sherwood Rebellion](https://sherwood-rebellion.16h6bw5cfk6jc.ca-central-1.cs.amazonlightsail.com/)**

The same AWS Lightsail HTTPS origin serves the 3D client, health endpoint, and Merry Band WebSocket rooms.

## Release status

| Plane | Current state |
| --- | --- |
| Live production | M7 gameplay and social alpha. Playable, but all six persistence flags currently report `false`; band/social/campaign writes and verified leaderboard submissions are disabled. |
| Pushed development | Draft PR [#38](https://github.com/water-bear86/sherwood-rebellion/pull/38) completes M8: hardened asset gate, restrained cel shading, and the curated CC0 cottage/wagon runtime slice. It is not deployed. |
| Local worktree | M8 has no intentionally deferred asset staging. New work starts from the production/mainline gates. |

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

## Multiplayer and persistence

Private rooms support two to four players. Robin, Maid Marian, Little John, and Much are playable across three versioned missions, with shared guards, pings, loot, Wanted pressure, revives, redistribution, rotations, rescue follow-ups, preparations, and seasonal campaign state.

The Supabase schema is in [`supabase/migrations`](./supabase/migrations); generated types are in [`src/database.types.ts`](./src/database.types.ts). Browser clients use only the publishable key. The authoritative room service requires `SUPABASE_SECRET_KEY` for durable band, rescue, contribution, campaign, social, and verified leaderboard writes. Without it, the server stays playable and fails closed to local/unverified behavior.

Global boards are read through a privacy-filtered RPC. Clients never write ranked scores directly. Production activation and proofs remain tracked in #9, #10, and #14.

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
- [AWS deployment](./deploy/aws/README.md)
