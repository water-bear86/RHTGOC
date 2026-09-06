> **SUPERSEDED by `04-horizon-backdrop.md`** — this draft never landed and its numbers were not re-verified. Do not run it.

# Task 03 — Replace the empty expanse beyond the map with a painted horizon

Follow `README.md` in this folder. Max 8 iterations. Write NOTES.md beside this file.
Run AFTER task 02 (building scale) has landed.

## What is wrong (operator report)

Past the edge of the 184-unit terrain there is nothing: the flat clear colour
(`scene.background = 0x91aa83`, fog `FogExp2(0x91aa83, 0.012)`, `src/main.ts` ~line 351)
shows as an empty golden-sage void. The world needs a background — a distant forest under
a sky — so every camera angle ends on something painted, never on nothing.

## Constraints (hard)

- **Zero new runtime dependencies.** Three.js only.
- **Asset budget:** at most ONE new image ≤ 400 KB (WebP), under `public/assets/environment/`,
  registered in `public/manifest.json` the same way existing environment assets are, and
  passing the existing asset gate (`npm run validate:assets`). If you cannot make a texture,
  do the whole thing procedurally (gradients + instanced billboard trees) — that is allowed
  and preferred if it looks as good.
- Must render on the `degraded` tier (`?render=degraded`, no shadows, pixelRatio 1) without
  the frame budget regressing: no per-frame allocations, no more than 2 extra draw calls
  for the sky and ~1 for the treeline ring.
- Fog colour must equal the horizon colour where sky meets treeline, or the seam shows.
- Browser-native, buildless; no shader compile of your own unless a gradient sky needs it —
  a `ShaderMaterial` with ≤ 20 lines of GLSL is acceptable, a post-process pass is not.

## Where the code is (only these files may change)

- `src/main.ts` — scene/fog setup (~351), `addLighting()`, and the terrain/forest setup
  where `SHERWOOD_VISUAL_TERRAIN_SIZE` is used. Add ONE call, `addHorizonBackdrop(scene)`,
  defined in a new module.
- NEW `src/horizon-backdrop.ts` (+ `.test.ts`) — everything else lives here: sky dome or
  gradient, distant treeline ring, colour constants exported so the test can assert the
  fog/horizon match.
- `src/forest-dressing.ts` — only if you reuse its tree silhouettes for the ring.
- `public/assets/environment/`, `public/manifest.json` — only if you add the one texture.

Do NOT touch: terrain heightfield, region fog tiles (`regionFogViews` is gameplay fog of
war, not atmosphere), server/shared, any HUD/CSS.

## Design (this is the look — don't invent a different one)

Three layers, all centred on the camera target each frame (cheap: just copy position):

1. **Sky**: a large inverted sphere or a vertex-coloured dome, 3-stop gradient:
   zenith `#6f8fa8` → horizon `#d9d4b0` (warm haze) → below horizon fades to the fog colour.
   The horizon band is the ONLY warm/gold allowed — it explains today's golden void as
   "late afternoon light", which fits the toon-storybook art and the parchment UI.
2. **Far treeline ring**: a ring of ~48 flat, two-tone (dark `#22402a`, mid `#2f5a37`)
   conifer/oak silhouettes at radius ≈ 130–160 units, heights 14–22 units (they are FAR, so
   tall), slight per-tree jitter from a seeded PRNG, instanced or merged into one geometry.
   Fogged so they read as hazy blue-green, never crisp.
3. **Mid ring** (optional, only if the seam still shows): a lower, denser band at ~95 units
   using the existing `createFallbackTree` at scale 2.5, ~24 instances, merged.

`scene.fog` becomes `FogExp2(horizonColor, 0.010)`; `scene.background` is replaced by the
sky (or set to the horizon colour as a fallback under it).

## Acceptance criteria

1. `hub.png`, `hub-degraded.png`, `mobile.png`: no frame shows bare clear colour above or
   beyond the terrain — sky gradient above, treeline at the horizon, fog blending both.
2. `horizon-backdrop.test.ts`: fog colour === horizon gradient colour (exported constants),
   ring radius > `SHERWOOD_VISUAL_TERRAIN_SIZE / 2 + 30`, tree count and heights in range,
   and the backdrop group reports ≤ 3 meshes.
3. Frame-time guard: the existing `src/render-profile.test.ts` / any perf test stays green;
   no `new THREE.*` inside the per-frame update (grep your own diff).
4. If a texture was added: it is in the manifest, ≤ 400 KB, `npm run validate:assets` green.
5. `npx tsc -b && npx vitest run` green. Diff ≤ 220 lines including the new module.

## Hints

- Start procedural. A vertex-colour dome (SphereGeometry 32×16, `BackSide`,
  `MeshBasicMaterial({ vertexColors: true, fog: false, depthWrite: false })`) plus one
  merged `PlaneGeometry` silhouette ring gets criterion 1 in one iteration.
- Silhouettes: 2-triangle cards, `DoubleSide`, `alphaTest` not needed if you use solid
  triangles/polygons for crowns instead of textures.
- Keep the ring's Y anchored at the terrain edge height (sample `sherwoodHeightAt` at the
  ring radius) so trees don't float over the far slope.
