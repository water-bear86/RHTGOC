# Task 06 — The Major Oak: Sherwood's landmark and the hideout above the camp

Follow `README.md` in this folder. Max 8 iterations per stage (two stages, §Stages). Write `06-NOTES.md`
beside this file. Run AFTER 04 (needs `?view=`) and 05 (needs the hub hut layout and the cottage
footprint constants). Every path, line and number was verified at commit `892bc5f` on
`release/sherwood-launch`; line numbers drift, function names are the anchors.

**This task must never block.** Stage 0 ships a complete procedural Major Oak with the shared
position, collider and tests. Stage 1 swaps in the owner's 3D asset the moment it exists, through the
existing asset gate. If the asset is missing, unlicensed or over budget, Stage 0 is the shipped result
and NOTES says `WAITING FOR ASSET` (or `ASSET REJECTED: <reason>`).

## What is wrong (operator report)

Sherwood has no Major Oak. The real tree — the ancient, hollow, prop-supported oak at the heart of
the forest, Robin's legendary hideout — is the one landmark players will look for, and it should be the
anchor of the outlaw camp and a beacon you steer by. Today the camp is three huts and a campfire on
flat ground with ordinary 8–16 u trees around it.

## Facts (measured — use these)

- Ordinary trees: 7.6–15.9 u tall, mean 11.6 (`src/tree-placements.ts:84-92` × `shared/world-layout.ts`
  scales 0.76–1.47). Hero H = 2.35 (`src/character-assets.ts:81`). Camp campfire (−11, 9) at ground
  height 1.20 (`HUB_CAMPFIRE_POSITION`, `src/main.ts:567`); hub walk box `PUBLIC_HUB_WORLD_BOUNDS =
  {minX −18, maxX −4, minZ 2, maxZ 16}` (`shared/world-collisions.ts:124`), used by `server/public-hub.ts:85,134`.
- **Camera geometry (from task 04):** the frame top is 13.6° below horizontal. From a camera at height
  h + 14.5, only the bottom `14.5 − 0.242·d` units of an object d units away are in frame: at 20 u you
  see the lowest 9.7 u, at 32 u the lowest 6.9 u. **A 26-u crown is never in frame; the trunk, root
  flare and the lowest boughs are what players see.** Design for that (§Design).
- Sun `(-18, 28, 14)` (`src/main.ts:919-935`): shadows fall toward +x/−z by 0.643·h in x and −0.5·h in z
  per unit of height; shadow intensity 0.45, frustum ±40 u around the player (`src/render-shadow.ts:10`).
  A canopy centred 15 u up casts its shadow 9.6 u east and 7.5 u south of the trunk.
- Placement search (all deterministic shared data — `SHERWOOD_TREE_LAYOUT` 314 trees,
  `SHERWOOD_RIDGE_ROCK_LAYOUT` 18 rocks, `SHERWOOD_PASSES`, `SHERWOOD_SETTLEMENT_SITES`, region cells at
  x,z ∈ {−52, −26, 0, 26, 52}): mission campfires/objectives are jittered ±3 around ANY river-clear cell
  centre (`shared/regional-layout.ts`, `anchorCells = cells.filter(missionAnchorCellClearOfRiver)`), so
  cell (−26, 0) can host a campfire — the whole Oak Ridge crest south of z ≈ 10 is excluded. The
  candidate box that satisfies tree-trunk clearance ≥ 6.5, rock clearance ≥ 3.9, pass clearance ≥ 3.0
  and cell-centre distance ≥ 11 is **x ∈ [−30, −28], z ∈ [10.5, 12]**, on the crest of `oak-ridge-middle`
  (`shared/world-topology.ts`, segment (−29, −20) → (−27, 12), height 5.2; crest x = −27.25 at z = 11).
- Chosen point **(−28, 11)**: ground height **5.74** (4.5 u above the campfire), nearest layout trunk edge
  6.7 u, nearest ridge-rock edge 5.25 u, `oak-north-pass` edge 3.4 u, `west-north` settlement-site edge
  3.1 u, nearest cell centre (−26, 0) 11.2 u, campfire 17.1 u. From the campfire the trunk stands in the
  default camera's background (−x is "away" for the default quarter turn); from the camp's west edge
  the lowest 4–8 u of it are in frame; from its foot the trunk and the first boughs fill the top band.
  The farm (`chooseFarmPosition`, `shared/world-landmarks-layout.ts:39`, corners ±48) is ≥ 40 u away;
  the stone circle (`chooseStoneCirclePosition` :61, settlement sites) ≥ 12 u; stockade sites are flat
  settlement sites, none within 15 u.
- Asset pipeline (verified): `public/assets/manifest.json` (`version 2`, `units meters`, `+Y up`, `+Z forward`)
  lists every shipped GLB; `npm run validate:assets` (`tools/validate-assets.mjs` →
  `tools/asset-validator.mjs`) hashes the file, runs the Khronos validator, derives geometry / materials /
  texture / bounds from the GLB and fails on any declared-vs-derived mismatch (`compareDerivedMetrics`
  :946-985; bounds tolerance 1e-4), enforces minY = 0 for a pivot policy matching
  `/(?:feet|foot|bottom).*origin/`, checks category budgets (`budgets.assetCategories`), and binds the
  licence evidence file by SHA-256 (`validateLicense` :693-737: `verified` needs a valid SPDX id with no
  `LicenseRef`; `project-authorized` needs `LicenseRef-Project-Owner-Authorized`). Rules and the
  accept / rework / reject table: `docs/operations/3d-assets.md`. Evidence lives in `docs/assets/licenses/`
  (`stylized-nature-megakit-cc0.txt`, `ground-textures-project-authorized.md` are the two patterns).
  Existing GLBs are normalised to **1 m height, bottom-centre pivot, +Y up** by Blender scripts
  (`tools/build-stylized-nature-dressing.py`, `tools/expand-stylized-tree-catalog.py`) then
  `npx gltf-transform optimize … --simplify … --texture-compress webp --texture-size 512`
  (`docs/assets/stylized-nature-trees.md`). Runtime loads catalogs with `gltfLoader.loadAsync(versionedAssetUrl(...))`
  + `convertObjectToToon` (`src/main.ts:1223-1240`) and swaps procedural fallbacks for authored views
  when they arrive (`attachVillageSlice`, `src/main.ts:1303-1330`, `villageCottageFallback` :991).
- Category budgets (manifest `budgets`): `decorative-environment` = 500 000 bytes, 30 000 render / 20 000
  upload vertices, 20 000 triangles, 8 primitives, 8 draw calls, 8 materials, 512 px textures, 1.5 MB GPU.
  Scene: 220 draw calls desktop / 130 degraded.

## Constraints (hard)

- No new runtime dependency; buildless client; Three.js only. `npx tsc -b && npx vitest run` green;
  `npm run validate:assets` green whenever the manifest changes.
- Hero heights unchanged. Anything the server reads changes only in `shared/` with tests; bump
  `shared/protocol-version.json` (21 → 22 if task 05 landed, else 20 → 21).
- The oak is ONE object with ≤ 4 draw calls authored, ≤ 3 procedural; always visible (it is exempt from
  the 48-u tree cull at `src/main.ts:4870`); `castShadow = renderProfile.shadows`, so the degraded tier
  costs nothing extra.
- The authored asset is accepted only through the manifest gate: category `decorative-environment`,
  ≤ 500 000 bytes, ≤ 20 000 triangles, ≤ 4 primitives, ≤ 3 materials, 512 px WebP, verified or
  project-authorised licence. Over budget → simplify harder or ship Stage 0; unclear licence → reject
  (`docs/operations/3d-assets.md`, "Reject" row). Never copy a raw source (FBX/OBJ/blend) into `public/`.
- Procedural and authored oak share `MAJOR_OAK_HEIGHT`, the shared position and the shared collider,
  so swapping one for the other changes nothing the server or the camera care about.
- Diff ≤ 420 lines for Stage 0 (module ≈ 180, tests ≈ 90, shared ≈ 50, main ≈ 40, harness ≈ 10);
  Stage 1 adds the build script, the manifest entry and two docs.

## Where the code is (only these files may change)

- NEW `src/major-oak.ts` (+ `src/major-oak.test.ts`): `MAJOR_OAK_HEIGHT`, `createProceduralMajorOak()`,
  `createAuthoredMajorOak(scene: THREE.Object3D)`, `attachMajorOak(scene, options)`.
- `shared/world-landmarks-layout.ts` (+ test): `SHERWOOD_MAJOR_OAK = { x: -28, z: 11, trunkHalfExtent: 2.0, canopyRadius: 12 }`.
- `shared/world-obstacles.ts` (+ tests): `SHERWOOD_MAJOR_OAK_OBSTACLES` (two rotated squares, §Design) added to
  BOTH `SHERWOOD_STATIC_OBSTACLES` (:47-50) and `SHERWOOD_MISSION_STATIC_OBSTACLES` (:53).
- `shared/world-collisions.ts` (+ test): `PUBLIC_HUB_WORLD_BOUNDS.minX` −18 → **−32** (:124) so the oak's foot is walkable in the hub.
- `shared/world-dressing-layout.ts`: add `{ x, z, radius: 3.5 }` for the oak to the exclusions (:61-83) so
  shared forest rocks never spawn in the trunk. `shared/world-composer.ts`: `treeClear` (:92) also rejects
  building positions within `radius + trunkHalfExtent + 1` of the oak — one condition, nothing else.
- `src/main.ts`: `createWorld()` (:977) calls `attachMajorOak(...)`; register the trunk in
  `cameraOccluders` (:548) with radius 2.6; set `renderer.domElement.dataset.majorOak = "procedural" | "authored"`
  (beside the existing `dataset.characterOcclusion` write); `?view=oak` row in `src/debug-views.ts`.
- `tools/visual-check.mjs`: `oak` and `oak-degraded` captures; log `canvas.dataset.majorOak` for them.
- Stage 1 only: NEW `tools/build-major-oak.py`, NEW `docs/assets/major-oak.md`, NEW
  `docs/assets/licenses/<evidence file>`, `public/assets/manifest.json` (one asset entry + one
  `catalog.shipped` line), NEW `public/assets/environment/sherwood-major-oak.glb`.
- Optional (≤ 20 lines, only if everything else is PASS): `src/region-map.ts` + `src/style.css` — a
  landmark class on the cell that contains the oak (row 2, column 1 → index 11) drawn as a small dark-green
  disc, the in-map beacon.

Do NOT touch: `src/tree-placements.ts`, `shared/world-layout.ts`, `shared/world-topology.ts`,
`shared/regional-layout.ts`, `server/`, hero assets, `src/render-shadow.ts`, lighting, any other manifest
entry, `HUB_CAMPFIRE_POSITION` or the server spawn ring.

## Design

**What it is.** An ancient hollow oak, 26 u tall (11 H; 2.2× the average tree, 1.6× the tallest), crown
24 u across (`canopyRadius 12`), trunk 3.2 u thick at breast height (0.062·h — the real tree's 10 m
girth on 23 m height) flaring to a 4.8-u root buttress at the ground, first boughs at 5–7 u (2–3 H)
reaching 9–12 u out, two of them propped on timber posts the way the real Major Oak has been since 1908,
and a hero-sized hollow (1.1 × 2.6 u) in the trunk on the +x face — the side that faces the camp. Toon
two-tone leaves (`palette.leaf 0x284f32` / `palette.leafLight 0x3c6a3e`, `src/main.ts:731-732`) and
`palette.trunk 0x59422b` (:733) so it belongs to the same storybook as the forest; no new style.

**Why it is designed from the ground up.** The camera never shows the crown (Facts). The parts that
carry "ancient and enormous" on screen are the buttressed trunk that dwarfs the hero, the prop-supported
low limbs crossing the top of the frame, and the wide dappled shadow on the camp. The crown exists for
the shadow, the region map and the family-photo scene, not for the gameplay frame. Do not spend budget
on leaf detail.

**Where and why.** (−28, 11) on Oak Ridge (the ridge is already named for it): 4.5 u above the camp, 17 u
west of the campfire, so the trunk stands in the default camera's background from the whole hub, and the
camp sits under its eastern boughs. Its shadow (centre ≈ (−18, 3.5), radius ≈ 12) crosses the south-west
of the hub as dappled light (broken canopy blobs, 0.45 intensity): acceptable and atmospheric. If
`hub-camp.png` shows the campfire ring inside solid shade, move the oak within the candidate box toward
(−30, 12) — the shadow moves 1:1 — and re-run the clearance test. Alternate site if the ridge fails
review: (−12, −6) south of the hub (ground 1.4, cell clearance 13.4, shadow falls away from the camp)
— it needs its own clearance run and hub-bounds change (`minZ` −12); do not use it without that.

**Collision (shared, server-authoritative).** Two `SherwoodObstacle`s at the oak centre, halfExtents
(2.0, 2.0), rotations 0 and π/4 — together an octagon of radius 2.0–2.16 that matches the round trunk
without a new collider type. The root flare (radius 2.4, ≤ 0.4 u tall) is walk-over ground. With
`SHERWOOD_PLAYER_RADIUS 0.45` the hero stops 0.45 u from bark. Roads already route around
`SHERWOOD_MISSION_STATIC_OBSTACLES` (`shared/world-composer.ts:578`), so no road change is needed.

**Runtime (`src/major-oak.ts`).**
- `attachMajorOak(scene, { castShadow, onStatus })`: adds the procedural oak synchronously at
  `(x, sherwoodFootprintGroundY(x, z, 2.0, 2.0), z)`; if `public/assets/environment/sherwood-major-oak.glb` is
  in the manifest (Stage 1) loads it with `gltfLoader.loadAsync(versionedAssetUrl(...))` →
  `convertObjectToToon` → `createAuthoredMajorOak` → replaces the procedural group in place (same
  position, `scale.setScalar(MAJOR_OAK_HEIGHT)`); on load failure or draw-call overrun
  (`countVillageDrawCalls > 4`) keeps the procedural one and calls `onStatus("procedural")`. The
  procedural oak is never disposed until the authored one is in the scene.
- `createAuthoredMajorOak`: the asset is normalised to 1 m height with its pivot at the trunk-base
  centre (Stage 1 guarantees it); runtime only scales, sets `castShadow/receiveShadow` per mesh, and sets
  `alphaTest = 0.5, transparent = false` on any leaf material so there is no sorting cost.
- `createProceduralMajorOak()` (all sizes for height 26; derive from `MAJOR_OAK_HEIGHT` as fractions):
  trunk `LatheGeometry` profile r 2.4 @ 0, 1.9 @ 1.5, 1.6 @ 4, 1.45 @ 8, 1.1 @ 12 (12 segments); six root
  buttresses (`DodecahedronGeometry` scaled ≈ 2.2 × 0.9 × 0.7, radiating, sunk 0.3); six limbs as
  `TubeGeometry` on `CatmullRomCurve3` (radius 0.55 → 0.25, 8 tubular × 5 radial) leaving the trunk at
  y 5–12 and reaching 9–12 u out, the two lowest (y 5.5 and 7) nearly horizontal toward +x / +z with
  two `CylinderGeometry(0.14, 0.16, h, 6)` props each from limb to ground; the hollow: a dark
  (`0x1b130d`) box 1.1 × 2.6 × 0.6 inset in the +x face at y 0–2.6, ringed by a bark arch; crown: eleven
  `IcosahedronGeometry(r, 1)` blobs, r 4.5–6.5, scaled (1, 0.62, 1), centres at y 13–22 and radius
  ≤ 12 from the axis, two-tone vertex colours, with gaps between blobs (dappled shadow). Bark (trunk,
  buttresses, limbs, props, arch, hollow) merged into ONE geometry with a `color` attribute; leaves
  merged into ONE; both `createToonMaterial({ vertexColors: true })` → 2 draw calls, ≤ 12 k triangles.
- LOD / tiers: always visible; `castShadow = renderProfile.shadows` on both groups; nothing distance-based.
  Camera occluder radius 2.6 (trunk only — the crown never occludes the player at this pitch).
- Debug view `oak: { player: { x: -24, z: 11 } }` — the hero at the oak's foot with the trunk directly
  behind, the first boughs crossing the top of the frame.

**Gameplay anchoring — decision: none in this task.** The campfire already anchors the hub (server spawn
ring, mission board, weapons-lowered rule); moving any of it 17 u up a ridge lengthens every hub
interaction. The hollow is cosmetic. Two follow-ups are worth a separate brief once the tree is in:
(1) a sanctuary rule (guards do not path within `canopyRadius` in missions) — server-side; (2) the hub
band roster / Scroll of Deeds display moved under the boughs. Record both in NOTES, implement neither.

**Stage 1 — registering the owner's asset (exact steps).**
1. The source file (any of `.glb .gltf .fbx .obj .blend`, plus textures) is placed OUTSIDE `public/`
   (e.g. `../major-oak-source/`). Record `shasum -a 256` and byte size of the archive/file as supplied.
   If nothing has been supplied, stop here: NOTES `WAITING FOR ASSET`.
2. Licence triage BEFORE conversion. Marketplace/Sketchfab/Quaternius etc. with CC0-1.0 or CC-BY-4.0:
   save the verbatim licence text as `docs/assets/licenses/<pack>-<spdx-lowercase>.txt`, `license.status
   "verified"`, `identifier "<SPDX>"`, `evidenceSha256` = sha256 of that file; CC-BY additionally gets the
   attribution line in `docs/assets/major-oak.md` (there is no in-game credits screen — verified). Owner-
   made or owner-supplied without a third-party licence: `status "project-authorized"`, `identifier
   "LicenseRef-Project-Owner-Authorized"`, evidence `docs/assets/licenses/major-oak-project-authorized.md`
   in the style of `ground-textures-project-authorized.md` (who supplied it, when, filename, sha256,
   bytes). Non-commercial, editorial-only, "free for personal use", or unknown → `ASSET REJECTED`, ship Stage 0.
3. `tools/build-major-oak.py` (Blender ≥ 5.1, modelled on `tools/build-stylized-nature-dressing.py`):
   import; join into ≤ 3 mesh objects by material family (bark, leaves, props); apply transforms;
   compute world bounds; translate so min Y = 0 and the X/Z centre of the TRUNK BASE (vertices with
   y < 5 % of height — not the canopy centre) is at the origin; scale so height = 1.0; limit every
   texture to 512 px; export GLB (`export_format='GLB'`, `export_image_format='WEBP'`, `export_apply=True`,
   `export_yup=True`) to `/tmp/sherwood-major-oak.raw.glb`. Then
   `npx gltf-transform optimize /tmp/sherwood-major-oak.raw.glb public/assets/environment/sherwood-major-oak.glb --flatten false --join false --instance false --simplify true --simplify-ratio <r> --simplify-error 0.02 --compress false --texture-compress webp --texture-size 512 --palette false`
   choosing `<r>` so triangles ≤ 20 000 (target 12 000) and bytes ≤ 500 000.
4. Measure the normalised trunk base radius (node one-liner, no new file):
   `node --input-type=module -e 'import {NodeIO} from "@gltf-transform/core"; import {ALL_EXTENSIONS} from "@gltf-transform/extensions"; const d=await new NodeIO().registerExtensions(ALL_EXTENSIONS).read("public/assets/environment/sherwood-major-oak.glb"); let r=0; for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a=p.getAttribute("POSITION"); for (let i=0;i<a.getCount();i++){const v=a.getElement(i,[]); if (v[1]<0.02) r=Math.max(r,Math.hypot(v[0],v[2]))} } console.log(r)'`
   → `r × 26` must be within [1.9, 2.5] for the shared collider (2.0); if not, rescale the trunk in the
   build script (never in runtime) and re-export. Write the number in NOTES and in `collision.reason`.
5. Manifest entry (append to `assets`; every field is required by the validator):
   `id "environment.sherwood.major-oak"`, `category "decorative-environment"`, `qualityGate { decision
   "accept", reviewedAt <date>, rationale }`, `provenance { sourceAsset, sourceSha256, sourceBytes,
   sourceGenerator, suppliedBy "project owner", conversionScript "tools/build-major-oak.py",
   conversionDoc "docs/assets/major-oak.md", optimizer "glTF Transform 4.4.1" }`, `license { … }`,
   `uri "assets/environment/sherwood-major-oak.glb"`, `format "glTF 2.0 GLB"`, `sha256`, `bytesMax 500000`,
   `resources { embedded true, externalUris [] }`, `geometry { renderVertices, uploadVertices, triangles,
   uniquePrimitives, sceneDrawCalls }`, `materials { count, names }`, `texture { count, format "webp",
   width, height, encodedBytes, gpuBytesApprox }`, `clips []`, `pivot { policy "bottom center at origin",
   passes true, evidence }`, `scale { units "meters", metersPerUnit 1, boundsMin, boundsMax }`,
   `orientation { upAxis "+Y", forwardAxis "+Z" }`, `collision { type "shared-authoritative-trunk-octagon",
   reason "<measured base radius>; SHERWOOD_MAJOR_OAK_OBSTACLES in shared/world-obstacles.ts" }`,
   `lod [ {0, 60, "self"}, {1, 140, "self; shadows only inside the ±40 u shadow frustum"}, {2, 300, "self in fog"} ]`.
   Add the id to `catalog.shipped`. Run `npm run validate:assets`; copy every "declared X does not match
   GLB Y" value it prints into the entry until it is green — the validator is the measuring tool.
6. `docs/assets/major-oak.md`: provenance, the exact commands, the measured numbers, the collider mapping.

## Stages

- **Stage 0 (no asset needed):** shared position + obstacles + hub bounds + dressing exclusion +
  composer clearance + protocol bump; `src/major-oak.ts` procedural oak; `attachMajorOak` in
  `createWorld`; occluder; `?view=oak`; harness; tests. Gate: criteria 1–5.
- **Stage 1 (asset present):** steps 1–6 above; `attachMajorOak` swaps it in. Gate: criteria 6–7.

## Acceptance criteria

1. `oak.png` / `oak-degraded.png` (`?view=oak`): the trunk behind the hero is visibly ≥ 3× thicker than
   any ordinary trunk in frame; the hero is shorter than the hollow's opening; at least one propped bough
   crosses the top band; the root flare sits on the ridge with no daylight under it and no bark sunk more
   than 0.4 u. `hub-camp.png`: the oak's trunk is in frame at the upper left and the campfire ring is not
   in solid shade (dappled or lit).
2. `major-oak.test.ts` + shared tests (pure data, no GLB): (a) `SHERWOOD_MAJOR_OAK` lies in
   x ∈ [−30, −28], z ∈ [10.5, 12]; for every `SHERWOOD_TREE_LAYOUT` tree
   `dist − 0.34·scale ≥ trunkHalfExtent + 1.0`; for every ridge rock `dist − 0.82·max(scale.x, scale.z) ≥
   trunkHalfExtent + 1.0`; for every pass `dist − radius ≥ 3`; for every region-cell centre `dist ≥ 11`;
   (b) both obstacles are in `SHERWOOD_STATIC_OBSTACLES` and `SHERWOOD_MISSION_STATIC_OBSTACLES`;
   `isSherwoodPlayerPositionBlocked(centre, 0)` is true and `…({x: centre.x + 2.9, z: centre.z}, 0)` false,
   with and without a layout; (c) the procedural oak's bark vertices with `y < 0.3` have max radius in
   [2.0, 2.5] (root flare may exceed the collider by ≤ 25 %), total height ∈ [25, 27], crown radius ≤ 12.5,
   `countVillageDrawCalls === 2`; (d) `PUBLIC_HUB_WORLD_BOUNDS.minX === -32`; (e) for seeds 1..48 no
   composed building rectangle (`composeSherwoodWorld`) has a corner inside the oak octagon and no shared
   forest rock (`createSherwoodMissionForestRockLayout`) is within 3.5 u of the oak.
3. `shared/map-feasibility.test.ts`, `shared/map-quality.test.ts`, `shared/world-composer.test.ts`,
   `shared/world-collisions.test.ts` green with the new obstacles (if a seed fails, move the oak inside the
   candidate box and re-run; record the seed).
4. `canvas.dataset.majorOak` is `"procedural"` in Stage 0 and `"authored"` in Stage 1 (harness logs it).
5. `npx tsc -b && npx vitest run` green; no new dependency; protocol version bumped once; Stage 0 diff ≤ 420 lines.
6. Stage 1: `npm run validate:assets` green with the new entry; file ≤ 500 000 bytes, ≤ 20 000
   triangles, ≤ 4 primitives, ≤ 3 materials, 512 px WebP; licence evidence file exists and its sha256
   matches; `docs/assets/major-oak.md` exists; the measured base radius × 26 ∈ [1.9, 2.5].
7. Stage 1: `oak.png` shows the authored asset (dataset `"authored"`) at the same position and height as
   the procedural one (silhouette top within ±1 u in the two captures); frame draw calls rise by ≤ 4.

## Hints

1. Stage 0 first, all of it, before touching the asset — the shared data and tests are what the asset
   plugs into.
2. Build the procedural trunk profile as one `LatheGeometry`; do not stack cylinders (visible rings).
3. `mergeGeometries` needs identical attribute sets: give every part a `color` attribute before merging.
4. The clearance test is cheap: it is arithmetic over `SHERWOOD_TREE_LAYOUT` and friends — no Three.
5. If the asset's leaves are alpha-blended cards, force `alphaTest 0.5, transparent false, depthWrite true`
   after `convertObjectToToon`; blended leaves through fog are the classic sorting mess.
6. For the region-map beacon use a CSS class on the existing cell element — no canvas drawing.
