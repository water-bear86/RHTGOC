# Authored Sherwood tree grove

The source `Tree Assets (1).glb` was supplied by the project owner and is integrated as `environment.sherwood.tree-grove`.

## Normalization

`tools/normalize-tree-grove.py` performs the repeatable Blender conversion:

- removes the source presentation ground tile;
- centers the grove on X/Z, places the lowest root at Y=0, and normalizes total height to one meter;
- preserves all eight flat-color materials and their texture-free low-poly appearance;
- joins 18 source objects into one mesh with eight material primitives;
- exports an extension-free GLB that requires no decoder or external texture requests.

The resulting shipping asset is 384 KB, 15,264 rendered vertices, 11,107 uploaded vertices, eight draw calls, and no textures or animation clips.

## Runtime policy

Standard devices place three differently scaled and rotated groves on the perimeter. Degraded devices place one. Each grove is visible within its authored 38-meter LOD range; beyond that, the procedural forest and fog remain the fallback. The procedural placement count was reduced when the authored layer was added, keeping the forest denser in character rather than simply increasing scene cost.

The grove is decorative and sits outside the critical paths. Authoritative world bounds remain the collision policy, so the source asset cannot create invisible gameplay blockers. Meshes cast shadows only on the standard render profile and remain frustum culled.

## Validation

The asset is declared in `public/assets/manifest.json` with byte, vertex, draw-call, pivot, collision, and LOD policy. `npm run build` now runs `validate:assets` before mission validation and TypeScript/Vite compilation.

Browser verification fetched `/assets/environment/sherwood-tree-grove.glb` with HTTP 200 and rendered its colored grove beside the storehouse mission with no console, page, or request errors.
