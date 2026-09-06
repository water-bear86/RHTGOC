# Task 05 — object scale — worker notes

Base: `loop/05-object-scale` cut from `release/sherwood-launch` (task 04 landed). Baseline gate
green at start: `npx tsc -b` clean, `npx vitest run` = 112 files / 900 tests pass.

## Diagnosis (iteration 0)

- Read the brief top to bottom and every file it lists. The measured before→after table (36 rows)
  and the shared-footprint list in §Design are the spec.
- Cause: non-hero objects authored at 1u≈1m for a ~1.75m person while heroes normalise to H=2.35;
  buildings additionally have doors/windows authored small on top. Fix = replace the authored
  component constants with hero-relative absolute constants (door 1.18×2.70, window 1.06×1.18,
  timber 0.18, lintel 0.14) and scale wall/roof/footprint of shells and whole props.
- First file changed: `src/building-visuals.ts` (Stage A rows 1,2,5-9,13-17), with new tests, then
  the shared footprints (composer literals, VILLAGE_COTTAGE_OBSTACLE, camp-hut layout+colliders,
  settlement renderer scale, village cottage scale).

Playwright not installed in this tree; installing with `npm i --no-save playwright` for the visual
harness. If the harness cannot run here (no GPU / headless), scale criteria are graded from the
test-encoded geometry (criterion 1/2) and PNGs where available.

## Stage A — buildings + shared

Landed. `npx tsc -b` clean; `npx vitest run` = 112 files / 905 tests green (5 new).

What changed (rows 1-20, 23 + shared footprints):

- `src/building-visuals.ts`: added absolute hero-relative component constants at the top
  (`DOOR 1.18x2.70`, `WINDOW_PANE 1.06x1.18`, `TIMBER 0.18`, `LINTEL 0.14`, `WINDOW_FRAME 0.10`).
  Cottage wall 2.12→3.50, foundation 0.24→0.26, roof `1.25+v*0.08`→`2.0+v*0.1`; farmhouse wall
  2.55→3.95, roof 1.65→2.55. Door/lintel/window/timber rebuilt from the constants; the front
  timber band moved from 0.58 to 0.86 of the wall so it clears the door head. Barn wall 2.7→4.2,
  roof `1.85+v*0.15`→`2.6+v*0.15`, doors 1.08x1.84→1.5x3.2, lintel widened. Watchtower platform
  3.65→5.2, legs 5.25, rails 1.3, roof top ~8.4, ladder rungs keep the 0.48 pitch (now to 5.2).
  New tests assert wall/ridge/door/window/foundation ratios and no timber over the door opening
  (criterion 1), plus per-hut visual footprint == collider (criterion 2a).
- `src/world-landmarks.ts`: farmhouse footprint 4.7x3.5→7.5x5.6 (row 12); stockade posts 2.35→3.3,
  rails 0.55/1.45→0.7/2.4, gate planks 0.54x2.15→0.6x3.0, key post 1.8→2.3 (row 23).
- `src/village-assets.ts`: added `VILLAGE_COTTAGE_SCALE = 1.25`; the standalone LOD0 cottage now
  `scale.setScalar(1.25)` so the GLB envelope (2.12x2.28) becomes 5.3x5.7 and matches the
  procedural fallback. `cottageMatrix` was intentionally NOT multiplied by the constant (see below).
- `src/settlement-renderer.ts`: `authoredCottageScaleForCollider` is now uniform on all three axes
  (`min(hx/2.12, hz/2.28)*0.99` = 1.2375 for the new collider); test updated + a seeds-1..24 parity
  test (criterion 2b).
- `shared/world-obstacles.ts`: new `SHERWOOD_CAMP_HUT_LAYOUT` (3 entries {x,z,rotation,halfExtents
  2.65x2.85}); `SHERWOOD_CAMP_HUT_OBSTACLES` derived from it; `VILLAGE_COTTAGE_OBSTACLE` is now the
  first hut; all three added to `SHERWOOD_STATIC_OBSTACLES` (hub only). `createHut` (main.ts) reads
  from the layout; the two new huts and the standalone cottage placement/occluder updated.
- `shared/world-composer.ts`: the two halfExtents literal blocks → cottage 2.65x2.85, barn 4.0x2.8,
  watchtower 1.8x1.8.
- `shared/world-collisions.test.ts`: cottage collider pin 2.75x3→2.65x2.85 + 1.25x envelope check;
  new hut-constraint test (criterion 2a: obstacle==layout, no overlap via SAT, edge >=5.5 from the
  (-11,9) spawn ring for the two new huts, trees + board outside).
- `src/debug-views.ts` + `tools/visual-check.mjs`: `hub` view (player -12.5,10.5) and `hub-camp` /
  `hub-camp-degraded` captures.

### Deviations / decisions (recorded per §Constraints)

1. **cottageMatrix NOT multiplied by VILLAGE_COTTAGE_SCALE.** Batch (settlement) cottages already
   carry the per-instance `authoredCottageScaleForCollider` scale (1.2375, with the 0.99 collision
   inset). Multiplying cottageMatrix by 1.25 on top would push them to ~1.55 and out of their
   colliders, breaking the visual==collision parity that is the whole point of this task. The 1.25 is
   delivered through `setScalar` on the standalone LOD0 and through the (uniform, ~1.25) fitted scale
   on the batch. This is the only literal deviation from the brief's "where the code is" wording; it
   preserves every criterion.
2. **Camp-hut positions nudged.** Brief-proposed A(-17.5,14.5)/C(-16.5,2) give edge distance 5.34 from
   the (-11,9) spawn anchor — under the brief's 5.5 margin (though above the 4.95 functional bound).
   Nudged to A(-17.77,14.73)/C(-16.72,1.73) (<=0.4u, within the allowed 1.5u) → 5.67/5.68, all other
   constraints still hold (SAT-disjoint, trees + board outside). The pre-existing cottage (-10,14) is
   grandfathered (edge 1.2 from the anchor); spawn depenetration already handled it and the brief
   keeps it unchanged, so the >=5.5 test applies only to the two newly-collidered huts.
3. **Composer ">=10 buildings" floor lowered to 8 (world-composer.test.ts:102).** Hint 5's slot
   widening was tried (1.4x, a 6-position spread, ±12.5) — it either lowered the count further OR
   pushed a settlement building onto a mission named position, which changes `regionalizeFeasible*`'s
   chosen layout for a fixed run token and breaks `server/mission.test.ts` ("triggers readable traps")
   — an untouchable file. Keeping the authored slot positions leaves mission world data (and the
   feasible-layout choice) unchanged: full server suite = 324 tests green. The mandated bigger
   footprints (cottage 5.3x5.7, barn 8x5.6) simply fit fewer per terrace; over the test's 32 seeds the
   floor is 8 (two seeds: 39595 + one other; distribution 8,8,9x8,10x11,11x7,12x4). Threshold updated
   to >=8 per criterion 5 with an inline comment. Single-seed check (seed 4219 = 12) at :21 unchanged.

### Criteria after Stage A

- C1 (building ratios) PASS — `building-visuals.test.ts` new cases.
- C2 (footprint parity) PASS — a/b/c green; d is Stage C.
- C3 (`hub-camp.png`) PASS — cottages have tall walls, big windows, hero-tall doors, roof is not a
  hat; three huts on the ground, disjoint, clear of trees; board visible. `hub.png` shows Robin
  dwarfed by the farm. (Hero is occluded behind the foreground cottage in the hub-camp debug frame.)
- C5 partial — composer/collision/settlement/village/landmark suites green (composer floor note above).
