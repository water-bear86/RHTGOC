const BUILD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const HASHED_ASSET_PATTERN = /-[A-Za-z0-9_-]{8,}\.(?:css|js|mjs|map|woff2?|png|jpe?g|webp|avif|svg)$/i
// Godot Web exports use stable filenames (game.wasm, game.pck), so they are only
// safe to cache immutably when addressed through their content-addressed lane:
// /godot/<source-commit-12>-<asset-manifest-hash-12>/... A re-export always lands
// under a new artifact id, so no published byte is ever replaced in place.
// Keep these patterns in sync with tools/godot-artifact.mjs.
const GODOT_ARTIFACT_ID_PATTERN = /^[0-9a-f]{12}-[0-9a-f]{12}$/
const GODOT_ARTIFACT_PATH_PATTERN = /^\/godot\/[0-9a-f]{12}-[0-9a-f]{12}\//

export const DEVELOPMENT_BUILD_ID = "dev"
export const GODOT_LANE_PREFIX = "/godot/"

export function normalizeBuildId(value: unknown, fallback = DEVELOPMENT_BUILD_ID): string {
  if (typeof value !== "string") return fallback
  const candidate = value.trim()
  return BUILD_ID_PATTERN.test(candidate) ? candidate : fallback
}

export function isBuildId(value: unknown): value is string {
  return typeof value === "string" && BUILD_ID_PATTERN.test(value)
}

export function isGodotArtifactId(value: unknown): value is string {
  return typeof value === "string" && GODOT_ARTIFACT_ID_PATTERN.test(value)
}

export function godotArtifactBasePath(artifactId: string): string {
  if (!isGodotArtifactId(artifactId)) throw new Error("Invalid Godot artifact id")
  return `${GODOT_LANE_PREFIX}${artifactId}/`
}

export function versionedAssetUrl(path: string, buildId: string): string {
  const normalizedBuildId = normalizeBuildId(buildId)
  const fragmentIndex = path.indexOf("#")
  const fragment = fragmentIndex >= 0 ? path.slice(fragmentIndex) : ""
  const withoutFragment = fragmentIndex >= 0 ? path.slice(0, fragmentIndex) : path
  const separator = withoutFragment.includes("?") ? "&" : "?"
  return `${withoutFragment}${separator}v=${encodeURIComponent(normalizedBuildId)}${fragment}`
}

export function staticCacheControl(pathname: string): string {
  if (pathname === "/" || pathname.endsWith(".html")) return "no-store"
  // The Godot pointer and promotion journal select the active candidate; they
  // must never be cached, or promotion/rollback would lag behind the operator.
  if (pathname === "/godot/current.json" || pathname.startsWith("/godot/history/")) return "no-store"
  if (HASHED_ASSET_PATTERN.test(pathname) || GODOT_ARTIFACT_PATH_PATTERN.test(pathname)) {
    return "public, max-age=31536000, immutable"
  }
  return "public, max-age=3600, must-revalidate"
}
