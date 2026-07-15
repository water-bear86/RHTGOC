# 3D asset quality-gate audit

This ledger records the first retrospective decisions under the browser-ready asset gate. A source decision is not a substitute for the measured shipping entry in `public/assets/manifest.json`.

## Shipped artifacts

| Artifact | Source decision | Shipping decision | Evidence |
| --- | --- | --- | --- |
| KayKit Merry Band | Accept for role conversion: Ranger, Rogue, Barbarian, and Hooded Rogue use the same exact 23-bone `Rig_Medium` rest skeleton as Character Animations 1.1, native weighted closed-hand meshes, one palette texture each, and explicit CC0 licenses. | Accept as the active Robin, Marian, Little John, and Much visuals after deterministic recolouring, embedded WebP export, four-clip packaging, and deformation review. Every hero carries an upright morphable bow on `handslot.l`; `Idle`, held-bow movement, the 0.8-second draw/release attack, distinct signatures, the string-release seam, and both side views are verified without retargeting or body reshaping. | `tools/build-kaykit-characters.py`, `docs/assets/licenses/kaykit-adventurers-and-character-animations-cc0.txt`, `docs/operations/3d-assets.md`, the four measured manifest entries, Blender deformation renders, and the browser family-photo audit. |
| Meshy Robin Hood | Rework history: the desired silhouette arrived as a 100,913-vertex static mesh with no armature or clips and oversized PBR textures. Multiple custom and human-rig attempts failed project-owner visual review. | Retain the technically valid optimized GLB only as `character.robin.meshy-rollback`. Runtime character loading does not reference it; the KayKit Ranger is the active Robin. | `art/characters/robin-human-rig.blend`, `tools/rig-human-character.py`, `tools/render-character-deformation-audit.py`, and the rollback manifest entry. |
| Meshy Maid Marian and Little John | Reject as runtime sources: both supplied meshes are unrigged, heavyweight generator exports, and the attempted custom rigging did not meet the visual bar. | Replaced wholesale by native KayKit Rogue and Barbarian assets rather than altering or hiding defects in the Meshy geometry. | The rejected sources stay outside `public/`; only the accepted KayKit GLBs ship. |
| Stylized Nature trees | Accept for curated conversion: eight useful CC0 silhouettes with shared bark and alpha-tested foliage materials. Raw OBJ/MTL files and the full pack are not runtime artifacts. | Accept after grounding and normalizing each variant, deduplicating materials, simplifying geometry, resizing textures to 512-pixel WebP, and instancing fifteen material primitives across eight silhouettes. | `docs/assets/stylized-nature-trees.md`, `tools/build-stylized-tree-catalog.py`, the supplied `License_Standard.txt`, and the manifest entry. |
| Stylized Nature ground dressing | Accept for curated conversion: nine CC0 grass, fern, bush, flower, mushroom, rock, pebble, and wheat variants have useful silhouettes and authored textures. | Accept as a 352,608-byte embedded catalogue. Deterministic instancing replaces textureless forest-floor primitives and the procedural wheat bundle without changing collision or mission layouts. | `tools/build-stylized-nature-dressing.py`, `docs/assets/licenses/stylized-nature-megakit-cc0.txt`, and the measured manifest entry. |
| CraftPix medieval props | Rework: the ten selected meshes were grounded and scaled, but the previous shipping GLB did not embed their supplied palette atlas. | Accept after assigning the real 32×32 palette texture to one shared opaque material. Regional props and secured caches now use the textured catalogue; procedural boxes remain load-failure fallbacks only. | `tools/build-craftpix-medieval-props.py`, `docs/assets/licenses/craftpix-freebie-license-reference.md`, and the measured manifest entry. |

The project owner supplied Meshy rollback does not embed a standard license identifier. Its manifest status is therefore `project-authorized`, not a claim of CC0, an SPDX grant, or permission for unrelated reuse. KayKit Adventurers, KayKit Character Animations 1.1, and the Stylized Nature tree pack are different: their supplied licenses explicitly grant CC0 1.0, so the converted artifacts record that standard identifier. A missing owner directive, incompatible third-party terms, or unknown source remains a rejection under the gate.

The separate Marian shortbow file remains equipment-only and is not misrepresented as a complete character. Much now uses the KayKit Hooded Rogue rather than an unrelated Friar Tuck replacement. Procedural heroes remain synchronous loading and downed-state fallbacks, not the primary in-game models.

## July 14 guard candidate

`KayKit_Adventurers_2.0_FREE.zip` also includes a visually suitable Knight on the same verified `Rig_Medium` skeleton. Cross-file animation compatibility is therefore no longer the blocker. Guard replacement remains a separate follow-up because the Knight starts at nine skinned primitives, three portrait guards would cost 27 draws before the environment, and guard-specific idle, pursuit, attack, hit, and death states still require an offline combined export plus browser review. The existing procedural guards remain deterministic, variant-specific, and cheaper while the four-hero replacement is reviewed.

## July 11 supplied character and prop packs

The CraftPix medieval prop archive is accepted only as a curated conversion source. Ten small set-dressing pieces (barrel, bench, box, bucket, chest, firewood, haystack, pot, signpost, and well) are grounded, meter-scaled, embedded in one catalog, and used as nonblocking regional landmarks. The archive's license file points to the CraftPix Freebie License; the local reference records the relevant game-use and no-source-redistribution terms.

`ga_free_101_stylized_forest_ranger.glb` is rejected from runtime integration. It has no supplied license evidence or animation clips, totals about 95,498 triangles, and carries three 4096-pixel textures with an estimated 268 MB combined GPU cost. It is not a browser guard replacement.

`low-poly-archer.zip` is rejected because its nested archive contains only an OBJ with no license, material package, rig, or animations. A future authored guard pack should provide explicit commercial redistribution rights, a humanoid rig, idle/walk/attack/hit clips, bow or spear variants, roughly 15,000–25,000 triangles per guard, and one or two textures no larger than 1024 pixels.

## Medieval Village MegaKit Standard

The supplied Standard pack declares CC0 1.0 Universal in `License_Standard.txt` (SHA-256 `ec6fd5004514cb0515a7dc1065f474644d31698861597b32e1745945ffec71de`). Models are by Quaternius. The pack-level license is accepted; each selected model still needs an individual technical decision.

The FBX set is rejected as a runtime source because it contains absolute Windows texture paths. The matching glTF set is the material and hierarchy reference. The complete 176-model library is rejected as a shipping unit: its raw textures would cost roughly 310 MiB uncompressed on the GPU, while most of the geometry is light. Only a curated conversion may enter `public/`.

### Accepted village slice

The village slice has three deliberately separate decisions:

| Stage | Status | Meaning |
| --- | --- | --- |
| Source audition | Accepted for conversion | The selected CC0 modules have useful silhouettes and acceptable repair cost. |
| Browser artifact | Accepted | A deterministic, embedded GLB passes manifest budgets, license binding, byte-level Khronos validation, and offline reproduction. |
| Runtime integration | Accepted | One authored cottage and wagon shell are loaded through the shared toon adapter; client/server collision, LOD fallbacks, cross-mission routes, resize, and context restoration pass. |

The following sources make up the offline conversion candidate:

- `Wall_Plaster_WoodGrid.gltf`
- `Wall_Plaster_Door_Round.gltf`
- `Wall_Plaster_Window_Wide_Round.gltf`
- `Roof_RoundTiles_4x4.gltf`
- `Door_1_Round.gltf`
- `Window_Wide_Round1.gltf`
- `Stairs_Exterior_Straight.gltf`
- `Prop_Wagon.gltf`
- `Prop_Crate.gltf`
- `Prop_WoodenFence_Single.gltf`
- `Prop_WoodenFence_Extension1.gltf`
- `Prop_Vine2.gltf`

Together these sources are about 370 KB of geometry/JSON, 5,410 triangles, and 21 stored primitives. Their raw textures are about 42.7 MB. The accepted browser artifact embeds sixteen resized 512-pixel WebPs and seven material families.

### Rejected from the first slice

- `Door_2_Round.gltf`: 6,188 triangles for a detail that `Door_1_Round.gltf` provides in about 470.
- The 6-by-8 round-tile roof: oversized for the first compact cottage; use `Roof_RoundTiles_4x4.gltf`.
- Any source module that depends on a missing texture, uses a broken external path, creates a false traversal affordance, or fails the shared collision/route audit.

The accepted `sherwood-village-slice.glb` is 677,248 bytes with 23 measured Three.js submissions: 21 stored primitives plus the second pass for two double-sided transparent window primitives. It replaces one cottage and the procedural wagon body at LOD0, shares the authored cottage collision resolver across solo, public-hub, client prediction, and mission-server movement, and passed standard/degraded rendering across all three authoritative missions.

## Unlicensed voxel free sample

The supplied `Free Sample` folder is rejected from the runtime. It contains a ten-OBJ MagicaVoxel diorama with no license, author, receipt, source URL, or README; “free sample” is not a redistribution grant. The raw audit conversion is 3,149,468 bytes, 56,000 triangles, 168,000 render vertices, 88,288 upload vertices, ten draws, and ten materials/textures. Deduplication reduces transfer and material duplication but does not repair the geometry budget, scene-level pivots, unknown meter scale, or missing rights evidence.

The cottage silhouette, rack, and logs may be reconsidered only if the exact license is recovered and they are retopologized as nonblocking dressing. Its 4,620-triangle trolley and 2,084-triangle crates are rejected even with a license because the curated MegaKit wagon (1,672 triangles) and crate (230 triangles) are lighter and match the selected village language. Duplicate voxel crates and grass should be instanced rather than retained as baked translated meshes.
