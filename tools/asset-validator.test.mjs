import { createHash } from "node:crypto"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ASSET_CATEGORIES, validateAssetManifest } from "./asset-validator.mjs"

const temporaryRoots = []

function makeGlb(gltf = { asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [] }] }, binary = Buffer.alloc(0)) {
  const source = Buffer.from(JSON.stringify(gltf), "utf8")
  const jsonPadding = (4 - (source.length % 4)) % 4
  const json = Buffer.concat([source, Buffer.alloc(jsonPadding, 0x20)])
  const binaryPadding = (4 - (binary.length % 4)) % 4
  const bin = Buffer.concat([binary, Buffer.alloc(binaryPadding)])
  const buffer = Buffer.alloc(20 + json.length + (bin.length ? 8 + bin.length : 0))
  buffer.write("glTF", 0, 4, "ascii")
  buffer.writeUInt32LE(2, 4)
  buffer.writeUInt32LE(buffer.length, 8)
  buffer.writeUInt32LE(json.length, 12)
  buffer.writeUInt32LE(0x4e4f534a, 16)
  json.copy(buffer, 20)
  if (bin.length) {
    const offset = 20 + json.length
    buffer.writeUInt32LE(bin.length, offset)
    buffer.writeUInt32LE(0x004e4942, offset + 4)
    bin.copy(buffer, offset + 8)
  }
  return buffer
}

function makePngHeader(width, height) {
  const png = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png)
  png.write("IHDR", 12, 4, "ascii")
  png.writeUInt32BE(width, 16)
  png.writeUInt32BE(height, 20)
  return png
}

function checksum(buffer) {
  return createHash("sha256").update(buffer).digest("hex")
}

function categoryBudgets() {
  return Object.fromEntries(ASSET_CATEGORIES.map((category) => [category, {
    bytesMax: 10_000,
    renderVerticesMax: 1_000,
    uploadVerticesMax: 1_000,
    trianglesMax: 1_000,
    uniquePrimitivesMax: 20,
    sceneDrawCallsMax: 20,
    materialsMax: 10,
    textureEdgeMax: 1_024,
    textureGpuBytesMax: 5_000_000,
  }]))
}

async function makeFixture() {
  const rootDir = await mkdtemp(join(tmpdir(), "sherwood-assets-"))
  temporaryRoots.push(rootDir)
  await mkdir(join(rootDir, "public/assets/models"), { recursive: true })
  await mkdir(join(rootDir, "docs/assets"), { recursive: true })
  await writeFile(join(rootDir, "docs/assets/license.txt"), "CC0 1.0 Universal\n")
  await writeFile(join(rootDir, "docs/assets/conversion.md"), "# Conversion\n")

  const positions = Buffer.alloc(36)
  const png = makePngHeader(2, 2)
  const binary = Buffer.concat([positions, png])
  const gltf = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [
      { attributes: { POSITION: 0 }, material: 0 },
      { attributes: { POSITION: 0 }, material: 1 },
    ] }],
    accessors: [{
      bufferView: 0,
      componentType: 5126,
      count: 3,
      type: "VEC3",
      min: [-1, 0, -1],
      max: [1, 2, 1],
    }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length },
      { buffer: 0, byteOffset: positions.length, byteLength: png.length },
    ],
    buffers: [{ byteLength: binary.length }],
    images: [{ bufferView: 1, mimeType: "image/png" }],
    textures: [{ source: 0 }],
    materials: [
      { name: "cloth", pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      { name: "metal" },
    ],
  }
  const glb = makeGlb(gltf, binary)
  await writeFile(join(rootDir, "public/assets/models/test-hero.glb"), glb)
  const asset = {
    id: "character.test.hero",
    category: "hero",
    uri: "assets/models/test-hero.glb",
    format: "glTF 2.0 GLB",
    sha256: checksum(glb),
    bytesMax: 10_000,
    resources: { embedded: true, externalUris: [] },
    qualityGate: {
      decision: "accept",
      reviewedAt: "2026-07-11T12:00:00Z",
      rationale: "Clear silhouette and stable browser runtime contract.",
    },
    provenance: {
      sourceAsset: "test-hero-source.glb",
      sourceSha256: "1".repeat(64),
      suppliedBy: "fixture artist",
      conversionDoc: "docs/assets/conversion.md",
    },
    license: { status: "verified", identifier: "CC0-1.0", evidence: "docs/assets/license.txt" },
    geometry: { uniquePrimitives: 2, sceneDrawCalls: 2, renderVertices: 6, uploadVertices: 3, triangles: 2 },
    materials: { count: 2, names: ["cloth", "metal"] },
    texture: { count: 1, format: "png", width: 2, height: 2, gpuBytesApprox: 20 },
    clips: ["Idle"],
    pivot: { policy: "feet-at-origin", passes: true, evidence: "bounds min Y=0" },
    scale: { units: "meters", metersPerUnit: 1, boundsMin: [-1, 0, -1], boundsMax: [1, 2, 1] },
    orientation: { upAxis: "+Y", forwardAxis: "+Z" },
    collision: { type: "capsule", radius: 0.4, height: 1.8 },
    lod: [
      { level: 0, maxDistance: 20, asset: "self" },
      { level: 1, maxDistance: 45, asset: "simplified silhouette" },
      { level: 2, maxDistance: 100, asset: "hidden in fog" },
    ],
  }
  const manifest = {
    version: 2,
    units: "meters",
    upAxis: "+Y",
    forwardAxis: "+Z",
    assets: [asset],
    catalog: { shipped: [asset.id], procedural: ["prop.procedural.marker"] },
    budgets: {
      assetCategories: categoryBudgets(),
      sceneDrawCallsDesktop: 220,
      sceneDrawCallsDegraded: 130,
    },
  }
  return { rootDir, manifest, asset, glb, gltf, binary }
}

async function writeFixtureGlb(fixture) {
  fixture.glb = makeGlb(fixture.gltf, fixture.binary)
  await writeFile(join(fixture.rootDir, "public/assets/models/test-hero.glb"), fixture.glb)
  fixture.asset.sha256 = checksum(fixture.glb)
}

async function validate(fixture) {
  return validateAssetManifest({ manifest: fixture.manifest, rootDir: fixture.rootDir })
}

function expectFailure(failures, text) {
  expect(failures.some((failure) => failure.includes(text)), failures.join("\n")).toBe(true)
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("browser 3D asset quality gate", () => {
  it("accepts a self-contained GLB with complete provenance and budgets", async () => {
    const fixture = await makeFixture()
    expect(await validate(fixture)).toEqual([])
  })

  it("derives scene bounds through matrix/TRS hierarchy and mesh instances", async () => {
    const fixture = await makeFixture()
    fixture.gltf.nodes = [
      {
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, -2, 1],
        children: [1, 2],
      },
      { mesh: 0, translation: [1, 0, 0] },
      { mesh: 0, translation: [-3, 0, 0] },
    ]
    fixture.asset.geometry.sceneDrawCalls = 4
    fixture.asset.geometry.renderVertices = 12
    fixture.asset.geometry.triangles = 4
    fixture.asset.scale.boundsMin = [-2, 0, -3]
    fixture.asset.scale.boundsMax = [4, 2, -1]
    await writeFixtureGlb(fixture)
    expect(await validate(fixture)).toEqual([])
  })

  it("rejects lying bounds and grounded-pivot declarations using derived world bounds", async () => {
    const fixture = await makeFixture()
    fixture.gltf.nodes[0].translation = [0, 0.5, 0]
    await writeFixtureGlb(fixture)
    const failures = await validate(fixture)
    expectFailure(failures, "scale.boundsMin[1]: declared 0 does not match GLB 0.5")
    expectFailure(failures, "requires derived minY=0")
  })

  it("requires finite declared bounds vectors", async () => {
    const fixture = await makeFixture()
    fixture.asset.scale.boundsMin = [0, Number.POSITIVE_INFINITY, 0]
    expectFailure(await validate(fixture), "scale.boundsMin: required finite 3-number array")
  })

  it.each([
    ["raw FBX", "assets/models/test-hero.fbx", "runtime assets must use a lowercase .glb extension"],
    ["root-absolute URI", "/assets/models/test-hero.glb", "absolute, external"],
    ["remote URI", "https://cdn.example/test-hero.glb", "absolute, external"],
    ["parent traversal", "assets/../test-hero.glb", "absolute, external"],
  ])("rejects %s shipping paths", async (_case, uri, diagnostic) => {
    const fixture = await makeFixture()
    fixture.asset.uri = uri
    expectFailure(await validate(fixture), diagnostic)
  })

  it("rejects GLBs that refer to an external buffer or texture", async () => {
    const fixture = await makeFixture()
    const externalGlb = makeGlb({
      asset: { version: "2.0" },
      buffers: [{ byteLength: 16, uri: "geometry.bin" }],
      images: [{ uri: "https://cdn.example/hero.png" }],
    })
    await writeFile(join(fixture.rootDir, "public/assets/models/test-hero.glb"), externalGlb)
    fixture.asset.sha256 = checksum(externalGlb)
    const failures = await validate(fixture)
    expectFailure(failures, "external GLB resource forbidden at glTF.buffers[0].uri")
    expectFailure(failures, "external GLB resource forbidden at glTF.images[0].uri")
  })

  it("rejects a file with a .glb name that is not a GLB 2.0 container", async () => {
    const fixture = await makeFixture()
    const invalidGlb = Buffer.from("not actually a GLB")
    await writeFile(join(fixture.rootDir, "public/assets/models/test-hero.glb"), invalidGlb)
    fixture.asset.sha256 = checksum(invalidGlb)
    expectFailure(await validate(fixture), "file is not a valid GLB container")
  })

  it("rejects raw source models and unlisted GLBs copied into public assets", async () => {
    const fixture = await makeFixture()
    await writeFile(join(fixture.rootDir, "public/assets/models/source.fbx"), "raw source")
    await writeFile(join(fixture.rootDir, "public/assets/models/unreviewed.glb"), makeGlb())
    const failures = await validate(fixture)
    expectFailure(failures, "source.fbx: raw source format is forbidden")
    expectFailure(failures, "unreviewed.glb: unlisted GLB is not covered by the quality gate")
  })

  it.each([
    ["category", "category"],
    ["qualityGate", "qualityGate"],
    ["provenance", "provenance"],
    ["license", "license"],
    ["sha256", "sha256"],
    ["resources", "resources"],
    ["geometry", "geometry"],
    ["materials", "materials"],
    ["texture", "texture"],
    ["pivot", "pivot"],
    ["scale", "scale"],
    ["orientation", "orientation"],
    ["collision", "collision"],
    ["lod", "lod"],
  ])("rejects missing %s metadata", async (field, diagnostic) => {
    const fixture = await makeFixture()
    delete fixture.asset[field]
    expectFailure(await validate(fixture), diagnostic)
  })

  it("rejects incomplete provenance and external source paths", async () => {
    const fixture = await makeFixture()
    fixture.asset.provenance.sourceAsset = "/Users/artist/Desktop/test-hero.blend"
    delete fixture.asset.provenance.conversionDoc
    const failures = await validate(fixture)
    expectFailure(failures, "sourceAsset: absolute, external")
    expectFailure(failures, "conversionDoc: required")
  })

  it.each(["sourceAsset", "sourceSha256", "suppliedBy", "conversionDoc"])(
    "rejects missing provenance.%s",
    async (field) => {
      const fixture = await makeFixture()
      delete fixture.asset.provenance[field]
      expectFailure(await validate(fixture), `provenance.${field}: required`)
    },
  )

  it("rejects unverified licenses and missing authorization evidence", async () => {
    const fixture = await makeFixture()
    fixture.asset.license.status = "unverified"
    fixture.asset.license.evidence = "https://example.com/private-license"
    const failures = await validate(fixture)
    expectFailure(failures, "license.status: must be verified or project-authorized")
    expectFailure(failures, "license.evidence: absolute, external")
  })

  it("binds project authorization to the exact project LicenseRef", async () => {
    const fixture = await makeFixture()
    fixture.asset.license.status = "project-authorized"
    fixture.asset.license.identifier = "LicenseRef-Something-Else"
    expectFailure(await validate(fixture), "must use LicenseRef-Project-Owner-Authorized")
  })

  it("rejects LicenseRef identifiers for generally verified licenses", async () => {
    const fixture = await makeFixture()
    fixture.asset.license.identifier = "LicenseRef-Private"
    expectFailure(await validate(fixture), "verified assets require a conventional non-LicenseRef identifier")
  })

  it("rejects an empty license evidence file", async () => {
    const fixture = await makeFixture()
    await writeFile(join(fixture.rootDir, "docs/assets/license.txt"), "  \n")
    expectFailure(await validate(fixture), "referenced evidence file is empty")
  })

  it("rejects rework, rejected, and invalid quality decisions", async () => {
    const rework = await makeFixture()
    rework.asset.qualityGate.decision = "rework"
    expectFailure(await validate(rework), "only accepted assets may ship (received rework)")

    const rejected = await makeFixture()
    rejected.asset.qualityGate.decision = "reject"
    expectFailure(await validate(rejected), "only accepted assets may ship (received reject)")

    const invalid = await makeFixture()
    invalid.asset.qualityGate.decision = "maybe"
    expectFailure(await validate(invalid), "only accepted assets may ship (received maybe)")
  })

  it("enforces the selected category's geometry, material, and texture budgets", async () => {
    const fixture = await makeFixture()
    const hero = fixture.manifest.budgets.assetCategories.hero
    hero.trianglesMax = 1
    hero.materialsMax = 1
    hero.textureEdgeMax = 1
    const failures = await validate(fixture)
    expectFailure(failures, "triangles 2 exceeds hero budget 1")
    expectFailure(failures, "materials 2 exceeds hero budget 1")
    expectFailure(failures, "texture edge 2 exceeds hero budget 1")
  })

  it("derives runtime costs from the GLB so under-reported declarations cannot bypass budgets", async () => {
    const fixture = await makeFixture()
    fixture.asset.geometry.sceneDrawCalls = 1
    fixture.asset.geometry.renderVertices = 3
    fixture.asset.materials.count = 1
    fixture.asset.materials.names = ["cloth"]
    fixture.asset.texture.width = 1
    fixture.manifest.budgets.assetCategories.hero.sceneDrawCallsMax = 1
    const failures = await validate(fixture)
    expectFailure(failures, "geometry.sceneDrawCalls: declared 1 does not match GLB 2")
    expectFailure(failures, "geometry.renderVertices: declared 3 does not match GLB 6")
    expectFailure(failures, "materials.count: declared 1 does not match GLB 2")
    expectFailure(failures, "materials.names: declaration does not match GLB")
    expectFailure(failures, "texture.width: declared 1 does not match GLB 2")
    expectFailure(failures, "scene draw calls 2 exceeds hero budget 1")
  })

  it("requires a complete budget contract for every asset category", async () => {
    const fixture = await makeFixture()
    delete fixture.manifest.budgets.assetCategories["repeated-prop"]
    delete fixture.manifest.budgets.assetCategories.hero.uniquePrimitivesMax
    const failures = await validate(fixture)
    expectFailure(failures, "repeated-prop: required object")
    expectFailure(failures, "hero.uniquePrimitivesMax: required positive integer")
  })

  it("rejects unknown, duplicate, and cross-bucket catalog references", async () => {
    const fixture = await makeFixture()
    fixture.manifest.catalog.shipped = [fixture.asset.id, fixture.asset.id, "prop.unknown.shipped"]
    fixture.manifest.catalog.procedural = [fixture.asset.id, "prop.procedural.marker", "prop.procedural.marker"]
    fixture.manifest.catalog.characters = []
    const failures = await validate(fixture)
    expectFailure(failures, "unknown catalog bucket")
    expectFailure(failures, "duplicate reference character.test.hero")
    expectFailure(failures, "unknown shipped asset prop.unknown.shipped")
    expectFailure(failures, "belongs in catalog.shipped")
    expectFailure(failures, "appears in shipped and procedural")
    expectFailure(failures, "duplicate reference prop.procedural.marker")
  })

  it("rejects two shipped IDs that claim the same runtime file", async () => {
    const fixture = await makeFixture()
    const duplicate = structuredClone(fixture.asset)
    duplicate.id = "character.test.duplicate"
    fixture.manifest.assets.push(duplicate)
    fixture.manifest.catalog.shipped.push(duplicate.id)
    expectFailure(await validate(fixture), "duplicate runtime file")
  })

  it("checks the on-disk byte count and SHA-256 rather than trusting metadata", async () => {
    const fixture = await makeFixture()
    fixture.asset.bytesMax = fixture.glb.length - 1
    fixture.asset.sha256 = "0".repeat(64)
    const failures = await validate(fixture)
    expectFailure(failures, `actual file size ${fixture.glb.length} exceeds asset bytesMax`)
    expectFailure(failures, "checksum mismatch")
  })

  it("requires three sequential LOD levels with increasing distances", async () => {
    const fixture = await makeFixture()
    fixture.asset.lod[1].level = 4
    fixture.asset.lod[1].maxDistance = 10
    fixture.asset.lod.pop()
    const failures = await validate(fixture)
    expectFailure(failures, "at least three ordered LOD bands")

    fixture.asset.lod.push({ level: 2, maxDistance: 60, asset: "hidden" })
    const orderedFailures = await validate(fixture)
    expectFailure(orderedFailures, "lod[1].level: must be 1")
    expectFailure(orderedFailures, "lod[1].maxDistance: must be finite and strictly increasing")
  })
})
