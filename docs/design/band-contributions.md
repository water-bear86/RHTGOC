# Asynchronous band contributions

Band contributions let an outlaw leave one small, understandable advantage for a later mission without creating a marketplace, tradable inventory, or hidden power curve.

## Player loop

At the campfire, every connected outlaw may deposit up to two available preparations. A room holds at most six available preparations and at most two of any type. The band leader selects at most three before readiness locks the mission.

| Contribution | Planning promise | Visible mission result | Consumption |
| --- | --- | --- | --- |
| Supplies | A one-use field restock | Gold-banded supply crate near the spawn | On interaction |
| Intelligence | The contributor's scout report is credited in the plan | Map board at the planning point | At mission start |
| Snare kit | A trap is pre-positioned on the chosen approach | Full road-snare world model and authoritative trap | At mission start |
| Safe house | A one-use recovery point is prepared | Green extraction tent that restores health and arrows | On interaction |

The planning list, mission debug view, HUD preparation count, world models, event captions, and results breakdown all expose who contributed and whether the resource was consumed. No contribution changes mission reward calculation.

## Lifecycle and abuse bounds

The room server owns the state machine:

`available -> locked -> consumed | refunded`

`available -> expired | revoked`

- Available resources expire after 24 hours.
- Only the contributor may revoke an unlocked resource.
- Only the connected room leader may select resources.
- Readiness atomically locks the selected set to a fresh mission UUID; stale selection messages cannot add anything afterward.
- Intelligence and snares settle at mission start. Supplies and safe-house aid settle only on an authoritative proximity interaction.
- Unused supplies and safe-house aid are refunded on any terminal run, including a return-to-hub cancellation race.
- Room history is bounded while the full transition audit is written asynchronously with retry telemetry.

Player-to-player trading, currency exchange, purchased consumables, and public contribution feeds are deliberately absent.

## Persistence and operations

Migration `20260711070000_add_band_contributions.sql` creates private, service-role-only contribution and event tables plus an idempotent transition RPC. It rejects missing initial deposits, illegal lifecycle changes, and mutations after a terminal state. The server queues every transition and retries failed Supabase writes with bounded exponential backoff.

The production schema was drilled through `available -> locked -> consumed`: exactly three audit events were written, replaying the consumed event was idempotent, and the drill record was removed afterward. RLS intentionally has no public policies because neither table is a client-readable surface.

Runtime persistence activates when the room service receives `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. Until the AWS runtime secret is installed under the persistence-hardening work, `/health` reports `contributionPersistence: false`; gameplay remains server-authoritative and the retry path remains covered by tests.
