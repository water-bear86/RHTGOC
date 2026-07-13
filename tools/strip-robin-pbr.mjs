import { NodeIO } from "@gltf-transform/core"
import { ALL_EXTENSIONS } from "@gltf-transform/extensions"
import { prune } from "@gltf-transform/functions"

const [, , input, output] = process.argv
if (!input || !output) throw new Error("Usage: node tools/strip-robin-pbr.mjs input.glb output.glb")

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const document = await io.read(input)
for (const material of document.getRoot().listMaterials()) {
  material.setNormalTexture(null)
  material.setEmissiveTexture(null)
  material.setMetallicRoughnessTexture(null)
  material.setMetallicFactor(0)
  material.setRoughnessFactor(1)
  material.setEmissiveFactor([0, 0, 0])
}
await document.transform(prune())
await io.write(output, document)
