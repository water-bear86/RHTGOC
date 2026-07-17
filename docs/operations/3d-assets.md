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
| Hero | 2,500,000 | 200,000 | 50,000 | 100,000 | 10 | 1024 | 7,500,000 |
| Modular environment | 3,000,000 | 100,000 | 75,000 | 60,000 | 24 | 1024 | 32,000,000 |
| Repeated prop | 500,000 | 30,000 | 20,000 | 20,000 | 4 | 512 | 1,500,000 |
| Decorative environment | 500,000 | 30,000 | 20,000 | 20,000 | 8 | 512 | 1,500,000 |

The complete scene remains capped at 220 draw calls on the desktop profile and 130 on the degraded profile. Repeated props should use instancing when it reduces draw calls without breaking culling or interaction. Budget exceptions require a measured playtest and a manifest change; they cannot be implied by a larger `bytesMax` on one asset.

## Manifest and provenance

`public/assets/manifest.json` separates shipped GLBs from procedural stable references. Every shipped ID resolves to exactly one file and every file must be listed once. Procedural references may be used by mission packages, but must not masquerade as measured GLBs.

The validator hashes the shipping file and compares it with the declared SHA-256. Provenance records the original filename, who supplied it, the license or project-use basis, the evidence location, and the repeatable conversion document. Never record a local absolute path, credential, private download URL, or unverifiable license claim.

## Authored Merry Band measurement

| Character | Shipping GLB bytes | Triangles | Upload vertices | Draws | Palette texture | Clips |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Robin / Ranger | 1,702,460 | 23,084 | 32,898 | 10 | 1024² + 512² WebP | `Idle`, `Walk`, `Attack`, `Signature` |
| Marian / Rogue | 604,532 | 8,246 | 7,429 | 8 | 1024² WebP | `Idle`, `Walk`, `Attack`, `Signature` |
| Little John / Barbarian | 578,928 | 7,807 | 7,017 | 8 | 1024² WebP | `Idle`, `Walk`, `Attack`, `Signature` |
| Much / Hooded Rogue | 572,640 | 7,869 | 6,839 | 8 | 1024² WebP | `Idle`, `Walk`, `Attack`, `Signature` |

The active Merry Band uses KayKit's complete character parts rather than modifying the rejected Meshy meshes. Ranger, Rogue, Barbarian, and Hooded Rogue have the same exact 23-bone `Rig_Medium` rest skeleton. Their native weighted hand geometry is already a closed stylized fist, so the conversion adds no finger bones, hand remodelling, fused geometry, metaballs, or runtime retargeting. Independent comparison keeps the source arm surfaces within floating-point export tolerance and all 23 bones receive channels in every clip.

`tools/build-kaykit-characters.py` is the deterministic offline builder. It reads the Adventurers character pack and Character Animations 1.1 outside `public/`, verifies the exact 23-bone Medium rig, equips every role with `bow_withString`, and emits self-contained GLBs. `Ranged_Bow_Idle` becomes `Idle`, `Running_HoldingBow` becomes `Walk`, and `Attack` is an exact 1.0-second NLA composition: the complete native `Ranged_Bow_Draw` retimed to 0.6 seconds, then the complete `Ranged_Bow_Release` retimed to 0.4 seconds, with the release seam at normalized progress 0.6. `Signature` remains a separately timed clip: Robin preserves the legacy 0.8-second bow composition with its 0.12-second seam, Marian and Little John retain `Use_Item`, and Much retains `Throw`. The builder applies a distinct Merry Band green to each role and reloads the authored palette before WebP export: Robin uses forest green, Marian sage, Little John moss beneath the retained leather-and-bear silhouette, and Much muted olive. Ranger and Hooded Rogue capes are consolidated into their body objects without moving existing body vertices. Marian, Little John, and Much remain at eight draws; Robin uses two additional draws for the consolidated hat and feather.

Build all four from the untouched local pack with Blender 5.1 or newer:

```bash
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup \
  --python tools/build-kaykit-characters.py -- \
  --source-dir /path/to/KayKit_Adventurers_2.0_FREE \
  --animation-dir /path/to/KayKit_Character_Animations_1.1/Animations \
  --robin-accessory-blend /path/to/robinHoodHatLowPoly.blend \
  --output-dir public/assets/characters
```

Robin builds require the saved accessory source to contain `Robin_Hat_Brim`, `Robin_Hat_Cap`, `Robin_Hat_Band`, and `Robin_Hat_Feather`, each attached to the `head` bone of `Rig_Medium.001`. The builder rejects any rest-rig mismatch, verifies that transfer changes no accessory world matrix beyond floating-point tolerance, consolidates the three textured hat pieces to one primitive, applies the feather's non-destructive thickness modifier on the export copy, and retains both results as children of the animated head joint. The authored source placement is not recomputed or guessed during export.

Every KayKit bow keeps its `Basis` and `Draw` morph targets and is parented directly to `handslot.l`. The native equipment-space transform is XYZ `(-90°, 0°, -180°)` at uniform scale `0.91`; front, both side views, full draw, the Draw-to-Release seam, separation, and recovery were rendered before acceptance. Runtime samples the authored one-shot deterministically from gameplay `actionProgress`: normal attacks reach full string draw at progress 0.6, then release during the final 0.4 seconds. Robin's bow-driven signature retains its independent legacy 0.15 seam; the other three role signatures leave the string at rest.

The runtime wrapper creates the procedural character synchronously, then atomically replaces it with a cloned authored skeleton after the GLB, bow morph, and all four required clips validate. Load failure and the currently unauthored downed pose retain the deterministic procedural model. Character-only deformed bounds drive scale, grounding, and horizontal centering, so the asymmetric bow cannot shift the gameplay body root. One-shot animation time is sampled from normalized action progress; idle/walk local time respects reduced motion while mixer time continues so crossfades still complete. This preserves startup, multiplayer spawning, and failure behavior without making asset loading part of simulation state. Native walk clips can dip a foot roughly six centimetres below the source ground plane; a dedicated foot-lock pass remains the appropriate later fix if gameplay review finds it noticeable.

The older Meshy/Rigify scripts remain only for the explicit `character.robin.meshy-rollback` artifact and historical audit reproduction. They are not the active hero pipeline.

`tools/recolor-authored-heroes.mjs` is the deterministic repair pass for the accepted checked-in KayKit GLBs. It preserves geometry, skinning, clips, and non-cloth atlas colours while remapping Marian's authored cloth to sage, Little John's blue underlayer to moss, and Much's bright green cloth to muted olive. It updates the embedded lossless WebP plus the manifest checksum and encoded texture size. The Blender builder remains the source pipeline and emits the same role palette when the untouched source packs are available.

## Validation

Run:

```bash
npm run validate:assets
npm test
npm run build
```

The gate runs the lockfile-pinned official Khronos validator against the GLB
bytes, binds each license-evidence file by SHA-256, validates verified SPDX
expressions, and accounts for Three.js double-sided transparent submissions.
Regression fixtures prove that falsified accessor bounds and arbitrary license
replacement text fail. Asset conversion uses only lockfile-pinned local tools;
the release gate performs no install-time executable fetch.

Then verify Idle, Walk, Attack, role equipment, silhouette, shadow behavior, family-photo readiness, and local/remote skeleton cloning in a real browser room. The renderer selects a degraded profile for low texture limits, caps device pixel ratio, disables expensive shadows when needed, responds to resize, and handles WebGL context loss/restoration.

## Visual audition

Before accepting a new artifact, place it in the gameplay scene and record standard and degraded profile evidence for:

- silhouette and scale at interaction, pursuit, and far-LOD distances;
- pivot, orientation, spawn clearance, camera occlusion, and shadow footprint;
- material families, alpha cutouts, transparency, vertex colors, toon-light response, fog readability, and gameplay-driven recoloring;
- animation names, skeleton cloning, attachments, and transitions for skinned assets;
- collision alignment and parity between authoritative server movement and the client view;
- LOD transitions, fallback silhouette, instancing/culling, draw calls, texture requests, and estimated GPU memory;
- resize plus WebGL context loss/restoration with no console, shader, page, or asset-request error.

Append `?render=degraded` to a local or deployed game URL to exercise the degraded profile deterministically on capable test hardware. This override can only lower quality; it cannot force the standard profile onto a constrained device.

An environment asset is not accepted if its render mesh silently becomes collision. Decorative vines, trim, roofs, and other non-blocking dressing must say so explicitly. Blocking geometry requires simple shared collision data on the server and client before it enters a multiplayer route.

## LOD policy

- LOD0: authored hero within 24 meters.
- LOD1: the same authored KayKit hero from 24–48 meters; no old-model swap is permitted.
- LOD2: hide the world model beyond 48 meters while retaining party HUD presence.

Environment props should move to instanced GLBs as authored assets arrive. The desktop scene budget is 220 draw calls; degraded mode targets 130.

## Textured ground dressing

`tools/build-stylized-nature-dressing.py` curates nine CC0 ground-cover models from the supplied Stylized Nature MegaKit into `sherwood-nature-dressing.glb`. Each variant is bottom-centered, normalized to one meter, limited to 512-pixel embedded WebP textures, and indexed by a stable runtime name. The game instances those shared meshes for grass, ferns, bushes, flowers, mushrooms, rocks, pebbles, and the farm's golden wheat. The earlier primitives remain only as an asset-load fallback.

Build the catalogue with Blender 5.1 or newer:

```bash
/Applications/Blender.app/Contents/MacOS/Blender \
  --background --factory-startup \
  --python tools/build-stylized-nature-dressing.py -- \
  --source-dir /path/to/Stylized\ Nature\ MegaKit\[Standard\]/glTF \
  --output public/assets/environment/sherwood-nature-dressing.glb
```

The CraftPix medieval prop builder accepts either the original directory or zip. It assigns the pack's 32-pixel palette atlas to all ten curated meshes and exports it as one opaque embedded WebP material. Regional set dressing and secured mission caches share the resulting catalogue geometry; the animated treasure chest remains the authored bow-cache asset.
