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

The Camp channel is an authenticated, instance-local trollbox, not a global feed. It is available only when durable moderation-evidence storage is configured. It keeps at most 100 in-memory messages for 30 minutes, applies its own send and duplicate limits, and never carries text between public-camp instances. There is no voice, direct messaging, or cross-instance text. Players may also use:

- looking-for-band on/off;
- one shared two-outlaw queue;
- automatic mission selection so a small population is never divided by preferences.

A report is limited to one per target per session and no more than one every five seconds. The server pairs looking-for-band players across public-camp instances, prioritizes accepted friends, reserves an empty private room for ten seconds, and sends the requester first so leadership is deterministic. Every client then re-enters through normal authenticated room admission, role limits, readiness, and mission validation. Private invite rooms retain their two-to-four-player setup.

## Safety

Public discovery requires a verified Supabase access token. Guest room-code play remains available, but there is no anonymous public presence. Mute is local and hides that participant's chat, pings, and emotes. Message reports use the existing four fixed reasons and resolve server-owned message evidence; only the reported message and bounded context persist to a private moderation table for 30 days. Block immediately removes both players from each other's hub projection and received chat history; a configured room service also persists the verified UUID pair, deletes friendships, revokes pending invitations, and prevents blocked pairs from being co-placed after reconnect.

Public-hub telemetry tracks opt-ins, leaves, instance/player gauges, formed private bands, chat send/rejection counts, fixed emotes/pings, reports, and blocks. It never contains message text, sender identity, a chat log, or a location feed.
