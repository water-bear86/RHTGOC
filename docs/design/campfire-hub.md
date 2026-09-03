# Quick play and the campfire runtime

The public entry flow is intentionally short: choose an outlaw name, press `PLAY ONLINE`, and wait for four players. Wallet identity is optional and private invite codes are no longer part of the player-facing entry flow.

## Player flow

1. **Enter:** `PLAY ONLINE` joins the shared queue immediately as a guest or optional authenticated identity.
2. **Match:** the server forms an exact four-player FIFO group and assigns Robin, Marian, Little John, and Much once each, honoring a player's selected role when it is still available.
3. **Launch:** reservation tokens bind each queued player to the assigned room and role. The authoritative room starts automatically after all four reserved players arrive.
4. **Resolve:** the results surface records the run, redistribution vote, and resulting village state.
5. **Return:** the room resets its players and readiness, retains the band and village state, and broadcasts the refreshed hub without a page reload.

## Mission-board data

The board iterates `MISSION_CATALOG`; its title, version, approaches, par time, and selected state are therefore sourced from validated mission packages rather than hard-coded cards. The room broadcasts the selected mission slug, village upgrades, recent result, party roles, field kits, readiness, and connection state.

Quick-play role assignment and readiness are server-owned so one disconnected menu cannot stall the group before launch. The normal room lifecycle remains available internally for reconnect and backwards compatibility.

## Field kits

- `balanced`: the standard mission configuration.
- `smoke`: the player starts the mission with two seconds of veil protection.

Kits are server-authoritative mission inputs. They are visible in the hub and cannot be used to alter simulation state directly from the client.

## 3D and input behavior

The physical mission board is a low-cost procedural prop beside the village camp. Carts, guards, and sabotage props are hidden in the hub, leaving the party, fire, paths, river, and village visible. The hub adds only a few primitive meshes and reuses the existing world, lighting, character, and camera budget.

Movement continues through the shared remappable keyboard, pointer, and controller input layer. The mapped interact action focuses the preparation flow; the board surface provides accessible DOM controls for mission, role, kit, invite, and ready actions.

## Verification

- Automated tests cover the protocol, room lifecycle, exact four-player matching, role assignment, guest access, return-to-hub reset, village state, and server-side kit effects.
- The production build validates every mission package and stable asset reference before bundling.
- The four-client smoke test proves guest entry, one shared room, four unique roles, automatic launch, and Band chat delivery.
