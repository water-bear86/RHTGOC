# Browser 3D asset pipeline

## Runtime contract

- Ship GLB/glTF 2.0 only. Source Blender files and raw generator exports are not runtime assets.
- Asset IDs use lowercase dotted names such as `character.robin.ranger`; filenames use lowercase kebab case.
- World units are meters, +Y is up, +Z is character forward, and character pivots sit at the feet.
- Every shipped asset declares provenance, license evidence, SHA-256, quality-gate decision, geometry, materials, texture cost, pivot, scale, orientation, collision, and three LOD bands in `public/assets/manifest.json`.
- Hero collision uses a stable capsule proxy. Animation bones and visible mesh never define collision.

Raw FBX, OBJ, Blender/DCC files, absolute source paths, and glTF files with unresolved external buffers or textures are source material only and fail the shipping validator. Source packs are curated outside `public/`; only accepted, normalized runtime assets enter the browser bundle.

## Accept, rework, or reject

| Decision | Binding rule | Next action |
| --- | --- | --- |
| Accept | License is compatible; silhouette, proportions, topology, rig/skin, animation, pivots, scale, and runtime cost are sound. | Normalize, document, validate, and ship. |
| Rework | Silhouette and structural quality are sound, but textures, materials, pivots, naming, hierarchy, draw calls, collision, or LODs miss the runtime contract. | Repair offline, then re-audit. A source marked `rework` is not shipped until the completed runtime artifact receives an `accept` decision. |
| Reject | License is unclear/incompatible, or silhouette, proportions, topology, skinning, rig, animation, or repair cost is unsuitable. | Do not copy it into `public/` and do not hide the defect with shaders or runtime correction code. |

Cel shading may unify a good model with weak stock textures. It is never a reason to retain bad geometry, a broken rig, misleading collision, or an unverified license. Time already spent on an asset does not affect its decision.

## Category budgets

The checked-in manifest is authoritative; these are the initial ceilings for a single LOD0 asset, not targets to consume.

| Category | GLB bytes | Render vertices | Upload vertices | Triangles | Primitives / draw calls | Texture edge | Approx. texture GPU bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Hero | 2,500,000 | 200,000 | 50,000 | 100,000 | 8 | 1024 | 6,000,000 |
| Modular environment | 3,000,000 | 100,000 | 75,000 | 60,000 | 24 | 1024 | 32,000,000 |
| Repeated prop | 500,000 | 30,000 | 20,000 | 20,000 | 4 | 512 | 1,500,000 |
| Decorative environment | 500,000 | 30,000 | 20,000 | 20,000 | 8 | 512 | 1,500,000 |

The complete scene remains capped at 220 draw calls on the desktop profile and 130 on the degraded profile. Repeated props should use instancing when it reduces draw calls without breaking culling or interaction. Budget exceptions require a measured playtest and a manifest change; they cannot be implied by a larger `bytesMax` on one asset.

## Manifest and provenance

`public/assets/manifest.json` separates shipped GLBs from procedural stable references. Every shipped ID resolves to exactly one file and every file must be listed once. Procedural references may be used by mission packages, but must not masquerade as measured GLBs.

The validator hashes the shipping file and compares it with the declared SHA-256. Provenance records the original filename, who supplied it, the license or project-use basis, the evidence location, and the repeatable conversion document. Never record a local absolute path, credential, private download URL, or unverifiable license claim.

## Robin Ranger measurement

| Metric | Before | Shipping |
| --- | ---: | ---: |
| GLB transfer | 4.40 MB | 2.29 MB |
| Base-color texture | 2048² PNG, 2.93 MB | 1024² WebP, 61.7 KB |
| Estimated texture VRAM | 22.37 MB | 5.59 MB |
| Upload vertices | 35,374 | 35,374 |
| Draw calls | 13 | 6 |
| Named clips | 3 | 3 |

The shipping pass joins repeated quiver shafts and arrowheads offline, then uses glTF Transform deduplication, weld, animation resampling, pruning, sparse accessors, 1024-pixel resizing, and WebP compression. Position quantization is deliberately disabled: applying a mesh-centered normalized position accessor to this sibling-root skin moved its feet below the origin and doubled the apparent model scale. The accepted GLB retains floating-point positions, a true `minY=0` pivot, one skin, all three clips, and six measured scene draws. Manifest bounds conservatively enclose transformed accessor AABBs, so they may be slightly wider than exact-vertex inspection while remaining safe for culling and pivot validation.

Run `tools/rig_robin_ranger.py` in Blender, then `tools/optimize-robin-ranger.sh INPUT.glb OUTPUT.glb`. Both steps are repeatable and the optimizer pins glTF Transform 4.4.1.

## Validation

Run:

```bash
npm run validate:assets
npx --yes @gltf-transform/cli validate public/assets/characters/robin-ranger-rigged.glb
npm test
npm run build
```

Then verify Idle, Walk, Shoot, bow, quiver, silhouette, shadow behavior, and local/remote skeleton cloning in a real browser room. The renderer selects a degraded profile for low texture limits, caps device pixel ratio, disables expensive shadows when needed, responds to resize, and handles WebGL context loss/restoration.

## Visual audition

Before accepting a new artifact, place it in the gameplay scene and record standard and degraded profile evidence for:

- silhouette and scale at interaction, pursuit, and far-LOD distances;
- pivot, orientation, spawn clearance, camera occlusion, and shadow footprint;
- material families, alpha cutouts, transparency, vertex colors, toon-light response, fog readability, and gameplay-driven recoloring;
- animation names, skeleton cloning, attachments, and transitions for skinned assets;
- collision alignment and parity between authoritative server movement and the client view;
- LOD transitions, fallback silhouette, instancing/culling, draw calls, texture requests, and estimated GPU memory;
- resize plus WebGL context loss/restoration with no console, shader, page, or asset-request error.

An environment asset is not accepted if its render mesh silently becomes collision. Decorative vines, trim, roofs, and other non-blocking dressing must say so explicitly. Blocking geometry requires simple shared collision data on the server and client before it enters a multiplayer route.

## LOD policy

- LOD0: authored hero within 24 meters.
- LOD1: procedural hero silhouette from 24–48 meters.
- LOD2: hide the world model beyond 48 meters while retaining party HUD presence.

Environment props should move to instanced GLBs as authored assets arrive. The desktop scene budget is 220 draw calls; degraded mode targets 130.
