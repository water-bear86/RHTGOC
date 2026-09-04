import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  ARTIFACT_ID_PATTERN,
  CONTENT_TYPES,
  POINTER_KEY,
  artifactIdFrom,
  assetManifestHash,
  buildInvalidationArgs,
  buildListArgs,
  buildManifest,
  buildPointer,
  buildPutArgs,
  cacheControlFor,
  contentTypeFor,
  isArtifactId,
  listExportFiles,
  pack,
  validateExportShape,
  verifyManifestAgainstEntries,
} from "./godot-artifact.mjs"

function fakeExport(dir) {
  writeFileSync(join(dir, "index.html"), "<html>godot</html>")
  writeFileSync(join(dir, "game.wasm"), Buffer.from([0x00, 0x61, 0x73, 0x6d]))
  writeFileSync(join(dir, "game.pck"), Buffer.from("GDPC"))
  writeFileSync(join(dir, "game.js"), "// loader")
  mkdirSync(join(dir, "textures"), { recursive: true })
  writeFileSync(join(dir, "textures", "oak.png"), Buffer.from([0x89, 0x50]))
}

describe("Godot artifact identity", () => {
  it("derives a stable content-addressed artifact id", () => {
    const entries = [
      { path: "game.wasm", sha256: "a".repeat(64), bytes: 4 },
      { path: "index.html", sha256: "b".repeat(64), bytes: 18 },
    ]
    const hash = assetManifestHash(entries)
    expect(hash).toMatch(/^[0-9a-f]{12}$/)
    // Order must not matter; content must.
    expect(assetManifestHash([...entries].reverse())).toBe(hash)
    expect(assetManifestHash([{ ...entries[0], sha256: "c".repeat(64) }, entries[1]])).not.toBe(hash)

    const id = artifactIdFrom("0C70A62F3B21DEADBEEF0000", hash)
    expect(id).toBe(`0c70a62f3b21-${hash}`)
    expect(isArtifactId(id)).toBe(true)
    expect(ARTIFACT_ID_PATTERN.test("latest")).toBe(false)
    expect(() => artifactIdFrom("not-a-commit", hash)).toThrow(/hex commit/)
  })

  it("recognizes a Godot Web export shape and rejects non-exports", () => {
    expect(validateExportShape(["index.html", "game.wasm", "game.pck"])).toEqual([])
    expect(validateExportShape(["index.html"]).join(" ")).toMatch(/wasm/)
    expect(validateExportShape(["game.wasm", "game.pck"]).join(" ")).toMatch(/index.html/)
    expect(validateExportShape(["index.html", "game.wasm", "game.pck", "manifest.json"]).join(" ")).toMatch(/manifest/)
  })

  it("builds a manifest that verifies against its own files and detects drift", () => {
    const entries = [
      { path: "index.html", sha256: "1".repeat(64), bytes: 10 },
      { path: "game.wasm", sha256: "2".repeat(64), bytes: 20 },
    ]
    const hash = assetManifestHash(entries)
    const manifest = buildManifest({
      artifactId: `0c70a62f3b21-${hash}`,
      sourceCommit: "0c70a62f3b21",
      manifestHash: hash,
      protocolVersion: 20,
      entries,
      createdAt: "2026-09-04T00:00:00.000Z",
    })
    expect(verifyManifestAgainstEntries(manifest, entries)).toEqual([])
    const tampered = [{ ...entries[0], sha256: "f".repeat(64) }, entries[1]]
    expect(verifyManifestAgainstEntries(manifest, tampered).join(" ")).toMatch(/mismatch|differs/)
    const missing = [entries[0]]
    expect(verifyManifestAgainstEntries(manifest, missing).join(" ")).toMatch(/missing file game.wasm/)
  })

  it("packs a raw export into an immutable artifact directory", () => {
    const exportDir = mkdtempSync(join(tmpdir(), "godot-export-"))
    const outDir = mkdtempSync(join(tmpdir(), "godot-artifacts-"))
    fakeExport(exportDir)
    const commit = "0c70a62f3b21deadbeef0c70a62f3b21deadbeef"
    let printed = ""
    const { artifactId, manifest } = pack({ exportDir, outDir, commit, write: (text) => { printed += text } })
    expect(isArtifactId(artifactId)).toBe(true)
    expect(artifactId.startsWith("0c70a62f3b21-")).toBe(true)
    expect(manifest.files.map((file) => file.path)).toEqual(["game.js", "game.pck", "game.wasm", "index.html", "textures/oak.png"])
    expect(manifest.protocolVersion).toBeGreaterThan(0)
    expect(printed).toContain(artifactId)
    const listed = listExportFiles(join(outDir, artifactId))
    expect(listed).toContain("manifest.json")
    // Same bytes => same id (deterministic identity).
    const second = pack({ exportDir, outDir: mkdtempSync(join(tmpdir(), "godot-artifacts-2-")), commit, write: () => {} })
    expect(second.artifactId).toBe(artifactId)
  })

  it("serves Godot files with correct content types and scoped immutability", () => {
    expect(contentTypeFor("game.wasm")).toBe("application/wasm")
    expect(contentTypeFor("game.pck")).toBe("application/octet-stream")
    expect(contentTypeFor("manifest.json")).toBe("application/json; charset=utf-8")
    expect(CONTENT_TYPES[".html"]).toContain("text/html")

    expect(cacheControlFor("godot/0c70a62f3b21-9d8e7f6a5b4c/game.wasm")).toContain("immutable")
    expect(cacheControlFor("godot/0c70a62f3b21-9d8e7f6a5b4c/index.html")).toContain("no-store")
    expect(cacheControlFor(POINTER_KEY)).toContain("no-store")
    expect(cacheControlFor("godot/history/2026-09-04-promote.json")).toContain("no-store")
    // Outside a content-addressed prefix nothing is immutable.
    expect(cacheControlFor("godot/stray.bin")).not.toContain("immutable")
  })

  it("builds field-limited AWS arguments without secret-bearing queries", () => {
    const list = buildListArgs("bucket-a", "godot/")
    expect(list).toContain("Contents[].Key")
    expect(list.join(" ")).not.toMatch(/environment/i)

    const put = buildPutArgs("bucket-a", "godot/0c70a62f3b21-9d8e7f6a5b4c/game.wasm", "/tmp/game.wasm")
    expect(put).toContain("application/wasm")
    expect(put.join(" ")).toContain("immutable")

    const pointerPut = buildPutArgs("bucket-a", POINTER_KEY, "/tmp/pointer.json")
    expect(pointerPut.join(" ")).toContain("no-store")

    const invalidation = buildInvalidationArgs("EDISTRO", ["/godot/current.json"])
    expect(invalidation).toContain("/godot/current.json")
    expect(invalidation).toContain("Invalidation.Id")
  })

  it("emits pointers that name the artifact, its provenance, and the action", () => {
    const manifest = {
      sourceCommit: "0c70a62f3b21",
      assetManifestHash: "9d8e7f6a5b4c",
      protocolVersion: 20,
    }
    const pointer = buildPointer({
      artifactId: "0c70a62f3b21-9d8e7f6a5b4c",
      manifest,
      promotedAt: "2026-09-04T00:00:00.000Z",
      action: "promote",
    })
    expect(pointer.artifactPath).toBe("/godot/0c70a62f3b21-9d8e7f6a5b4c/index.html")
    expect(pointer.action).toBe("promote")
    expect(pointer.protocolVersion).toBe(20)
    expect(pointer.assetManifestHash).toBe("9d8e7f6a5b4c")
  })
})
