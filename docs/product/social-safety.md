# Social safety boundary

Sherwood Rebellion's alpha social surface is deliberately narrow.

Enabled:

- private six-character Merry Band rooms;
- preset contextual pings;
- local mute of another player's pings;
- fixed-reason reports stored as server audit events;
- private-room removal and reconnect-token blocking by the current room moderator;
- validated player and band names;
- server rate limits for movement and contextual pings.

Not enabled:

- public text chat;
- voice chat;
- direct item or currency trading;
- custom emotes;
- free-text reports;
- custom banners, images, or other user-generated content;
- public invites or discovery without the separate safety work in M7.

The current block is room-scoped until authenticated player identity and persistent sanctions are connected. A blocked reconnect token cannot return to that room, but account-level blocking must not be claimed until issue #9's authenticated persistence wiring is complete.
