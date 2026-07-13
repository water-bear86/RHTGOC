# Merry Band persistence operations

## Implementation status

The schema, server stores, idempotency rules, and recovery drills exist in the repository. As checked on 2026-07-11, the permanent AWS service reports `bandPersistence`, `rescueOfferPersistence`, `contributionPersistence`, `seasonPersistence`, and `socialPersistence` as `false`; durable production writes are not active until the server-only credential and end-to-end proofs in #9 and #14 are complete.

## Data boundary

Merry Bands, active membership, preset banners, mission history, community grants, camp state, village state, and audit events live in the Supabase project `whkaenfnefhuezkutnxe`. Every public table has RLS enabled. Authenticated clients receive read-only access to their own active band rows; all mutation goes through the authoritative game server using `SUPABASE_SECRET_KEY`.

Seasonal campaign snapshots and immutable mission/contribution/operator events live in `sherwood_campaigns` and `sherwood_campaign_events`. They are service-role-only: clients receive the current projection through the room server and cannot author totals. On startup, a configured room service prefers the newest non-archived snapshot and processed-event ledger, then falls back to the newest archived campaign so its successor can be started after a restart. Recovery failure fails closed rather than silently starting a competing season.

The secret key is a runtime secret. It must never use a `VITE_` prefix, enter the browser bundle, appear in screenshots, or be committed. If it is absent, the server must leave persistent-band features unavailable rather than opening anonymous writes.

When the room creator has a verified Supabase session, the server calls the service-only `ensure_merry_band` RPC before opening the room. The RPC serializes concurrent creation per user, restores the one active membership, updates the recorded hero role, and returns the privacy-safe band/camp/village projection. Public-hub private-room handoff follows the same path for its first authenticated leader. Guests can still play but never create or mutate persistent records.

Every terminal mission is copied into an in-process backoff queue before the room may be reset or expire. `record_band_mission_outcome` records both success and failure; only a successful resolved redistribution creates a progression grant. The returned band projection refreshes the visible camp card without allowing a delayed response to regress local village progress. Verified leaderboard runs use a separate backoff queue and include the server-verified Auth user and band IDs.

## Idempotency and audit

- A band mission is unique on `(band_id, mission_id)`.
- A progression grant is unique on `(band_id, mission_id, grant_key)`.
- `record_band_mission_outcome` returns `recorded=false` and `progressed=false` for a duplicate mission and does not advance camp or village progression twice.
- Band, membership, mission-history, and grant changes write before/after JSON to `band_audit_log`.
- Only active band leaders can read audit rows through the Data API.

## Migration workflow

1. Create every file with `supabase migration new <name>`.
2. Apply the reviewed migration to a development branch when one is available; otherwise apply once to the alpha project through the connected Supabase migration tool.
3. Run Supabase security and performance advisors.
4. Generate TypeScript database types and run the server test suite.
5. Deploy the game server only after the migration is visible in the remote migration list.

The timestamp and name in every checked-in migration filename must exactly match the remote migration ledger. When the connected migration tool assigns the timestamp, rename the local file to that returned version before committing. A release is blocked until the ordered local filename list and the remote `(version, name)` list are identical; never repair drift by replaying an already-applied schema change.

## Backup and recovery

Supabase provides daily project backups. Before a destructive schema change or season rollover:

1. Confirm the latest backup in the Supabase dashboard.
2. Export `merry_bands`, `merry_band_members`, `band_mission_history`, `band_progression_grants`, and `band_audit_log` to encrypted operator storage.
3. Retain immutable season and mission identifiers so grants can be replayed idempotently.
4. Restore into a temporary project first and verify row counts, foreign keys, RLS policies, and audit continuity.
5. Run a no-op duplicate grant against the restored database; it must return `false` and leave progression unchanged.
6. Point a staging server at the restored project before any production cutover.

Run the transactional recovery assertion against that temporary project:

```bash
psql -f tools/supabase-restore-drill.sql "$RESTORED_DATABASE_URL"
```

The drill creates disposable Auth users and a band inside a transaction, proves explicit member add/remove, band identity updates, and persistent hero-role recovery, applies one idempotent mission grant, proves a replay is rejected, records a failed mission without progression, verifies the restored camp/village/history projection and audit actor continuity, and rolls everything back. Never run a restore drill against the live project. Record the backup timestamp, restored project reference, row counts, assertion output, operator, and deletion time in the release log.

Enable Point-in-Time Recovery before the public alpha if the recovery-point objective must be shorter than the daily backup interval.
