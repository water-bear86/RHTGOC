# Observability and reliability

The room server exposes privacy-safe operational telemetry at `GET /metrics`. It contains aggregate counters, gauges, and uptime only. Display names, room codes, reconnect tokens, player IDs, IP addresses, and chat content are never logged or exported.

Each room receives an ephemeral trace ID. Structured one-line JSON events follow that trace through room creation, mission phases, resolution, persistence, and expiry. Trace IDs are deliberately unrelated to join codes and disappear when the room expires.

## Mission and social funnel

Key counters:

- `rooms_created_total`, `room_joins_total`, `players_ready_total`
- `mission_phase_<phase>_total`, `mission_succeeded_total`, `mission_failed_total`
- `action_<action>_total`, `world_pings_total`, `redistribution_votes_total`
- `reconnect_attempts_total`, `reconnect_success_total`, `disconnects_total`
- `band_restore_<success|failure>_total`, `band_persistence_queue`, `band_persistence_<success|idempotent|retry>_total`
- `leaderboard_persistence_queue`, `leaderboard_persistence_<success|retry>_total`, `leaderboard_quarantine_total`
- `protocol_invalid_json_total`, `protocol_invalid_message_total`
- `client_metrics_reports_total`, `input_backlog_<bucket>_total`, `snapshot_gap_<bucket>_total`
- `season_<mission|contribution|operator>_events_total`, `season_pressure`, `season_persistence_queue`, `season_persistence_<success|retry>_total`
- `recent_players_persistence_queue`, `recent_players_persistence_<success|retry>_total`; Supabase `social_rate_events` is the source for friend-request and direct-invite abuse review.
- `band_membership_<offers|accepts|declines|removals>_total`, `band_membership_<accept|remove>_failure_total`, `band_identity_<updates|update_failure>_total`, and `band_hero_role_update_<total|failure_total>`.
- `public_hub_instances`, `public_hub_players`, `hub_opt_ins_total`, `hub_private_bands_formed_total`, `hub_<emote|ping>_*`, `hub_*_rate_limited_total`, `hub_reports_total`, and `hub_blocks_total`.

Key gauges: `active_connections`, `active_rooms`, and `active_players`.

## Alerts

For the alpha, poll `/health` and `/metrics` once per minute and alert when:

- `/health` fails twice consecutively.
- Reconnect success is below 95% over 5 minutes with at least 20 attempts.
- Invalid protocol messages exceed 2% of inbound connections over 5 minutes.
- Either band or leaderboard persistence retry counter rises for 5 consecutive minutes, or either queue remains nonzero for 10 minutes.
- Active connections exceed 80 or active rooms exceed 35 on the single micro instance.
- The container restarts twice within 15 minutes.

Mission failure and phase drop-off are product signals, not paging alerts. Review them weekly by route, modifier set, party size, and hero mix. The browser reports coarse authoritative input-backlog and snapshot-gap buckets at most once every 10 seconds. The server rate-limits those reports and never retains a per-player series.

## Reliability tests

Start the room server, then run:

```bash
npm run test:load
npm run test:reconnect
ROOMS=4 DURATION_MS=5000 MIN_SNAPSHOTS=30 npm run test:soak
```

`test:load` creates 12 simultaneous two-player missions, drives authoritative movement, and fails on snapshot starvation. `test:soak` uses the same harness for a longer bounded run. `test:reconnect` injects malformed JSON and an abrupt transport failure, then proves that the reconnect token restores the same authoritative player and the server still answers pings.

For a release candidate, run the default 60-second soak and record the `/metrics` snapshot in the playtest report. Raise `ROOMS` in steps only while CPU, memory, reconnect rate, and snapshot delivery remain healthy.
