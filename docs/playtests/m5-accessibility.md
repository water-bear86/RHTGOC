# M5 accessibility and cross-browser QA

Target: `http://127.0.0.1:5175/` with the authoritative room server on `ws://127.0.0.1:8787/`  
Environment: macOS arm64, desktop 1440×900, mobile 390×844  
Build: `agent/m5-replayable-alpha`, based on `4cd03fb` plus the accessibility work in this milestone increment  
Evidence: source inventory, mechanical DOM inventories, Playwright interaction runner, screenshots, browser console capture, Vitest, and production build

## Browser matrix

| Browser target | Coverage | Result | Evidence / limitation |
|---|---|---:|---|
| Google Chrome | Installed branded browser, desktop smoke and full Chromium journey | Pass | Intro, gameplay, panels, options, remapping, persistence, and console capture |
| Firefox | Playwright Firefox 140 engine, desktop smoke | Pass | Boot, WebGL scene, settings, high contrast, Escape close, no page errors |
| Safari | Playwright WebKit 26 engine, desktop smoke | Pass | Safari-compatible engine boot, WebGL scene, settings, Escape close, no page errors |
| Microsoft Edge | Chromium compatibility covered; branded Edge binary unavailable | Blocked | Edge is not installed on this Mac; repeat the smoke checklist on branded Edge before public alpha |

Branded Safari automation is also blocked because Remote Automation is not enabled. WebKit engine coverage is useful but is not represented as an actual Safari application run.

## Coverage ledger

| ID | Surface | Controls / states | Action and expected result | Result | Evidence |
|---|---|---:|---|---:|---|
| ENTRY-01 | Hero select | Robin, Marian | Click each; selected hero has `aria-pressed=true` | Pass | Desktop runner |
| ENTRY-02 | Band form | Name, invalid code, create, join validation | Type and submit; clear six-character feedback; room code created | Pass | Desktop runner + live room server |
| ENTRY-03 | Lobby | Ready, unready, enter solo | Toggle ready twice; button state returns to `READY UP`; enter closes intro | Pass | Desktop runner |
| HUD-01 | Persistent HUD | Help, leaderboard, safety, settings | Each opens the named dialog only | Pass | Gameplay inventory, 12 visible enabled candidates |
| HELP-01 | Field notes | Close, Escape, focus loop | Tab enters close button; Escape closes and restores trigger focus | Pass | Desktop runner |
| BOARD-01 | Leaderboard | 6 filter selects, close | Exercise every select; category title and state refresh; close returns focus | Pass | Desktop runner |
| SAFE-01 | Safety | Open, close, empty self-only state | Panel opens without exposing actions against self | Pass | Desktop runner |
| SAFE-02 | Peer safety actions | Mute, report, remove, block | Requires a second live player and moderator/non-moderator roles | Blocked | Covered by room tests; repeat as two-browser release check |
| SETTINGS-01 | Display options | 5 checkboxes | Toggle reduced motion, contrast, captions, readable text, mobile spectator; classes/runtime update immediately | Pass | Desktop + mobile runner |
| SETTINGS-02 | Keyboard | 14 remap buttons | Capture every physical key binding; reject system keys; labels and help copy update | Pass | Settings inventory, 41 visible enabled candidates |
| SETTINGS-03 | Pointer | 3 select controls | Remap primary, middle, and secondary actions; secondary action executes on canvas | Pass | Desktop runner |
| SETTINGS-04 | Controller | 10 select controls | Remap every action button; injected gamepad action executes; left-stick movement path compiled | Pass | Desktop runner + build |
| SETTINGS-05 | Disclosure/reset | 3 summaries, reset, close | Toggle each group; reset restores Space/fire and all defaults; reload preserves reset | Pass | Desktop runner |
| INPUT-01 | Keyboard gameplay | Move and remapped fire | Hold movement, fire with remapped key, receive visible event caption | Pass | Desktop runner |
| INPUT-02 | Pointer gameplay | Primary move, secondary fire | Click and right-click canvas; mapped actions execute without context menu | Pass | Desktop runner |
| INPUT-03 | Controller gameplay | Left stick, mapped button edge | Deadzone path active; virtual button edge executes once | Pass | Desktop runner |
| VISUAL-01 | Color independence | Pursuit, pings, party | Wanted text + hatched meter; pings use distinct symbols; presence uses `●`/`×` plus reconnect text | Pass | Source and rendered screenshots |
| MOBILE-01 | Lightweight spectator | 390×844 spectator state | View-only banner visible; 1× pixel ratio and shadows off; opt-out restores play input | Pass | Mobile runner |
| MOBILE-02 | Responsive settings | 390×844 panel | Panel bounds remain within viewport and scroll vertically | Pass | Bounds: x12, y12, 366×820 |
| RESULTS-01 | Mastery results | Results close, three vote buttons | Requires authoritative mission completion | Blocked | Unit-tested result/vote model; perform in full mission release session |
| RECOVERY-01 | WebGL recovery | Context loss/restoration | Browser event handlers preserve text feedback | Pass | Source inventory + production build |

Reconciliation: source discovery, the entry inventory, gameplay inventory, settings inventory, and executed rows have no unmatched reachable controls. Nested text nodes reported as pointer candidates are decorative children of tested buttons and are not separate controls. Time-gated multiplayer surfaces are explicitly blocked above rather than silently omitted.

## Automated results

- Entry inventory: 11 visible interactive elements after duplicate/decorative reconciliation.
- Gameplay inventory: 12 visible interactive elements.
- Settings inventory: 41 visible interactive elements.
- Desktop journey: no page or console errors.
- Mobile journey: no page or console errors.
- Browser engine smoke: Chrome, Firefox, and WebKit pass.
- Unit/integration suite: 51 passing after the final browser fix.
- Production TypeScript/Vite build: passing after the final browser fix.

## Finding fixed during QA

Escape initially failed to close a dialog when focus was inside a checkbox or select because form-field handling returned before modal handling. The keyboard event order now closes the active dialog first and restores focus to its trigger.

## Release checklist

- Run `npm test`, `npm run build`, `npm run validate:assets`, `npm run test:reconnect`, and the 60-second `npm run test:soak`.
- Repeat SAFE-02 with two real browser sessions.
- Complete one authoritative mission and exercise RESULTS-01, including all vote buttons.
- Run the desktop smoke on branded Microsoft Edge and actual Safari.
- Repeat at 1280×720, 1440×900, 1920×1080, and 390×844.
- Verify keyboard-only focus order, Escape, Enter, Space, remap capture cancellation, and reset persistence.
- Verify reduced motion from both OS preference and in-game setting.
- Verify high contrast and readable text at 200% browser zoom.
- Verify mobile spectator disables gameplay input and opt-out restores it.
- Verify no personal identifiers appear in logs, metrics, screenshots, or leaderboard error states.
