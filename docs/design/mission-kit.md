# Data-driven mission kit

Mission rules are trusted, versioned JSON packages in `missions/`. They are validated during every production build and parsed again when the authoritative server or browser catalog loads.

## Boundary

- Mission packages own identifiers, content hash, environment asset keys, player/guard/prop spawns, objectives, routes, modifiers, mastery thresholds and weights, rewards, and bounded rule constants.
- The authoritative simulation owns entities, timers, movement, validation, actions, results, and persistence identity.
- Three.js owns scene objects, animation, camera, effects, and readable representations of authoritative state.
- Mission packages never contain executable code or runtime URLs and are never downloaded from users.

The shared catalog exposes the same parsed package to client and server. Every authoritative snapshot includes `missionId`, `missionVersion`, and `contentHash`; the browser reports a mismatch instead of silently treating different rules as the same mission.

## Reference package

`missions/peoples-purse.v1.json` is the source of truth for the existing tax-cart heist. Its values preserve the current spawns, two entry and escape routes, modifier pool, 15-minute par, mastery weights, delivery targets, cart values, guard layout, world bounds, and trap lifetime.

Stable references use asset-manifest keys grouped by:

- `characters`
- `environments`
- `props`
- `audio`
- `effects`

The mission validator fails when a package references a missing key.

## Create a trusted variant

1. Copy `missions/peoples-purse.v1.json` to a new versioned filename.
2. Change `id`, `slug`, `missionVersion`, and `name`.
3. Change package data only; do not add branches to `server/mission.ts` for ordinary spawn, route, reward, mastery, or modifier changes.
4. Add any new stable environment keys to `public/assets/manifest.json` and ship referenced GLBs through the asset pipeline.
5. Run `npm run validate:missions`. If content changed, validation prints the exact expected hash; set `contentHash` to that value and rerun.
6. Add the reviewed package to `shared/mission-catalog.ts`.
7. Run `npm test`, `npm run build`, and a two-to-four-player browser playtest.

## Validation and debug

`npm run validate:missions` returns field paths such as `routes.entry`, `mastery.weights`, or `environment reference 'prop.example'`. It rejects unsupported schema versions, malformed stable IDs, duplicate objective/route IDs, stale hashes, invalid bounds, incomplete routes, missing spawns, and mastery weights that do not sum to one.

Open Field Notes and choose **Toggle Mission Debug** to see client and server IDs, versions, hashes, validation status, phase, active objective, trigger, routes, modifiers, traps, and signal state. The overlay contains serializable simulation identity only—never Three.js object references.

## Leaderboard identity

Verified runs carry mission version and content hash in the authoritative RPC payload. A protected database trigger hydrates indexed `mission_version` and `mission_content_hash` columns, preserving legacy entries while making new scores traceable to an exact mission ruleset.
