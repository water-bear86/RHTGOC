import { readFile, stat } from "node:fs/promises"
import { resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const manifest = JSON.parse(await readFile(resolve(root, "public/assets/manifest.json"), "utf8"))
const failures = []

for (const asset of manifest.assets) {
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(asset.id)) failures.push(`${asset.id}: invalid stable id`)
  if (!asset.uri.endsWith(".glb")) failures.push(`${asset.id}: shipping asset must be GLB`)
  const file = await stat(resolve(root, "public", asset.uri.replace(/^\//, "")))
  if (file.size > asset.bytesMax) failures.push(`${asset.id}: ${file.size} bytes exceeds ${asset.bytesMax}`)
  if (asset.drawCalls > manifest.budgets.heroDrawCalls) failures.push(`${asset.id}: draw-call budget exceeded`)
  if (asset.texture.width > manifest.budgets.heroTextureEdge || asset.texture.height > manifest.budgets.heroTextureEdge) failures.push(`${asset.id}: texture budget exceeded`)
  if (!asset.collision || !asset.pivot || asset.lod.length < 3) failures.push(`${asset.id}: collision, pivot, and three-level LOD policy are required`)
}

if (failures.length) {
  console.error(failures.join("\n"))
  process.exit(1)
}

console.log(`Validated ${manifest.assets.length} browser 3D asset against manifest budgets`)
