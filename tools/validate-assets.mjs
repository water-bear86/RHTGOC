import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { validateAssetManifest } from "./asset-validator.mjs"

const root = resolve(import.meta.dirname, "..")
const manifest = JSON.parse(await readFile(resolve(root, "public/assets/manifest.json"), "utf8"))
const failures = await validateAssetManifest({ manifest, rootDir: root })

if (failures.length) {
  console.error(`Asset validation failed (${failures.length}):\n${failures.map((failure) => `- ${failure}`).join("\n")}`)
  process.exit(1)
}

console.log(`Validated ${manifest.assets.length} browser 3D assets against provenance, packaging, and category budgets`)
