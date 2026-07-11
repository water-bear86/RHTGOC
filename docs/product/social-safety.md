# Social safety boundary

Sherwood Rebellion's alpha social surface is deliberately narrow.

Enabled:

- private six-character Merry Band rooms;
- preset contextual pings;
- local mute of another player's pings;
- fixed-reason reports stored as server audit events;
- private-room removal and reconnect-token blocking by the current room moderator;
- authenticated account blocking across friends, direct invitations, recent players, public-camp discovery, and leaderboard results;
- consent-based persistent Merry Band membership controlled by fixed accept/decline actions;
- validated player and band names;
- server rate limits for room movement and pings, public-hub movement, emotes, pings and reports, plus database-enforced friend-request and direct-invitation limits.

Not enabled:

- public text chat;
- voice chat;
- direct item or currency trading;
- custom emotes;
- free-text reports;
- custom banners, images, or other user-generated content;
- unbounded public discovery or automatic matchmaking without explicit opt-in.

Room moderation and account blocking are intentionally separate. A room moderator can remove a disruptive session and invalidate its reconnect token for that room. A signed-in player can also create a persistent account block; the blocked account is excluded from friendships, pending invitations, recent-player discovery, public-camp visibility, and ranked results. Neither path exposes email addresses or permits free-text moderation content.
