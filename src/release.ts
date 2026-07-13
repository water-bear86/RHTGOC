import { normalizeBuildId, versionedAssetUrl as addBuildId } from "../shared/release"

export const CLIENT_BUILD_ID = normalizeBuildId(import.meta.env.VITE_BUILD_ID)
const REFRESH_GUARD_KEY = "sherwood:build-refresh"

export function versionedAssetUrl(path: string): string {
  return addBuildId(path, CLIENT_BUILD_ID)
}

export function shouldRefreshForBuildMismatch(clientBuildId: string, serverBuildId: string, lastRefreshBuildId: string | null): boolean {
  const normalizedClient = normalizeBuildId(clientBuildId)
  const normalizedServer = normalizeBuildId(serverBuildId)
  return normalizedClient !== normalizedServer && normalizedServer !== lastRefreshBuildId
}

export function refreshForBuildMismatch(
  serverBuildId: string,
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = window.sessionStorage,
  reload: () => void = () => window.location.reload(),
): boolean {
  const normalizedServer = normalizeBuildId(serverBuildId)
  if (CLIENT_BUILD_ID === normalizedServer) {
    storage.removeItem(REFRESH_GUARD_KEY)
    return false
  }
  if (!shouldRefreshForBuildMismatch(CLIENT_BUILD_ID, normalizedServer, storage.getItem(REFRESH_GUARD_KEY))) return false
  storage.setItem(REFRESH_GUARD_KEY, normalizedServer)
  reload()
  return true
}
