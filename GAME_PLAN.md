# Sherwood Rebellion — game plan

## North star

Build an approachable true-3D cooperative browser game where a first-time outlaw can understand the complete vocabulary in one minute, while coordinated bands can spend months mastering routes, guard behavior, hero technique chains, risk, rescue, and redistribution.

The permanent playtest is an alpha service, not a finished MMO. Small-group mission quality, trustworthy persistence, readable 3D gameplay, and measurable player learning come before world scale.

## Completed foundation — M1 through M7

- Robin, Maid Marian, Little John, and Much are playable named heroes with distinct roles.
- Two-to-four-player Merry Band rooms use authoritative missions, readiness, shared guards and objectives, pings, loot transfer, downing, revival, reconnects, and redistribution votes.
- The campfire mission board offers three validated missions: tax-cart robbery, prison-wagon rescue, and royal-storehouse infiltration.
- Routes, optional objectives, Sheriff modifiers, mastery scoring, daily targets, rescue follow-ups, and band preparations make runs replayable.
- The social layer includes a public opt-in campfire, privacy-safe friends/presence/invitations, account blocking, reports, and persistent-band schemas.
- Seasonal village projects, Sheriff pressure, campaign finales, verified leaderboard paths, quarantine review, and archive/finalization rules exist in code.
- The permanent AWS Lightsail origin serves the browser client, health endpoint, and secure WebSocket rooms from one origin.

Production persistence is not active: the live container lacks the server-only Supabase credential, so all six persistence-backed capabilities remain fail-closed. Issues #9, #10, and #14 own that release boundary.

## Completed art/runtime milestone — M8

Delivered in draft PR [#38](https://github.com/water-bear86/sherwood-rebellion/pull/38):

- A browser-ready GLB manifest and automated asset gate.
- A repaired, grounded Robin model with bow, quiver, one skin, and three clips.
- A shared restrained four-step toon-material system.
- Measured standard and forced-degraded render profiles.
- A deterministic 677,248-byte CC0 village module catalog with 12 stable roots, seven material families, sixteen embedded 512-pixel WebPs, and 23 renderer submissions.
- One authored cottage and wagon shell with procedural LOD fallbacks and shared client/server cottage collision.

Verification completed:

- The gate runs the official Khronos validator against bytes, binds license evidence by SHA-256, validates SPDX, counts transparent two-pass materials, and rejects adversarial fixtures.
- An offline rebuild from `/tmp` produced the accepted GLB hash without fetching executable tooling.
- Standard and degraded profiles render all three authoritative missions under budget with no new browser errors.
- Resize and deliberate WebGL context loss/restoration preserve the complete 3D scene.
- The unlicensed `Free Sample` pack is rejected. Raw source packs remain outside the runtime.

No M9 feature implementation starts until #9, #10, #14, and #39 produce a persistence-enabled, traceable mainline release.

## Next sprint — M9 Deeper Sherwood Public Alpha

The ordered GitHub backlog is:

1. #39 — establish a releasable mainline and automated promotion gate.
2. #40 — teach the complete game in a five-minute Practice Grove.
3. #41 — add hero technique chains and cooperative combo mastery.
4. #42 — add readable stealth, sound, and guard investigation.
5. #43 — build a cooperative planning table with route voting.
6. #44 — create a data-driven regional world composer.
7. #45 — ship the Nottingham Market tax-ledger raid.
8. #46 — add role-aware opt-in matchmaking from the public campfire.
9. #47 — add verified run replays and privacy-safe challenge codes.
10. #48 — add co-op accessibility assists with a fair scoring contract.
11. #49 — enforce runtime performance and network budgets in CI.
12. #50 — run an instrumented public-alpha playtest and publish the tuning report.

M9 is complete only when first-time players can learn the game quickly, returning bands can demonstrate deeper mastery, the new region stays inside browser/network budgets, accessibility is a release criterion, the deployed commit is traceable, and real playtest evidence produces the next ranked backlog.

## Later horizon

- More authored Sherwood and Nottingham regions assembled from the versioned world-composer contract.
- Villagers, wildlife, ambient audio, day/night, weather, crafting, camp decoration, reputation, and cosmetics.
- Durable replay storage, regional service scaling, and content operations when measured concurrency requires them.
- A larger connected world only after instanced hubs and missions prove retention, safety, reliability, and cost.

Open trading, tokens, PvP, unrestricted chat, user-generated content, and pay-to-win progression remain out of scope.

## Technical guardrails

- Three.js, TypeScript, and Vite remain the browser runtime; WebGL gameplay stays true 3D.
- Simulation, mission rules, and collision stay serializable and renderer-independent.
- The server owns positions, guards, objectives, combat, rewards, social mutation, campaign state, and ranked outcomes.
- Runtime assets are curated GLB/glTF 2.0 with license evidence, measured geometry/texture/draw cost, simple shared collision, and explicit LOD behavior.
- Standard and degraded profiles must preserve routes, collision, visibility rules, and scoring.
- The client never receives Supabase or operator secrets and never authors verified score values.
