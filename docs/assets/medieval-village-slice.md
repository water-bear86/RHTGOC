# Medieval Village browser slice

`public/assets/environment/sherwood-village-slice.glb` is the accepted browser
slice from Quaternius's Medieval Village MegaKit (Standard). The file is a
module catalog, not a precomposed village: its default scene contains 12
overlapping, grounded roots that runtime code indexes by stable extras IDs and
clones into the level.

## License and source contract

- Author: Quaternius (`@Quaternius`)
- License: CC0 1.0 Universal / Public Domain Dedication
- Byte-identical evidence: `docs/assets/licenses/medieval-village-megakit-cc0.txt`
- License evidence SHA-256: `ec6fd5004514cb0515a7dc1065f474644d31698861597b32e1745945ffec71de`
- Audited source fingerprint SHA-256: `71d564c9a2f3a4e94933bf9091ab08e2b2f5540650e200eb8afbf4a574399068`

The source fingerprint covers the license, all 12 source glTF documents, their
binary buffers, and the 16 unique textures they reference. Paths are normalized
to `/` and sorted by UTF-8 bytes, independent of the host locale. The build fails
closed if either the license or source fingerprint changes.

## Curated roots

| Named root | Intended use |
| --- | --- |
| `Wall_Plaster_WoodGrid` | timber-grid wall |
| `Wall_Plaster_Door_Round` | door opening wall |
| `Wall_Plaster_Window_Wide_Round` | window opening wall |
| `Roof_RoundTiles_4x4` | compact story roof |
| `Door_1_Round` | low-poly working door |
| `Window_Wide_Round1` | wide window insert |
| `Stairs_Exterior_Straight` | exterior access stairs |
| `Prop_Wagon` | authoritative tax-cart visual shell |
| `Prop_Crate` | village dressing and cover |
| `Prop_WoodenFence_Single` | fence start |
| `Prop_WoodenFence_Extension1` | fence continuation |
| `Prop_Vine2` | facade silhouette breakup |

`Door_1_Round` is intentional: it is dramatically lighter than the ornate
`Door_2_Round` alternative while reading clearly at gameplay distance.

## Deterministic build

From the repository root:

```sh
node tools/build-sherwood-village-slice.mjs \
  --source "/path/to/Medieval Village MegaKit[Standard]"
```

The script invokes the lockfile-pinned glTF Transform 4.4.1 CLI, preserves meter scale, grounds every root,
deduplicates shared resources, welds geometry, generates MikkTSpace tangents,
repairs two source vertices with degenerate tangent space, prunes unused data,
resizes textures to 512 px, converts them to WebP at quality 82, embeds every
resource, and runs the Khronos validator. Two consecutive builds from the
audited source produced the same shipping SHA-256; the script rejects output
drift before replacing the GLB. The default outputs are repository-rooted,
source input is explicit, fingerprints are portable, and an offline invocation
from `/tmp` reproduced the accepted bytes without an install-time fetch.

## Measured shipping contract

| Metric | Result | Budget |
| --- | ---: | ---: |
| File size | 677,248 B | 3,000,000 B |
| SHA-256 | `9af770b514072dd55d13c29ffd95b4e1b39659e8baaf17b68e32ee80f4b150eb` | exact |
| Stored primitive submissions | 21 | 24 |
| Expected Three.js submissions | 23 unless thin glass is forced single-pass | 24 |
| Unique primitives | 21 | 24 |
| Render vertices | 16,230 | 100,000 |
| Upload vertices | 7,601 | 75,000 |
| Triangles | 5,410 | 60,000 |
| Material families | 7 | 8 |
| Texture images | 16 x 512 px WebP | 1,024 px max edge |
| Encoded texture bytes | 262,418 B | tracked |
| Estimated texture GPU bytes with mipmaps | 22,369,600 B | 32,000,000 B |

The source slice contained 55 texture references to 16 unique PNGs totaling
42,684,232 bytes. The shipping GLB carries one embedded copy of each image.
`EXT_texture_webp` is the only required extension.

Overall bounds are `[-2.756538, 0, -3.150432]` to
`[2.756538, 4.249393, 2.821567]` meters. Each of the 12 named roots independently
has `minY = 0`; the original authored Y offset remains in root `extras` for
diagnostics. Scale remains one meter per glTF unit and orientation remains +Y
up / +Z forward.

The shipping artifact's Khronos glTF report contains zero errors, warnings,
infos, or hints. `npm run validate:assets` runs the lockfile-pinned official
validator against actual accessor bytes and fails on severity errors.

## Runtime and collision policy

The runtime loads the GLB once, indexes the default scene's direct children by stable `sherwoodAssetId` extras,
and clones only the roots needed by the level. It converts each shared source material to the
shared storybook toon family after loading; do not duplicate textures per clone.

The GLB intentionally contains visual modules rather than physics meshes. Before
walls, stairs, fences, crates, or the wagon become blocking geometry, define the
same authoritative XZ rectangle/capsule data in the shared simulation contract
used by both the browser client and multiplayer server. The wagon GLB replaces
only the procedural visual shell; it must not replace authoritative coin, cage,
lock, or objective state.

LOD policy:

- LOD0: this GLB inside 34 m.
- LOD1: procedural hut and wagon silhouettes from 34-58 m.
- LOD2: hide modules beyond 58 m under the forest fog treatment.

The authored cottage replaces `createHut(-10, 14, -0.55)` and the authored wagon
replaces only the procedural shell while mission coin, cage, collision, and
objective state remain authoritative. The cottage uses a shared rotated XZ
proxy on client and server. At 34–58 metres the procedural silhouette returns;
beyond 58 metres both shells hide under fog. This keeps one high-quality source
of truth while avoiding remote draws for scenery that occupies only a few pixels.
