# Campfire hub and mission board

The campfire is the band's persistent preparation space between mission instances. It keeps the outlaws in the 3D world while moving target, role, field-kit, invite, and readiness decisions into one compact mission-board surface.

## Player flow

1. **Intro to camp:** `FORM A MERRY BAND`, `JOIN BAND`, `REJOIN LAST BAND`, and solo `ENTER THE CAMPFIRE` all arrive at the same hub state.
2. **Prepare:** the leader selects a mission from the data-driven mission catalog. Every player selects a hero and field kit, then toggles ready.
3. **Launch:** when every connected outlaw is ready, the authoritative room creates the selected mission snapshot and all clients transition into the mission together.
4. **Resolve:** the results surface records the run, redistribution vote, and resulting village state.
5. **Return:** the room resets its players and readiness, retains the band and village state, and broadcasts the refreshed hub without a page reload.

Direct invitation links use `?room=CODE`. The last joined room is stored locally so a returning browser can offer one-click rejoin.

## Mission-board data

The board iterates `MISSION_CATALOG`; its title, version, approaches, par time, and selected state are therefore sourced from validated mission packages rather than hard-coded cards. The room broadcasts the selected mission slug, village upgrades, recent result, party roles, field kits, readiness, and connection state.

Only the first room member can change the target. Role and kit selection remain player-owned. Starting a mission still requires every connected player to be ready.

## Field kits

- `balanced`: the standard mission configuration.
- `bandage`: a successful revive restores one additional health, capped at the normal maximum.
- `smoke`: the player starts the mission with two seconds of veil protection.

Kits are server-authoritative mission inputs. They are visible in the hub and cannot be used to alter simulation state directly from the client.

## 3D and input behavior

The physical mission board is a low-cost procedural prop beside the village camp. Carts, guards, and sabotage props are hidden in the hub, leaving the party, fire, paths, river, and village visible. The hub adds only a few primitive meshes and reuses the existing world, lighting, character, and camera budget.

Movement continues through the shared remappable keyboard, pointer, and controller input layer. The mapped interact action focuses the preparation flow; the board surface provides accessible DOM controls for mission, role, kit, invite, and ready actions.

## Verification

- 68 automated tests cover the protocol, room lifecycle, selected mission, role and kit synchronization, return-to-hub reset, village state, and server-side kit effects.
- The production build validates every mission package and stable asset reference before bundling.
- A two-context Chromium playtest formed and joined a room, synchronized Much and Little John with different kits, copied and validated the direct invite, launched both clients, exposed the rejoin path, and produced no console, page, or request errors.
- Visual proof: `/tmp/sherwood-qa/campfire-hub.png`.
