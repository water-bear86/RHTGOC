# Social safety boundary

Sherwood Rebellion's alpha social surface is deliberately narrow.

Enabled:

- private six-character Merry Band rooms;
- bounded typed Band chat for the current private room, with guest support and in-memory history only;
- bounded typed Camp chat for the current authenticated 12-player public-camp instance when durable moderation-evidence storage is configured;
- preset contextual pings;
- local mute of another player's chat, pings, and emotes;
- fixed-reason reports stored as server audit events;
- private-room removal and reconnect-token blocking by the current room moderator;
- authenticated account blocking across friends, direct invitations, recent players, public-camp discovery, and leaderboard results;
- consent-based persistent Merry Band membership controlled by fixed accept/decline actions;
- validated player and band names;
- server rate limits for room movement, chat and pings, public-hub movement, chat, emotes, pings and reports, plus database-enforced friend-request and direct-invitation limits.

Not enabled:

- global, cross-instance, or direct-message text chat;
- voice chat;
- direct item or currency trading;
- custom emotes;
- free-text reports;
- custom banners, images, or other user-generated content;
- unbounded public discovery or automatic matchmaking without explicit opt-in.

Room moderation and account blocking are intentionally separate. A room moderator can remove a disruptive session and invalidate its reconnect token for that room. A signed-in player can also create a persistent account block; the blocked account is excluded from friendships, pending invitations, recent-player discovery, public-camp visibility, ranked results, and the blocker's received Camp history. Neither path exposes email addresses or permits free-text moderation content.

Typed messages are plain text, server-normalized, capped at 160 characters, rate-limited, and kept only in bounded process memory. A message report uses the server-owned message identity and one fixed reason. Band reports remain in the bounded room audit; authenticated Camp reports persist that message and bounded context as private moderation evidence for 30 days. Normal chat history never enters persistence, logs, telemetry, product analytics, issues, or release artifacts. Camp chat fails closed when that evidence store is unavailable; private Band chat remains available and disappears with its room. The complete contract lives in `docs/design/typed-chat.md`.
