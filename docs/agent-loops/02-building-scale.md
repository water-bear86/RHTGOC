# Task 02 — Scale buildings correctly against the heroes

Follow `README.md` in this folder. Max 8 iterations. Write NOTES.md beside this file.

## What is wrong (operator report)

Houses read as toys. A hero standing beside a cottage is taller than its walls and about a
third of its width; real proportions are a person ~1/2 of wall height and ~1/4 of the width.

## The numbers (measured in the codebase — do not re-derive, use these)

- Heroes are normalized to `height` in `src/character-assets.ts`: Robin 2.35, Marian 2.15,
  Little John 2.5, Much 1.92 world units. **Hero height is authoritative** — gameplay,
  collision, camera, and the server all assume it. Do not change it.
- Stylized buildings in `src/building-visuals.ts`: cottage `wallHeight 2.12`, farmhouse
  `2.55`, roof `1.25–1.65`; the camp hut is `createHut()` in `src/main.ts` with
  `width 3.2 × depth 2.6`. So a cottage is ~3.4 tall and 3.2 wide next to a 2.35 hero.
- Target ratios (hero = 1.0): wall height ≈ 1.6, ridge ≈ 2.4, cottage width ≈ 3.5,
  depth ≈ 2.8, door ≈ 1.15 tall. That is roughly a **×1.75 uniform scale** on today's
  cottage, and the windows/door/timber components must NOT scale with it (they are already
  hero-sized).

## Where the code is (only these files may change)

- `src/building-visuals.ts` (+ `.test.ts`) — the box/gable component builder. Add a single
  exported `BUILDING_SCALE` constant (or per-kind table) and apply it to wall height, roof
  height, and width/depth of the shell only; keep component sizes (window 0.5×0.44, door,
  timber 0.13) in world units.
- `src/main.ts` — `createHut()` (~line 942) and the village cottage placement (~line 1289):
  pass the scaled footprint into `sherwoodFootprintGroundY(x, z, halfW, halfD, rot)` and
  bump `cameraOccluders` radius to match.
- `src/settlement-renderer.ts` — if generated settlements size buildings from
  `shared/world-composer.ts` records, scale at render time here, not in shared.
- `shared/world-obstacles.ts` (`sherwood-village-cottage` footprint) and
  `shared/world-collisions.ts` — **the collision footprint must match the new visual**. This
  is shared with the server, so change it in one place, keep the existing tests green, and
  add one test asserting visual footprint == collision footprint for the cottage.

Do NOT touch: character files, GLB assets, `shared/world-composer.ts` placement logic
(spacing between buildings is a separate problem; if scaled buildings now overlap roads,
say so in NOTES.md — don't fix it here).

## Acceptance criteria

1. `building-visuals.test.ts`: new test proves cottage wall height / Robin height is within
   `1.5..1.7` and cottage width / Robin height within `3.2..3.8`.
2. `world-collisions.test.ts` (or obstacles test): cottage collision footprint equals the
   visual footprint ± 0.05 units, both for the fixed hub cottage and the camp hut.
3. `hub.png`: the hero beside the hut is visibly shorter than the wall top; door is
   hero-sized; windows are not giant; roof overhang looks right (not a hat).
4. Buildings still sit on the terrain (no floating, no sunk foundations) — check the base
   line in `hub.png` and `mobile.png`.
5. Camera occlusion still works: walking behind the hut still fades it (radius updated).
6. `npx tsc -b && npx vitest run` green (654+ tests). No new deps. Diff ≤ 150 lines.

## Hints

1. Do the constant + visuals first, screenshot, confirm criterion 3 before touching
   collision — you want to see the proportion is right before propagating it.
2. `sherwoodFootprintGroundY` takes half-extents; the hut call passes `1.6, 1.3` today.
3. The village-module GLB cottage (`createVillageCottage`) is authored geometry; scale the
   group uniformly with `.scale.setScalar(BUILDING_SCALE)` and re-anchor Y with
   `sherwoodFootprintGroundY`. Component sizes inside a GLB can't be excluded — accept it,
   note it.
