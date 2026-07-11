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

### Accepted for conversion audition

These sources have useful silhouettes and are accepted into the offline curation pass, not yet accepted as shipping artifacts:

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

Together these sources are about 370 KB of geometry/JSON, 5,410 triangles, and 21 primitives. Their raw textures are about 42.7 MB and require rework into shared toon families before shipping.

### Rejected from the first slice

- `Door_2_Round.gltf`: 6,188 triangles for a detail that `Door_1_Round.gltf` provides in about 470.
- The 6-by-8 round-tile roof: oversized for the first compact cottage; use `Roof_RoundTiles_4x4.gltf`.
- Any source module that depends on a missing texture, uses a broken external path, creates a false traversal affordance, or fails the shared collision/route audit.

The first conversion target is one `sherwood-village-slice.glb` at or below 3 MB, 24 LOD0 draw calls, and seven shared material families. It will replace one cottage and the procedural wagon body before broader village rollout.
