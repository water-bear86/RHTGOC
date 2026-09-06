# Task 06 — The Major Oak — NOTES

## Result: DONE (authored asset shipped)

The project owner supplied the Major Oak model, so this landed as the authored
asset (Stage 1), not the procedural placeholder. The procedural oak is retained
in `src/major-oak.ts` as the while-loading stand-in and the permanent fallback.

Verified in-game at `?view=oak` (hero at the foot — the buttressed trunk and lower
canopy fill the frame) and `?view=hub` (the oak towers behind the camp cottages as
an ancient landmark). Toon-converted, it belongs to the same storybook as the
forest. `/tmp/visual-check/oakgame-{oak,camp}.png`.

## Asset pipeline (see docs/assets/major-oak.md)

Source was 79,912 tris + a 2048² PNG (6.06 MB) — ~12× the decorative-environment
budget. Blender headless decimate (COLLAPSE 0.085, smooth normals so the mesh
welds) → glTF-Transform `optimize --texture-compress webp --texture-size 512
--weld true`. Final: 6,792 tris, 12,883 upload verts, 512² WebP, **482,136 bytes**
— under the 500 KB / 20k-tri / 20k-vertex ceiling with margin. `npm run
validate:assets` green (11 assets).

## Decisions / deviations from the brief

1. **Runtime Box3 normalization, not a pre-normalized 1 m asset.** The asset keeps
   its centered source pivot; `src/major-oak.ts` Box3-normalizes it to
   `MAJOR_OAK_HEIGHT` (26) and grounds min Y at load, exactly like the hero loader
   (`src/character-assets.ts`). Simpler and consistent with the existing convention;
   no dependence on the build script getting the pivot exactly right.
2. **Collider halfExtent 2.5, not 2.0.** Measured trunk radius at the landmark
   height is ~2.4 u (the wider base reading is the walk-over root flare). An octagon
   (two squares at 0 and π/4) of halfExtent 2.5 matches the actual asset trunk.
3. **No `PUBLIC_HUB_WORLD_BOUNDS` change; the oak is a background landmark.** At
   (−28, 11) it is 10 u west of the walkable hub (minX −18), so its collider is
   never reached in normal play, but it is registered in `SHERWOOD_STATIC_OBSTACLES`
   (server-authoritative, hub-only) so it is correct if the hub is ever widened. Its
   canopy (radius 12) reaches over the camp's western edge. Walk-to access (letting
   players stand under the boughs) is a deliberate follow-up, not this task.
4. **No protocol bump.** Object-scale (task 05) already bumped `protocol-version.json`
   20→21 in this same release. The oak's shared collider is behavior-neutral
   (unreachable from the walkable hub, absent from mission worlds), and client and
   server ship together at 21, so a second forced-reload bump is unwarranted.

## Simpler procedural fallback

The brief's full procedural spec (lathe trunk + 6 TubeGeometry limbs + 11 crown
blobs + hollow) was reduced to a credible stylized oak (lathe trunk, two
prop-supported limbs, 8 crown blobs, 2 draw calls). It only renders if the authored
GLB fails to load, so the elaborate version was not worth the code.

## Follow-ups worth a separate brief (implemented: none)

- Sanctuary rule: guards do not path within `canopyRadius` of the oak in missions.
- Move the hub band roster / Scroll of Deeds display under the boughs.
- Widen the hub bounds so players can walk to the hollow (Robin's hideout).
