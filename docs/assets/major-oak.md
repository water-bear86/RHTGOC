# Major Oak landmark asset

The Major Oak is the named Sherwood landmark — the ancient, broad, prop-supported
oak that is Robin Hood's legendary hideout. The model was supplied by the project
owner and optimized to the `decorative-environment` budget for the browser client.

## Provenance & licence

- Source: `major-oak-source.glb` (glTF 2.0 GLB, trimesh export), supplied by the
  project owner on 2026-09-06. SHA-256
  `34e4caf553815c3d43626584260e1fb5c06602a90f55c60d86c4d771d559b248`, 6,061,444 bytes.
- Licence: `LicenseRef-Project-Owner-Authorized` — see
  `docs/assets/licenses/major-oak-project-authorized.md`.

## Conversion

Source was 79,912 triangles with a 2048×2048 PNG albedo (6.06 MB) — ~12× the
decorative-environment budget. Two-step pipeline:

1. Blender 5.x headless: import, join, Decimate (COLLAPSE, ratio 0.085), shade
   smooth and clear custom split normals so shared-position vertices share a
   normal (which lets the mesh weld), export GLB (`export_yup=True`).
2. glTF-Transform 4.4.1:
   `optimize --texture-compress webp --texture-size 512 --weld true --simplify false --compress false`.

## Result (all under the decorative-environment budget)

| metric | value | budget |
| --- | ---: | ---: |
| bytes | 482,136 | 500,000 |
| triangles | 6,792 | 20,000 |
| upload vertices | 12,883 | 20,000 |
| render vertices | 20,376 | 30,000 |
| primitives | 1 | 8 |
| materials | 1 | 8 |
| texture | 512² WebP | 512 edge |

SHA-256 `e4c7b5098739a449d176d465aad98049df13a6bb656412bbafae6bb2088b0e32`.

## Runtime & collision

The asset keeps its centered source pivot; the runtime (`src/major-oak.ts`)
Box3-normalizes it to `MAJOR_OAK_HEIGHT` and grounds its minimum Y, exactly like
the hero loader (`src/character-assets.ts`), then toon-converts it and sets the
leaf material double-sided. Measured trunk radius at the landmark height is ~2.4u
(the wider reading at the very base is the walk-over root flare), so the shared
server-authoritative collider `SHERWOOD_MAJOR_OAK_OBSTACLES`
(`shared/world-obstacles.ts`) is an octagon of halfExtents 2.5 (two squares at 0
and π/4). The oak sits at (−28, 11) on Oak Ridge, west of the walkable hub, so it
reads as a landmark backdrop whose eastern boughs overhang the camp.
