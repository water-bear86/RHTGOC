# Bounded Band and Camp chat

Sherwood Rebellion has one typed-chat surface with two deliberately small channels. `Band` belongs to the current private Merry Band room. `Camp` belongs only to the current authenticated public-camp instance, which contains at most 12 players. Neither channel is global, and neither follows a player between rooms or instances.

## Player experience

- Press Enter during online play to open a one-line quick composer. Enter sends, Escape cancels, and input-method composition must finish before Enter can send.
- The two newest visible messages remain over the playfield for about six seconds.
- The full chat button opens a scrollable desktop drawer or a mobile bottom sheet. It contains Band and Camp tabs, unread counts, a new-message affordance when the reader is away from the bottom, and a sticky composer.
- Opening either composer clears held movement, cancels click-to-move, sends neutral movement, and suppresses movement, camera, fire, ping, controller, and canvas-click input until focus returns to play. The authoritative online simulation never pauses.
- History is selectable text and uses a polite live region for new arrivals. Loading or changing history must not re-announce old messages.

## Channel contract

| Property | Band | Camp |
| --- | --- | --- |
| Audience | Current private room | Current public-camp instance |
| Identity | Guest or authenticated room identity | Verified authenticated identity |
| History | Last 50 messages for room lifetime | Last 100 messages, no older than 30 minutes |
| Send limit | One per second; five per 10 seconds | One per 1.5 seconds; eight per 30 seconds |
| Persistence | None | None |
| Production gate | Room service available | Durable moderation-evidence store configured |

The server owns sender identity, character, message ID, sequence, timestamp, and channel. Clients submit only a channel and candidate text. Text is Unicode-normalized, stripped of control and bidirectional-spoofing characters, trimmed, and limited to 160 characters. It is rendered with text nodes only: no HTML, Markdown, attachments, embeds, or clickable links.

Repeated identical text from the same sender is rejected for 30 seconds. The WebSocket server rejects payloads larger than 32 KiB before protocol parsing. Chat history is sent separately from room state and simulation snapshots so the 10 Hz gameplay stream never carries message content.

## Safety and privacy

Mute is local and hides a sender's typed chat, pings, and emotes. A public-camp block removes both players from each other's projection and hides already received messages as well as future ones. Room removal and reconnect blocking remain moderator-only actions.

A report contains a server-known message ID and one fixed reason: harassment, griefing, unsafe name, or cheating. The server resolves the sender, exact normalized text, and channel. A Band report remains in the room's bounded in-memory audit and disappears with the room. An authenticated Camp report additionally resolves bounded surrounding context and must persist as private moderation evidence before the server accepts it. General history is never written to the database, logs, telemetry, analytics, GitHub issues, or release artifacts.

Camp chat fails closed unless the room server has a verified Supabase identity boundary and a durable report-evidence store. Band chat remains available without database credentials because its private, bounded history disappears with the room. Voice, direct messages, global or cross-instance chat, media, links, free-text reports, and automated content moderation remain out of scope.

Reported evidence is service-role-only and retained for 30 days. Operators record retention runs without copying report content into the release log. Production activation requires a reviewed migration, matching local and remote migration ledgers, database security/performance advisor checks, and an end-to-end authenticated report proof.
