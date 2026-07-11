# Opt-in public campfire discovery

The public camp is a small authenticated staging space, not an MMO zone. Players explicitly opt in from the title screen, meet at most 11 other visible outlaws, express fixed intent, and move into an ordinary private Merry Band before any mission begins.

## Instance and performance bounds

- Hard cap: 12 connected players per instance.
- Placement prefers an instance containing an accepted friend when capacity permits; otherwise it fills the most populated readable instance first.
- Movement is server-clamped to the camp clearing and rate-limited by monotonic input sequence.
- One idle minute removes a participant. Empty instances are deleted immediately.
- A 120-player service load partitions into exactly ten full instances and cleans all state after the idle boundary.

The browser reuses the existing 3D character pipeline and snapshot interpolation. Public players appear around the authored campfire, including Robin's rigged GLB, while the compact discovery panel protects the playfield.

## Communication and matchmaking

There is no public text or voice. Players may use:

- looking-for-band on/off;
- one trusted-mission preference;
- desired party size from two to four;
- wave, cheer, or bow;
- regroup or target ping.

Emotes have a one-second cooldown and short visual lifetime. Pings have a two-second cooldown. A report is limited to one per target per session and no more than one every five seconds. The server waits for the requested party size, matches compatible looking-for-band players, prioritizes accepted friends, reserves an empty private room for ten seconds, and sends the requester first so leadership is deterministic. Every client then re-enters through normal authenticated room admission, role limits, readiness, and mission validation.

## Safety

Public discovery requires a verified Supabase access token. Guest room-code play remains available, but there is no anonymous public presence. Mute is local. Reports use the existing four fixed reasons, aggregate telemetry without free text, and persist to a private moderation table when the room service is configured. Block immediately removes both players from each other's hub projection; a configured room service also persists the verified UUID pair, deletes friendships, revokes pending invitations, and prevents blocked pairs from being co-placed after reconnect.

Public-hub telemetry tracks opt-ins, leaves, instance/player gauges, formed private bands, fixed emotes/pings, rate-limit rejections, reports, and blocks. No public follower count, chat log, or location feed exists.
