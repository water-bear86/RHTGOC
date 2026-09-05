import { describe, expect, it } from "vitest"
import { godotArtifactBasePath, isBuildId, isGodotArtifactId, normalizeBuildId, staticCacheControl, versionedAssetUrl } from "./release"

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

  it("scopes Godot immutability to content-addressed artifact paths", () => {
    const artifact = "/godot/0c70a62f3b21-9d8e7f6a5b4c"
    expect(staticCacheControl(`${artifact}/game.wasm`)).toBe("public, max-age=31536000, immutable")
    expect(staticCacheControl(`${artifact}/game.pck`)).toBe("public, max-age=31536000, immutable")
    expect(staticCacheControl(`${artifact}/manifest.json`)).toBe("public, max-age=31536000, immutable")
    // Entry documents stay revalidatable even inside an immutable artifact so a
    // viewer can never pin a stale bootstrap for a year.
    expect(staticCacheControl(`${artifact}/index.html`)).toBe("no-store")
    // The mutable pointer and journal must never cache: they ARE the canary switch.
    expect(staticCacheControl("/godot/current.json")).toBe("no-store")
    expect(staticCacheControl("/godot/history/2026-09-04-promote.json")).toBe("no-store")
    // Godot filenames outside the content-addressed lane must never be immutable:
    // a re-export under the same name would otherwise poison caches.
    expect(staticCacheControl("/game.wasm")).toBe("public, max-age=3600, must-revalidate")
    expect(staticCacheControl("/game.pck")).toBe("public, max-age=3600, must-revalidate")
    expect(staticCacheControl("/godot/latest/game.wasm")).toBe("public, max-age=3600, must-revalidate")
    expect(staticCacheControl("/godot/current.json")).toBe("no-store")
  })

  it("recognizes canonical Godot artifact ids", () => {
    expect(isGodotArtifactId("0c70a62f3b21-9d8e7f6a5b4c")).toBe(true)
    expect(isGodotArtifactId("0C70A62F3B21-9D8E7F6A5B4C")).toBe(false)
    expect(isGodotArtifactId("0c70a62f3b21")).toBe(false)
    expect(isGodotArtifactId("../escape-9d8e7f6a5b4c")).toBe(false)
    expect(godotArtifactBasePath("0c70a62f3b21-9d8e7f6a5b4c")).toBe("/godot/0c70a62f3b21-9d8e7f6a5b4c/")
    expect(() => godotArtifactBasePath("latest")).toThrow("Invalid Godot artifact id")
  })
})
