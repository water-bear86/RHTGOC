#!/usr/bin/env bash
set -euo pipefail

INPUT="${1:?usage: optimize-character.sh INPUT.glb OUTPUT.glb}"
OUTPUT="${2:?usage: optimize-character.sh INPUT.glb OUTPUT.glb}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CLI="@gltf-transform/cli@4.4.1"

npx --yes "$CLI" dedup "$INPUT" "$WORK/1-dedup.glb"
npx --yes "$CLI" weld "$WORK/1-dedup.glb" "$WORK/2-weld.glb"
npx --yes "$CLI" resample "$WORK/2-weld.glb" "$WORK/3-resample.glb"
node tools/strip-robin-pbr.mjs "$WORK/3-resample.glb" "$WORK/4-toon.glb"
npx --yes "$CLI" prune "$WORK/4-toon.glb" "$WORK/5-prune.glb"
npx --yes "$CLI" sparse "$WORK/5-prune.glb" "$WORK/6-sparse.glb"
npx --yes "$CLI" resize "$WORK/6-sparse.glb" "$WORK/7-resize.glb" --width 1024 --height 1024
mkdir -p "$(dirname "$OUTPUT")"
npx --yes "$CLI" webp "$WORK/7-resize.glb" "$OUTPUT" --quality 85 --effort 80
npx --yes "$CLI" validate "$OUTPUT"
