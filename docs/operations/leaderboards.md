# Seasonal leaderboard operations

## Implementation status

The privacy-filtered read path, authoritative write store, quarantine review, lifecycle finalizer, and database drills exist in the repository. As checked on 2026-07-11, the permanent AWS service reports `verifiedLeaderboardWrites: false`; public verified submissions are not active until the server-only credential and production proof in #10 and #14 are complete.

## Ranked mission boundary

Only missions beginning while a Sherwood campaign is `active` or in `finale` are eligible for verified rankings. The room captures the season slug and mission start time at launch; a later pause, archive, or successor season cannot move that run. Paused, succeeded, failed, and archived campaigns remain playable but do not start new ranked runs.

The authoritative server submits the captured start time, clean-escape state, mission version and content hash, score inputs, player identity, and verification UUID. A finale run may begin after the campaign's scheduled `endsAt`; archive time—not the scheduled finale boundary—closes new mission starts.

Only authenticated players receive global verified entries. Public boards use a deterministic, season-scoped alias generated from the authenticated UUID (for example, `Oak Wren A41C`), never the player-authored room name. The alias changes between seasons, contains no user text, and keeps global identity separate from social-profile names. Guest results remain local/offline only.

## Closing and finalization

`record_sherwood_campaign_transition` synchronizes the campaign and leaderboard registry in one database transaction. Archive moves the leaderboard season from `open` to `closing`, records `closed_at`, and sets `finalize_after` to 30 minutes later. That timestamp is the earliest finalization time, not a hard retry deadline.

The server finalizer waits until:

- the minimum 30-minute drain has elapsed;
- no ranked room has an active or unclaimed successful mission;
- the in-process verified-run retry queue is empty; and
- the database has no pending quarantine review for that season.

The database uses the same advisory lifecycle lock for writes, reviews, and finalization. It then writes all five boards and marks the season `finalized` in one transaction. New writes and reviews fail after that state; exact already-recorded replays remain idempotent.

The retry queues are process memory, not a durable outbox. They survive transient database failures while the process remains alive, but not a host/process crash. Do not describe them as restart-safe until a durable outbox is added.

All browser reads use the security-definer `read_leaderboard` RPC. It enforces friend and Merry Band scope against the authenticated social graph, derives bilateral block suppression from the authenticated viewer in the database, and returns no Auth UUID, verification UUID, raw score payload, or audit snapshot. Callers cannot provide arbitrary exclusion UUIDs. Finalized history reads the complete frozen `leaderboard_entries` set. The five append-only `leaderboard_season_snapshots` remain a service-only audit artifact; browser roles cannot select the base entries or snapshot tables directly. Campaign events and snapshot rows are append-only.

## Suspicious-run review

Suspicious authoritative runs never enter a public board immediately. The database stores their complete server-owned result in `leaderboard_quarantine`; browser roles cannot read or mutate that table.

Review requires two independent credentials:

1. `Authorization: Bearer $OPS_ADMIN_SECRET`
2. `X-Sherwood-Operator-Token: $SUPABASE_ACCESS_TOKEN`

The Supabase user represented by the access token must have `app_metadata.sherwood_operator=true`, set through a trusted Supabase admin path. User-editable `user_metadata` never grants review authority. The server derives the reviewer UUID from that token; callers cannot submit or spoof it in the request body.

Use a fixed decision, never free text:

```bash
curl --fail-with-body \
  -X POST "$GAME_ORIGIN/admin/leaderboard/quarantine/review" \
  -H "Authorization: Bearer $OPS_ADMIN_SECRET" \
  -H "X-Sherwood-Operator-Token: $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{"quarantineId":"QUARANTINE_UUID","decision":"rejected"}'
```

An approved run is inserted as `verified=true` and `suspicious=true`, preserving its original verification UUID. A rejected run remains out of public rankings. Replaying the same decision returns the terminal state; requesting the opposite decision returns HTTP 409. Review audit columns retain the authenticated operator UUID and timestamp. Structured application logs contain only the aggregate decision and whether a run was promoted.

Before approval, compare the quarantined payload with the authoritative mission trace, mission version/content hash, party composition, start and elapsed times, and score thresholds. Reject when the server trace cannot independently establish the result.

## Release drill

Run `tools/leaderboard-lifecycle-drill.sql` before releasing a lifecycle change. It executes as `service_role` inside a transaction and rolls everything back. The drill proves finale and post-archive drain writes, three quarantine paths, reviewer attribution, strict replay conflicts, pending-review finalization gates, all five board definitions and stable ordering, immutable history, browser-role denial, and exact replay after finalization.

`SUPABASE_SECRET_KEY` is a fully trusted server credential. It must never reach browser code, logs, Git history, screenshots, or issue comments. Database grants and RPC checks reduce accidental misuse; possession of the service credential remains administrative trust.
