# Stylized Nature tree catalog

The playable forest uses a curated subset of Quaternius' **Stylized Nature MegaKit Standard**. The supplied `License_Standard.txt` dedicates the pack to the public domain under CC0 1.0; models are credited to Quaternius.

## Curated sources

The runtime catalog contains eleven silhouettes from the owner's supplied archive and the pack's glTF distribution:

- `CommonTree_1` through `CommonTree_4`;
- `Pine_2`, `Pine_3`, and `Pine_5`;
- `TwistedTree_1` and `TwistedTree_5`;
- `DeadTree_3` and `Stump`.

The OBJ/MTL copies are not shipped. Verified embedded catalog materials preserve the pack's texture and alpha-mask intent without relying on source files' absolute Windows texture paths.

## Reproducible conversion

`tools/expand-stylized-tree-catalog.py` imports the eight-variant baseline GLB plus a silhouette-balanced FBX subset from `tree objects.zip`, reuses the pack's verified embedded bark and leaf materials, corrects source-axis differences, grounds every root at Y=0, centers X/Z, normalizes each silhouette to one meter, and exports one embedded catalog. The catalog keeps multiple representatives per living family while staying inside the browser's geometry and draw-call budgets. `Tree Assets (1).glb` is intentionally excluded because its disconnected foliage pieces do not form a production-ready tree. The checked-in GLB is then optimized with:

```sh
npx gltf-transform optimize /tmp/sherwood-tree-catalog.raw.glb \
  public/assets/environment/sherwood-tree-catalog.glb \
  --flatten false --join false --instance false \
  --simplify true --simplify-ratio 0.048 --simplify-error 0.025 \
  --compress false --texture-compress webp --texture-size 512 --palette false
```

The artifact keeps stable variant node names, five shared materials, and seven embedded 512-pixel WebP textures. Geometry stays decoder-free for immediate browser loading. Runtime placement uses one `THREE.InstancedMesh` batch per catalog primitive rather than cloning meshes per tree.

## Runtime contract

- Authoritative positions and trunk collision remain in `shared/world-layout.ts` and `shared/world-collisions.ts`.
- Variant, rotation, and visual scale are deterministic view data from `src/tree-placements.ts`; related silhouettes collect into stable broadleaf, pine, and twisted groves, with sparse deadwood and stumps.
- Standard rendering enables authored tree shadows; the degraded profile disables them.
- Trees outside the active LOD radius and trees blocking the camera-to-player sightline are hidden per instance without changing collision.
- The former cone-tree forest remains only as a load-failure fallback.

This replacement keeps the multiplayer world contract unchanged while making the trees players actually walk beside use the supplied authored silhouettes.
