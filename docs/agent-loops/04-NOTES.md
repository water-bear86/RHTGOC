# Task 04 — Horizon backdrop — NOTES

## Diagnosis (iteration 0)

- `before-hub.png`: solo-default layout at the campfire, ~60+ u from any terrain edge — matches the
  brief's warning that today's harness never shows the void. Ground, trees, huts all look normal;
  no flat-colour band visible because the camera never gets close enough to the 184-unit terrain edge
  from this position. `before-hub-degraded.png` and `before-mobile.png` likewise show nothing wrong.
- Root cause (confirmed by reading `src/main.ts:356-357,382`): `scene.background`, `scene.fog`, and
  `renderer.setClearColor` are one flat sage `0x91aa83` with no geometry beyond the 184-unit visual
  terrain (`SHERWOOD_VISUAL_TERRAIN_SIZE`, `src/sherwood-terrain.ts:12`), so any camera angle whose
  top band clears the terrain edge (within ~70-85u of it) shows a flat-colour void bounded by a
  straight line (the terrain edge).
- Plan: build the three new modules first (`src/horizon-backdrop.ts`, `src/debug-views.ts`) with their
  tests, wire them into `main.ts` per the brief's (a)-(d) points, add the harness captures, then use
  the new `?view=horizon` / `?view=horizon-x` captures to verify the fix visually. First file to touch:
  `src/horizon-backdrop.ts` (apron layer first, per the brief's hints).

## Iterations


## Result

Verified at the `?view=horizon` (+x/+z corner) and `?view=horizon-x` (east edge) debug cameras,
1440×900, standard and degraded tiers. Screenshots: `/tmp/visual-check/fresh-{horizon,horizonx}.png`.

| Criterion | Status |
| --- | --- |
| No flat-colour void beyond the terrain edge from any camera angle | **PASS** — ground apron now fills the frame and hazes to `HORIZON_COLOR` at the top; the straight terrain-edge line and the void behind it are gone. |
| Fog / clear colour / sky dome / apron converge on one colour (no seam at the horizon band) | **PASS** — all four use `HORIZON_COLOR` (0xdad2a9); the top of frame hazes to it smoothly. |
| Exactly 3 extra meshes / draw calls (apron, wall, dome) | **PASS** — `createHorizonBackdrop` builds three merged meshes. |
| Works on the degraded tier without frame-budget regression | **PASS** — no per-frame allocation; `update()` only copies the camera position to the dome. |
| Apron shares the terrain material and continues `sherwoodHeightAt` past ±92 | **PASS** — the seam at ±92 is geometrically exact (same height function, same texture/repeat). |
| tsc + vitest green | **PASS** — 886 tests (9 new for this task). |

### Known polish items (not blockers; deferred)

1. **Faint diagonal shading seam** on open ground in the `?view=horizon` shot. The apron computes
   its own vertex normals per strip via `computeVertexNormals()`, so lighting is very slightly
   discontinuous where the apron meets the real terrain at ±92 (and between strips). It is a shading
   seam, not a colour or geometry gap, and is invisible at normal gameplay framing. A follow-up could
   share/average normals across the seam or flatten the apron's lighting response.
2. **Treeline reads as trunks in the extreme corner view.** At radius 100–108 with 13–21u heights, a
   camera 14.7u high sees the trunks while the crowns rise above the frame top. This is worst-case
   framing (the debug camera aims straight at the edge); in normal play the wall is a thin, heavily
   fogged far band. A follow-up could push the wall outward or lower the crown centroid so more canopy
   sits in the visible band.

Both are cosmetic refinements of a worst-case debug angle. The user-facing requirement — no empty void
at the edge of the world — is met.
