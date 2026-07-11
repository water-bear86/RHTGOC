# Sherwood Rebellion

A true 3D browser-game prototype inspired by Kintara's approachable isometric world loop and rebuilt around the Robin Hood fantasy.

## Playtest

The permanent multiplayer playtest is hosted on AWS Lightsail:

**[Play Sherwood Rebellion](https://sherwood-rebellion.16h6bw5cfk6jc.ca-central-1.cs.amazonlightsail.com/)**

The same HTTPS origin serves the 3D client, health endpoint, and secure Merry Band WebSocket rooms.

## Run

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local`, then open the local URL Vite prints. The checked-in values are a Supabase publishable URL and key; never put a secret or service-role key in a `VITE_` variable.

Controls: WASD or click to move, `E` to interact, Space to fire, and `Q` to use the selected outlaw's signature ability.

## Supabase

The global leaderboard reads verified scores from Supabase and listens for new verified runs through Realtime. Browser clients have read-only RLS access: they cannot insert or modify ranked results. A room server configured with the server-only Supabase secret submits authoritative outcomes; an unconfigured server remains playable but keeps completed local runs in the browser's unverified offline preview.

The reproducible schema is in [`supabase/migrations`](./supabase/migrations). Generated database types live in [`src/database.types.ts`](./src/database.types.ts).

## Verify

```bash
npm test
npm run build
```

See [PRD.md](./PRD.md) for the complete product requirements and [GAME_PLAN.md](./GAME_PLAN.md) for the original vertical-slice roadmap.
