# Friends, presence, and direct invitations

Sherwood's trusted-social layer is deliberately private. Authentication uses a Supabase email magic link; email addresses never enter gameplay tables or appear to other players. Guests retain room-code play, while signed-in players receive a random eight-character friend code.

## Relationship and safety rules

- Friend requests require an exact private code; there is no public name search or follower count.
- Requests are limited to 10 per hour. Direct band invitations are limited to 5 per 10 minutes, deduplicated per sender/recipient/room, and expire after 15 minutes.
- Presence is off by default. When enabled, only accepted friends see `available` or `in-band`; the room code is never shown as a public discovery field.
- Either player can remove a friendship. Blocking deletes the relationship, revokes pending invitations in both directions, suppresses recent-player recording, and prevents new requests or invitations.
- There is no direct message, contact upload, public feed, or unrestricted user content.

## Invitation flow

A signed-in player in a private camp can invite an accepted friend. Accepting the invitation validates its recipient, expiry, and block state in Supabase, then opens the ordinary hero-selection screen with the verified room code and optional hero hint prefilled. It never bypasses capacity, role availability, readiness, or the authoritative join protocol. Room codes remain the fallback.

## Identity and recent players

The browser attaches its current Supabase access token to create/join intent. A configured room server resolves the token through Supabase Auth and stores only the verified user UUID inside the private room instance. Reconnect tokens are bound to that UUID. Clients cannot submit user IDs.

After a terminal authenticated mission, the server writes the two-to-four verified participant UUIDs through an idempotent mission RPC. Each player gets a small recent-outlaws list unless either side blocked the other. This write uses the same bounded retry telemetry as other server persistence.

## Runtime activation

The browser needs only the public Supabase URL and publishable key. Full verified room identity and recent-player writes activate when the room service receives `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and the server-only `SUPABASE_SECRET_KEY`. Anonymous sign-in is intentionally not assumed; the current project has it disabled, so the UI exposes the proper email-link flow rather than manufacturing local identities.
