# Gameplay analytics operations

## Runtime and privacy boundary

Gameplay analytics is a coarse, server-owned product signal, not a player tracking system. Sampling occurs only while the client-transmitted product analytics preference and the authoritative room flag are both `true`. The current browser preference is enabled unless a player explicitly disables it in Privacy settings; changing that setting updates the room immediately.

Database persistence is a separate, fail-closed switch. It activates only when `GAMEPLAY_ANALYTICS_ENABLED=true`, `SUPABASE_URL`, and the server-only `SUPABASE_SECRET_KEY` are all present. If the secret is absent, the gameplay store and `ExperimentService` remain inactive, `/health` reports `gameplayAnalytics: false` and `experiments: false`, and play continues without durable analytics or experiment loading.

The durable payload may contain only:

- five-minute `windowStart`, mission slug, map version, phase, and `buildId`;
- an all-or-none experiment ID, revision, and variant ID dimension;
- an 8 m `cellX`/`cellZ` bucket; and
- fixed aggregate counters.

Never persist or export player/Auth IDs, display names, room or join codes, reconnect tokens, IP addresses, user-agent/browser detail, client diagnostic or device fingerprints, raw coordinates, or movement paths. The sampler may keep an opaque room scope plus a numeric player slot in process memory solely to enforce the one-sample-per-second limit and count cell entry transitions. That subject state is bounded by in-process retention, while the experiment cache is explicitly released when a mission returns to the hub or its room expires. Neither value belongs in a batch, report, log, or experiment assignment.

The database's `payload_digest` is an internal MD5 digest of the schema version, creation timestamp, and aggregate rows. It exists only to detect conflicting reuse of a batch ID. It is not a client diagnostic fingerprint, device fingerprint, player identifier, or cross-batch tracking key and must not be exposed in reports.

Accepted position observations are capped at 1 Hz per ephemeral room scope and player slot, quantized immediately into 8 m cells, and combined into five-minute windows. Do not retain the raw input after incrementing the aggregate. `buildId` must remain a first-class dimension so a canary can be compared with its baseline. When an experiment applies, its ID, revision, and variant are also dimensions; the three values are either all populated or all `null`.

Diagnostics are fixed codes, never free text or exception content:

- `webgl_context_lost`
- `asset_load_failed`
- `uncaught_error`
- `unhandled_rejection`
- `frame_stall`
- `snapshot_desync`

The server bridge must read only the code. Do not forward the client's fingerprint, browser family/major version, render profile, error message, stack, URL, or arbitrary diagnostic fields into `GameplayAnalyticsAggregator`.

## Server integration

Create the persistence store and `ExperimentService` through their environment-backed factories; both return `null` without the Supabase URL and secret. Construct `GameplayAnalyticsAggregator` only when the store exists, and gate that path with `GAMEPLAY_ANALYTICS_ENABLED=true` in the room server.

Refresh active experiment definitions on startup and periodically. Assign against one opaque room scope at mission start, store the returned assignment on the in-memory `Room`, and reuse it for every snapshot and aggregate until that room/mission ends:

```ts
await experimentService?.refresh(Date.now(), true)

const roomScope = room.analyticsScope()
const assignments = experimentService?.assignRoom(roomScope) ?? []
room.experimentAssignments = assignments.slice(0, 1)

// A refresh can change definitions for new rooms, never this room's assignment.
// On expiry, remove the only cached association with the opaque room scope.
experimentService?.releaseRoom(roomScope)
```

`ExperimentService` hashes the definition salt, experiment ID/revision, purpose, and room scope into deterministic enrollment and variant buckets. Assignment is room-scoped, frozen for the room, and never written to an assignment table. Reports persist only the non-identifying experiment/variant dimension attached to aggregates. A pause or revision therefore affects new rooms; never mutate an in-flight room to force a rebucket.

Build one validated dimension from authoritative room state, then pass only coarse inputs to the aggregator:

```ts
const assignment = room.experimentAssignments[0] ?? null
const dimension: GameplayAnalyticsDimension = {
  missionSlug: room.mission.definition.slug,
  mapVersion: room.mission.definition.contentHash,
  buildId: room.clientBuildId(player.id),
  phase: room.mission.phase,
  experimentId: assignment?.experimentId ?? null,
  experimentRevision: assignment?.experimentRevision ?? null,
  variantId: assignment?.variantId ?? null,
}

if (room.hasProductAnalyticsConsent(player.id)) {
  gameplayAnalytics.observe(roomScope, playerSlot, {
    observedAtMs: Date.now(),
    x: player.position.x,
    z: player.position.z,
    dangerNearby,
    dimension,
  })

  gameplayAnalytics.recordEvent({
    observedAtMs: Date.now(),
    x: player.position.x,
    z: player.position.z,
    event: "objective-interaction",
    dimension,
  })

  // diagnostic.code is the validated ClientDiagnosticCode; discard every
  // other client diagnostic field before this boundary.
  gameplayAnalytics.recordDiagnostic({
    observedAtMs: Date.now(),
    x: player.position.x,
    z: player.position.z,
    code: diagnostic.code,
    dimension,
  })
}
```

`observe` performs the 1 Hz gate and cell-entry accounting. `recordEvent` accepts only the fixed gameplay event union. `recordDiagnostic` increments `clientErrorCount` plus the matching fixed diagnostic counter. These methods quantize coordinates before aggregation; callers must not log, queue, or persist the raw values.

## Migration and release drill

The API contract is [`supabase/migrations/20260713203547_gameplay_analytics_experiments.sql`](../../supabase/migrations/20260713203547_gameplay_analytics_experiments.sql). Apply migrations to a linked staging project through the migration ledger, never by pasting the file into the production SQL editor:

```bash
supabase db push --dry-run
supabase db push
supabase migration list
```

Run the assertion against staging or a disposable restored project with a direct database URL:

```bash
psql -X -v ON_ERROR_STOP=1 "$STAGING_DATABASE_URL" \
  -f tools/gameplay-analytics-drill.sql
```

The drill checks that `anon` and `authenticated` cannot execute any analytics or experiment RPC while `service_role` can. None of those roles, including `service_role`, may use the private schema or select its three tables directly; security-definer RPCs are the only database boundary. The drill upserts and reads an experiment, proves a stored revision definition is immutable, ingests the exact 26-key row twice to prove idempotency, rejects a row containing `playerId`, queries the report, exercises retention, and rolls back every write. Any failed assertion exits nonzero; a disconnected session also rolls back its open transaction.

## Experiment operations

Only a trusted server or operator database session may call experiment RPCs. `SUPABASE_SECRET_KEY` maps to the elevated `service_role` database role and must never use a `VITE_` prefix or enter browser code, logs, Git history, screenshots, shell history, URLs, or issue comments.

Create a low-allocation canary as a new immutable revision. Variant weights must total 10,000 basis points; `allocationBps` controls what fraction of new room scopes enroll:

```sql
begin;
set local role service_role;

select public.upsert_gameplay_experiment(
  '{
    "id": "guard-pressure",
    "revision": 1,
    "salt": "guard-pressure-r1",
    "allocationBps": 500,
    "variants": [
      {"id": "control", "weightBps": 5000, "config": {"guardPressure": 1}},
      {"id": "treatment", "weightBps": 5000, "config": {"guardPressure": 2}}
    ]
  }'::jsonb,
  'active',
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp() + interval '7 days'
);

commit;
```

Use `draft` while reviewing a definition, `active` to expose it to eligible new rooms, `paused` to stop new assignment without deleting history, and `complete` when analysis is closed. Activating a revision automatically pauses another active revision of the same experiment. Once an `(id, revision)` exists, its salt, allocation, variants, weights, and config are immutable; only its status and schedule may be updated. Any definition change requires a new revision and salt so old aggregates keep their original meaning.

## Reports, canaries, and retention

The operator CLI calls the service-only report RPC, validates its response, and renders hotspots, low-dwell cells, fixed diagnostic counters, experiment variants, and build/canary comparisons. It reads `SUPABASE_URL` and `SUPABASE_SECRET_KEY` from the trusted server environment; never pass the secret as an argument. With no flags it reports the last 24 hours:

```bash
node tools/gameplay-analytics-report.mjs
node tools/gameplay-analytics-report.mjs \
  --since 2026-07-12T00:00:00Z \
  --until 2026-07-13T00:00:00Z \
  --limit 5000
node tools/gameplay-analytics-report.mjs --json > gameplay-analytics-summary.json
```

The RPC permits one to 5,000 rows across at most 90 days. Treat redirected JSON as sensitive operational data, keep it in approved encrypted storage, and delete it under the same release-evidence retention policy.

For a canary, compare the same mission, map version, phase, and five-minute windows by `buildId`, experiment revision, and variant. Review at least mission success/start, mission failure/start, danger/sample, stuck recovery/sample, and each diagnostic/sample rate. Require enough starts to avoid reacting to single-room noise. Pause the experiment if treatment regresses a guardrail; already assigned rooms remain frozen, while new rooms stop enrolling after the next definition refresh.

Retention is explicit and service-only. Schedule the prune RPC from trusted server infrastructure; the boundary must be at least seven days old. This example keeps 90 days and deletes older batch-ledger rows, cascading their aggregates:

```sql
begin;
set local role service_role;
select public.prune_gameplay_analytics(
  pg_catalog.clock_timestamp() - interval '90 days'
);
commit;
```

Record the retention window, execution time, deleted batch count, and operator in the release log without copying report rows or secrets. Do not delete directly from the private tables and do not grant browser roles access to them.
