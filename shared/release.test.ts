import { describe, expect, it } from "vitest"
import { isBuildId, normalizeBuildId, staticCacheControl, versionedAssetUrl } from "./release"

describe("release identity", () => {
  it("accepts inspectable build ids and rejects unsafe values", () => {
    expect(normalizeBuildId(" 0c70a62-prod.15 ")).toBe("0c70a62-prod.15")
    expect(isBuildId("release_2026-07-13")).toBe(true)
    expect(normalizeBuildId("../../index.html")).toBe("dev")
    expect(normalizeBuildId("x".repeat(81))).toBe("dev")
  })

  it("versions stable asset URLs without losing their existing query or fragment", () => {
    expect(versionedAssetUrl("/assets/environment/tree.glb", "abc12345")).toBe("/assets/environment/tree.glb?v=abc12345")
    expect(versionedAssetUrl("/asset.glb?lod=1#oak", "abc12345")).toBe("/asset.glb?lod=1&v=abc12345#oak")
  })

  it("only grants immutable caching to fingerprinted build artifacts", () => {
    expect(staticCacheControl("/index.html")).toBe("no-store")
    expect(staticCacheControl("/assets/index-B7z4sPq9.js")).toBe("public, max-age=31536000, immutable")
    expect(staticCacheControl("/assets/environment/sherwood-village-slice.glb")).toBe("public, max-age=3600, must-revalidate")
  })
})
