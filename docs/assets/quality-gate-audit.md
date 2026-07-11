# 3D asset quality-gate audit

This ledger records the first retrospective decisions under the browser-ready asset gate. A source decision is not a substitute for the measured shipping entry in `public/assets/manifest.json`.

## Shipped artifacts

| Artifact | Source decision | Shipping decision | Evidence |
| --- | --- | --- | --- |
| Robin Ranger | Rework: useful silhouette and functioning humanoid rig; source presentation, materials, attachments, and browser cost required repair. | Accept after restoring the feet-at-origin pivot, consolidating repeated quiver pieces from 13 to 6 scene draws, preserving the skin and three clips, resizing to 1024 WebP, and defining capsule collision plus LODs. | `docs/operations/3d-assets.md` and the manifest entry. The project owner supplied `fantasy+ranger+3d+model (1).glb` and directed its integration. |
| Sherwood tree grove | Rework: strong low-poly silhouettes and texture-free materials; source ground tile, transforms, object count, pivot, and scale were unsuitable. | Accept after removing the ground, joining the grove, centering X/Z, placing roots at Y=0, normalizing height, and defining decorative collision/LOD policy. | `docs/assets/authored-tree-grove.md` and the manifest entry. The project owner supplied `Tree Assets (1).glb` and directed its integration. |

Neither owner-supplied GLB embeds a standard license identifier. Their manifest status is therefore `project-authorized`, not a claim of CC0, an SPDX grant, or permission for unrelated reuse: the project owner supplied each source directly and explicitly instructed this project to integrate it. Independent redistribution or reuse outside Sherwood requires separate license evidence. A missing owner directive, incompatible third-party terms, or an unknown source remains a rejection under the gate.

## Medieval Village MegaKit Standard

The supplied Standard pack declares CC0 1.0 Universal in `License_Standard.txt` (SHA-256 `ec6fd5004514cb0515a7dc1065f474644d31698861597b32e1745945ffec71de`). Models are by Quaternius. The pack-level license is accepted; each selected model still needs an individual technical decision.

The FBX set is rejected as a runtime source because it contains absolute Windows texture paths. The matching glTF set is the material and hierarchy reference. The complete 176-model library is rejected as a shipping unit: its raw textures would cost roughly 310 MiB uncompressed on the GPU, while most of the geometry is light. Only a curated conversion may enter `public/`.

### Worktree candidate

The village slice has three deliberately separate decisions:

| Stage | Status | Meaning |
| --- | --- | --- |
| Source audition | Accepted for conversion | The selected CC0 modules have useful silhouettes and acceptable repair cost. |
| Browser artifact | Candidate in the local worktree | A deterministic, embedded GLB passes current metrics and Khronos validation but is not committed. |
| Runtime integration | Not accepted | The module catalog is not imported by `src/main.ts`; cottage/wagon visuals and client prediction have not passed gameplay QA. |

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

Together these sources are about 370 KB of geometry/JSON, 5,410 triangles, and 21 stored primitives. Their raw textures are about 42.7 MB. The worktree candidate embeds sixteen resized 512-pixel WebPs and seven material families; the final decision remains open in #37.

### Rejected from the first slice

- `Door_2_Round.gltf`: 6,188 triangles for a detail that `Door_1_Round.gltf` provides in about 470.
- The 6-by-8 round-tile roof: oversized for the first compact cottage; use `Roof_RoundTiles_4x4.gltf`.
- Any source module that depends on a missing texture, uses a broken external path, creates a false traversal affordance, or fails the shared collision/route audit.

The first conversion target is one `sherwood-village-slice.glb` at or below 3 MB, 24 LOD0 renderer submissions, and seven shared material families. The current file is 677,248 bytes, but two double-sided transparent window primitives may produce 23 Three.js submissions rather than the 21 stored primitives. It must replace one cottage and the procedural wagon body, share authoritative collision with client prediction, and pass both render profiles before acceptance.

## Unlicensed voxel free sample

The supplied `Free Sample` folder is rejected from the runtime. It contains a ten-OBJ MagicaVoxel diorama with no license, author, receipt, source URL, or README; “free sample” is not a redistribution grant. The raw audit conversion is 3,149,468 bytes, 56,000 triangles, 168,000 render vertices, 88,288 upload vertices, ten draws, and ten materials/textures. Deduplication reduces transfer and material duplication but does not repair the geometry budget, scene-level pivots, unknown meter scale, or missing rights evidence.

The cottage silhouette, rack, and logs may be reconsidered only if the exact license is recovered and they are retopologized as nonblocking dressing. Its 4,620-triangle trolley and 2,084-triangle crates are rejected even with a license because the curated MegaKit wagon (1,672 triangles) and crate (230 triangles) are lighter and match the selected village language. Duplicate voxel crates and grass should be instanced rather than retained as baked translated meshes.
