# Stylized Nature tree catalog

The playable forest uses a curated subset of Quaternius' **Stylized Nature MegaKit Standard**. The supplied `License_Standard.txt` dedicates the pack to the public domain under CC0 1.0; models are credited to Quaternius.

## Curated sources

The runtime catalog contains eight silhouettes from the pack's glTF distribution:

- `CommonTree_1` through `CommonTree_5`;
- `Pine_2` and `Pine_5`;
- `DeadTree_3`.

The OBJ/MTL copies are not shipped. The glTF sources preserve the pack's texture and alpha-mask intent without relying on the OBJ files' absolute Windows texture paths.

## Reproducible conversion

`tools/build-stylized-tree-catalog.py` imports the selected glTF files in Blender, deduplicates their shared materials, grounds every root at Y=0, centers X/Z, normalizes each silhouette to one meter, and exports one embedded catalog. The checked-in GLB is then optimized with:

```sh
npx gltf-transform optimize /tmp/sherwood-tree-catalog.raw.glb \
  public/assets/environment/sherwood-tree-catalog.glb \
  --flatten false --join false --instance false \
  --simplify true --simplify-ratio 0.7 --simplify-error 0.001 \
  --compress false --texture-compress webp --texture-size 512 --palette false
```

The artifact keeps stable variant node names, fifteen material primitives, four shared materials, and six embedded 512-pixel WebP textures. Geometry stays decoder-free for immediate browser loading. Runtime placement uses fifteen `THREE.InstancedMesh` primitive batches across eight silhouettes rather than cloning meshes per tree.

## Runtime contract

- Authoritative positions and trunk collision remain in `shared/world-layout.ts` and `shared/world-collisions.ts`.
- Variant, rotation, and visual scale are deterministic view data from `src/tree-placements.ts`.
- Standard rendering enables authored tree shadows; the degraded profile disables them.
- Trees outside the active LOD radius and trees blocking the camera-to-player sightline are hidden per instance without changing collision.
- The former cone-tree forest remains only as a load-failure fallback.

This replacement keeps the multiplayer world contract unchanged while making the trees players actually walk beside use the supplied authored silhouettes.
