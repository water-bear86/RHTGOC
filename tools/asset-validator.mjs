import { createHash } from "node:crypto"
import { readFile, readdir, realpath, stat } from "node:fs/promises"
import { extname, isAbsolute, relative, resolve, sep } from "node:path"
import { validateBytes as validateGltfBytes } from "gltf-validator"
import parseSpdxExpression from "spdx-expression-parse"
import { Matrix4, Quaternion, Vector3 } from "three"

export const ASSET_CATEGORIES = [
  "hero",
  "modular-environment",
  "repeated-prop",
  "decorative-environment",
]

// One tenth of a millimeter in the manifest's meter-based world coordinates.
export const ASSET_BOUNDS_TOLERANCE = 1e-4

const STABLE_ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const SHA256 = /^[a-f0-9]{64}$/
const PROJECT_AUTHORIZED_LICENSE = "LicenseRef-Project-Owner-Authorized"
const EXTERNAL_PATH = /^(?:[a-z][a-z0-9+.-]*:|\/\/|[a-z]:[\\/])/i
const RAW_3D_EXTENSIONS = new Set([
  ".3ds", ".abc", ".bin", ".blend", ".dae", ".fbx", ".gltf", ".ma", ".max", ".mb", ".mtl", ".obj", ".ply", ".stl", ".usd", ".usda", ".usdc",
])
const CATEGORY_BUDGET_FIELDS = [
  "bytesMax",
  "renderVerticesMax",
  "uploadVerticesMax",
  "trianglesMax",
  "uniquePrimitivesMax",
  "sceneDrawCallsMax",
  "materialsMax",
  "textureEdgeMax",
  "textureGpuBytesMax",
]

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0
}

function isInside(parent, candidate) {
  const path = relative(parent, candidate)
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
}

function requireText(record, key, label, failures) {
  const value = isRecord(record) ? record[key] : undefined
  if (!hasText(value)) {
    failures.push(`${label}.${key}: required non-empty string`)
    return undefined
  }
  return value
}

function requirePositiveInteger(record, key, label, failures) {
  const value = isRecord(record) ? record[key] : undefined
  if (!isPositiveInteger(value)) {
    failures.push(`${label}.${key}: required positive integer`)
    return undefined
  }
  return value
}

function requireNonNegativeInteger(record, key, label, failures) {
  const value = isRecord(record) ? record[key] : undefined
  if (!isNonNegativeInteger(value)) {
    failures.push(`${label}.${key}: required non-negative integer`)
    return undefined
  }
  return value
}

function validateSafeRelativePath(value, label, failures, { requiredPrefix } = {}) {
  if (!hasText(value)) return false
  if (
    value.startsWith("/")
    || value.startsWith("\\")
    || EXTERNAL_PATH.test(value)
    || value.includes("\\")
    || value.includes("?")
    || value.includes("#")
    || value.split("/").includes("..")
  ) {
    failures.push(`${label}: absolute, external, and parent-traversal paths are forbidden`)
    return false
  }
  if (requiredPrefix && !value.startsWith(requiredPrefix)) {
    failures.push(`${label}: must begin with ${requiredPrefix}`)
    return false
  }
  return true
}

async function validateEvidencePath(rootDir, value, label, failures) {
  const [fileReference, ...anchorParts] = value.split("#")
  if (anchorParts.length > 1) {
    failures.push(`${label}: evidence may contain at most one document anchor`)
    return
  }
  if (!validateSafeRelativePath(fileReference, label, failures)) return
  const path = resolve(rootDir, fileReference)
  if (!isInside(rootDir, path)) {
    failures.push(`${label}: resolves outside the repository`)
    return
  }
  try {
    const target = await realpath(path)
    const rootTarget = await realpath(rootDir)
    if (!isInside(rootTarget, target)) {
      failures.push(`${label}: symlink target resolves outside the repository`)
      return
    }
    const file = await stat(target)
    if (!file.isFile()) {
      failures.push(`${label}: referenced evidence is not a file`)
      return undefined
    }
    return target
  } catch {
    failures.push(`${label}: referenced evidence does not exist (${value})`)
    return undefined
  }
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex")
}

function normalizedLicenseToken(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function evidenceIdentifiesLicense(contents, status, identifier) {
  const text = contents.toString("utf8")
  if (status === "project-authorized") {
    return /project[- ]authorized/i.test(text)
      && /(?:project owner|owner supplied|supplied[^\n]{0,80}owner)/i.test(text)
  }
  const token = normalizedLicenseToken(identifier)
  return token.length > 0 && normalizedLicenseToken(text).includes(token)
}

async function validateWithKhronos(buffer, label, failures) {
  try {
    const report = await validateGltfBytes(new Uint8Array(buffer), {
      uri: label,
      format: "glb",
      maxIssues: 0,
      writeTimestamp: false,
    })
    for (const issue of report?.issues?.messages ?? []) {
      if (issue.severity !== 0) continue
      const pointer = hasText(issue.pointer) ? ` at ${issue.pointer}` : ""
      failures.push(`${label}: Khronos ${issue.code ?? "VALIDATION_ERROR"}${pointer}: ${issue.message ?? "glTF validation error"}`)
    }
    if ((report?.issues?.numErrors ?? 0) > 0 && !(report?.issues?.messages ?? []).some((issue) => issue.severity === 0)) {
      failures.push(`${label}: Khronos validator reported ${report.issues.numErrors} error(s)`)
    }
  } catch (error) {
    failures.push(`${label}: Khronos validator could not validate GLB (${error instanceof Error ? error.message : String(error)})`)
  }
}

function parseGlb(buffer, label, failures) {
  if (buffer.length < 20 || buffer.toString("ascii", 0, 4) !== "glTF") {
    failures.push(`${label}: file is not a valid GLB container`)
    return undefined
  }

  const version = buffer.readUInt32LE(4)
  const declaredLength = buffer.readUInt32LE(8)
  if (version !== 2) failures.push(`${label}: GLB container version must be 2`)
  if (declaredLength !== buffer.length) {
    failures.push(`${label}: GLB declared length ${declaredLength} does not match ${buffer.length}`)
  }

  let offset = 12
  let json
  let binary
  let chunkIndex = 0
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset)
    const chunkType = buffer.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkLength
    if (chunkEnd > buffer.length) {
      failures.push(`${label}: GLB chunk extends beyond the file boundary`)
      return undefined
    }
    if (chunkLength % 4 !== 0) failures.push(`${label}: GLB chunks must be four-byte aligned`)
    if (chunkIndex === 0 && chunkType !== 0x4e4f534a) failures.push(`${label}: first GLB chunk must be JSON`)
    if (chunkType === 0x4e4f534a && json === undefined) {
      try {
        json = JSON.parse(buffer.toString("utf8", chunkStart, chunkEnd).replace(/[\u0000\u0020]+$/g, ""))
      } catch {
        failures.push(`${label}: GLB JSON chunk is invalid`)
        return undefined
      }
    } else if (chunkType === 0x4e4f534a) {
      failures.push(`${label}: GLB must contain exactly one JSON chunk`)
    } else if (chunkType === 0x004e4942 && binary === undefined) {
      binary = buffer.subarray(chunkStart, chunkEnd)
    } else if (chunkType === 0x004e4942) {
      failures.push(`${label}: GLB must contain at most one BIN chunk`)
    }
    offset = chunkEnd
    chunkIndex += 1
  }

  if (offset !== buffer.length) failures.push(`${label}: GLB has an incomplete trailing chunk header`)

  if (!isRecord(json)) {
    failures.push(`${label}: GLB JSON chunk is missing`)
    return undefined
  }
  if (json.asset?.version !== "2.0") failures.push(`${label}: embedded glTF asset version must be 2.0`)
  return { json, binary }
}

function findResourceUris(value, path = "glTF", matches = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findResourceUris(item, `${path}[${index}]`, matches))
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const itemPath = `${path}.${key}`
      if (key === "uri" && hasText(item)) matches.push({ path: itemPath, uri: item })
      findResourceUris(item, itemPath, matches)
    }
  }
  return matches
}

function decodeDataUri(uri) {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri)
  if (!match) return undefined
  try {
    return {
      mimeType: match[1] || undefined,
      data: match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8"),
    }
  } catch {
    return undefined
  }
}

function imageDimensions(data, mimeType) {
  if (data.length >= 24 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { format: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
  }
  if (data.length >= 30 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    const type = data.toString("ascii", 12, 16)
    if (type === "VP8 " && data.length >= 30) {
      return { format: "webp", width: data.readUInt16LE(26) & 0x3fff, height: data.readUInt16LE(28) & 0x3fff }
    }
    if (type === "VP8L" && data.length >= 25 && data[20] === 0x2f) {
      const bits = data.readUInt32LE(21)
      return { format: "webp", width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (type === "VP8X" && data.length >= 30) {
      const width = 1 + data[24] + (data[25] << 8) + (data[26] << 16)
      const height = 1 + data[27] + (data[28] << 8) + (data[29] << 16)
      return { format: "webp", width, height }
    }
  }
  const ktx2 = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a])
  if (data.length >= 28 && data.subarray(0, 12).equals(ktx2)) {
    return { format: "ktx2", width: data.readUInt32LE(20), height: data.readUInt32LE(24) }
  }
  if ((mimeType === "image/jpeg" || (data[0] === 0xff && data[1] === 0xd8)) && data.length >= 4) {
    let offset = 2
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) { offset += 1; continue }
      const marker = data[offset + 1]
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue }
      const length = data.readUInt16BE(offset + 2)
      if (length < 2 || offset + 2 + length > data.length) break
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { format: "jpeg", width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) }
      }
      offset += 2 + length
    }
  }
  return undefined
}

function rgbaMipBytes(width, height) {
  let total = 0
  let w = width
  let h = height
  while (w > 1 || h > 1) {
    total += w * h * 4
    w = Math.max(1, Math.floor(w / 2))
    h = Math.max(1, Math.floor(h / 2))
  }
  return total + 4
}

function triangleCount(primitive, accessors, label, failures) {
  const positionIndex = primitive.attributes?.POSITION
  const elementAccessorIndex = primitive.indices ?? positionIndex
  const accessor = accessors[elementAccessorIndex]
  if (!Number.isInteger(elementAccessorIndex) || !isRecord(accessor) || !isPositiveInteger(accessor.count)) {
    failures.push(`${label}: primitive requires a valid POSITION or index accessor`)
    return 0
  }
  const mode = primitive.mode ?? 4
  if (mode === 4) return Math.floor(accessor.count / 3)
  if (mode === 5 || mode === 6) return Math.max(0, accessor.count - 2)
  return 0
}

function renderedVertexCount(primitive, accessors) {
  const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION
  return accessors[accessorIndex]?.count ?? 0
}

function collectTextureIndices(value, indices = new Set()) {
  if (Array.isArray(value)) value.forEach((item) => collectTextureIndices(item, indices))
  else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (/texture$/i.test(key) && isRecord(item) && Number.isInteger(item.index)) indices.add(item.index)
      collectTextureIndices(item, indices)
    }
  }
  return indices
}

function finiteVector(value, length) {
  return Array.isArray(value) && value.length === length && value.every((item) => typeof item === "number" && Number.isFinite(item))
}

function localNodeMatrix(node, nodeLabel, failures) {
  if (node.matrix !== undefined) {
    if (!finiteVector(node.matrix, 16)) {
      failures.push(`${nodeLabel}.matrix: required finite 16-number array`)
      return new Matrix4()
    }
    if (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined) {
      failures.push(`${nodeLabel}: matrix cannot be combined with TRS properties`)
    }
    return new Matrix4().fromArray(node.matrix)
  }

  const translation = node.translation ?? [0, 0, 0]
  const rotation = node.rotation ?? [0, 0, 0, 1]
  const scale = node.scale ?? [1, 1, 1]
  if (!finiteVector(translation, 3)) failures.push(`${nodeLabel}.translation: required finite 3-number array`)
  if (!finiteVector(rotation, 4)) failures.push(`${nodeLabel}.rotation: required finite 4-number array`)
  if (!finiteVector(scale, 3)) failures.push(`${nodeLabel}.scale: required finite 3-number array`)
  return new Matrix4().compose(
    new Vector3(...(finiteVector(translation, 3) ? translation : [0, 0, 0])),
    new Quaternion(...(finiteVector(rotation, 4) ? rotation : [0, 0, 0, 1])),
    new Vector3(...(finiteVector(scale, 3) ? scale : [1, 1, 1])),
  )
}

function deriveGlbMetrics(container, label, failures) {
  const { json, binary } = container
  const nodes = Array.isArray(json.nodes) ? json.nodes : []
  const meshes = Array.isArray(json.meshes) ? json.meshes : []
  const accessors = Array.isArray(json.accessors) ? json.accessors : []
  const materials = Array.isArray(json.materials) ? json.materials : []
  const animations = Array.isArray(json.animations) ? json.animations : []
  const scenes = Array.isArray(json.scenes) ? json.scenes : []
  const sceneIndex = json.scene ?? 0
  const scene = scenes[sceneIndex]
  if (!isRecord(scene) || !Array.isArray(scene.nodes)) {
    failures.push(`${label}: default glTF scene is missing or invalid`)
    return undefined
  }

  const usedMeshes = new Set()
  const usedAccessors = new Set()
  const usedPositionAccessors = new Set()
  const usedMaterials = new Set()
  const boundsMin = new Vector3(Infinity, Infinity, Infinity)
  const boundsMax = new Vector3(-Infinity, -Infinity, -Infinity)
  let hasBounds = false
  let sceneDrawCalls = 0
  let renderVertices = 0
  let triangles = 0

  function expandWorldBounds(accessor, worldMatrix, primitiveLabel) {
    if (!finiteVector(accessor.min, 3) || !finiteVector(accessor.max, 3)) {
      failures.push(`${primitiveLabel}: POSITION accessor requires finite min/max 3-vectors`)
      return
    }
    if (accessor.min.some((value, axis) => value > accessor.max[axis])) {
      failures.push(`${primitiveLabel}: POSITION accessor min cannot exceed max`)
      return
    }
    for (const x of [accessor.min[0], accessor.max[0]]) {
      for (const y of [accessor.min[1], accessor.max[1]]) {
        for (const z of [accessor.min[2], accessor.max[2]]) {
          const point = new Vector3(x, y, z).applyMatrix4(worldMatrix)
          boundsMin.min(point)
          boundsMax.max(point)
          hasBounds = true
        }
      }
    }
  }

  function primitiveValues(primitive, primitiveLabel, rendered, worldMatrix) {
    if (!isRecord(primitive)) {
      failures.push(`${primitiveLabel}: invalid primitive`)
      return
    }
    const positionIndex = primitive.attributes?.POSITION
    const position = accessors[positionIndex]
    if (!Number.isInteger(positionIndex) || !isRecord(position) || !isPositiveInteger(position.count)) {
      failures.push(`${primitiveLabel}: valid POSITION accessor is required`)
      return
    }
    usedAccessors.add(positionIndex)
    if (Number.isInteger(primitive.indices)) usedAccessors.add(primitive.indices)
    if (rendered) {
      const material = Number.isInteger(primitive.material) ? materials[primitive.material] : undefined
      sceneDrawCalls += material?.alphaMode === "BLEND" && material.doubleSided === true ? 2 : 1
      renderVertices += renderedVertexCount(primitive, accessors)
      triangles += triangleCount(primitive, accessors, primitiveLabel, failures)
      expandWorldBounds(position, worldMatrix, primitiveLabel)
    }
    usedPositionAccessors.add(positionIndex)
    if (primitive.material === undefined) usedMaterials.add("default")
    else if (!Number.isInteger(primitive.material) || !isRecord(materials[primitive.material])) {
      failures.push(`${primitiveLabel}: material reference is invalid`)
    } else usedMaterials.add(primitive.material)
  }

  function visitNode(nodeIndex, ancestry, parentMatrix) {
    if (!Number.isInteger(nodeIndex) || !isRecord(nodes[nodeIndex])) {
      failures.push(`${label}: scene references invalid node ${String(nodeIndex)}`)
      return
    }
    if (ancestry.has(nodeIndex)) {
      failures.push(`${label}: node hierarchy contains a cycle at ${nodeIndex}`)
      return
    }
    const nextAncestry = new Set(ancestry).add(nodeIndex)
    const node = nodes[nodeIndex]
    const worldMatrix = new Matrix4().multiplyMatrices(parentMatrix, localNodeMatrix(node, `${label}: node ${nodeIndex}`, failures))
    if (node.mesh !== undefined) {
      const mesh = meshes[node.mesh]
      if (!Number.isInteger(node.mesh) || !isRecord(mesh) || !Array.isArray(mesh.primitives)) {
        failures.push(`${label}: node ${nodeIndex} references invalid mesh ${String(node.mesh)}`)
      } else {
        mesh.primitives.forEach((primitive, primitiveIndex) => {
          primitiveValues(primitive, `${label}: mesh ${node.mesh} primitive ${primitiveIndex}`, true, worldMatrix)
        })
        usedMeshes.add(node.mesh)
      }
    }
    if (Array.isArray(node.children)) node.children.forEach((child) => visitNode(child, nextAncestry, worldMatrix))
  }

  scene.nodes.forEach((nodeIndex) => visitNode(nodeIndex, new Set(), new Matrix4()))

  let uniquePrimitives = 0
  for (const meshIndex of usedMeshes) {
    const primitives = meshes[meshIndex].primitives
    uniquePrimitives += primitives.length
    primitives.forEach((primitive, primitiveIndex) => {
      primitiveValues(primitive, `${label}: mesh ${meshIndex} primitive ${primitiveIndex}`, false)
    })
  }
  let uploadVertices = 0
  for (const accessorIndex of usedPositionAccessors) uploadVertices += accessors[accessorIndex].count

  const textureIndices = new Set()
  for (const materialIndex of usedMaterials) {
    if (materialIndex !== "default") collectTextureIndices(materials[materialIndex], textureIndices)
  }

  const buffers = Array.isArray(json.buffers) ? json.buffers : []
  function bufferData(bufferIndex) {
    const definition = buffers[bufferIndex]
    if (!isRecord(definition)) return undefined
    if (hasText(definition.uri)) return decodeDataUri(definition.uri)?.data
    return bufferIndex === 0 ? binary : undefined
  }
  function bufferViewData(bufferViewIndex) {
    const view = json.bufferViews?.[bufferViewIndex]
    if (!isRecord(view) || !Number.isInteger(view.buffer) || !isNonNegativeInteger(view.byteLength)) return undefined
    const data = bufferData(view.buffer)
    const start = view.byteOffset ?? 0
    if (!data || !isNonNegativeInteger(start) || start + view.byteLength > data.length) return undefined
    return data.subarray(start, start + view.byteLength)
  }

  const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
  const typeComponents = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }
  for (const accessorIndex of usedAccessors) {
    const accessor = accessors[accessorIndex]
    const view = json.bufferViews?.[accessor?.bufferView]
    const bytes = componentBytes[accessor?.componentType]
    const components = typeComponents[accessor?.type]
    if (!isRecord(accessor) || !Number.isInteger(accessor.bufferView) || !isRecord(view) || !bytes || !components) {
      failures.push(`${label}: geometry accessor ${accessorIndex} has invalid storage metadata`)
      continue
    }
    if (!bufferViewData(accessor.bufferView)) {
      failures.push(`${label}: geometry accessor ${accessorIndex} references unavailable buffer data`)
      continue
    }
    const elementBytes = bytes * components
    const stride = view.byteStride ?? elementBytes
    const accessorOffset = accessor.byteOffset ?? 0
    const requiredBytes = accessorOffset + (accessor.count - 1) * stride + elementBytes
    if (!isNonNegativeInteger(accessorOffset) || !isPositiveInteger(stride) || requiredBytes > view.byteLength) {
      failures.push(`${label}: geometry accessor ${accessorIndex} exceeds its buffer view`)
    }
  }

  const imageIndices = new Set()
  const textures = Array.isArray(json.textures) ? json.textures : []
  for (const textureIndex of textureIndices) {
    const texture = textures[textureIndex]
    if (!isRecord(texture)) {
      failures.push(`${label}: material references invalid texture ${textureIndex}`)
      continue
    }
    const source = texture.extensions?.KHR_texture_basisu?.source ?? texture.extensions?.EXT_texture_webp?.source ?? texture.source
    if (!Number.isInteger(source)) failures.push(`${label}: texture ${textureIndex} has no valid image source`)
    else imageIndices.add(source)
  }

  const formats = new Set()
  let textureWidth = 0
  let textureHeight = 0
  let textureGpuBytes = 0
  for (const imageIndex of imageIndices) {
    const image = json.images?.[imageIndex]
    if (!isRecord(image)) {
      failures.push(`${label}: texture references invalid image ${imageIndex}`)
      continue
    }
    let data
    let mimeType = image.mimeType
    if (Number.isInteger(image.bufferView)) data = bufferViewData(image.bufferView)
    else if (hasText(image.uri)) {
      const decoded = decodeDataUri(image.uri)
      data = decoded?.data
      mimeType ??= decoded?.mimeType
    }
    const dimensions = data ? imageDimensions(data, mimeType) : undefined
    if (!dimensions || !isPositiveInteger(dimensions.width) || !isPositiveInteger(dimensions.height)) {
      failures.push(`${label}: cannot derive dimensions for image ${imageIndex}`)
      continue
    }
    formats.add(dimensions.format)
    textureWidth = Math.max(textureWidth, dimensions.width)
    textureHeight = Math.max(textureHeight, dimensions.height)
    textureGpuBytes += rgbaMipBytes(dimensions.width, dimensions.height)
  }

  if (!hasBounds) failures.push(`${label}: could not derive finite scene bounds from rendered POSITION accessors`)

  const clips = []
  for (const [animationIndex, animation] of animations.entries()) {
    if (!isRecord(animation) || !hasText(animation.name)) {
      failures.push(`${label}: animation ${animationIndex} requires a non-empty name`)
      continue
    }
    clips.push(animation.name)
  }
  const duplicateClips = [...new Set(clips.filter((clip, index) => clips.indexOf(clip) !== index))]
  if (duplicateClips.length > 0) {
    failures.push(`${label}: GLB animations contain duplicate clip name(s): ${duplicateClips.join(", ")}`)
  }

  return {
    geometry: { uniquePrimitives, sceneDrawCalls, renderVertices, uploadVertices, triangles },
    materials: {
      count: usedMaterials.size,
      names: [...usedMaterials]
        .map((materialIndex) => materialIndex === "default" ? "Three.js default material" : materials[materialIndex]?.name)
        .filter(hasText),
    },
    texture: {
      count: textureIndices.size,
      format: formats.size === 0 ? "none" : formats.size === 1 ? [...formats][0] : "mixed",
      width: textureWidth,
      height: textureHeight,
      gpuBytesApprox: textureGpuBytes,
    },
    bounds: hasBounds ? { min: boundsMin.toArray(), max: boundsMax.toArray() } : undefined,
    clips,
  }
}

function validateQualityGate(asset, label, failures) {
  if (!isRecord(asset.qualityGate)) {
    failures.push(`${label}.qualityGate: required object`)
    return
  }
  const decision = requireText(asset.qualityGate, "decision", `${label}.qualityGate`, failures)
  if (decision !== undefined && decision !== "accept") {
    failures.push(`${label}.qualityGate.decision: only accepted assets may ship (received ${decision})`)
  }
  const reviewedAt = requireText(asset.qualityGate, "reviewedAt", `${label}.qualityGate`, failures)
  if (reviewedAt && !Number.isFinite(Date.parse(reviewedAt))) {
    failures.push(`${label}.qualityGate.reviewedAt: must be a valid date`)
  }
  requireText(asset.qualityGate, "rationale", `${label}.qualityGate`, failures)
}

async function validateProvenance(asset, label, rootDir, failures) {
  if (!isRecord(asset.provenance)) {
    failures.push(`${label}.provenance: required object`)
    return
  }
  const sourceAsset = requireText(asset.provenance, "sourceAsset", `${label}.provenance`, failures)
  if (sourceAsset) validateSafeRelativePath(sourceAsset, `${label}.provenance.sourceAsset`, failures)
  const sourceSha256 = requireText(asset.provenance, "sourceSha256", `${label}.provenance`, failures)
  if (sourceSha256 && !SHA256.test(sourceSha256)) {
    failures.push(`${label}.provenance.sourceSha256: must be 64 lowercase hexadecimal characters`)
  }
  requireText(asset.provenance, "suppliedBy", `${label}.provenance`, failures)
  const conversionDoc = requireText(asset.provenance, "conversionDoc", `${label}.provenance`, failures)
  if (conversionDoc) await validateEvidencePath(rootDir, conversionDoc, `${label}.provenance.conversionDoc`, failures)

  const additionalSources = asset.provenance.additionalSources
  if (additionalSources === undefined) return
  if (!Array.isArray(additionalSources)) {
    failures.push(`${label}.provenance.additionalSources: optional array`)
    return
  }

  const sourceAssets = new Map()
  const sourceChecksums = new Map()
  if (hasText(sourceAsset)) sourceAssets.set(sourceAsset, `${label}.provenance.sourceAsset`)
  if (hasText(sourceSha256)) sourceChecksums.set(sourceSha256, `${label}.provenance.sourceSha256`)

  for (const [index, source] of additionalSources.entries()) {
    const sourceLabel = `${label}.provenance.additionalSources[${index}]`
    if (!isRecord(source)) {
      failures.push(`${sourceLabel}: required object`)
      continue
    }

    const additionalSourceAsset = requireText(source, "sourceAsset", sourceLabel, failures)
    if (additionalSourceAsset) {
      validateSafeRelativePath(additionalSourceAsset, `${sourceLabel}.sourceAsset`, failures)
      const firstDeclaration = sourceAssets.get(additionalSourceAsset)
      if (firstDeclaration) {
        failures.push(`${sourceLabel}.sourceAsset: duplicate source also declared by ${firstDeclaration}`)
      } else {
        sourceAssets.set(additionalSourceAsset, `${sourceLabel}.sourceAsset`)
      }
    }

    const additionalSourceSha256 = requireText(source, "sourceSha256", sourceLabel, failures)
    if (additionalSourceSha256) {
      if (!SHA256.test(additionalSourceSha256)) {
        failures.push(`${sourceLabel}.sourceSha256: must be 64 lowercase hexadecimal characters`)
      }
      const firstDeclaration = sourceChecksums.get(additionalSourceSha256)
      if (firstDeclaration) {
        failures.push(`${sourceLabel}.sourceSha256: duplicate source checksum also declared by ${firstDeclaration}`)
      } else {
        sourceChecksums.set(additionalSourceSha256, `${sourceLabel}.sourceSha256`)
      }
    }

    if (Object.hasOwn(source, "sourceBytes") && !isPositiveInteger(source.sourceBytes)) {
      failures.push(`${sourceLabel}.sourceBytes: must be a positive integer when supplied`)
    }
    if (Object.hasOwn(source, "sourceGenerator") && !hasText(source.sourceGenerator)) {
      failures.push(`${sourceLabel}.sourceGenerator: must be a non-empty string when supplied`)
    }
  }
}

async function validateLicense(asset, label, rootDir, failures) {
  if (!isRecord(asset.license)) {
    failures.push(`${label}.license: required object`)
    return
  }
  const status = requireText(asset.license, "status", `${label}.license`, failures)
  if (status !== undefined && status !== "verified" && status !== "project-authorized") {
    failures.push(`${label}.license.status: must be verified or project-authorized`)
  }
  const identifier = requireText(asset.license, "identifier", `${label}.license`, failures)
  if (status === "project-authorized" && identifier !== PROJECT_AUTHORIZED_LICENSE) {
    failures.push(`${label}.license.identifier: project-authorized assets must use ${PROJECT_AUTHORIZED_LICENSE}`)
  }
  if (status === "verified" && identifier) {
    try {
      if (identifier.startsWith("LicenseRef-")) throw new Error("LicenseRef is not independently verified")
      parseSpdxExpression(identifier)
    } catch {
      failures.push(`${label}.license.identifier: verified assets require a valid SPDX expression without LicenseRef identifiers`)
    }
  }
  const evidence = requireText(asset.license, "evidence", `${label}.license`, failures)
  const evidenceSha256 = requireText(asset.license, "evidenceSha256", `${label}.license`, failures)
  if (evidenceSha256 && !SHA256.test(evidenceSha256)) {
    failures.push(`${label}.license.evidenceSha256: must be 64 lowercase hexadecimal characters`)
  }
  if (evidence) {
    const evidencePath = await validateEvidencePath(rootDir, evidence, `${label}.license.evidence`, failures)
    if (evidencePath) {
      try {
        const contents = await readFile(evidencePath)
        if (!contents.toString("utf8").trim()) failures.push(`${label}.license.evidence: referenced evidence file is empty`)
        const actualEvidenceSha256 = sha256(contents)
        if (SHA256.test(evidenceSha256) && evidenceSha256 !== actualEvidenceSha256) {
          failures.push(`${label}.license.evidenceSha256: checksum mismatch (actual ${actualEvidenceSha256})`)
        }
        if (status && identifier && contents.length > 0 && !evidenceIdentifiesLicense(contents, status, identifier)) {
          failures.push(`${label}.license.evidence: does not identify the declared ${identifier} license basis`)
        }
      } catch {
        failures.push(`${label}.license.evidence: referenced evidence file cannot be read`)
      }
    }
  }
}

function validateGeometry(asset, label, failures) {
  if (!isRecord(asset.geometry)) {
    failures.push(`${label}.geometry: required object`)
    return undefined
  }
  const geometry = {}
  for (const field of ["uniquePrimitives", "sceneDrawCalls", "renderVertices", "uploadVertices", "triangles"]) {
    geometry[field] = requirePositiveInteger(asset.geometry, field, `${label}.geometry`, failures)
  }
  return geometry
}

function validateMaterials(asset, label, failures) {
  if (!isRecord(asset.materials)) {
    failures.push(`${label}.materials: required object`)
    return undefined
  }
  const count = requirePositiveInteger(asset.materials, "count", `${label}.materials`, failures)
  const names = asset.materials.names
  if (!Array.isArray(names) || names.length === 0 || names.some((item) => !hasText(item))) {
    failures.push(`${label}.materials.names: required non-empty string array`)
  } else {
    if (new Set(names).size !== names.length) failures.push(`${label}.materials.names: duplicate material name`)
    if (count !== undefined && names.length !== count) {
      failures.push(`${label}.materials.names: must contain exactly material count entries`)
    }
  }
  return { count, names }
}

function validateTexture(asset, label, failures) {
  if (!isRecord(asset.texture)) {
    failures.push(`${label}.texture: required aggregate object`)
    return undefined
  }
  const format = requireText(asset.texture, "format", `${label}.texture`, failures)
  const count = requireNonNegativeInteger(asset.texture, "count", `${label}.texture`, failures)
  const width = requireNonNegativeInteger(asset.texture, "width", `${label}.texture`, failures)
  const height = requireNonNegativeInteger(asset.texture, "height", `${label}.texture`, failures)
  const gpuBytesApprox = requireNonNegativeInteger(asset.texture, "gpuBytesApprox", `${label}.texture`, failures)
  if (format === "none") {
    if (count !== 0 || width !== 0 || height !== 0 || gpuBytesApprox !== 0) {
      failures.push(`${label}.texture: format none requires zero count, dimensions, and GPU bytes`)
    }
  } else if (format !== undefined && (count === 0 || width === 0 || height === 0 || gpuBytesApprox === 0)) {
    failures.push(`${label}.texture: textured assets require positive count, dimensions, and GPU bytes`)
  }
  return { count, format, width, height, gpuBytesApprox }
}

function validateTransformAndCollision(asset, label, failures) {
  if (!isRecord(asset.pivot)) failures.push(`${label}.pivot: required object`)
  else {
    requireText(asset.pivot, "policy", `${label}.pivot`, failures)
    requireText(asset.pivot, "evidence", `${label}.pivot`, failures)
    if (asset.pivot.passes !== true) failures.push(`${label}.pivot.passes: must be true for a shipped asset`)
  }

  if (!isRecord(asset.scale)) failures.push(`${label}.scale: required object`)
  else {
    if (asset.scale.units !== "meters") failures.push(`${label}.scale.units: must be meters`)
    if (asset.scale.metersPerUnit !== 1) failures.push(`${label}.scale.metersPerUnit: must be 1`)
    if (!finiteVector(asset.scale.boundsMin, 3)) failures.push(`${label}.scale.boundsMin: required finite 3-number array`)
    if (!finiteVector(asset.scale.boundsMax, 3)) failures.push(`${label}.scale.boundsMax: required finite 3-number array`)
    if (finiteVector(asset.scale.boundsMin, 3) && finiteVector(asset.scale.boundsMax, 3)
      && asset.scale.boundsMin.some((value, axis) => value > asset.scale.boundsMax[axis])) {
      failures.push(`${label}.scale: boundsMin cannot exceed boundsMax`)
    }
  }

  if (!isRecord(asset.orientation)) failures.push(`${label}.orientation: required object`)
  else {
    if (asset.orientation.upAxis !== "+Y") failures.push(`${label}.orientation.upAxis: must be +Y`)
    if (asset.orientation.forwardAxis !== "+Z") failures.push(`${label}.orientation.forwardAxis: must be +Z`)
  }

  if (!isRecord(asset.collision)) failures.push(`${label}.collision: required object`)
  else {
    const type = requireText(asset.collision, "type", `${label}.collision`, failures)
    if (type === "none" && !hasText(asset.collision.reason)) {
      failures.push(`${label}.collision.reason: required when collision type is none`)
    }
  }
}

function validateLods(asset, label, failures) {
  if (!Array.isArray(asset.lod) || asset.lod.length < 3) {
    failures.push(`${label}.lod: at least three ordered LOD bands are required`)
    return
  }
  let previousDistance = 0
  asset.lod.forEach((lod, index) => {
    const lodLabel = `${label}.lod[${index}]`
    if (!isRecord(lod)) {
      failures.push(`${lodLabel}: required object`)
      return
    }
    if (lod.level !== index) failures.push(`${lodLabel}.level: must be ${index}`)
    if (typeof lod.maxDistance !== "number" || !Number.isFinite(lod.maxDistance) || lod.maxDistance <= previousDistance) {
      failures.push(`${lodLabel}.maxDistance: must be finite and strictly increasing`)
    } else previousDistance = lod.maxDistance
    requireText(lod, "asset", lodLabel, failures)
  })
}

function validateClips(asset, label, failures) {
  if (!Array.isArray(asset.clips) || asset.clips.some((clip) => !hasText(clip))) {
    failures.push(`${label}.clips: required string array`)
    return
  }
  if (new Set(asset.clips).size !== asset.clips.length) failures.push(`${label}.clips: duplicate clip`)
}

function validateBudgets(manifest, failures) {
  if (!isRecord(manifest.budgets)) {
    failures.push("manifest.budgets: required object")
    return undefined
  }
  if (!isRecord(manifest.budgets.assetCategories)) {
    failures.push("manifest.budgets.assetCategories: required object")
    return undefined
  }
  const budgets = {}
  for (const category of ASSET_CATEGORIES) {
    const budget = manifest.budgets.assetCategories[category]
    const label = `manifest.budgets.assetCategories.${category}`
    if (!isRecord(budget)) {
      failures.push(`${label}: required object`)
      continue
    }
    budgets[category] = {}
    for (const field of CATEGORY_BUDGET_FIELDS) {
      budgets[category][field] = requirePositiveInteger(budget, field, label, failures)
    }
  }
  for (const key of Object.keys(manifest.budgets.assetCategories)) {
    if (!ASSET_CATEGORIES.includes(key)) failures.push(`manifest.budgets.assetCategories.${key}: unknown category`)
  }
  const desktop = requirePositiveInteger(manifest.budgets, "sceneDrawCallsDesktop", "manifest.budgets", failures)
  const degraded = requirePositiveInteger(manifest.budgets, "sceneDrawCallsDegraded", "manifest.budgets", failures)
  if (desktop !== undefined && degraded !== undefined && degraded > desktop) {
    failures.push("manifest.budgets.sceneDrawCallsDegraded: cannot exceed desktop budget")
  }
  return budgets
}

function validateCatalog(manifest, assetsById, failures) {
  if (!isRecord(manifest.catalog)) {
    failures.push("manifest.catalog: required object")
    return
  }
  const keys = Object.keys(manifest.catalog)
  for (const key of keys) {
    if (key !== "shipped" && key !== "procedural") failures.push(`manifest.catalog.${key}: unknown catalog bucket`)
  }
  const shipped = Array.isArray(manifest.catalog.shipped) ? manifest.catalog.shipped : undefined
  const procedural = Array.isArray(manifest.catalog.procedural) ? manifest.catalog.procedural : undefined
  if (!shipped) failures.push("manifest.catalog.shipped: required array")
  if (!procedural) failures.push("manifest.catalog.procedural: required array")
  if (!shipped || !procedural) return

  const shippedCounts = new Map()
  for (const id of shipped) {
    if (!hasText(id) || !STABLE_ID.test(id)) failures.push(`manifest.catalog.shipped: invalid stable id ${String(id)}`)
    shippedCounts.set(id, (shippedCounts.get(id) ?? 0) + 1)
    if (!assetsById.has(id)) failures.push(`manifest.catalog.shipped: unknown shipped asset ${id}`)
  }
  for (const [id, count] of shippedCounts) {
    if (count > 1) failures.push(`manifest.catalog.shipped: duplicate reference ${id}`)
  }

  const proceduralSeen = new Set()
  for (const id of procedural) {
    if (!hasText(id) || !STABLE_ID.test(id)) failures.push(`manifest.catalog.procedural: invalid stable id ${String(id)}`)
    if (proceduralSeen.has(id)) failures.push(`manifest.catalog.procedural: duplicate reference ${id}`)
    proceduralSeen.add(id)
    if (assetsById.has(id)) failures.push(`manifest.catalog.procedural: shipped asset ${id} belongs in catalog.shipped`)
    if (shippedCounts.has(id)) failures.push(`manifest.catalog: ${id} appears in shipped and procedural buckets`)
  }

  for (const id of assetsById.keys()) {
    const count = shippedCounts.get(id) ?? 0
    if (count !== 1) failures.push(`manifest.catalog.shipped: asset ${id} must appear exactly once`)
  }
}

function compareToBudget(asset, values, budget, label, failures) {
  if (!budget) return
  const comparisons = [
    ["bytesMax", asset.bytesMax, "bytesMax"],
    ["renderVertices", values.geometry?.renderVertices, "renderVerticesMax"],
    ["uploadVertices", values.geometry?.uploadVertices, "uploadVerticesMax"],
    ["triangles", values.geometry?.triangles, "trianglesMax"],
    ["unique primitives", values.geometry?.uniquePrimitives, "uniquePrimitivesMax"],
    ["scene draw calls", values.geometry?.sceneDrawCalls, "sceneDrawCallsMax"],
    ["materials", values.materials?.count, "materialsMax"],
    ["texture edge", Math.max(values.texture?.width ?? 0, values.texture?.height ?? 0), "textureEdgeMax"],
    ["texture GPU bytes", values.texture?.gpuBytesApprox, "textureGpuBytesMax"],
  ]
  for (const [metric, value, budgetKey] of comparisons) {
    if (typeof value === "number" && typeof budget[budgetKey] === "number" && value > budget[budgetKey]) {
      failures.push(`${label}: ${metric} ${value} exceeds ${asset.category} budget ${budget[budgetKey]}`)
    }
  }
}

function compareDerivedMetrics(asset, derived, label, failures) {
  for (const [group, fields] of Object.entries({
    geometry: ["uniquePrimitives", "sceneDrawCalls", "renderVertices", "uploadVertices", "triangles"],
    materials: ["count"],
    texture: ["count", "format", "width", "height", "gpuBytesApprox"],
  })) {
    for (const field of fields) {
      if (asset[group]?.[field] !== derived[group][field]) {
        failures.push(`${label}.${group}.${field}: declared ${String(asset[group]?.[field])} does not match GLB ${String(derived[group][field])}`)
      }
    }
  }
  const declaredNames = [...(asset.materials?.names ?? [])].sort()
  const derivedNames = [...derived.materials.names].sort()
  if (JSON.stringify(declaredNames) !== JSON.stringify(derivedNames)) {
    failures.push(`${label}.materials.names: declaration does not match GLB (${derivedNames.join(", ")})`)
  }
  const declaredClips = Array.isArray(asset.clips) ? [...asset.clips].sort() : []
  const derivedClips = [...derived.clips].sort()
  if (Array.isArray(asset.clips) && JSON.stringify(declaredClips) !== JSON.stringify(derivedClips)) {
    failures.push(`${label}.clips: declaration does not match GLB (${derived.clips.join(", ")})`)
  }
  if (derived.bounds) {
    for (const [field, actual] of [["boundsMin", derived.bounds.min], ["boundsMax", derived.bounds.max]]) {
      const declared = asset.scale?.[field]
      if (finiteVector(declared, 3)) {
        declared.forEach((value, axis) => {
          if (Math.abs(value - actual[axis]) > ASSET_BOUNDS_TOLERANCE) {
            failures.push(`${label}.scale.${field}[${axis}]: declared ${value} does not match GLB ${actual[axis]} within tolerance ${ASSET_BOUNDS_TOLERANCE}`)
          }
        })
      }
    }
    const pivotPolicy = hasText(asset.pivot?.policy) ? asset.pivot.policy.toLowerCase() : ""
    if (/(?:feet|foot|bottom).*origin|origin.*(?:feet|foot|bottom)/.test(pivotPolicy)
      && Math.abs(derived.bounds.min[1]) > ASSET_BOUNDS_TOLERANCE) {
      failures.push(`${label}.pivot.policy: ${asset.pivot.policy} requires derived minY=0 within tolerance ${ASSET_BOUNDS_TOLERANCE} (actual ${derived.bounds.min[1]})`)
    }
  }
}

function validateResourceDeclaration(asset, resourceUris, label, failures) {
  if (!isRecord(asset.resources)) {
    failures.push(`${label}.resources: required object`)
    return
  }
  const externalUris = resourceUris.filter(({ uri }) => !uri.startsWith("data:"))
  const declaredUris = asset.resources.externalUris
  if (asset.resources.embedded !== (externalUris.length === 0)) {
    failures.push(`${label}.resources.embedded: does not match GLB packaging`)
  }
  if (!Array.isArray(declaredUris) || declaredUris.some((uri) => !hasText(uri))) {
    failures.push(`${label}.resources.externalUris: required string array`)
  } else {
    const actual = externalUris.map(({ uri }) => uri).sort()
    const declared = [...declaredUris].sort()
    if (JSON.stringify(actual) !== JSON.stringify(declared)) {
      failures.push(`${label}.resources.externalUris: declaration does not match GLB`)
    }
  }
  for (const resource of externalUris) {
    failures.push(`${label}: external GLB resource forbidden at ${resource.path} (${resource.uri})`)
  }
}

async function walkFiles(directory, prefix = "") {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) files.push(...await walkFiles(resolve(directory, entry.name), name))
    else files.push({ name, symbolicLink: entry.isSymbolicLink() })
  }
  return files
}

async function validatePublicAssetInventory(manifest, publicDir, failures) {
  const assetDirectory = resolve(publicDir, "assets")
  let files
  try {
    files = await walkFiles(assetDirectory)
  } catch {
    failures.push("public/assets: runtime asset directory does not exist")
    return
  }
  const declaredGlbs = new Set(
    manifest.assets
      .filter(isRecord)
      .map((asset) => asset.uri)
      .filter((uri) => hasText(uri) && uri.startsWith("assets/") && uri.endsWith(".glb")),
  )
  for (const { name: filename, symbolicLink } of files) {
    const uri = `assets/${filename}`
    const extension = extname(filename).toLowerCase()
    if (symbolicLink) failures.push(`${uri}: symbolic links are forbidden in public assets`)
    if (RAW_3D_EXTENSIONS.has(extension)) failures.push(`${uri}: raw source format is forbidden in public/`)
    if (extension === ".glb" && !declaredGlbs.has(uri)) failures.push(`${uri}: unlisted GLB is not covered by the quality gate`)
  }
}

async function validateAssetFile(asset, label, publicDir, categoryBudget, failures) {
  const uri = requireText(asset, "uri", label, failures)
  const declaredSha = asset.sha256
  if (!hasText(declaredSha)) failures.push(`${label}.sha256: required checksum`)
  else if (!SHA256.test(declaredSha)) failures.push(`${label}.sha256: must be 64 lowercase hexadecimal characters`)
  if (asset.format !== "glTF 2.0 GLB") failures.push(`${label}.format: must be glTF 2.0 GLB`)
  if (!uri) return
  const safe = validateSafeRelativePath(uri, `${label}.uri`, failures, { requiredPrefix: "assets/" })
  if (!uri.endsWith(".glb")) failures.push(`${label}.uri: runtime assets must use a lowercase .glb extension`)
  if (!safe) return

  const path = resolve(publicDir, uri)
  if (!isInside(publicDir, path)) {
    failures.push(`${label}.uri: resolves outside public/`)
    return
  }
  let file
  let buffer
  try {
    const target = await realpath(path)
    const publicTarget = await realpath(publicDir)
    if (!isInside(publicTarget, target)) {
      failures.push(`${label}.uri: symlink target resolves outside public/`)
      return
    }
    file = await stat(target)
    if (!file.isFile()) {
      failures.push(`${label}.uri: runtime asset is not a file`)
      return
    }
    buffer = await readFile(target)
  } catch {
    failures.push(`${label}.uri: runtime asset does not exist (${uri})`)
    return
  }

  if (isPositiveInteger(asset.bytesMax) && file.size > asset.bytesMax) {
    failures.push(`${label}: actual file size ${file.size} exceeds asset bytesMax ${asset.bytesMax}`)
  }
  if (categoryBudget?.bytesMax !== undefined && file.size > categoryBudget.bytesMax) {
    failures.push(`${label}: actual file size ${file.size} exceeds ${asset.category} budget ${categoryBudget.bytesMax}`)
  }

  const checksum = createHash("sha256").update(buffer).digest("hex")
  if (SHA256.test(declaredSha) && declaredSha !== checksum) {
    failures.push(`${label}.sha256: checksum mismatch (actual ${checksum})`)
  }

  await validateWithKhronos(buffer, label, failures)
  const gltf = parseGlb(buffer, label, failures)
  if (gltf) {
    const resourceUris = findResourceUris(gltf.json)
    validateResourceDeclaration(asset, resourceUris, label, failures)
    const derived = deriveGlbMetrics(gltf, label, failures)
    if (derived) {
      compareDerivedMetrics(asset, derived, label, failures)
      compareToBudget(asset, derived, categoryBudget, label, failures)
    }
  }
}

export async function validateAssetManifest({ manifest, rootDir, publicDir = resolve(rootDir, "public") }) {
  const failures = []
  if (!isRecord(manifest)) return ["manifest: required JSON object"]
  if (manifest.version !== 2) failures.push("manifest.version: must be 2")
  if (manifest.units !== "meters") failures.push("manifest.units: must be meters")
  if (manifest.upAxis !== "+Y") failures.push("manifest.upAxis: must be +Y")
  if (manifest.forwardAxis !== "+Z") failures.push("manifest.forwardAxis: must be +Z")

  const budgets = validateBudgets(manifest, failures)
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    failures.push("manifest.assets: required non-empty array")
    return failures
  }

  const assetsById = new Map()
  const assetsByUri = new Map()
  for (const [index, asset] of manifest.assets.entries()) {
    const fallbackLabel = `manifest.assets[${index}]`
    if (!isRecord(asset)) {
      failures.push(`${fallbackLabel}: required object`)
      continue
    }
    const id = requireText(asset, "id", fallbackLabel, failures)
    const label = id ? `asset ${id}` : fallbackLabel
    if (id) {
      if (!STABLE_ID.test(id)) failures.push(`${label}.id: invalid stable id`)
      if (assetsById.has(id)) failures.push(`${label}.id: duplicate asset id`)
      else assetsById.set(id, asset)
    }
    if (hasText(asset.uri)) {
      if (assetsByUri.has(asset.uri)) {
        failures.push(`${label}.uri: duplicate runtime file also declared by ${assetsByUri.get(asset.uri)}`)
      } else assetsByUri.set(asset.uri, label)
    }
  }

  validateCatalog(manifest, assetsById, failures)
  await validatePublicAssetInventory(manifest, publicDir, failures)

  for (const [index, asset] of manifest.assets.entries()) {
    if (!isRecord(asset)) continue
    const label = hasText(asset.id) ? `asset ${asset.id}` : `manifest.assets[${index}]`
    if (!ASSET_CATEGORIES.includes(asset.category)) {
      failures.push(`${label}.category: must be one of ${ASSET_CATEGORIES.join(", ")}`)
    }
    const bytesMax = requirePositiveInteger(asset, "bytesMax", label, failures)
    if (bytesMax !== undefined && budgets?.[asset.category]?.bytesMax !== undefined && bytesMax > budgets[asset.category].bytesMax) {
      failures.push(`${label}: bytesMax ${bytesMax} exceeds ${asset.category} budget ${budgets[asset.category].bytesMax}`)
    }
    validateQualityGate(asset, label, failures)
    await validateProvenance(asset, label, rootDir, failures)
    await validateLicense(asset, label, rootDir, failures)
    const geometry = validateGeometry(asset, label, failures)
    const materials = validateMaterials(asset, label, failures)
    const texture = validateTexture(asset, label, failures)
    validateTransformAndCollision(asset, label, failures)
    validateLods(asset, label, failures)
    validateClips(asset, label, failures)
    compareToBudget(asset, { geometry, materials, texture }, budgets?.[asset.category], label, failures)
    await validateAssetFile(asset, label, publicDir, budgets?.[asset.category], failures)
  }

  return failures
}
