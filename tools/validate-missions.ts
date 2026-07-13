import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { validateMissionDefinition } from "../shared/mission-definition"

const root = resolve(import.meta.dirname, "..")
const filenames = (await readdir(resolve(root, "missions"))).filter((name) => name.endsWith(".json")).sort()
const manifest = JSON.parse(await readFile(resolve(root, "public/assets/manifest.json"), "utf8")) as {
  catalog: Record<"characters" | "environments" | "props" | "audio" | "effects", string[]>
}
const stableAssets = new Set(Object.values(manifest.catalog).flat())
const failures: string[] = []

for (const filename of filenames) {
  const value: unknown = JSON.parse(await readFile(resolve(root, "missions", filename), "utf8"))
  const result = validateMissionDefinition(value)
  if (!result.success || !result.data) {
    failures.push(...result.errors.map((error) => `${filename}: ${error}`))
    continue
  }
  const references = [
    result.data.environment.scene,
    ...result.data.environment.characters,
    ...result.data.environment.props,
    ...result.data.environment.audio,
    ...result.data.environment.effects,
  ]
  for (const reference of references) if (!stableAssets.has(reference)) failures.push(`${filename}: environment reference '${reference}' is missing from public/assets/manifest.json`)
}

if (filenames.length === 0) failures.push("missions: at least one mission package is required")
if (failures.length > 0) {
  console.error(failures.join("\n"))
  process.exit(1)
}
console.log(`Validated ${filenames.length} mission package${filenames.length === 1 ? "" : "s"} and stable asset references`)
