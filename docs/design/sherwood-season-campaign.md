# Season of the Green Bough

The first Sherwood campaign gives every private band a shared, non-PvP reason to improve the same world. It favors redistribution, rescues, clean escapes, tactical mastery, and small asynchronous preparations—not raw hoarded wealth.

## Lifecycle

`active -> paused -> active`

`active -> finale -> succeeded | failed -> archived`

The initial campaign runs for 90 days. Completing every Tier 3 village project or reaching the scheduled campaign boundary exposes the finale. Finale participation requires a server-verified daily Sheriff target: three successful marks win, while five attempts without three successes fail the campaign. Either outcome preserves village totals, recognition, identity, safety history, band membership, cosmetics, and entitlements. Archival freezes the event-sourced snapshot; starting the next season creates a new campaign row instead of wiping permanent data.

## Shared projects

Each project has visible thresholds at 600, 1,800, and 3,600 points:

- **Greenwood Granary:** redistribution votes and supply caches.
- **St. Mary's Shelter:** redistribution votes and safe-house aid.
- **Oakwatch Beacon:** redistribution votes, scout intelligence, and snare kits.

Verified community coin contributes its exact server-owned value. A consumed preparation contributes 25 points once. The browser never submits campaign totals. Every tier enlarges the existing 3D village project and adds a new beacon light, so the village changes at all three thresholds rather than only showing a progress number.

## Sheriff pressure

Failed missions add 10 pressure. Successful missions remove 4; consumed preparations remove 1. Pressure is bounded from 0 to 100. At 35 pressure, a compatible daily target gains Armored Escort; at 70, it can also gain Watchful Sheriff. The validated mission catalog is checked before adding a modifier, duplicates are rejected, and a target is capped at three modifiers. This makes the campaign respond without inventing an impossible mission package.

## Recognition

The authoritative season snapshot accumulates four explainable totals:

- redistributed community coin;
- captives and allies rescued;
- zero-damage clean escapes;
- verified tactical mastery score.

These values are archived with the campaign for later cosmetic recognition. They are not currency and cannot be traded.

## Operations and persistence

Authenticated operator routes support start, pause, resume, extend, rollback, and archive. The service checkpoints the last 32 revisions and restores both state and processed-event IDs during rollback, so replayed mission or contribution events still cannot count twice.

Migration `20260711065530_add_sherwood_campaigns.sql` stores immutable campaign events and revisioned snapshots behind service-role-only RLS. The live drill covered active progress, finale success, archival, idempotent replay, rollback to a recognized terminal state, and cleanup. The room service retries failed writes with bounded exponential backoff and exposes persistence activation in `/health`.
