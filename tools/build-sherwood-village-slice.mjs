#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const GLTF_TRANSFORM_VERSION = "4.4.1";
const LICENSE_SHA256 = "ec6fd5004514cb0515a7dc1065f474644d31698861597b32e1745945ffec71de";
const SOURCE_FINGERPRINT_SHA256 = "71d564c9a2f3a4e94933bf9091ab08e2b2f5540650e200eb8afbf4a574399068";
const OUTPUT_SHA256 = "9af770b514072dd55d13c29ffd95b4e1b39659e8baaf17b68e32ee80f4b150eb";
const MAX_BYTES = 3_000_000;
const MAX_DRAWS = 24;
const MAX_TEXTURE_EDGE = 512;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const GLTF_TRANSFORM_CLI = join(REPO_ROOT, "node_modules", "@gltf-transform", "cli", "bin", "cli.js");

const ASSETS = [
  "Wall_Plaster_WoodGrid",
  "Wall_Plaster_Door_Round",
  "Wall_Plaster_Window_Wide_Round",
  "Roof_RoundTiles_4x4",
  "Door_1_Round",
  "Window_Wide_Round1",
  "Stairs_Exterior_Straight",
  "Prop_Wagon",
  "Prop_Crate",
  "Prop_WoodenFence_Single",
  "Prop_WoodenFence_Extension1",
  "Prop_Vine2",
];

const LEGACY_SOURCE_HINT = join(homedir(), "Desktop", "Medieval Village MegaKit[Standard]");
export const DEFAULT_OUTPUT = join(REPO_ROOT, "public", "assets", "environment", "sherwood-village-slice.glb");
export const DEFAULT_LICENSE_OUTPUT = join(REPO_ROOT, "docs", "assets", "licenses", "medieval-village-megakit-cc0.txt");

export function parseArgs(argv) {
  const args = {
    source: process.env.SHERWOOD_VILLAGE_KIT,
    output: DEFAULT_OUTPUT,
    licenseOutput: DEFAULT_LICENSE_OUTPUT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--source") args.source = argv[++index];
    else if (value === "--output") args.output = argv[++index];
    else if (value === "--license-output") args.licenseOutput = argv[++index];
    else if (value === "--help" || value === "-h") {
      console.log(
        "Usage: node tools/build-sherwood-village-slice.mjs [--source <MegaKit directory>] [--output <GLB path>] [--license-output <text path>]",
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  if (!args.source) {
    throw new Error(
      `Village source pack is required. Pass --source <directory> or set SHERWOOD_VILLAGE_KIT (previous local location: ${LEGACY_SOURCE_HINT}).`,
    );
  }
  return {
    source: resolve(args.source),
    output: resolve(args.output),
    licenseOutput: resolve(args.licenseOutput),
  };
}

export function normalizeFingerprintPath(root, path) {
  return relative(root, path).split(sep).join("/");
}

export function compareFingerprintEntries([left], [right]) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function runTransform(args) {
  const result = spawnSync(
    process.execPath,
    [GLTF_TRANSFORM_CLI, ...args],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status !== 0) {
    throw new Error(
      [`gltf-transform ${args[0]} failed`, result.stdout.trim(), result.stderr.trim()]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result.stdout.trim();
}

function safeResourcePath(root, uri) {
  if (!uri || uri.startsWith("data:") || /^[a-z][a-z0-9+.-]*:/i.test(uri) || isAbsolute(uri)) {
    throw new Error(`Expected a relative, external source resource URI; received ${JSON.stringify(uri)}`);
  }
  const resource = resolve(root, uri);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!resource.startsWith(prefix)) throw new Error(`Source resource escapes the glTF directory: ${uri}`);
  return resource;
}

function sceneRoot(doc, sourceName) {
  const scene = doc.scenes?.[doc.scene ?? 0];
  if (!scene || scene.nodes?.length !== 1) {
    throw new Error(`${sourceName}: expected exactly one scene root`);
  }
  const nodeIndex = scene.nodes[0];
  const node = doc.nodes?.[nodeIndex];
  if (!node || node.mesh === undefined || node.children?.length) {
    throw new Error(`${sourceName}: expected one direct mesh node with no child hierarchy`);
  }
  if (node.matrix || node.rotation || node.scale) {
    throw new Error(`${sourceName}: unexpected authored matrix, rotation, or scale`);
  }
  return { scene, node, nodeIndex };
}

function meshBounds(doc, meshIndex, sourceName) {
  const mesh = doc.meshes?.[meshIndex];
  if (!mesh?.primitives?.length) throw new Error(`${sourceName}: root mesh has no primitives`);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const primitive of mesh.primitives) {
    const accessorIndex = primitive.attributes?.POSITION;
    const accessor = doc.accessors?.[accessorIndex];
    if (!accessor?.min || !accessor?.max) {
      throw new Error(`${sourceName}: POSITION accessor is missing bounds`);
    }
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], accessor.min[axis]);
      max[axis] = Math.max(max[axis], accessor.max[axis]);
    }
  }
  return { min, max };
}

async function prepareSource(sourceName, sourceDir, workDir, copiedResources, fingerprintFiles) {
  const input = join(sourceDir, `${sourceName}.gltf`);
  const inputBytes = await readFile(input);
  const doc = JSON.parse(inputBytes.toString("utf8"));
  if (doc.asset?.version !== "2.0") throw new Error(`${sourceName}: expected glTF 2.0`);

  const { scene, node } = sceneRoot(doc, sourceName);
  const bounds = meshBounds(doc, node.mesh, sourceName);
  const originalTranslation = node.translation ?? [0, 0, 0];
  const authoredMinY = bounds.min[1] + originalTranslation[1];
  node.translation = [originalTranslation[0], -bounds.min[1], originalTranslation[2]];
  node.name = sourceName;
  node.extras = {
    ...(node.extras ?? {}),
    sherwoodAssetId: sourceName,
    unitMeters: 1,
    authoredMinY,
    groundOffsetY: -authoredMinY,
  };
  scene.name = sourceName;

  const resourceUris = [
    ...(doc.buffers ?? []).map((resource) => resource.uri),
    ...(doc.images ?? []).map((resource) => resource.uri).filter(Boolean),
  ];
  for (const uri of resourceUris) {
    const resource = safeResourcePath(sourceDir, uri);
    const destination = join(workDir, uri);
    await mkdir(dirname(destination), { recursive: true });
    const bytes = await readFile(resource);
    const existingDigest = copiedResources.get(uri);
    const digest = sha256(bytes);
    if (existingDigest && existingDigest !== digest) {
      throw new Error(`${sourceName}: resource URI collision with different contents: ${uri}`);
    }
    if (!existingDigest) {
      await copyFile(resource, destination);
      copiedResources.set(uri, digest);
      fingerprintFiles.set(normalizeFingerprintPath(dirname(sourceDir), resource), bytes);
    }
  }

  fingerprintFiles.set(normalizeFingerprintPath(dirname(sourceDir), input), inputBytes);
  const prepared = join(workDir, `${sourceName}.gltf`);
  await writeFile(prepared, `${JSON.stringify(doc, null, 2)}\n`);
  return prepared;
}

function parseGlb(bytes) {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF") {
    throw new Error("Output is not a GLB file");
  }
  const version = bytes.readUInt32LE(4);
  const declaredLength = bytes.readUInt32LE(8);
  if (version !== 2 || declaredLength !== bytes.length) throw new Error("Invalid GLB header");
  let offset = 12;
  let json;
  let binary = Buffer.alloc(0);
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8").trim());
    else if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  if (!json) throw new Error("GLB is missing its JSON chunk");
  return { json, binary };
}

function accessorLayout(doc, accessorIndex, elementSize) {
  const accessor = doc.accessors?.[accessorIndex];
  const view = doc.bufferViews?.[accessor?.bufferView];
  if (!accessor || !view || accessor.componentType !== 5126 || accessor.sparse) {
    throw new Error(`Expected a dense float accessor at index ${accessorIndex}`);
  }
  return {
    accessor,
    offset: (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0),
    stride: view.byteStride ?? elementSize,
  };
}

function sanitizeTangents(bytes) {
  const { json: doc, binary } = parseGlb(bytes);
  let repaired = 0;
  for (const mesh of doc.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      const tangentIndex = primitive.attributes?.TANGENT;
      const normalIndex = primitive.attributes?.NORMAL;
      if (tangentIndex === undefined) continue;
      if (normalIndex === undefined) throw new Error("A tangent accessor has no matching normal accessor");
      const tangent = accessorLayout(doc, tangentIndex, 16);
      const normal = accessorLayout(doc, normalIndex, 12);
      if (tangent.accessor.type !== "VEC4" || normal.accessor.type !== "VEC3") {
        throw new Error("Expected VEC4 tangents and VEC3 normals");
      }
      if (tangent.accessor.count !== normal.accessor.count) {
        throw new Error("Tangent and normal accessor counts do not match");
      }
      for (let index = 0; index < tangent.accessor.count; index += 1) {
        const tangentOffset = tangent.offset + index * tangent.stride;
        const normalOffset = normal.offset + index * normal.stride;
        const x = binary.readFloatLE(tangentOffset);
        const y = binary.readFloatLE(tangentOffset + 4);
        const z = binary.readFloatLE(tangentOffset + 8);
        const length = Math.hypot(x, y, z);
        if (length > 0.5) continue;

        const nx = binary.readFloatLE(normalOffset);
        const ny = binary.readFloatLE(normalOffset + 4);
        const nz = binary.readFloatLE(normalOffset + 8);
        const helper = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        let tx = helper[1] * nz - helper[2] * ny;
        let ty = helper[2] * nx - helper[0] * nz;
        let tz = helper[0] * ny - helper[1] * nx;
        const tangentLength = Math.hypot(tx, ty, tz) || 1;
        tx /= tangentLength;
        ty /= tangentLength;
        tz /= tangentLength;
        binary.writeFloatLE(tx, tangentOffset);
        binary.writeFloatLE(ty, tangentOffset + 4);
        binary.writeFloatLE(tz, tangentOffset + 8);
        binary.writeFloatLE(1, tangentOffset + 12);
        repaired += 1;
      }
    }
  }
  return repaired;
}

function webpDimensions(bytes) {
  if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
    throw new Error("Expected an embedded WebP texture");
  }
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8X") {
    return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  }
  if (kind === "VP8 ") {
    return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  }
  if (kind === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  throw new Error(`Unsupported WebP payload: ${kind}`);
}

function primitiveTriangles(doc, primitive) {
  const accessorIndex = primitive.indices ?? primitive.attributes?.POSITION;
  const count = doc.accessors?.[accessorIndex]?.count ?? 0;
  const mode = primitive.mode ?? 4;
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0;
}

function measureOutput(bytes) {
  const { json: doc, binary } = parseGlb(bytes);
  const scene = doc.scenes?.[doc.scene ?? 0];
  if (!scene) throw new Error("Output has no default scene");

  let sceneDrawCalls = 0;
  let renderVertices = 0;
  let renderTriangles = 0;
  const uploadedPositionAccessors = new Set();
  const visited = new Set();
  const names = [];
  const rootGroundY = {};
  const rootBounds = {};
  const boundsMin = [Infinity, Infinity, Infinity];
  const boundsMax = [-Infinity, -Infinity, -Infinity];

  function visit(nodeIndex) {
    const node = doc.nodes?.[nodeIndex];
    if (!node) throw new Error(`Scene references missing node ${nodeIndex}`);
    if (node.mesh !== undefined) {
      const mesh = doc.meshes?.[node.mesh];
      if (!mesh) throw new Error(`Node references missing mesh ${node.mesh}`);
      for (const primitive of mesh.primitives) {
        const material = Number.isInteger(primitive.material) ? doc.materials?.[primitive.material] : undefined;
        sceneDrawCalls += material?.alphaMode === "BLEND" && material.doubleSided === true ? 2 : 1;
        const renderAccessor = doc.accessors?.[primitive.indices ?? primitive.attributes?.POSITION];
        renderVertices += renderAccessor?.count ?? 0;
        renderTriangles += primitiveTriangles(doc, primitive);
        uploadedPositionAccessors.add(primitive.attributes?.POSITION);
      }
    }
    for (const child of node.children ?? []) visit(child);
  }

  for (const nodeIndex of scene.nodes ?? []) {
    const root = doc.nodes?.[nodeIndex];
    names.push(root?.name);
    visit(nodeIndex);
    if (root?.mesh !== undefined) {
      const bounds = meshBounds(doc, root.mesh, root.name ?? `node-${nodeIndex}`);
      const translation = root.translation ?? [0, 0, 0];
      rootGroundY[root.name] = bounds.min[1] + translation[1];
      rootBounds[root.name] = {
        min: bounds.min.map((value, axis) => value + translation[axis]),
        max: bounds.max.map((value, axis) => value + translation[axis]),
      };
      for (let axis = 0; axis < 3; axis += 1) {
        boundsMin[axis] = Math.min(boundsMin[axis], bounds.min[axis] + translation[axis]);
        boundsMax[axis] = Math.max(boundsMax[axis], bounds.max[axis] + translation[axis]);
      }
    }
  }

  for (const image of doc.images ?? []) {
    if (image.uri || image.bufferView === undefined || image.mimeType !== "image/webp") {
      throw new Error("Every output image must be an embedded WebP buffer view");
    }
  }
  if ((doc.buffers ?? []).some((buffer) => buffer.uri)) {
    throw new Error("Output contains an external buffer URI");
  }

  const textureDimensions = (doc.images ?? []).map((image) => {
    const view = doc.bufferViews?.[image.bufferView];
    if (!view) throw new Error("Image references a missing buffer view");
    const start = view.byteOffset ?? 0;
    const data = binary.subarray(start, start + view.byteLength);
    return webpDimensions(data);
  });
  const maxTextureEdge = textureDimensions.reduce(
    (largest, dimensions) => Math.max(largest, ...dimensions),
    0,
  );
  const textureEncodedBytes = (doc.images ?? []).reduce(
    (total, image) => total + doc.bufferViews[image.bufferView].byteLength,
    0,
  );
  const textureGpuBytesWithMipmaps = textureDimensions.reduce((total, [width, height]) => {
    let pixels = 0;
    for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) {
      pixels += w * h;
      if (w === 1 && h === 1) break;
    }
    return total + pixels * 4;
  }, 0);
  const uploadVertices = [...uploadedPositionAccessors].reduce(
    (total, accessorIndex) => total + (doc.accessors?.[accessorIndex]?.count ?? 0),
    0,
  );

  for (const name of names) {
    if (visited.has(name)) throw new Error(`Duplicate root asset name: ${name}`);
    visited.add(name);
  }
  if (names.length !== ASSETS.length || ASSETS.some((name) => !visited.has(name))) {
    throw new Error(`Expected named roots ${ASSETS.join(", ")}; received ${names.join(", ")}`);
  }
  for (const [name, minY] of Object.entries(rootGroundY)) {
    if (Math.abs(minY) > 0.0001) throw new Error(`${name}: root is not grounded (minY=${minY})`);
  }
  if (bytes.length > MAX_BYTES) throw new Error(`Output is ${bytes.length} bytes; budget is ${MAX_BYTES}`);
  if (sceneDrawCalls > MAX_DRAWS) throw new Error(`Output uses ${sceneDrawCalls} draws; budget is ${MAX_DRAWS}`);
  if (maxTextureEdge > MAX_TEXTURE_EDGE) {
    throw new Error(`Output has a ${maxTextureEdge}px texture edge; budget is ${MAX_TEXTURE_EDGE}px`);
  }

  return {
    bytes: bytes.length,
    sha256: sha256(bytes),
    namedRoots: names,
    meshes: doc.meshes?.length ?? 0,
    uniquePrimitives: (doc.meshes ?? []).reduce((sum, mesh) => sum + mesh.primitives.length, 0),
    sceneDrawCalls,
    renderVertices,
    uploadVertices,
    renderTriangles,
    materials: doc.materials?.length ?? 0,
    materialNames: (doc.materials ?? []).map((material) => material.name),
    textures: doc.textures?.length ?? 0,
    textureImages: doc.images?.length ?? 0,
    maxTextureEdge,
    textureDimensions,
    textureEncodedBytes,
    textureGpuBytesWithMipmaps,
    requiredExtensions: doc.extensionsRequired ?? [],
    boundsMin,
    boundsMax,
    rootGroundY,
    rootBounds,
    allResourcesEmbedded: true,
  };
}

async function main() {
  const { source, output, licenseOutput } = parseArgs(process.argv.slice(2));
  const sourceDir = join(source, "glTF");
  const licensePath = join(source, "License_Standard.txt");
  const licenseBytes = await readFile(licensePath);
  const licenseDigest = sha256(licenseBytes);
  if (licenseDigest !== LICENSE_SHA256) {
    throw new Error(`Unexpected license evidence SHA-256: ${licenseDigest}`);
  }

  const workDir = await mkdtemp(join(tmpdir(), "sherwood-village-slice-"));
  try {
    const copiedResources = new Map();
    const fingerprintFiles = new Map([[normalizeFingerprintPath(dirname(sourceDir), licensePath), licenseBytes]]);
    const prepared = [];
    for (const sourceName of ASSETS) {
      prepared.push(
        await prepareSource(sourceName, sourceDir, workDir, copiedResources, fingerprintFiles),
      );
    }

    const fingerprint = createHash("sha256");
    for (const [path, bytes] of [...fingerprintFiles.entries()].sort(compareFingerprintEntries)) {
      fingerprint.update(path);
      fingerprint.update("\0");
      fingerprint.update(bytes);
      fingerprint.update("\0");
    }
    const sourceFingerprintSha256 = fingerprint.digest("hex");
    if (sourceFingerprintSha256 !== SOURCE_FINGERPRINT_SHA256) {
      throw new Error(`Unexpected source pack fingerprint: ${sourceFingerprintSha256}`);
    }

    const merged = join(workDir, "01-merged.glb");
    const deduped = join(workDir, "02-deduped.glb");
    const welded = join(workDir, "03-welded.glb");
    const tangent = join(workDir, "04-tangent.glb");
    const pruned = join(workDir, "05-pruned.glb");
    const sparse = join(workDir, "06-sparse.glb");
    const resized = join(workDir, "07-resized.glb");
    const encoded = join(workDir, "08-webp.glb");
    const validated = join(workDir, "09-validated.glb");

    runTransform(["merge", ...prepared, merged, "--merge-scenes"]);
    runTransform(["dedup", merged, deduped]);
    runTransform(["weld", deduped, welded]);
    runTransform(["tangents", welded, tangent]);
    runTransform(["prune", tangent, pruned, "--keep-leaves", "true"]);
    runTransform(["sparse", pruned, sparse]);
    runTransform([
      "resize",
      sparse,
      resized,
      "--width",
      String(MAX_TEXTURE_EDGE),
      "--height",
      String(MAX_TEXTURE_EDGE),
      "--filter",
      "lanczos3",
    ]);
    runTransform([
      "webp",
      resized,
      encoded,
      "--quality",
      "82",
      "--effort",
      "80",
    ]);

    const outputBytes = await readFile(encoded);
    const repairedTangents = sanitizeTangents(outputBytes);
    const metrics = measureOutput(outputBytes);
    if (metrics.sha256 !== OUTPUT_SHA256) {
      throw new Error(`Non-deterministic output SHA-256: ${metrics.sha256}`);
    }
    await writeFile(validated, outputBytes);
    const validation = runTransform(["validate", validated]);

    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, outputBytes);
    await mkdir(dirname(licenseOutput), { recursive: true });
    await writeFile(licenseOutput, licenseBytes);

    const report = {
      output,
      licenseOutput,
      source,
      sourceFingerprintSha256,
      licenseSha256: licenseDigest,
      gltfTransformVersion: GLTF_TRANSFORM_VERSION,
      repairedDegenerateTangents: repairedTangents,
      ...metrics,
    };
    console.log(JSON.stringify(report, null, 2));
    if (validation) console.error(validation);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}
