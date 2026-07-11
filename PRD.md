# Sherwood Rebellion — Product Requirements Document

**Status:** Draft v0.1

**Product:** 3D cooperative browser game

**Prototype:** Playable locally

**Core technology:** Three.js, TypeScript, Vite

## 1. Product vision

Sherwood Rebellion is a social 3D browser adventure in which players form outlaw bands, rob the Sheriff, escape through a living Sherwood, and return stolen wealth to communities that visibly change because of their choices.

The product should capture the accessibility and shared-world energy of an isometric browser MMO while building its identity around the Robin Hood fantasy: cooperation, pursuit, resistance, generosity, and the tension between personal reward and collective good.

## 2. Product goals

- Deliver a readable, approachable 3D world that runs directly in a modern browser.
- Make cooperative outlaw missions the primary source of social interaction.
- Create a satisfying loop from scouting through robbery, pursuit, escape, and redistribution.
- Make player generosity and community impact as meaningful as combat or accumulated wealth.
- Establish a technical foundation that can grow from four-player sessions into a persistent shared world.

## 3. Product principles

### True 3D

The game must remain a true 3D experience. Terrain, characters, structures, navigation, lighting, camera behavior, combat, and world interactions must be spatial and rendered in 3D. A 2D implementation is out of scope. Standard DOM UI may overlay the WebGL playfield for accessibility and clarity.

### Cooperation before chat

Social design must begin with reasons to depend on other players. Chat, friend lists, feeds, and leaderboards support the experience but cannot substitute for cooperative mechanics.

### Generosity is progression

Redistributing wealth should unlock visible community improvements, relationships, missions, recruits, and strategic advantages. The game should celebrate collective impact rather than simply rewarding hoarding.

### Small-group quality before MMO scale

The first multiplayer milestone is one excellent two-to-four-player heist. A large persistent world should only follow after small-group play is demonstrably fun, reliable, and replayable.

## 4. Target experience

Players should feel that they are:

- Members of a capable outlaw band rather than anonymous avatars in a crowd.
- Planning and improvising together under pressure.
- Protecting one another during a dangerous escape.
- Changing the condition of Sherwood's villages through shared decisions.
- Building a recognizable reputation as clever, generous, or audacious outlaws.

Initial target session length is 12–20 minutes per heist, with a lightweight campfire intermission between missions.

### Easy to learn, difficult to master

The first minute should teach the complete base vocabulary: move, interact, fire, and use one signature ability. Contextual prompts, generous early timing, readable guard silhouettes, and immediate feedback should make a first robbery achievable without reading a manual.

Long-term mastery should come from systems rather than hidden controls:

- Reading and manipulating patrol routes.
- Managing Wanted pressure instead of simply outrunning it.
- Coordinating role abilities and rescues with precise timing.
- Choosing faster, riskier routes and extraction plans.
- Preserving arrows, health, stealth, and carried loot.
- Completing optional objectives without triggering reinforcements.
- Building a chain of clean actions that increases mission score.

Difficulty may increase through smarter combinations, shorter timing windows, adaptive Sheriff responses, and mission modifiers. It must not rely on unreadable attacks, arbitrary stat inflation, or deliberately awkward controls.

## 5. Core game loop

1. Return to the campfire hub.
2. Form or rejoin a Merry Band of two to four players.
3. Select a royal target and review available intelligence.
4. Choose roles, equipment, entry route, and escape plan.
5. Scout and infiltrate the target area.
6. Rob the target and trigger a dynamic Wanted response.
7. Escape while protecting the loot and reviving downed allies.
8. Return to safety and vote on how to distribute the haul.
9. Improve villages, the outlaw camp, equipment, reputation, or future opportunities.
10. Select the next target as the Sheriff adapts.

## 6. Current vertical slice

The existing prototype establishes:

- A true 3D low-poly Sherwood environment.
- Perspective follow camera with click and keyboard movement.
- A guarded tax cart that can be robbed.
- Guard patrol, pursuit, damage, and archery stun behavior.
- Health, arrows, loot, Wanted heat, village delivery, and win/fail states.
- A responsive DOM HUD over the 3D playfield.
- Renderer-independent simulation state and automated simulation tests.

The current slice is single-player and uses procedural placeholder geometry. It validates the fundamental robbery-and-return loop but not yet the social experience.

## 7. Social product model

### Primary social unit: the Merry Band

A Merry Band is a persistent or session-based group of two to four players. It is the main unit for matchmaking, progression, identity, missions, and social recognition.

A band may eventually have:

- A chosen name and banner.
- A shared camp and visual upgrades.
- A record of successful robberies, rescues, and community contributions.
- Band reputation across villages and regions.
- Lightweight roles and permissions without complex guild administration.

### Cooperative roles

The initial characters should create complementary play without rigidly preventing solo action:

- **Robin — Marksman:** marks priority targets, disables guards at range, and creates openings.
- **Little John — Vanguard:** controls crowds, carries heavy loot, and protects downed allies.
- **Maid Marian — Scout:** reveals patrol routes, uses disguises, cools Wanted pressure more efficiently, and opens alternate paths. Marian must be fully playable from the first character-select milestone rather than existing only as an NPC or support ability.
- **Much — Saboteur:** places traps, disrupts reinforcements, and interferes with wagons or gates.

Character identities may be presented as archetypes or named heroes. Every role must have a useful action during scouting, robbery, and escape.

### Social interaction layers

The first social layer should include:

- Invite codes and private joinable rooms.
- Visible player characters, names, facing, movement, and action state.
- Contextual pings for targets, danger, routes, loot, and regrouping.
- A small set of expressive emotes.
- Shared objectives and team-level Wanted pressure.
- Downed state, rescue, and revival.
- Shared mission results and redistribution vote.

Text and voice chat are not required for the first multiplayer milestone. The game should remain understandable through movement, pings, animation, and contextual actions.

### Global leaderboard

The game should operate a seasonal global leaderboard that recognizes skillful and socially valuable play. It must not reduce success to raw accumulated wealth.

Initial leaderboard boards should include:

- **Master Outlaws:** highest validated mission mastery score.
- **People's Champions:** most wealth successfully redistributed.
- **Clean Escapes:** highest-value missions completed without damage or capture.
- **Rescuers:** most teammate revives and rescue missions completed.
- **Swift Arrows:** fastest validated heist completion for each mission and party size.

Leaderboard entries must record season, mission, party size, character or role, score breakdown, completion time, and validation status. Competitive boards must accept results only from the authoritative mission server. Prototype or offline results may be shown locally but must never be represented as globally verified.

The leaderboard needs filters for global, friends, Merry Band, character, party size, and season. Anti-cheat review, suspicious-score quarantine, privacy-safe display names, and moderation controls are launch requirements for public rankings.

## 8. First social MVP

The first social release must support one complete four-player experience:

### Lobby and party

- One player can create a private Merry Band room.
- Other players can join with a short code or direct invitation.
- The lobby shows connected players, selected roles, readiness, and connection state.
- A mission cannot begin until all connected players are ready.

### Shared 3D mission

- Two to four players inhabit the same authoritative mission instance.
- Remote players move smoothly and display their role, health, and downed state.
- Players can ping world positions and mission objects.
- The tax-cart objective, guards, loot, damage, and Wanted state are shared.
- A player carrying loot moves more slowly and can transfer the burden to an ally.
- A downed player can be revived by another player within a limited window.
- The band succeeds only if the required loot reaches the village or safe house.

### Mission resolution

- The results screen reports loot recovered, players rescued, alarms triggered, and escape time.
- The results screen reports an understandable mastery grade and score breakdown covering speed, stealth, accuracy, damage avoided, rescues, and redistribution.
- Players vote between at least two community uses for the recovered wealth.
- The winning choice produces a visible village or camp change.
- Personal progression cannot override or secretly reduce the agreed community allocation.

## 9. Persistent social expansion

After the social MVP proves successful, expand in this order:

1. Persistent Merry Bands, banners, membership, and shared camp upgrades.
2. Public campfire hub with opt-in proximity and lightweight discovery.
3. Daily Sheriff targets, regional bounties, and rotating mission modifiers.
4. Rescue missions triggered by captured players or failed band missions.
5. Asynchronous contributions such as supplies, intelligence, traps, and safe houses.
6. Community villages built through contributions from multiple bands.
7. Seasonal Sheriff campaigns and regional competition.

Competition should emphasize clean escapes, rescues, generosity, tactical execution, and village loyalty—not raw wealth accumulation alone.

The first seasonal campaign must be an event-sourced, server-authoritative shared world layer. Verified redistribution and consumed band preparations advance three-tier village projects; mission outcomes adjust bounded Sheriff pressure and validated daily-target modifiers. Completing the project set unlocks a finite participation-based finale. Success, failure, rollback, and archival must preserve permanent identity, safety, band membership, cosmetics, entitlements, past recognition, and the immutable campaign audit trail.

Persistent friendship must use authenticated, non-enumerable private friend codes. Presence is opt-in and visible only to accepted, unblocked friends. Direct invitations expire, deduplicate, obey server-observable rate limits, and lead back through ordinary hero selection and authoritative room admission. Blocking removes relationships, revokes invitations, and suppresses recent-player surfaces; room codes remain available to guests.

## 10. Progression and economy

Progression should operate across three connected tracks:

- **Player:** equipment options, cosmetics, role mastery, and personal reputation.
- **Band:** camp facilities, banner identity, mission intelligence, and cooperative perks.
- **Community:** village security, food, health, loyalty, recruits, routes, and available missions.

The first multiplayer version should use only earned in-game resources. A token, marketplace, real-money economy, or player-to-player asset trading is explicitly outside the social MVP.

Future monetization should prioritize cosmetics, banners, camp decoration, emotes, and other non-power identity items. It must not undermine cooperative balance or generosity mechanics.

## 11. World and content requirements

The first production region should contain:

- A campfire hub.
- One village with visible upgrade states.
- A forest traversal space with multiple routes and hiding areas.
- One royal road and guarded tax-cart encounter.
- One safe house or alternate extraction point.
- Patrols, reinforcements, environmental cover, and escape obstacles.

Later regions may include Nottingham, Locksley, royal estates, woodland settlements, and connected wilderness routes.

## 12. UX requirements

- The first playable view must prioritize the 3D world over interface chrome.
- The persistent HUD should show only health, role resources, carried loot, Wanted pressure, and the current objective.
- Party status should remain compact and readable without covering the playfield.
- Contextual pings and interaction prompts should reduce dependence on chat.
- Menus, party setup, mission results, and accessibility settings should use DOM overlays.
- Keyboard, pointer, and controller input should share an explicit action map.
- Mobile may support spectating or lightweight interaction initially; full mobile gameplay is not required for the first social MVP.

## 13. Technical requirements

### Client

- Three.js, TypeScript, and Vite remain the core runtime.
- Simulation rules must remain separate from Three.js renderer objects.
- Remote players must use buffered snapshots and interpolation.
- Shipped 3D assets should use optimized GLB or glTF 2.0.
- Rapier should be introduced when authored collision, projectiles, and physical interactions require it.

### Multiplayer service

- Multiplayer missions must be server-authoritative.
- Clients send input and action intent, not final position, damage, loot, or reward outcomes.
- WebSockets distribute world snapshots, events, pings, and party state.
- The server owns guards, objectives, loot, combat validation, Wanted state, revives, and mission resolution.
- Match instances must support reconnect grace periods and clean host-independent shutdown.

### Persistence

- Persistent storage should cover identity, band membership, cosmetics, role progression, village state, and mission history.
- Mission rewards must be idempotent to prevent duplicate grants during reconnects or retries.
- Audit events should exist for band membership, mission completion, redistribution votes, and reward grants.
- Globally ranked results must be generated and signed by the authoritative mission service; clients may submit display preferences but not score values.

## 14. Safety and moderation

Social features must launch with:

- Player mute and block controls.
- Report flow with a small, explicit reason set.
- Band owner controls for removing members from private rooms.
- Rate limits for invitations, pings, emotes, and future chat.
- Safe default display names and validated band names.
- Server-side enforcement for gameplay actions and rewards.

Public text chat, voice chat, trading, and user-generated content require separate moderation plans before implementation.

## 15. Success metrics

The social MVP should be evaluated on:

- Percentage of created rooms that reach mission start.
- Median time from room creation to mission start.
- Mission completion rate by party size.
- Percentage of missions containing a revive, ping, or loot transfer.
- Percentage of players who complete a second band mission in the same session.
- Seven-day return rate for players who complete at least one social mission.
- Distribution of redistribution-vote outcomes.
- Disconnect, reconnect, and desynchronization rates.
- Reports or blocks per 1,000 social sessions.

The primary qualitative test is whether players naturally tell stories about saving one another, escaping together, and deciding what to do with the money.

## 16. Milestones

### Milestone 0 — Current prototype

- Single-player 3D robbery-and-return loop.
- Procedural placeholder world and characters.
- Local simulation tests and browser playtest.

### Milestone 1 — Multiplayer movement room

- Room creation and join code.
- Two to four synchronized players.
- Names, roles, interpolation, disconnect, and reconnect behavior.

### Milestone 2 — Cooperative heist

- Shared guards, cart, loot, Wanted state, pings, downing, revives, and success/failure.
- Server-authoritative mission simulation.

### Milestone 3 — Social resolution

- Results screen, redistribution vote, persistent band identity, and first visible village upgrades.

### Milestone 4 — Replayable alpha

- Multiple routes and modifiers.
- Role differentiation and balance pass.
- Safety controls, telemetry, persistence hardening, and invite flow polish.

## 17. Non-goals for the social MVP

- A seamless massively multiplayer world.
- Open-world PvP.
- Public marketplace or player trading.
- Blockchain or token integration.
- User-generated levels or objects.
- Public voice or unrestricted text chat.
- Large guild administration systems.
- Pay-to-win progression.

## 18. Open product questions

- Are Merry Band roles fixed named heroes or customizable outlaw archetypes?
- Does all stolen wealth enter the redistribution vote, or does a transparent fixed share fund personal progression?
- Should failed missions create rescue content for the same band or for the broader community?
- How much of the camp and village state is private to a band versus shared across a server or season?
- Is the long-term world structured as MMO realms, smaller regional shards, or instanced social hubs connected to missions?

These decisions should be tested through the four-player heist before committing to large-scale persistent-world architecture.
