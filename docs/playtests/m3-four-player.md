# M3 four-player browser playtest

- Date: 2026-07-10
- Build: `agent/m3-authoritative-heist`
- Environment: Vite client on `127.0.0.1:5175`, authoritative room server on `127.0.0.1:8787`
- Party: two Robin players and two Marian players
- Browser: Codex in-app Chromium viewport

## Scenarios

| Scenario | Result | Evidence |
| --- | --- | --- |
| Four players join one private room | Pass | Lobby showed all four names, two-per-role capacity, and independent ready state. |
| Ready gate starts without a host dependency | Pass | Mission began once all four clients were ready. |
| Server scales the escort | Pass | Four-player mission snapshot contained five guards; unit coverage also asserts the count. |
| Scout chooses an entry route | Pass | Marian bot traversed to the forest landmark and the server advanced from Scout to Ambush. |
| Phase guidance updates | Pass | Objective changed to “Stun two escort guards” and the party HUD stayed visible. |
| Equipped Robin replicates | Pass | Local and remote Robin instances rendered with bow, quiver, and independent animation mixers. |
| Party readability | Pass | Four names, roles, connection dots, and hearts remained readable without obscuring the main playfield. |
| Cooperative signal | Pass | Danger ping rendered as a pulsing red ring and floating exclamation marker. |
| Browser/runtime errors | Pass | No console errors in the final four-player gameplay capture. |

## Finding resolved during the pass

Click-to-move produced a long direction vector. Protocol validation rejected it as intended, but this caused repeated invalid-message feedback after using pointer movement. The multiplayer client now normalizes movement intent before transmission, while the server still normalizes again and enforces world bounds.

## Remaining alpha risks

- The room state remains in one in-memory server process; horizontal scaling must wait for a shared room store.
- The current Robin GLB is larger than the eventual alpha asset budget and should move through the optimized asset pipeline.
- The 12–20 minute duration is a design target based on five shipment cycles and a 15-minute par; a timed human session is still needed for balance calibration.
