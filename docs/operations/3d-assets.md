# Browser 3D asset pipeline

## Runtime contract

- Ship GLB/glTF 2.0 only. Source Blender files and raw generator exports are not runtime assets.
- Asset IDs use lowercase dotted names such as `character.robin.ranger`; filenames use lowercase kebab case.
- World units are meters, +Y is up, +Z is character forward, and character pivots sit at the feet.
- Every gameplay asset declares collision metadata and three LOD bands in `public/assets/manifest.json`.
- Hero collision uses a stable capsule proxy. Animation bones and visible mesh never define collision.

## Robin Ranger measurement

| Metric | Before | Shipping |
| --- | ---: | ---: |
| GLB transfer | 4.9 MB | 1.4 MB |
| Base-color texture | 2048² PNG, 2.93 MB | 1024² WebP, 47.7 KB |
| Estimated texture VRAM | 22.37 MB | 5.59 MB |
| Upload vertices | 35,374 | 35,158 |
| Draw calls | 13 | 7 |
| Named clips | 3 | 3 |

The shipping pass uses glTF Transform deduplication, weld, animation resampling, pruning, sparse accessors, WebP texture compression, and KHR mesh quantization. It deliberately disables hierarchy flattening, mesh joining, and geometry simplification for the skinned hero.

## Validation

Run:

```bash
npm run validate:assets
npx --yes @gltf-transform/cli validate public/assets/characters/robin-ranger-rigged.glb
npm test
npm run build
```

Then verify Idle, Walk, Shoot, bow, quiver, silhouette, shadow behavior, and local/remote skeleton cloning in a real browser room. The renderer selects a degraded profile for low texture limits, caps device pixel ratio, disables expensive shadows when needed, responds to resize, and handles WebGL context loss/restoration.

## LOD policy

- LOD0: authored hero within 24 meters.
- LOD1: procedural hero silhouette from 24–48 meters.
- LOD2: hide the world model beyond 48 meters while retaining party HUD presence.

Environment props should move to instanced GLBs as authored assets arrive. The desktop scene budget is 220 draw calls; degraded mode targets 130.
