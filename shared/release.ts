const BUILD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/
const HASHED_ASSET_PATTERN = /-[A-Za-z0-9_-]{8,}\.(?:css|js|mjs|map|woff2?|png|jpe?g|webp|avif|svg)$/i

export const DEVELOPMENT_BUILD_ID = "dev"

export function normalizeBuildId(value: unknown, fallback = DEVELOPMENT_BUILD_ID): string {
  if (typeof value !== "string") return fallback
  const candidate = value.trim()
  return BUILD_ID_PATTERN.test(candidate) ? candidate : fallback
}

export function isBuildId(value: unknown): value is string {
  return typeof value === "string" && BUILD_ID_PATTERN.test(value)
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
  if (HASHED_ASSET_PATTERN.test(pathname)) return "public, max-age=31536000, immutable"
  return "public, max-age=3600, must-revalidate"
}
