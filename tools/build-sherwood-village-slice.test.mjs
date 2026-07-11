import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  DEFAULT_LICENSE_OUTPUT,
  DEFAULT_OUTPUT,
  REPO_ROOT,
  compareFingerprintEntries,
  normalizeFingerprintPath,
  parseArgs,
} from "./build-sherwood-village-slice.mjs"

const temporaryRoots = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("Medieval Village deterministic builder", () => {
  it("keeps default outputs repository-rooted when invoked from another working directory", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "sherwood-village-builder-"))
    temporaryRoots.push(temporaryRoot)
    const previousCwd = process.cwd()
    try {
      process.chdir(temporaryRoot)
      const options = parseArgs(["--source", "/tmp/explicit-village-source"])
      expect(options).toEqual({
        source: "/tmp/explicit-village-source",
        output: DEFAULT_OUTPUT,
        licenseOutput: DEFAULT_LICENSE_OUTPUT,
      })
      expect(DEFAULT_OUTPUT.startsWith(`${REPO_ROOT}/`)).toBe(true)
      expect(DEFAULT_LICENSE_OUTPUT.startsWith(`${REPO_ROOT}/`)).toBe(true)
    } finally {
      process.chdir(previousCwd)
    }
  })

  it("requires an explicit source pack instead of silently depending on a Desktop path", () => {
    const previous = process.env.SHERWOOD_VILLAGE_KIT
    delete process.env.SHERWOOD_VILLAGE_KIT
    try {
      expect(() => parseArgs([])).toThrow("Pass --source <directory> or set SHERWOOD_VILLAGE_KIT")
    } finally {
      if (previous === undefined) delete process.env.SHERWOOD_VILLAGE_KIT
      else process.env.SHERWOOD_VILLAGE_KIT = previous
    }
  })

  it("normalizes fingerprint paths and sorts them by UTF-8 bytes", () => {
    expect(normalizeFingerprintPath("/source", "/source/glTF/Prop_Crate.gltf")).toBe("glTF/Prop_Crate.gltf")
    const entries = [["z/item", Buffer.alloc(0)], ["a/item", Buffer.alloc(0)]]
    expect(entries.sort(compareFingerprintEntries).map(([path]) => path)).toEqual(["a/item", "z/item"])
  })
})
