# Task 01 — Fix the sun shadow effect

Follow `README.md` in this folder. Max 8 iterations. Write NOTES.md beside this file.

## What is wrong (operator report)

The dynamic shadows look wrong in play. Diagnose which of these it is from the `before-*.png`
captures — it may be more than one:

- **A. Shadows vanish or get sliced** when the player walks away from the map origin.
- **B. Blocky / stair-stepped shadow edges**, especially on tree crowns and roofs.
- **C. Acne or peter-panning**: striped self-shadowing on the ground, or shadows detached
  from the feet of characters and the base of walls.
- **D. A hard, sharp, over-dark shadow** that fights the storybook toon look.

## Where the code is (only these files may change)

- `src/main.ts` — `addLighting()` (~line 904): sun `DirectionalLight` at a fixed
  `position (-18, 28, 14)`, `castShadow`, `shadow.mapSize 2048²`, ortho shadow camera fixed
  at ±75 units around the origin, `near 1 / far 150`, `bias -0.0004`, `shadow.intensity 0.3`.
  `renderer.shadowMap.type = PCFSoftShadowMap` (~line 373). The sun and its target are never
  moved after creation. The camera follows the player; the shadow frustum does not.
- `src/render-profile.ts` — `shadows` is off entirely on the `degraded` tier.
- `src/render-shadow.ts` and `src/render-shadow.test.ts` — the existing shadow helper and its
  tests. Put any new pure math (frustum fitting, texel snapping) HERE with a unit test, not in
  main.ts.

Do NOT touch: `src/character-occlusion.ts` (the silhouette-behind-cover effect is not a
shadow and is not this task), any `server/` or `shared/` file, any GLB or asset.

## Facts you need

- The visual terrain is 184×184 units (`SHERWOOD_VISUAL_TERRAIN_SIZE`). A ±75 ortho box
  centred at the origin does not cover it → cause A.
- 2048 px across 150 units ≈ 13.6 px per unit; a hero is ~2.3 units tall → ~31 px of shadow
  map for a whole character → cause B.
- Bias −0.0004 with a 150-unit far plane is a guess; `normalBias` is unset → cause C.
- Every frame already has the player world position (`player.x`, `player.z`) and the
  camera; use them.

## Acceptance criteria (all must be PASS in the PNGs and tests)

1. `hub.png`: every tree, hut, and the hero cast a visible, soft-edged shadow on the ground;
   no shadow is cut off by a straight frustum edge anywhere in frame.
2. The shadow camera **follows the player**: a new unit test in `render-shadow.test.ts` proves
   that a `fitShadowFrustum(playerPos, cameraPos)` (or equivalently named pure function)
   returns a box that contains the player and the visible ground ring, and that the box
   origin is **snapped to shadow-map texels** so shadows don't shimmer as the player moves.
3. Shadow map resolution is spent where the camera looks: the ortho box is no larger than
   ~90 units on a side (tighter is better) and `near/far` hug the scene instead of `1..150`.
4. No shadow acne on flat ground and no visible gap between a hero's feet and their shadow
   (`bias`/`normalBias` tuned; `normalBias` must be non-zero).
5. Shadow darkness matches the toon look: soft PCF, `shadow.intensity` between 0.35 and 0.55,
   never black. `hub-degraded.png` still renders correctly with shadows disabled.
6. `npx tsc -b && npx vitest run` green. No new dependencies. Diff ≤ 120 lines.

## Hints (use in this order, stop when criteria pass)

1. Add `fitShadowFrustum` in `render-shadow.ts`: centre on the player, half-size ≈ 40,
   `near = 0.5`, `far = distance(sun → centre) + 60`, snap `centre.x/z` to
   `worldUnitsPerTexel = (2 * halfSize) / mapSize`.
2. In the render loop, each frame: `sun.position.copy(centre).add(sunOffset)`,
   `sun.target.position.copy(centre)`, `sun.target.updateMatrixWorld()`, and call
   `sun.shadow.camera.updateProjectionMatrix()` only when the box changes.
3. Then tune: `bias -0.0002`, `normalBias 0.02..0.05`, `shadow.intensity 0.45`.
4. Only if B persists after 1–3: raise `mapSize` to 4096 on `standard` tier only.
