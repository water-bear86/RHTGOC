# Task 04 — Paint the edge of the world: ground apron, forest wall, sky dome

Follow `README.md` in this folder. Max 8 iterations. Write `04-NOTES.md` beside this file.
Supersedes `03-horizon-backdrop.md` (never landed; its numbers were not re-verified — ignore it).
Run this task FIRST of 04/05/06: it introduces the `?view=` debug camera that 05 and 06 reuse.
Every path, line and number below was verified at commit `892bc5f` on `release/sherwood-launch`
(origin/main + launch fixes). Line numbers drift; the function names are the real anchors.

## What is wrong (operator report)

Past the 184-unit visual terrain there is nothing. Clear colour and fog are one flat sage
(`0x91aa83`), so from the outer third of the play area the top of the frame ends on a straight
terrain edge with a flat void beyond it. Every camera angle must end on something painted: ground
that keeps going, a hazy treeline, and a warm late-afternoon sky band above it.

## Facts (measured — use these, do not re-derive)

- `src/main.ts:356-357`: `scene.background = new THREE.Color(0x91aa83)`,
  `scene.fog = new THREE.FogExp2(0x91aa83, 0.012)`. `src/main.ts:382`: `renderer.setClearColor(0x91aa83, 1)`.
  Nothing else under `src/` uses that hex.
- Camera (`src/main.ts:359-361` and the follow block at `5011-5013`): `PerspectiveCamera(42° vertical,
  aspect, 0.1, 280)`; every frame it lerps to `player + (12.5, 14.5, 15.5)` (offset rotated by quarter
  turns) and looks at `player + 0.75`. Pitch = atan(13.75 / 19.9) = **34.6° down**, half-FOV 21°, so the
  top-centre ray of the frame points **13.6° below horizontal** (top corners at 16:10: 11.8°).
  **The sky is never in frame during play.** On flat ground the top of the frame shows ground 60 u
  (centre) to 70 u (corners) from the camera; with the worst terrain delta (camera on a 2.57 rise,
  ground at −0.66) 85 u. So the void appears only when the camera is within ~70–85 u of an edge
  along its view direction — but there it fills the whole top band.
- The camera's |x| and |z| never exceed 67 + 15.5 = **82.5** (`SHERWOOD_REGIONAL_BOUNDS = 67`,
  `shared/regional-layout.ts:43`). Visual terrain: `SHERWOOD_VISUAL_TERRAIN_SIZE = 184`
  (`src/sherwood-terrain.ts:12`) → edge at ±92, corners at radius 130.
- Terrain heights: along the edge −0.52 … 2.57 (mean 1.19); interior −0.52 … 7.13; the analytic
  surface beyond the edge out to r = 220: −0.66 … 2.77. `sherwoodHeightAt(x, z)` already returns the
  analytic `sherwoodTopologyHeightAt` outside ±92 (`src/sherwood-terrain.ts:40-43`), so the ground can
  be continued outward with the same function and the seam at ±92 can be exact.
- Terrain material (`src/sherwood-terrain.ts:121-124`):
  `createSherwoodGroundMaterial("meadow", { color: 0xd2dfbd, repeat: { x: 38, y: 38 } })` → one texture
  tile = 184/38 = 4.842 u; terrain UV is `u = (x+92)/184, v = (z+92)/184` (PlaneGeometry rotated −90°
  about X), i.e. tile phase = world/4.842 with an integer 19-tile offset.
  **Warning:** `createSherwoodGroundMaterial` writes `repeat` onto the SHARED cached textures
  (`src/ground-materials.ts:19, 47-55, 62`). Never call it with another repeat; reuse `terrainView.material`.
- FogExp2 0.012, fraction of fog colour by distance: 20 u 6 % · 34 u 15 % · 48 u 28 % · 60 u 40 % ·
  70 u 51 % · 90 u 69 % · 100 u 76 % · 130 u 91 %. Authored trees are hidden beyond 48 u (34 u degraded)
  from the player (`src/main.ts:4870`). Lowering density makes that pop MORE visible → density stays 0.012.
- Draw-call budgets: 220 desktop / 130 degraded (`public/assets/manifest.json:793-794`). Degraded tier
  (`src/render-profile.ts`): shadows off, pixelRatio 1, nothing else.
- three.js applies fog after tone mapping and colour-space conversion, in the same output space as the
  clear colour, so a fully fogged fragment equals `scene.background` exactly. A `MeshBasicMaterial` with
  `toneMapped: false` outputs its vertex colour exactly (sRGB). Hence the dome must be
  `toneMapped: false, fog: false` and share the SAME hex as fog and background, or a seam shows.
- `tools/visual-check.mjs` captures the solo default layout (`createInitialState` →
  `stableSeed("solo-default")`, `src/simulation.ts:130`), NOT the hub at (−11, 9): the player stands at
  that layout's campfire, 60+ u from every edge, so today's captures never show the void. This task adds
  captures that do.

## Constraints (hard)

- Zero new runtime dependencies. Three.js only. `mergeGeometries` from
  `three/examples/jsm/utils/BufferGeometryUtils.js` is already used by `src/world-landmarks.ts`.
- Fully procedural: no image, no manifest change, no custom shader, no post-process.
- The backdrop is exactly **3 meshes = 3 draw calls** on both tiers. No per-frame allocation
  (`new THREE.*`, `.clone()`, array/object literals) inside the per-frame update.
- Fog colour === horizon colour === clear colour === ONE exported constant. Density stays 0.012.
- Nothing inside |x|,|z| ≤ 92 moves, culls or re-tints except through the fog colour itself.
- Must render on `?render=degraded`. `npx tsc -b && npx vitest run` green. Diff ≤ 340 lines including
  the two new modules, their tests and the harness change.

## Where the code is (only these files may change)

- NEW `src/horizon-backdrop.ts` (+ `src/horizon-backdrop.test.ts`) — constants, `skyColorAtElevation`,
  `createHorizonBackdrop({ groundMaterial })` → `{ group, update(camera) }`. Everything in §Design lives here.
- NEW `src/debug-views.ts` (+ `src/debug-views.test.ts`) — pure data + `resolveDebugView(search)`; §Design 4.
- `src/main.ts` — (a) lines 356-357 and 382: replace the three `0x91aa83` literals with the imported
  `HORIZON_COLOR` / `HORIZON_FOG_DENSITY`; (b) `createWorld()` (line 977): after `scene.add(terrainView)`
  add `scene.add(backdrop.group)` with `groundMaterial: terrainView.material`; (c) the camera block at
  5011-5013: call `backdrop.update(camera)` right after the lerp/lookAt, and apply the debug view
  (freeze camera / teleport once); (d) parse `?view=` beside the existing `?render=` parse (line 374).
  ≤ 30 changed lines in this file.
- `tools/visual-check.mjs` — add the three `horizon*` captures (§Design 5) and fix the comment on line 8.

Do NOT touch: `src/sherwood-terrain.ts`, `src/ground-materials.ts`, `src/tree-placements.ts`,
`src/forest-dressing.ts`, `src/nature-assets.ts`, `src/world-landmarks.ts`, `src/render-shadow.ts`,
`addLighting()` (`src/main.ts:919`), `regionFogViews` (gameplay fog of war, not atmosphere), anything
under `shared/`, `server/`, `public/`, `index.html`, `src/style.css`.

## Design (this is the look — don't invent a different one)

Late-afternoon Sherwood: warm parchment haze on the horizon, dusty steel-blue above, and the forest
closing the world in a soft wall. All three layers meet at ONE colour — the horizon colour — so no
seam can exist. Toon/storybook throughout: flat facets, no textures on the backdrop trees.

Palette (sRGB hex — export every one from `src/horizon-backdrop.ts`):

- `HORIZON_COLOR = 0xdad2a9` — fog, clear colour, dome at and below 0°, and what apron and wall converge
  to. Sits between the UI `--paper-2 #e6d6b1` (`src/style.css:18`) and the meadow green so distance reads
  as warm haze, not dust.
- `HORIZON_FOG_DENSITY = 0.012` (unchanged).
- Sky ramp `skyColorAtElevation(deg)` — linear interpolation in sRGB between stops:
  `≤ 0° #dad2a9 · +6° #d1d4b6 · +18° #a9bfc3 · +45° #7f9db4 · +90° #6f8fa8`.
- Wall bark `#4a3626`; crowns two-tone `#2e5233` / `#3f6b3f`, alternating per cone; pre-hazed toward
  HORIZON by 15 % (inner row) and 35 % (outer row); ±5 % luminance jitter per tree from the seeded PRNG.

**Layer 1 — ground apron `SherwoodHorizonApron`** (this is the layer that actually fixes the report)

- Square annulus from |x|,|z| = 92 to `APRON_HALF_EXTENT = 180`, built from four `PlaneGeometry` strips
  at 4-unit spacing (N/S strips 360 × 88 → 90 × 22 segments; E/W strips 184 × 88 → 46 × 22), every vertex
  `y = sherwoodHeightAt(x, z)`, merged into one geometry. The grid must contain x, z = ±92 exactly (start at
  −180, step 4 → −92 is vertex 22) so the inner loop coincides with the terrain edge vertices; the analytic
  surface changes < 0.02 u over 4 u, so there is no crack.
- UVs in the terrain's own frame: `u = (x + 92) / 184`, `v = (z + 92) / 184` (values outside 0..1 are fine:
  the shared textures are `RepeatWrapping`). Material: the `groundMaterial` passed in
  (`terrainView.material`) — same textures, same repeat, same toon ramp → invisible seam at any distance.
- `receiveShadow = true`, `castShadow = false`, static. ≈ 6 k quads.
- Why 180: the farthest ground point the frame can ever show is camera |coord| 82.5 + 85 = 167.5.

**Layer 2 — forest wall `SherwoodHorizonTreeline`**

- Two SQUARE rings, not circles: the camera's |coord| ≤ 82.5, so a square ring at ≥ 96 can never stand
  between the camera and the player; a circle close enough to be seen through fog would pass inside the
  terrain corners where the camera can be. Row A: `max(|x|,|z|) = 100 ± 3`, 160 trees, spacing 5 ± 1.5
  along the 800-u perimeter, heights 13–17. Row B: 108 ± 4, 100 trees, spacing 8 ± 2, heights 16–21.
  Walk the perimeter as one loop so the four corners are filled.
- Each tree (h = its height): trunk `CylinderGeometry(0.06h, 0.09h, 0.30h, 6)`; crown = three stacked
  `ConeGeometry(r, height, 7)` with radii 0.28h / 0.22h / 0.15h, heights 0.40h / 0.35h / 0.30h, bases at
  0.30h / 0.55h / 0.78h. Every 4th tree is a broadleaf: two `IcosahedronGeometry(0.30h, 1)` blobs scaled
  (1, 0.7, 1) at 0.55h and 0.75h instead of the cones. Base `y = sherwoodHeightAt(x, z) − 0.3` (hides the
  flat bottom on slopes). Rotation, jitter and colour jitter from a seeded LCG (same 16807 recurrence as
  `src/forest-dressing.ts:35-41`, seed `0x4f414b`).
- Merged into ONE `BufferGeometry` with a `color` attribute (`mergeGeometries(list, false)`); material
  `createToonMaterial({ vertexColors: true })` (lit and fogged like the rest of the world, so it inherits
  the storybook ramp and converges to HORIZON). `castShadow = false`, `receiveShadow = false`.
  ≈ 16 k triangles, 1 draw call.
- Row A is 17.5–53 u from any camera that can see it and reads as the forest edge; row B and the real fog
  do the "hazy" part. Fog at 53 u is 33 %, at 17.5 u 4 %: the near row will be crisp — that is correct for
  a forest edge, which is why it uses the toon material and faceted silhouettes, not flat cards.

**Layer 3 — sky dome `SherwoodSkyDome`** (insurance; ~40 lines)

- `SphereGeometry(230, 24, 16)` (230 < camera far 280), `side: THREE.BackSide`,
  `MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false, depthWrite: false })`,
  `frustumCulled = false`, `renderOrder = -1`. Vertex colour = `skyColorAtElevation(asin(y / 230))`,
  written through `THREE.Color.setHex` so the attribute is linear-encoded as three expects.
- `update(camera)` does exactly `dome.position.copy(camera.position)`. That keeps the dome centred on the
  camera for free and guarantees every ray that misses apron and wall (top corners when the wall stands
  in a dip; any future camera change; extreme aspect ratios) ends on the horizon colour or the ramp.
- Keep `scene.background = new THREE.Color(HORIZON_COLOR)` as the fallback under it.

**4 — Debug views (`src/debug-views.ts`)** — needed to photograph the edge; inert in play.

```ts
export interface DebugView { camera?: { position: [number, number]; target: [number, number] }; player?: { x: number; z: number } }
export const DEBUG_VIEWS: Readonly<Record<string, DebugView>>
export function resolveDebugView(search: string): DebugView | null   // reads ?view=<name>
```
Positions are x/z only; `src/main.ts` sets camera `y = sherwoodHeightAt(target) + 14.5` and target
`y = sherwoodHeightAt(target) + 0.75`, so the pitch equals gameplay and the module stays Three-free.
- `horizon`: camera (59.5, 56.5) → target (72, 72). Looks out over the +x/+z corner; the top of the frame
  lands ~102 u out, past the terrain edge (this frame is bare void today).
- `horizon-x`: camera (46.1, 8) → target (66, 8). Looks along +x at the east edge from inside; the wall
  at 100 is 54 u away and sits in the top band.
In `src/main.ts`: a view with `camera` sets the camera once, hides `playerView`, and skips the
lerp/lookAt block every frame; a view with `player` assigns `state.player.position` once before the first
frame (05 and 06 add `hub` / `oak` rows that use this). No param → `null` → nothing changes.

**5 — Harness** (`tools/visual-check.mjs`): add
`await shoot("horizon", { width: 1440, height: 900, query: "?view=horizon" })`,
`await shoot("horizon-degraded", { width: 1440, height: 900, query: "?view=horizon&render=degraded" })`,
`await shoot("horizon-x", { width: 1440, height: 900, query: "?view=horizon-x" })`.
Replace the line-8 comment with "Captures the solo default layout at its campfire plus the `?view=` debug views".

## Acceptance criteria (all must be PASS in the PNGs and tests)

1. `horizon.png`, `horizon-degraded.png`, `horizon-x.png`: no region of flat clear colour bounded by a
   straight edge anywhere in frame; the ground texture continues past |x|,|z| = 92 with no visible line
   (no brightness step along the old edge); a treeline closes the top band; whatever shows above the
   treeline is the horizon colour, not a hole. Name the pixel band you inspected in NOTES.
2. `hub.png`, `hub-degraded.png`, `mobile.png`: composition unchanged; only the distance tint moved from
   sage to warm haze; no new pop-in at the top of the frame.
3. `horizon-backdrop.test.ts`: (a) `skyColorAtElevation(e).getHex() === HORIZON_COLOR` for
   e ∈ {−90, −30, −1, 0}; (b) every wall tree has `96 ≤ max(|x|,|z|) ≤ 113` and `13 ≤ height ≤ 21`, and the
   count is 240–280; (c) every apron inner-loop vertex (|x| = 92 or |z| = 92) satisfies
   `|y − sherwoodHeightAt(x, z)| < 1e-6` and the outer loop is at max(|x|,|z|) = 180; (d)
   `APRON_HALF_EXTENT ≥ 82.5 + (14.5 + 2.57 + 0.66) / Math.tan(11.8° in rad)` (= 167.5) and
   `WALL_INNER_MIN ≥ 82.5 + 10`; (e) `countVillageDrawCalls(group) === 3` (import from
   `src/village-assets.ts`), dome material `fog === false && toneMapped === false`, wall and apron
   materials `fog === true`; (f) calling `update(camera)` 500× leaves `group.children.length` and every
   geometry's vertex count unchanged and puts the dome at `camera.position`.
4. `debug-views.test.ts`: `resolveDebugView("?view=horizon")` returns the entry;
   `resolveDebugView("")` and `resolveDebugView("?view=nope")` return `null`.
5. `grep -c 0x91aa83 src/main.ts` prints 0; `scene.fog`, `scene.background` and `setClearColor` all use
   `HORIZON_COLOR` (grep your diff).
6. `npx tsc -b && npx vitest run` green; `node tools/visual-check.mjs --tag iterN` exits 0 on all six
   captures (no page error); no new dependency; diff ≤ 340 lines.

## Hints (use in this order, stop when criteria pass)

1. Apron first — it alone removes the void in `horizon.png`. Build one strip, check the seam, then mirror.
2. Wall second. Write one `treeGeometry(h, seed) → BufferGeometry` with a `color` attribute, loop, merge.
   Do not create Meshes per tree.
3. Dome last; it is one function and one line of update.
4. If the seam shows as a brightness step you have a second material instance (shared texture `repeat`
   clobbered): pass `terrainView.material` and nothing else.
5. If a corner of the wall shows a gap in `horizon.png`, you walked four sides instead of one loop.
