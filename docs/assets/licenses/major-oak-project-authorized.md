# Project-authorized Major Oak

The project owner supplied the Major Oak model and explicitly requested its use as
the Sherwood landmark on 2026-09-06.

- Supplied source: `major-oak-source.glb` (glTF 2.0 GLB, trimesh export) —
  SHA-256 `34e4caf553815c3d43626584260e1fb5c06602a90f55c60d86c4d771d559b248`, 6,061,444 bytes.

This owner-supplied source is recorded as `LicenseRef-Project-Owner-Authorized`.
This record does not claim a third-party SPDX license. If the project's
distribution rights change, replace this authorization with the original
publisher's license evidence or remove the runtime derivative.

Only the optimized runtime derivative ships in the browser bundle:

| Runtime derivative | SHA-256 |
| --- | --- |
| `assets/environment/sherwood-major-oak.glb` | `e4c7b5098739a449d176d465aad98049df13a6bb656412bbafae6bb2088b0e32` |

The derivative was produced by Blender 5.x decimate (collapse ratio 0.085, smooth
normals) then glTF-Transform 4.4.1 (`optimize --texture-compress webp
--texture-size 512 --weld true`): 79,912 → 6,792 triangles, one 512×512 WebP
albedo, 482,136 bytes. See `docs/assets/major-oak.md`.
