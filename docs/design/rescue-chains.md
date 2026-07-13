# Bounded rescue chains

Rescue chains turn selected failures into one optional cooperative follow-up without copying the failed simulation, locking captured players out of ordinary play, or allowing an infinite failure loop.

## Eligibility and identity

When a standard mission fails, the room creates at most one deterministic offer for that source mission ID. The privacy-safe context is one of:

- captured outlaws;
- unrescued prison-wagon captives;
- Sheriff-recovered supplies.

The offer exposes only a target count and generic context inside the existing private room. It does not include player names, public history, chat, or a discoverable room. Its ID is a stable UUID derived from the source mission ID, and the offer expires 30 minutes after creation.

A failed rescue mission cannot generate another rescue offer. This bounds every chain to one follow-up.

## Player flow

1. The failed mission produces an explicit result and one active offer.
2. The leader returns the band to the normal campfire. All captured/downed state is reset, so every player can immediately choose an ordinary mission instead.
3. The offer stays visible with its context and countdown. Existing room-code/direct-invite paths can bring replacement helpers into the private lobby.
4. Only the room leader can accept or abandon. Concurrent or duplicate acceptance loses to the first valid transition.
5. Acceptance selects a fresh `prison-wagon@1.0.0` mission reference carrying only `rescueOfferId` and `rescueSourceMissionId`; it does not clone guards, positions, timers, or rewards from the failed run.
6. Launch increments the attempt once. Success settles recovered value and rescuer credit once; failure, expiry, or abandonment is terminal.

Accepted players are still free to choose a normal mission or daily target before launch. Doing so releases the offer back to active rather than imposing a penalty or lockout.

## Authority and idempotency

The room server owns offer creation, status, acceptance, expiry, mission reference, attempts, completion, and recovered value. Reconnecting clients receive the same room-state offer. Client messages contain only an offer UUID; stale, expired, terminal, non-leader, and duplicate requests are rejected.

Mission snapshots and verified score breakdowns include the rescue offer identity. The prison mission already gives server-owned captive extraction and rescuer counts. A `rewardSettled` guard and terminal state check prevent repeat recovery.

## Persistence

Migration `20260711061439_add_rescue_chain_offers.sql` adds private service-only `rescue_offers` and append-only `rescue_offer_events` tables. The RPC:

- enforces monotonic terminal states;
- rejects terminal rewrites;
- upserts attempt/recovery maxima;
- deduplicates `(offer_id, sequence)`;
- permits no anonymous or authenticated browser access.

The room drains transition events into a bounded server retry queue. With `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, failed writes back off up to 60 seconds and expose queue/success/retry telemetry. The current local and AWS runtime still lack that secret, so persistence activation remains part of the existing #14 deployment blocker; the schema, RPC, store, retry path, and live transaction are complete.

## Verification

- Room tests cover one-off creation, deterministic identity, reconnect continuity, leader-only concurrent acceptance, duplicate rejection, fresh mission reference, captured-player reset, exactly-once completion, expiry, abandonment, and bounded repeated failure.
- Store tests cover the RPC contract and error path used by retry telemetry.
- The live Supabase migration is applied. A rollback transaction persisted active → accepted → completed as exactly three events, settled one 300-value recovery, and ignored the replay.
- A two-context Chromium run allowed a prison wagon to fail naturally, returned both players to camp, displayed privacy-safe offer copy, accepted it, and launched a fresh prison mission with the same offer/source identities and zero console, page, or request errors.
- Visual proofs: `/tmp/sherwood-qa/rescue-offer-hub.png` and `/tmp/sherwood-qa/rescue-chain-mission.png`.
