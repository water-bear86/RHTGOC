# 3D asset quality-gate audit

This ledger records the first retrospective decisions under the browser-ready asset gate. A source decision is not a substitute for the measured shipping entry in `public/assets/manifest.json`.

## Shipped artifacts

| Artifact | Source decision | Shipping decision | Evidence |
| --- | --- | --- | --- |
| Robin Ranger | Rework: useful silhouette and functioning humanoid rig; source presentation, materials, attachments, and browser cost required repair. | Accept after restoring the feet-at-origin pivot, consolidating repeated quiver pieces from 13 to 6 scene draws, preserving the skin and three clips, resizing to 1024 WebP, and defining capsule collision plus LODs. | `docs/operations/3d-assets.md` and the manifest entry. The project owner supplied `fantasy+ranger+3d+model (1).glb` and directed its integration. |
| Sherwood tree grove | Rework: strong low-poly silhouettes and texture-free materials; source ground tile, transforms, object count, pivot, and scale were unsuitable. | Accept after removing the ground, joining the grove, centering X/Z, placing roots at Y=0, normalizing height, and defining decorative collision/LOD policy. | `docs/assets/authored-tree-grove.md` and the manifest entry. The project owner supplied `Tree Assets (1).glb` and directed its integration. |

Neither owner-supplied GLB embeds a standard license identifier. Their manifest status is therefore `project-authorized`, not a claim of CC0, an SPDX grant, or permission for unrelated reuse: the project owner supplied each source directly and explicitly instructed this project to integrate it. Independent redistribution or reuse outside Sherwood requires separate license evidence. A missing owner directive, incompatible third-party terms, or an unknown source remains a rejection under the gate.

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
