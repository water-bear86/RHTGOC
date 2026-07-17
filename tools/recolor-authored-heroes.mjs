import { createHash } from "node:crypto"
import { readFile, rename, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { NodeIO } from "@gltf-transform/core"
import { EXTTextureWebP } from "@gltf-transform/extensions"
import sharp from "sharp"

const root = resolve(import.meta.dirname, "..")
const manifestPath = resolve(root, "public/assets/manifest.json")
const roles = [
  {
    id: "character.marian.scout",
    path: "public/assets/characters/marian-kaykit-rogue.glb",
    target: [0.34, 0.82, 0.44],
    outputSaturation: 0.56,
    selected: (red, green, blue, saturation) => (
      red > green + 28
      && blue > green + 18
      && red > blue + 10
      && saturation > 0.22
    ) || (
      green > red + 8
      && green > blue + 8
      && saturation > 0.15
    ),
  },
  {
    id: "character.little-john.vanguard",
    role: "little-john",
    path: "public/assets/characters/little-john-kaykit-barbarian.glb",
    target: [0.34, 0.56, 0.2],
    minimumSaturation: 0.58,
    outputSaturation: 0.58,
    selected: (red, green, blue, saturation, x, y, width, height) => {
      const blueUnderlayer = blue > red + 9 && blue > green + 5 && saturation > 0.18
      const mossUnderlayer = green > red + 5 && green > blue + 5 && saturation > 0.15
      const cellX = Math.floor((x / width) * 8)
      const cellY = Math.floor((y / height) * 8)
      const lowerBodyAtlas = (cellX === 2 && (cellY === 4 || cellY === 5))
        || (cellX === 3 && cellY >= 6)
        || (cellX === 6 && cellY >= 6)
        || (cellX === 7 && cellY === 4)
      const neutralGarment = lowerBodyAtlas && saturation < 0.2 && Math.max(red, green, blue) > 45
      return blueUnderlayer || mossUnderlayer || neutralGarment
    },
  },
  {
    id: "character.much.saboteur",
    path: "public/assets/characters/much-kaykit-rogue-hooded.glb",
    target: [0.48, 0.72, 0.22],
    outputSaturation: 0.6,
    selected: (red, green, blue, saturation) => green > red + 10
      && green > blue + 20
      && saturation > 0.22,
  },
]

function recolor(data, width, height, channels, spec) {
  const targetMax = Math.max(...spec.target)
  const target = spec.target.map((channel) => channel / targetMax)
  let selectedPixels = 0
  for (let offset = 0; offset < data.length; offset += channels) {
    const red = data[offset]
    const green = data[offset + 1]
    const blue = data[offset + 2]
    const maximum = Math.max(red, green, blue)
    const minimum = Math.min(red, green, blue)
    const saturation = maximum > 0 ? (maximum - minimum) / maximum : 0
    const pixel = offset / channels
    const x = pixel % width
    const y = Math.floor(pixel / width)
    if (!spec.selected(red, green, blue, saturation, x, y, width, height)) continue
    selectedPixels += 1
    const outputSaturation = spec.outputSaturation ?? Math.max(saturation, spec.minimumSaturation ?? 0)
    for (let channel = 0; channel < 3; channel += 1) {
      data[offset + channel] = Math.round(maximum * (1 - outputSaturation + outputSaturation * target[channel]))
    }
  }
  if (selectedPixels === 0) throw new Error(`${spec.id}: palette mask selected no pixels`)
  return selectedPixels
}

const io = new NodeIO().registerExtensions([EXTTextureWebP])
let manifestSource = await readFile(manifestPath, "utf8")
const manifest = JSON.parse(manifestSource)
const manifestUpdates = []
const requestedRoles = new Set(process.argv.slice(2))

for (const spec of roles.filter((candidate) => requestedRoles.size === 0 || requestedRoles.has(candidate.role ?? candidate.id.split(".")[1]))) {
  const assetPath = resolve(root, spec.path)
  const document = await io.read(assetPath)
  const textures = document.getRoot().listTextures()
  if (textures.length !== 1) throw new Error(`${spec.id}: expected one texture, found ${textures.length}`)
  const texture = textures[0]
  const image = texture.getImage()
  if (!image) throw new Error(`${spec.id}: texture has no embedded image`)
  const decoded = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const selectedPixels = recolor(decoded.data, decoded.info.width, decoded.info.height, decoded.info.channels, spec)
  const encoded = await sharp(decoded.data, {
    raw: {
      width: decoded.info.width,
      height: decoded.info.height,
      channels: decoded.info.channels,
    },
  }).webp({ lossless: true, effort: 6 }).toBuffer()
  texture.setImage(encoded)
  texture.setMimeType("image/webp")

  const temporaryPath = `${assetPath}.tmp.glb`
  await io.write(temporaryPath, document)
  await rename(temporaryPath, assetPath)
  const glb = await readFile(assetPath)
  const asset = manifest.assets.find((candidate) => candidate.id === spec.id)
  if (!asset) throw new Error(`${spec.id}: missing manifest entry`)
  asset.sha256 = createHash("sha256").update(glb).digest("hex")
  asset.texture.encodedBytes = encoded.length
  manifestUpdates.push({ id: spec.id, sha256: asset.sha256, encodedBytes: encoded.length })
  console.log(JSON.stringify({
    id: spec.id,
    selectedPixels,
    textureBytes: encoded.length,
    glbBytes: glb.length,
    sha256: asset.sha256,
  }))
}

for (const update of manifestUpdates) {
  const start = manifestSource.indexOf(`"id": "${update.id}"`)
  const end = manifestSource.indexOf('\n    {\n      "id":', start + 1)
  if (start < 0) throw new Error(`${update.id}: could not locate manifest source block`)
  const blockEnd = end < 0 ? manifestSource.length : end
  const block = manifestSource.slice(start, blockEnd)
    .replace(/"sha256": "[0-9a-f]{64}"/, `"sha256": "${update.sha256}"`)
    .replace(/"encodedBytes": \d+/, `"encodedBytes": ${update.encodedBytes}`)
  manifestSource = `${manifestSource.slice(0, start)}${block}${manifestSource.slice(blockEnd)}`
}
await writeFile(manifestPath, manifestSource)
