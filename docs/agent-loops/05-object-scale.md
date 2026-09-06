# Task 05 — Make every object the right size relative to the heroes

Follow `README.md` in this folder. Max 8 iterations PER STAGE (three stages, §Stages). Write
`05-NOTES.md` beside this file with one section per stage. Run AFTER task 04 (it provides `?view=`).
Supersedes `02-building-scale.md` (never landed; its "components are already hero-sized" claim was wrong
— measured below). Every path, line and number was verified at commit `892bc5f` on
`release/sherwood-launch`. Line numbers drift; function names are the anchors.

## What is wrong (operator report)

Houses read as toys and doors as cat flaps. A hero standing beside a cottage is as tall as its walls and
1.75× taller than its door. Almost everything that is not a hero was authored at 1 unit = 1 metre for a
~1.75 m person, while the heroes are normalised to 2.35 units: the world is ~25 % too small around
them, and buildings are far worse than that because their doors and windows were authored small on top.

## The reference (do not change it)

`src/character-assets.ts:81, 92, 103, 114` — `height:` Robin **2.35**, Marian **2.15**, Little John
**2.5**, Much **1.92** (bounding-box height after `normalizeAuthoredHero`, hat included; band mean 2.23;
manifest body capsules 2.1 / 1.95 / 2.25 / 1.75). **H = 2.35 (Robin) is the unit for every ratio
below.** Gameplay, collision (`SHERWOOD_PLAYER_RADIUS = 0.45`, `shared/world-collisions.ts:39`), camera
and server assume these; none of them changes. If a hero is 1.75 m, 1 u = 0.745 m and 1 m = 1.343 u.

## Measured today → target (units; ratios are ÷ H = 2.35)

Buildings (`src/building-visuals.ts` unless stated):

| # | Object | Where | Today | ÷H | Target ÷H | After |
|---|--------|-------|------:|---:|----------:|------:|
| 1 | Cottage eaves (foundation + wall) | `addCottage` :214-215 (`0.24 + 2.12`) | 2.36 | 1.00 | 1.60 | 3.76 (0.26 + 3.50) |
| 2 | Cottage ridge | :216 (roof `1.25 + variant·0.08`) | 3.65–3.81 | 1.55–1.62 | 2.50 | 5.85–6.05 (roof 2.0 + variant·0.1) |
| 3 | Camp hut footprint | `src/main.ts:963-964` (`width 3.2, depth 2.6`) | 3.2 × 2.6 | 1.36 × 1.11 | 2.26 × 2.43 | 5.3 × 5.7 |
| 4 | Generated cottage footprint | `shared/world-composer.ts:168, 200` (`{1.9, 1.45}`) | 3.8 × 2.9 | 1.62 × 1.23 | 2.26 × 2.43 | 5.3 × 5.7 (halfExtents 2.65 × 2.85) |
| 5 | Door | :237 (`[0.72, 1.34, 0.09]`) | 0.72 w × 1.34 h | 0.31 × 0.57 | 0.50 × 1.15 | 1.18 × 2.70 |
| 6 | Lintel | :238 (`[0.82, 0.11, 0.105]`) | 0.82 × 0.11 | — | — | 1.30 × 0.14, at foundation + 2.75 |
| 7 | Window pane | :193 (`[0.5, 0.44, 0.055]`), centre `foundation + 1.25` | 0.50 × 0.44 @ 1.49 | 0.21 × 0.19 | 0.45 × 0.50 @ 0.72 | 1.06 × 1.18 @ 1.70 (sill 1.11) |
| 8 | Window frame | `addWindow` :180-204 (`frame = 0.07`) | 0.07 | — | — | 0.10 |
| 9 | Timber band / uprights / corner posts | :167 (`0.13`), :169 (`0.12`), corner posts in `addCottage` (`0.12`) | 0.13 / 0.12 | 0.055 | 0.075 | 0.18 / 0.16 — band moves from `0.58·wall` to `0.86·wall` so it clears the door head |
| 10 | Farmhouse eaves | :214-215 (`0.3 + 2.55`) | 2.85 | 1.21 | 1.80 | 4.23 (0.28 + 3.95) |
| 11 | Farmhouse ridge | :216 (`1.65`) | 4.50 | 1.91 | 2.90 | 6.8 (roof 2.55) |
| 12 | Farmhouse footprint | `src/world-landmarks.ts:374-375` (`4.7 × 3.5`) | 4.7 × 3.5 | 2.0 × 1.49 | 3.2 × 2.4 | 7.5 × 5.6 |
| 13 | Barn eaves | `addBarn` :261-262 (`0.28 + 2.7`) | 2.98 | 1.27 | 1.90 | 4.48 (0.28 + 4.2) |
| 14 | Barn ridge | :263 (`1.85 + variant·0.15`) | 4.83–4.98 | 2.05–2.12 | 3.05 | 7.2 (roof 2.6–2.75) |
| 15 | Barn footprint | composer :167, 199 (`{2.5, 1.75}`) | 5.0 × 3.5 | 2.13 × 1.49 | 3.4 × 2.4 | 8.0 × 5.6 (halfExtents 4.0 × 2.8) |
| 16 | Barn doors (each) | :273 (`[1.08, 1.84, 0.1]`) | 1.08 × 1.84 | 0.46 × 0.78 | 0.64 × 1.36 | 1.5 × 3.2 |
| 17 | Watchtower platform / roof top | `addWatchtower` :288 (`platformY 3.65`), roof at +1.15, h 1.05 | 3.65 / 5.85 | 1.55 / 2.49 | 2.2 / 3.6 | 5.2 / 8.4 (legs 5.25, rails 1.3, rung pitch 0.48 unchanged) |
| 18 | Watchtower footprint | composer :166, 198 (`{1.45, 1.45}`) | 2.9 × 2.9 | 1.23 | 1.53 | 3.6 × 3.6 (halfExtents 1.8) |
| 19 | GLB cottage envelope | `src/village-assets.ts:59-126`; measured ±2.12 × ±2.28 (`src/settlement-renderer.ts:126-127`) | 4.24 × 4.56 | 1.80 × 1.94 | 2.26 × 2.43 | 5.3 × 5.7 by UNIFORM ×1.25 |
| 20 | GLB cottage eaves / ridge / door | wall modules 3.12 tall; roof at y 2.55 + 4.25·0.52; `Door_1_Round` 2.32 × 0.95 | 3.12 / 4.76 / 2.20 | 1.33 / 2.03 / 0.94 | 1.66 / 2.53 / 1.17 | 3.90 / 5.95 / 2.75 (falls out of ×1.25) |
| 21 | Windmill total / door / window | `src/world-landmarks.ts:334-366` (:337 base `2.45, 2.9, 4.8`; :343 door `0.9 × 1.75`; window 0.72) | 6.85 / 0.9 × 1.75 / 0.72 | 2.9 / 0.38 × 0.74 / 0.31 | 4.0 / 0.5 × 1.15 / 0.43 | 9.5 (base 6.6, r 3.3–3.9; roof 2.9; spars 6.5, sails 1.05 × 4.4) / 1.18 × 2.7 / 1.0 |
| 22 | Farm fence posts / rails | :110-149 (:128 `0.16 × 1.15`; rails at 0.42 / 0.85) | 1.15 | 0.49 | 0.64 | 1.5 (0.2 sq); rails 0.14 at 0.55 / 1.10 |
| 23 | Stockade posts / gate planks / key post | :152-232 (:158 `2.35`; :237 `0.54 × 2.15`; :274 `1.8`) | 2.35 / 2.15 / 1.8 | 1.0 / 0.91 / 0.77 | 1.4 / 1.28 / 0.98 | 3.3 (rails at 0.7 / 2.4) / 0.6 × 3.0 / 2.3 — FOOTPRINT 14 × 11 (shared) unchanged |
| 24 | Standing stones | :418 + `scaleY 1.8–2.3` | 2.5–3.2 tall | 1.07–1.37 | keep | — |
| 25 | Ridge boulders | `shared/world-ridge-rock-layout.ts` | 2.6–4.3 tall, 2.9–5.1 wide | 1.1–1.8 | keep | — |
| 26 | Forest medium rock | `Nature_Rock_Medium_2` = 1.61 × 1.0 × 1.31 at scale 0.7–1.25 | 1.1–2.0 wide, 0.7–1.25 tall | 0.3–0.53 | keep | — (collider wrong, see §Shared) |
| 27 | Fallback dressing stone | `src/forest-dressing.ts:292-293` | 0.56 × 0.27 × 0.46 | — | = #26 | `DodecahedronGeometry(0.85, 0)`, `scale(1, 0.6, 0.8)` → 1.6 × 1.0 × 1.3 |
| 28 | Authored trees | `src/tree-placements.ts:84-92` (×10.4 etc.) | 7.6–15.9 (mean 11.6) | 3.2–6.8 | keep | — |
| 29 | Fallback tree | `src/main.ts:939-956` | top at 4.9·scale = 3.7–7.2 | 1.6–3.1 | = authored 10.4·scale | every dimension ×2.12; occluder radius `1.2·scale` → `2.5·scale` |
| 30 | Campfire hearth | `src/campfire-visuals.ts:44-97` (stones r 0.19 on r 0.56; logs 1.08) | ring ≈ 1.5 dia | 0.64 | 0.80 | `hearth.scale.setScalar(1.25)` → 1.9 dia; flame lobes +0.08 y; light untouched |
| 31 | Tax cart (procedural) | `src/main.ts:1396-1444` (bed 2.8 × 0.7 × 1.65 at y 1; wheels r 0.52; cage roof at 2.75) | 2.8 long, top 1.35, wheel dia 1.04 | 1.19 / 0.57 / 0.44 | 1.5 / 0.72 / 0.55 | `proceduralShell`, `cage`, coins ×1.25 → 3.5 long, top 1.69, wheel dia 1.3 |
| 32 | Wagon shell (GLB `Prop_Wagon` 1.95 × 1.53 × 4.02) | `src/village-assets.ts:378` (`0.8`) | 1.56 × 1.22 × 3.22 | 0.52 tall / 1.37 long | 0.65 / 1.7 | scale 1.0 |
| 33 | Bow-cache fallback crate | `src/main.ts:1158` (`1.4 × 0.62 × 0.85`) | 0.62 tall | 0.26 | 0.34 | 1.65 × 0.8 × 1.0 (= the chest's 1.65 normalisation at :1188-1189) |
| 34 | Loot-cache crate | :2964 (`1.05 × 0.62 × 0.72`) | — | — | — | 1.3 × 0.8 × 0.9 |
| 35 | Village-upgrade crates | :3699 (`0.65 × 0.55 × 0.65`, pitch 0.75) | 0.55 tall | 0.23 | 0.30 | 0.85 × 0.72 × 0.85, pitch 0.95 |
| 36 | CraftPix props | `src/world-prop-layout.ts`, placed at `src/main.ts:1259-1276` | barrel 1.0, bench 0.9, box 0.7, bucket 0.5, chest 0.8, firewood 0.45, haystack 1.2, pot 0.4, signpost 2.2, well 1.5 | 0.745 of hero scale | ×1.3 | `MEDIEVAL_PROP_SCALE = 1.3` in `rebuildMedievalProps`; well `side` 2.85 → 2.55 (its rim 1.63 wide must stay inside the 3.5 wall line) |

Already right — leave alone: procedural guards ≈ 2.3–2.5 tall (`src/guard-visuals.ts:94-140`); mission
board top 2.25 (`src/main.ts:1463`); bridge 8.4 × 3.2 (shared); grass/fern/bush/flower dressing; standing
stones; boulders; authored trees. Optional if budget remains: mushrooms 0.4–0.88 → 0.3–0.6; wheat
0.78–0.98 → ×1.3 (`src/world-landmarks.ts:305`).

## Constraints (hard)

- Hero heights, `SHERWOOD_PLAYER_RADIUS`, guard separation, road widths, bridge, river, stockade
  footprint, tree layout and tree colliders do not change.
- **Visual footprint and shared collision footprint change in the same commit, from one constant.**
  The server runs `shared/world-collisions.ts` (`server/mission.ts:22`, `server/public-hub.ts:5`); a
  client-only size change desyncs movement. Bump `shared/protocol-version.json` 20 → 21 once at the end
  (world-data migrations bump it — see commit `0d76855`).
- **Components authored at human scale are absolute constants, never multiplied by a shell scale**:
  `DOOR = [1.18, 2.70]`, `WINDOW_PANE = [1.06, 1.18]`, `TIMBER = 0.18`, `LINTEL = 0.14`, rung pitch
  0.48, rail sections 0.14, fence post 0.2. The old constants were NOT hero-sized (door 0.57 H); replace
  them, do not scale them. Scale only wall height, roof height, width/depth of shells and whole props.
- No new runtime dependency; buildless client; `npx tsc -b && npx vitest run` green after every
  iteration; `?render=degraded` unaffected (nothing here is tier-specific).
- Total diff ≤ 520 lines over the three stages (A ≤ 260, B ≤ 160, C ≤ 100). If a stage needs more, stop
  and write the plan in NOTES.

## Where the code is (only these files may change)

- `src/building-visuals.ts` (+ `.test.ts`): `addCottage` :206-256, `addBarn` :258-284, `addWatchtower`
  :286-330, `addFrontBackTimber` :154-178, `addWindow` :180-204. Add the hero-relative component
  constants at the top; `createStylizedBuildingVisual` :378-390 keeps `sherwoodVisualHalfExtents`.
- `src/village-assets.ts` (+ `.test.ts`): `createVillageCottage` :343 → `cottage.scale.setScalar(VILLAGE_COTTAGE_SCALE)`;
  `cottageMatrix` :250 (batch path) multiplies by the same constant; `createVillageWagonShell` :368-380 scale 0.8 → 1.0.
- `src/settlement-renderer.ts` (+ `.test.ts`): `authoredCottageScaleForCollider` :130-136 → uniform scale.
- `src/world-landmarks.ts` (+ `.test.ts`): farmhouse size, windmill, fences, stockade heights, farm layout from the shared constant.
- `src/main.ts`: `createHut` :958-970 (reads position/size from the shared hut layout; occluder 2.2 → 3.9),
  hut calls :990-993, cottage placement :1306 and occluder :1321, `createFallbackTree` :939-956,
  `rebuildMedievalProps` :1259-1276, `createCart` :1396-1444, crates :1158, :2964, :3699.
- `src/campfire-visuals.ts` (`createHearth` :44-97), `src/forest-dressing.ts` (:292-293 only),
  `src/world-prop-layout.ts` (+ `.test.ts`), `src/debug-views.ts` (add the `hub` row), `tools/visual-check.mjs` (add `hub-camp` captures).
- `shared/world-obstacles.ts` (+ tests): `VILLAGE_COTTAGE_OBSTACLE` :18-23, new `SHERWOOD_CAMP_HUT_LAYOUT`
  / `SHERWOOD_CAMP_HUT_OBSTACLES`, `SHERWOOD_STATIC_OBSTACLES` :47-50.
- `shared/world-composer.ts`: ONLY the halfExtents literals at :166-168 and :198-200 (and, only if the
  ≥ 10-building test fails, the slot `along` spacing next to them).
- `shared/world-collisions.ts` (+ `.test.ts`): forest rock halfExtents :60; Stage C farm colliders in
  `staticCollidersForLayout`. `shared/world-landmarks-layout.ts`: new `SHERWOOD_FARM_LAYOUT`.
  `shared/protocol-version.json`.

Do NOT touch: `src/character-assets.ts`, any GLB, `public/assets/manifest.json`, `src/tree-placements.ts`,
`shared/world-layout.ts`, `shared/world-ridge-rock-layout.ts`, `shared/world-topology.ts`,
`shared/regional-layout.ts`, road routing in `world-composer.ts`, `server/`, `src/render-shadow.ts`.
If scaled buildings now overlap roads or each other for some seed, say so in NOTES with the seed — do
not "fix" the composer beyond the two literal blocks.

## Design

**Proportion set (storybook, not survey-accurate):** eaves 1.6 H, ridge 2.5 H, cottage front 2.26 H,
depth 2.43 H, door 1.15 H tall × 0.5 H wide, window 0.5 H tall with its centre at 0.72 H, timber
0.075 H. Tall walls on a compact footprint is the storybook silhouette (a real cottage is 3.4–4.6 H
wide; that would not fit the 14 × 14 hub or the 12-radius settlement terraces). Farmhouse and barn
are one step bigger (1.8–1.9 H eaves, 2.9–3.05 H ridge); the watchtower platform at 2.2 H puts a guard
just above head height. Cottage = **5.3 × 5.7** on purpose: it is exactly 1.25 × the authored GLB
envelope (2.12 × 2.28), so the GLB LOD0 and the procedural LOD1 (`syncVillageLods`, `src/main.ts:4774`)
swap without a size jump, and the generated authored cottages stop being squashed.

**Shared footprints (§Constraints rule 2) — the whole list:**

- `VILLAGE_COTTAGE_OBSTACLE` halfExtents 2.75 × 3.0 → **2.65 × 2.85**, centre (−10, 14) and rotation −0.55
  unchanged. Today the collider is 0.63 / 0.72 u larger per side than the GLB cottage and 1.15 / 1.7 u
  larger than the fallback hut. `shared/world-collisions.test.ts:47-55` pins the old numbers → update.
- Camp huts A (−14, 11, rot 0.35) and C (−15, 6, rot 1.1) (`src/main.ts:990-993`) have **no collider**
  (only the (−10, 14) cottage is in `SHERWOOD_STATIC_OBSTACLES`): hub players walk through them, and hut
  C is built over layout tree (−15.1, 5.9) (scale 1.42). New `SHERWOOD_CAMP_HUT_LAYOUT` (three entries
  `{ x, z, rotation, halfExtents }`) in `shared/world-obstacles.ts`; derive `SHERWOOD_CAMP_HUT_OBSTACLES`
  from it and put all three in `SHERWOOD_STATIC_OBSTACLES` (hub only — `SHERWOOD_MISSION_STATIC_OBSTACLES`
  stays trees only, :53). `createHut` reads from the same layout. Proposed: cottage (−10, 14, −0.55)
  unchanged; hut A → (−17.5, 14.5, 0.35); hut C → (−16.5, 2.0, 1.1). Constraints, all tested: no two hut
  rectangles overlap; every hut edge ≥ 5.5 from (−11, 9) (server spawns on a 4.5 ring around it,
  `server/public-hub.ts:82-85`); none of the hub-box layout trees (−15.1, 5.9), (−17.2, 7.1), (−10.4, 4.0)
  lies inside a hut; the mission board at (−7.6, 8.6) is outside. If one fails, slide that hut ≤ 1.5 u.
- Composer halfExtents: cottage (1.9, 1.45) → (2.65, 2.85); barn (2.5, 1.75) → (4.0, 2.8); watchtower
  (1.45, 1.45) → (1.8, 1.8). `sideDistance = 3.5 + halfExtents.z` (:169) unchanged.
- `authoredCottageScaleForCollider` returns a NON-uniform scale today (x 0.887, z 0.63, y 1: generated
  authored cottages are squashed 37 % in depth). Make it `s = min(hx / 2.12, hz / 2.28) · 0.99` on all
  three axes; with (2.65, 2.85) that is 1.2375 and the envelope matches the collider within 0.05.
- Forest medium rocks (`shared/world-collisions.ts:60`): `0.34·scale` → `(0.72·scaleX, 0.58·scaleZ)`
  (half-widths 0.80 / 0.65 of the 1 m variant with the same 10 % inset the boulders use). Standing
  stones (:66) stay.
- **Stage C — farm colliders:** the windmill and farmhouse have none (grep `farm` in
  `shared/world-collisions.ts` → nothing; both are inside the 67 bounds). Add `SHERWOOD_FARM_LAYOUT`
  to `shared/world-landmarks-layout.ts` = `{ rotation(farmPosition) = x·z > 0 ? −0.35 : 0.35, windmill: local
  (8.4, −1.2) r 3.9 → square halfExtents 3.4, farmhouse: local (1.7, 7.1) rot π, halfExtents (3.75, 2.8) }`
  (these are today's literals in `createSherwoodLandmarks`, `src/world-landmarks.ts:379-400`, moved, plus
  the new sizes). `createSherwoodFarmColliders(layout, world)` in `shared/world-collisions.ts` uses
  `chooseFarmPosition` (:39 of the layout module) and the same frame maths as `worldPointInFrame`
  (`src/world-landmarks.ts:68-76`); include it in `staticCollidersForLayout(layout)` beside
  `createSherwoodMissionRockColliders`. Rendering reads the offsets from the shared constant.

**Debug view + harness:** add `hub: { player: { x: -12.5, z: 10.5 } }` to `DEBUG_VIEWS` (teleport before
the first frame; the follow camera then frames the campfire, mission board, three huts and the hero —
the huts are visible because `missionWorldVisible` is false before a mission starts). Harness:
`shoot("hub-camp", { width: 1440, height: 900, query: "?view=hub" })` and `hub-camp-degraded`.

## Stages (one loop run each; gate green at the end of every iteration)

- **A — buildings + shared (≤ 260 lines):** rows 1–20 and 23, hut layout + colliders, composer
  literals, settlement renderer, village scale, tests. Screenshot gate: `hub-camp.png`.
- **B — props (≤ 160 lines):** rows 21, 22, 27, 29–36 and the prop-layout offsets.
- **C — farm colliders (≤ 100 lines):** the Stage C block above, then the protocol bump.

## Acceptance criteria

1. `building-visuals.test.ts` (new cases, using the file's `instanceMatrices` helper :30-40): for
   `createStylizedBuildingVisual({ kind: "cottage", width: 5.3, depth: 5.7 })` the wall box top ÷ 2.35 ∈
   [1.55, 1.65]; ridge top ÷ 2.35 ∈ [2.4, 2.6]; the door box is 2.70 ± 0.01 tall and 1.18 ± 0.01 wide; the
   window pane is 1.06 × 1.18; no timber box overlaps the door rectangle on the front face; the
   foundation box scale equals (5.3, ·, 5.7) ± 0.01 (visual footprint = descriptor). Farmhouse eaves ÷ 2.35
   ∈ [1.75, 1.85]; barn eaves ∈ [1.85, 1.95]; watchtower platform ∈ [2.15, 2.25].
2. Footprint parity: (a) `shared/world-collisions.test.ts`: for each `SHERWOOD_CAMP_HUT_LAYOUT` entry the
   obstacle halfExtents equal the layout's, and `createStylizedBuildingVisual` for that hut reports
   `sherwoodVisualHalfExtents` equal within 0.05; the hut constraints above all hold; (b)
   `settlement-renderer.test.ts`: for every building of `composeSherwoodWorld(layout)` over seeds 1..24,
   `width / 2 === halfExtents.x`, `depth / 2 === halfExtents.z`, and `authoredCottageScaleForCollider` is
   uniform with `hx − 2.12·s ≤ 0.05` and `hz − 2.28·s ≤ 0.05`; (c) `VILLAGE_COTTAGE_COLLIDER.halfExtents`
   equals `1.25 × (2.12, 2.28)` within 0.001; (d) Stage C: the farm colliders equal the rendered farmhouse
   `sherwoodVisualHalfExtents` and the windmill's `3.9 × 0.87` within 0.05 for seeds 1..24.
3. `hub-camp.png` / `hub-camp-degraded.png`: the hero beside a hut is clearly shorter than the eaves; the
   door is taller than the hero; windows are ≥ ¼ of the wall height; the roof overhang is not a hat; no
   hut intersects another hut or a tree trunk; all three huts sit on the ground (no gap under the
   foundation, no buried sill). `hub.png` (solo layout): farmhouse and windmill doors are hero-tall; fence
   rails reach the hero's hip; the campfire ring is ≈ 0.8 of the hero's height across.
4. Props in `hub.png` / `hub-camp.png`: a barrel reaches the hero's chest; crates and chest read as
   liftable, not furniture; cart wheels reach the hero's hip (visible when a mission layout is in frame;
   use `?view=` if needed).
5. Existing suites green with pinned numbers updated only where this brief changes them (list each in
   NOTES): `shared/world-collisions.test.ts`, `shared/world-composer.test.ts`,
   `shared/map-feasibility.test.ts`, `shared/map-quality.test.ts`, `src/settlement-renderer.test.ts`,
   `src/world-landmarks.test.ts`, `src/village-assets.test.ts`.
6. `npx tsc -b && npx vitest run` green; `npm run validate:assets` untouched; `shared/protocol-version.json`
   is 21; no new dependency; ≤ 520 lines total.

## Hints

1. Stage A: do the constants and `hub-camp.png` first, confirm criterion 3 by eye, THEN propagate the
   colliders — you want to see the proportion before you commit the shared contract.
2. Camera occluder radius = `Math.hypot(hx, hz)` (3.9 for a cottage), so walking behind a hut still fades it.
3. `sherwoodFootprintGroundY(x, z, hx, hz, rot)` takes HALF extents; the hut passes `1.6, 1.3` today.
4. Test the hut constraints with `isPointInsideSherwoodObstacle` (`shared/world-obstacles.ts`) — no new geometry code.
5. If `world-composer.test.ts` "≥ 10 buildings" fails after the halfExtents change, widen the slot `along`
   spacing by the same factor the depth grew (2.85 / 1.45 ≈ 1.97 is too much; try 1.4) and re-run
   `map-feasibility` / `map-quality`.

## Known, measured, deliberately NOT changed here (record in NOTES, do not fix)

Tree trunk colliders are `0.34·scale` = 0.26–0.50 u (`shared/world-obstacles.ts:29`), while the authored
catalog trunks' base radii are 0.085–0.131 × height ≈ 0.7–2.0 u for common trees, 0.05–0.14 × h for pines,
0.21–0.37 × h for twisted trees: players walk up to ~1 u into visible trunks. Fixing it re-routes roads and
settlement placement for 314 colliders — a separate migration, not a scale pass.
