# Merry Band persistence operations

## Data boundary

Merry Bands, active membership, preset banners, mission history, community grants, camp state, village state, and audit events live in the Supabase project `whkaenfnefhuezkutnxe`. Every public table has RLS enabled. Authenticated clients receive read-only access to their own active band rows; all mutation goes through the authoritative game server using `SUPABASE_SECRET_KEY`.

The secret key is a runtime secret. It must never use a `VITE_` prefix, enter the browser bundle, appear in screenshots, or be committed. If it is absent, the server must leave persistent-band features unavailable rather than opening anonymous writes.

## Idempotency and audit

- A band mission is unique on `(band_id, mission_id)`.
- A progression grant is unique on `(band_id, mission_id, grant_key)`.
- `apply_band_mission_reward` returns `false` for a duplicate grant and does not advance village progression twice.
- Band, membership, mission-history, and grant changes write before/after JSON to `band_audit_log`.
- Only active band leaders can read audit rows through the Data API.

## Migration workflow

1. Create every file with `supabase migration new <name>`.
2. Apply the reviewed migration to a development branch when one is available; otherwise apply once to the alpha project through the connected Supabase migration tool.
3. Run Supabase security and performance advisors.
4. Generate TypeScript database types and run the server test suite.
5. Deploy the game server only after the migration is visible in the remote migration list.

## Backup and recovery

Supabase provides daily project backups. Before a destructive schema change or season rollover:

1. Confirm the latest backup in the Supabase dashboard.
2. Export `merry_bands`, `merry_band_members`, `band_mission_history`, `band_progression_grants`, and `band_audit_log` to encrypted operator storage.
3. Retain immutable season and mission identifiers so grants can be replayed idempotently.
4. Restore into a temporary project first and verify row counts, foreign keys, RLS policies, and audit continuity.
5. Run a no-op duplicate grant against the restored database; it must return `false` and leave progression unchanged.
6. Point a staging server at the restored project before any production cutover.

Enable Point-in-Time Recovery before the public alpha if the recovery-point objective must be shorter than the daily backup interval.
