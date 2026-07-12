# Robin Hood: The Game (Onchain) · RHTGOC — Product Requirements Document

**Status:** Working alpha — sprint boundary 2026-07-11

**Product:** 3D cooperative browser game

**Production:** M7 is playable on the permanent AWS Lightsail origin. The live service is not yet a persistence-enabled release.

**Active pull request:** [#52 — World pass: solid forest and reflective river](https://github.com/water-bear86/sherwood-rebellion/pull/52), stacked on the production-gate chain and now carrying the first regional-composer prototype.

**Development status:** M8 is complete on its stacked branch but is not the production build. Production promotion remains gated; user-directed M9 world-composer prototyping may continue locally on the stack but cannot be called released or close the milestone gate.

**Core technology:** Three.js, TypeScript, Vite

## 1. Product vision

Robin Hood: The Game (Onchain), shortened to RHTGOC, is a social 3D browser adventure in which players form outlaw bands, rob the Sheriff, escape through a living Sherwood, and return stolen wealth to communities that visibly change because of their choices.

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

### Restrained storybook rendering

Sherwood should use a restrained cel-shaded storybook treatment rather than chasing realism or preserving the stock look of unrelated asset packs. A shared four-step toon-lighting ramp, coherent palette, directional light, fog, and controlled shadows should unify heroes, guards, foliage, architecture, and props while keeping pursuit routes and interaction states immediately readable. Heavy comic outlines and bloom are out of scope for the first art pass.

Cel shading is not permission to ship weak geometry. Assets with a sound silhouette, topology, and rig may be retextured and adapted; assets with poor proportions, topology, skinning, rigs, or animation should be rejected. External packs must be curated into small browser-ready GLB/glTF kits with consolidated materials, measured texture and draw-call costs, simple collision proxies, explicit LOD behavior, and recorded source/license metadata. Source packs, raw FBX files, and broken external texture paths must never be copied wholesale into the runtime.

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

## 6. Current alpha

The permanent M7 playtest establishes:

- A true 3D Sherwood world with a perspective follow camera, click and keyboard movement, archery, role abilities, Wanted pressure, loot, rescue, redistribution, and mastery scoring.
- Server-authoritative private Merry Band rooms for two to four players, shared missions, reconnects, role selection, readiness, pings, downing, revives, loot transfer, and redistribution votes.
- Four playable named heroes: Robin, Maid Marian, Little John, and Much.
- A campfire mission board and three versioned missions: the People's Purse tax-cart heist, prison-wagon rescue, and royal-storehouse infiltration.
- An opt-in public campfire, privacy-safe friends and invitations, daily Sheriff targets, rescue follow-ups, asynchronous band preparations, and seasonal village projects.
- Seasonal leaderboard schemas, privacy-filtered reads, authoritative write paths, quarantine review, and finalization rules.
- Authored Robin and tree GLBs alongside procedural scenery, with automated mission, simulation, networking, persistence, social, and browser checks.

The completed M8 branch adds the shared four-step toon-material system, standard/degraded render profiles, a deterministic 677,248-byte CC0 village catalog, one authored cottage, and the authored tax/prison wagon shell. The official asset validator checks actual GLB bytes and bound license evidence. Shared cottage collision now governs solo, public-hub, client-predicted, and authoritative mission movement. M8 is not yet the production build.

Production remains deliberately fail-closed without the server-only Supabase credential. Persistent band, rescue, contribution, season, social, and verified-leaderboard writes are inactive until #9, #10, and #14 pass their production proofs. Operator-secret rotation and the explicitly approved temporary-project restore drill are release gates.

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

## 9. Delivered social alpha and activation boundary

The M7 codebase includes:

1. Persistent Merry Band, membership, banner, camp, and village projections.
2. An opt-in public campfire for lightweight discovery.
3. Privacy-safe friends, presence, recent players, account blocking, and direct invitations.
4. Daily Sheriff targets, rotating modifiers, and regional bounties.
5. Private-band rescue follow-ups from captured or failed runs.
6. Asynchronous supplies, intelligence, traps, and safe-house preparations.
7. Shared seasonal village projects, Sheriff pressure, finite finales, and archived campaigns.

These capabilities have schema and runtime paths, but the permanent deployment currently runs without the trusted server credential and therefore cannot claim durable social progression or verified ranked writes. Public-alpha activation requires the production proofs in #9, #10, and #14; browser clients must never be given a service credential to bypass that gate.

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

Mission terrain is composed as a deterministic 5×5 grid of 26-metre sectors (a 134-metre playable span). Each run places the campfire in one outer sector and the objective in a farthest valid sector, with bounded per-cell jitter. The authoritative run seed translates player, objective, guard, route, signal, rescue, and storehouse positions together so every client sees the same geography and a replay can reproduce it. A compact HUD map begins with only the camp sector visible; entering a sector clears its fog for the entire Merry Band, while the target marker remains hidden until discovery. Searching the wrong sectors raises a three-step Sheriff pressure floor and can add target guards before discovery; exploration is therefore a mastery decision, not empty travel. A fresh run token must produce another valid placement without revealing the target sector in the HUD.

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
- Lit runtime materials should pass through one shared toon-material adapter without losing skinning, alpha, vertex colors, gameplay recoloring, or shadow behavior; intentionally unlit signals and markers remain unlit.
- Every shipped asset must pass the documented accept, rework, or reject quality gate and carry provenance, license, geometry, material, texture, collision, and LOD metadata.
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

## 16. Milestone ledger

| Milestone | Status | Product outcome |
| --- | --- | --- |
| M1 · Playable Rebellion | Closed | True-3D robbery loop, Maid Marian, mastery model, and leaderboard foundation. |
| M2 · Multiplayer Movement Room | Closed | Private rooms, synchronized players, roles, readiness, and reconnects. |
| M3 · Cooperative Heist | Closed | Server-authoritative four-player tax-cart heist with shared rescue and extraction. |
| M4 · Social Resolution | Open | Results and safety are delivered; durable band progression and verified production leaderboards remain gated by #9 and #10. |
| M5 · Replayable Alpha | Open | Routes, modifiers, assets, accessibility, and telemetry are delivered; production operations remain gated by #14. |
| M6 · Four Heroes & Mission Kit | Closed | Robin, Marian, Little John, and Much; campfire hub; three versioned missions. |
| M7 · Living Sherwood Playtest | Closed | Public campfire, friends/invites, rotations, rescue chains, preparations, and seasonal campaigns. |
| M8 · Storybook Sherwood Art Pass | Closed | Hardened asset gate, restrained cel shading, and curated cottage/wagon integration delivered in draft PR #38. |
| M9 · Deeper Sherwood Public Alpha | Planned | Twelve ordered issues (#39–#50) covering release promotion, onboarding, mastery, stealth, planning, authored world composition, Nottingham, matchmaking, replays, accessibility, performance, and public playtesting. |

M9 is a planning milestone, not active feature implementation. Its entry gate is a traceable mainline production release plus closure of #9, #10, #14, and #39.

## 17. Non-goals for the social MVP

- A seamless massively multiplayer world.
- Open-world PvP.
- Public marketplace or player trading.
- Blockchain or token integration.
- User-generated levels or objects.
- Public voice or unrestricted text chat.
- Large guild administration systems.
- Pay-to-win progression.

## 18. Product decisions and open questions

Decided for the current alpha:

- The roster uses four named playable heroes: Robin, Maid Marian, Little John, and Much. Will Scarlet is a future-character candidate, not part of the implemented roster.
- Recovered community coin enters the redistribution vote; personal mastery is scored separately and cannot silently reduce the community allocation.
- Failed or captured runs may create private-band rescue offers, not public obligations.
- Band membership, camp, and band village progression are private. Seasonal village projects and Sheriff pressure are shared campaign state.
- Missions and public hubs are authoritative instances; there is no claim of one seamless MMO world.

Still open:

- Should later regions use long-lived regional shards, short-lived social hubs, or a hybrid?
- Which progression rewards remain permanent across campaign rollover beyond identity, cosmetics, recognition, and safety state?
- What concurrency and geographic targets justify moving room state beyond the current single-node alpha service?

These questions should be answered through instrumented public playtests before committing to large-world architecture.
