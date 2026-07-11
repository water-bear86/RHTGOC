#!/usr/bin/env bash
set -euo pipefail

INPUT="${1:?usage: optimize-robin-ranger.sh INPUT.glb OUTPUT.glb}"
OUTPUT="${2:?usage: optimize-robin-ranger.sh INPUT.glb OUTPUT.glb}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

CLI="@gltf-transform/cli@4.4.1"

npx --yes "$CLI" dedup "$INPUT" "$WORK/1-dedup.glb"
npx --yes "$CLI" weld "$WORK/1-dedup.glb" "$WORK/2-weld.glb"
npx --yes "$CLI" resample "$WORK/2-weld.glb" "$WORK/3-resample.glb"
npx --yes "$CLI" prune "$WORK/3-resample.glb" "$WORK/4-prune.glb"
npx --yes "$CLI" sparse "$WORK/4-prune.glb" "$WORK/5-sparse.glb"
npx --yes "$CLI" resize "$WORK/5-sparse.glb" "$WORK/6-resize.glb" --width 1024 --height 1024
mkdir -p "$(dirname "$OUTPUT")"
npx --yes "$CLI" webp "$WORK/6-resize.glb" "$OUTPUT" --quality 85 --effort 80
npx --yes "$CLI" validate "$OUTPUT"
