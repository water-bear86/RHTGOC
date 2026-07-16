# Bow wind-up browser playtest

- Date: 2026-07-15
- Build: local uncommitted `main` working tree
- Environment: headed Vite capture on `127.0.0.1:4174`, with the final authoritative protocol smoke on `127.0.0.1:8797`
- Browsers: three headed Playwright Chromium sessions (solo, room host, room guest)
- Assets: the four active recoloured KayKit character GLBs

Port `8787` was deliberately avoided because an older OrbStack service on this machine was still serving protocol 11 there. The final isolated test server reported protocol 15 on `8797`.

## Scenarios

| Scenario | Result | Evidence |
| --- | --- | --- |
| A stationary Fire press begins a readable load | Pass | Solo capture at 0.3 seconds shows Robin holding the drawn bow while the HUD still shows six arrows (`output/playwright/bow-windup/bow-draw.png`). |
| Release, not input, spends the arrow | Pass | The same run retained six arrows during the load and showed five after the 0.6-second release boundary. |
| Movement cancels before release | Pass | Pressing movement 0.25 seconds into the load lowered the bow, displayed `STAND STILL TO DRAW`, and retained all six arrows (`output/playwright/bow-windup/bow-cancelled.png`). |
| Recovery permits movement | Pass | Reducer and authoritative mission tests advance movement during the final 0.4 seconds without cancelling or duplicating the released shot. |
| Locked target can escape | Pass | Solo and server tests spend one arrow and record one shot, but no hit, when the target leaves range before release. |
| Signature cannot hide a bow load | Pass | Client and server interlocks cover both directions through the full action boundary; focused snapshot tests preserve bow visual priority. |
| A delayed or rejected request cannot interrupt an accepted draw on a client timer | Pass | Protocol 15 returns an explicit `action_result`; a fresh socket smoke confirmed a moving shot was rejected with its matching request ID, while accepted shots remain snapshot-authoritative. |
| Down, mission end, disconnect, and reconnect cancel safely | Pass | Solo reducer, mission, room, and reconnect tests clear the action without a late release. |
| Two real clients enter one authoritative mission | Pass | Host Robin and guest Marian joined room `QRRS66`, confirmed distinct roles, readied, and rendered together from live room snapshots. |
| Authoritative room remains healthy under load | Pass | 12 rooms / 24 clients produced 1,056 snapshots over five seconds; reconnect, malformed-message, oversized-payload, and identity-restoration checks passed. |

## Automated gates

- `npx vitest run --maxWorkers=1`: 73 files, 500 tests passed.
- `npm run build`: asset validation, mission validation, TypeScript, and production Vite build passed.
- `npm run test:reconnect` against `ws://127.0.0.1:8797/rooms`: passed.
- `ROOMS=12 DURATION_MS=5000 npm run test:load`: passed with 1,056 snapshots.
- Protocol 15 socket acknowledgement smoke: passed; request 42 returned `action_result` with `accepted: false` for a moving shot.
- `git diff --check`: passed.

The ordinary parallel test command passed once earlier in the feature run, but two review reruns hit the suite's pre-existing five-second `shared/world-composer.test.ts` timeout. That file passes 4/4 in isolation and in the deterministic single-worker full gate above; the claim here is deliberately limited to the reproducible gate.

## Local harness noise

The headed Vite sessions logged the existing optional-access request CORS failure (`127.0.0.1:4174` to `127.0.0.1:8797`), the missing development favicon, and Lit's development-mode warning. None interrupted room creation, snapshots, gameplay input, bow animation, cancellation, or release. Production build output remained clean apart from the existing Rollup size/advisory warnings.
