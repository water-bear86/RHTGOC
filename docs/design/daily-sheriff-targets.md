# Daily Sheriff targets and regional bounties

Daily targets are server-owned overlays on validated mission packages. They create tactical variation without generating new maps or allowing the browser to author modifiers or rewards.

## Schedule

At 00:00 UTC, schedule version `1.0.0` deterministically publishes three targets:

- one exact two-player bracket;
- one exact three-player bracket;
- one exact four-player bracket.

Each target contains an immutable ID, start/end timestamps, mission slug/version/content hash, region, party bracket, one or more catalog-valid modifier IDs, a catalog-valid optional objective ID, and a presentation-only reward label. The next day's three targets are published in the same room-state payload so the campfire can preview them.

The generator hashes schedule version, UTC date, and party bracket. Given the same catalog and schedule version, operators and tests can reproduce any target. Mission, modifier, and objective references are validated against `MISSION_CATALOG`; duplicate or forged modifier sets are rejected.

## Launch authority

Only the room leader can select a target. Selection stores its ID and mission slug, but the room validates the target again when the last player readies:

- the target must still be active and unpaused;
- the connected party must exactly match its bracket;
- mission version and content hash must still match the catalog;
- every forced modifier must exist in the selected package.

Any failure clears all forged/stale readiness and keeps the room in the campfire. The `Mission` constructor performs a second identity and modifier check. The resulting snapshot and mastery results expose the rotation ID, forced modifier IDs, and target objective IDs.

Successful verified-run payloads include `rotationId` and `rotationModifierIds` in the database score breakdown. The existing mission verification ID still prevents duplicate reward settlement across retries and reconnects.

## Operator controls

`GET /rotations` is public and cache-disabled. When `OPS_ADMIN_SECRET` is configured, an operator can change the active service without a browser deploy:

- `POST /admin/rotations/pause` with `{ "until": <epoch-ms> }` pauses targets for up to seven days.
- `POST /admin/rotations/replace` with `{ "rotations": [...] }` installs one to three active, catalog-valid replacements.
- `POST /admin/rotations/rollback` clears pause/replacement state and immediately restores the deterministic schedule.

Admin routes require `Authorization: Bearer $OPS_ADMIN_SECRET`; missing configuration returns 503 and bad credentials return 401. Changes and unauthorized attempts are counted and structured-log audited. Runtime rollback is deliberately simple: a process restart also returns to the deterministic schedule.

## Telemetry

The server records selections, starts, completions/failures, repeat attempts, party bracket, forced modifier mix, and role mix. Rotation identity also appears in mission debug output and result details. This supports difficulty analysis without recording chat, movement history, or other unnecessary personal data.

## Verification

- Pure tests cover deterministic generation, every party bracket, UTC boundary rollover, upcoming parity, pause, replacement, rollback, stale windows, duplicated modifiers, and forged mission identity.
- Room tests cover leader ownership, exact party-size launch, expiry revalidation, readiness clearing, forced modifiers/objectives, and attempt accounting.
- The live HTTP service returned three current and three upcoming targets, rejected an unauthenticated pause with 401, applied an authenticated pause, and restored all targets through rollback.
- A two-context Chromium test selected the live two-player target at the campfire, synchronized it to the joining player, launched the correct mission, and matched the server-forced rotation ID, modifiers, and content hash with zero console, page, or request errors.
- Visual proofs: `/tmp/sherwood-qa/daily-target-hub.png` and `/tmp/sherwood-qa/daily-target-mission.png`.
