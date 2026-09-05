// Godot Web artifact lifecycle: pack, publish, canary-stage, promote, status.
//
// Identity model
//   artifactId = <source-commit-12>-<asset-manifest-hash-12>
//   assetManifestHash = sha256 over the sorted (path, sha256, bytes) rows of
//   every exported file, so the id changes whenever any shipped byte changes.
//   Artifacts live under s3://<bucket>/godot/<artifactId>/ and are IMMUTABLE:
//   publish refuses to overwrite an existing prefix. The active candidate is
//   named by the mutable pointer godot/current.json (no-cache), and every
//   promotion is journaled under godot/history/.
//
// The Three.js client at / is never touched by any of these commands; lane
// switching is CloudFront's continuous-deployment canary (tools/aws-edge-release.mjs).
// Keep the cache/content-type rules in sync with shared/release.ts.

import { createHash } from "node:crypto"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync, copyFileSync } from "node:fs"
import { dirname, extname, join, posix, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { buildStackStatusArgs, assertSafeEdgeStatus } from "./aws-edge-release.mjs"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export const GODOT_PREFIX = "godot/"
export const POINTER_KEY = "godot/current.json"
export const HISTORY_PREFIX = "godot/history/"
export const ARTIFACT_ID_PATTERN = /^[0-9a-f]{12}-[0-9a-f]{12}$/
export const MANIFEST_SCHEMA = 1
export const S3_REGION = "us-east-1"
export const DEFAULT_DISTRIBUTION_ID = "E3709O4G6YVCB"

export const CONTENT_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".pck": "application/octet-stream",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
})

export function contentTypeFor(path) {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream"
}

// Mirrors shared/release.ts staticCacheControl for the Godot lane: immutable
// only inside a content-addressed artifact, and entry documents plus the
// mutable pointer must always revalidate.
const ARTIFACT_KEY_PATTERN = /^godot\/[0-9a-f]{12}-[0-9a-f]{12}\//
export function cacheControlFor(key) {
  if (key.endsWith(".html") || key === POINTER_KEY || key.startsWith(HISTORY_PREFIX)) {
    return "no-cache, no-store, must-revalidate"
  }
  if (ARTIFACT_KEY_PATTERN.test(key)) return "public, max-age=31536000, immutable"
  return "public, max-age=3600, must-revalidate"
}

export function isArtifactId(value) {
  return typeof value === "string" && ARTIFACT_ID_PATTERN.test(value)
}

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

export function assetManifestHash(entries) {
  const canonical = [...entries]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((entry) => `${entry.path}\n${entry.sha256}\n${entry.bytes}\n`)
    .join("")
  return sha256Hex(Buffer.from(canonical, "utf8")).slice(0, 12)
}

export function artifactIdFrom(sourceCommit, manifestHash) {
  const commit = String(sourceCommit).trim().toLowerCase()
  if (!/^[0-9a-f]{12,64}$/.test(commit)) throw new Error("Source commit must be a hex commit id")
  if (!/^[0-9a-f]{12}$/.test(manifestHash)) throw new Error("Asset manifest hash must be 12 hex characters")
  return `${commit.slice(0, 12)}-${manifestHash}`
}

export function listExportFiles(exportDir) {
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const stats = statSync(full)
      if (stats.isDirectory()) walk(full)
      else files.push(posix.join(...relative(exportDir, full).split(/[\\/]/)))
    }
  }
  walk(exportDir)
  return files.sort()
}

export function validateExportShape(paths) {
  const problems = []
  if (!paths.includes("index.html")) problems.push("missing index.html entry document")
  if (!paths.some((path) => path.endsWith(".wasm"))) problems.push("missing .wasm engine binary")
  if (!paths.some((path) => path.endsWith(".pck"))) problems.push("missing .pck game pack")
  if (paths.includes("manifest.json")) problems.push("export already contains manifest.json; pack from the raw Godot export")
  return problems
}

export function buildManifest({ artifactId, sourceCommit, manifestHash, protocolVersion, entries, createdAt }) {
  return {
    schema: MANIFEST_SCHEMA,
    artifactId,
    engine: "godot-web",
    sourceCommit,
    assetManifestHash: manifestHash,
    protocolVersion,
    createdAt,
    entry: "index.html",
    files: [...entries]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((entry) => ({
        path: entry.path,
        sha256: entry.sha256,
        bytes: entry.bytes,
        contentType: contentTypeFor(entry.path),
      })),
  }
}

export function verifyManifestAgainstEntries(manifest, entries) {
  const problems = []
  if (manifest.schema !== MANIFEST_SCHEMA) problems.push(`unsupported manifest schema ${manifest.schema}`)
  if (!isArtifactId(manifest.artifactId)) problems.push("manifest artifactId is not canonical")
  const recomputed = assetManifestHash(entries)
  if (recomputed !== manifest.assetManifestHash) {
    problems.push(`asset manifest hash mismatch: manifest says ${manifest.assetManifestHash}, files hash to ${recomputed}`)
  }
  const expectedId = `${String(manifest.sourceCommit).slice(0, 12)}-${recomputed}`
  if (manifest.artifactId !== expectedId) problems.push(`artifactId ${manifest.artifactId} does not match ${expectedId}`)
  const manifestPaths = new Set(manifest.files.map((file) => file.path))
  for (const entry of entries) {
    const declared = manifest.files.find((file) => file.path === entry.path)
    if (!declared) problems.push(`file ${entry.path} is not declared in the manifest`)
    else if (declared.sha256 !== entry.sha256) problems.push(`file ${entry.path} hash differs from the manifest`)
  }
  for (const path of manifestPaths) {
    if (!entries.some((entry) => entry.path === path)) problems.push(`manifest declares missing file ${path}`)
  }
  return problems
}

export function buildPointer({ artifactId, manifest, promotedAt, action }) {
  return {
    schema: MANIFEST_SCHEMA,
    artifactId,
    action,
    sourceCommit: manifest.sourceCommit,
    assetManifestHash: manifest.assetManifestHash,
    protocolVersion: manifest.protocolVersion,
    artifactPath: `/godot/${artifactId}/index.html`,
    promotedAt,
  }
}

// ---------------------------------------------------------------------------
// AWS argument builders (field-limited, secret-free; tested without AWS).

export function buildListArgs(bucket, prefix) {
  return [
    "s3api", "list-objects-v2",
    "--bucket", bucket,
    "--prefix", prefix,
    "--max-items", "2000",
    "--query", "Contents[].Key",
    "--output", "json",
    "--region", S3_REGION,
    "--no-cli-pager",
  ]
}

export function buildPutArgs(bucket, key, filePath) {
  return [
    "s3api", "put-object",
    "--bucket", bucket,
    "--key", key,
    "--body", filePath,
    "--content-type", contentTypeFor(key),
    "--cache-control", cacheControlFor(key),
    "--query", "ETag",
    "--output", "json",
    "--region", S3_REGION,
    "--no-cli-pager",
  ]
}

export function buildGetArgs(bucket, key, outFile) {
  return [
    "s3api", "get-object",
    "--bucket", bucket,
    "--key", key,
    "--query", "ContentType",
    "--output", "json",
    "--region", S3_REGION,
    "--no-cli-pager",
    outFile,
  ]
}

export function buildInvalidationArgs(distributionId, paths) {
  return [
    "cloudfront", "create-invalidation",
    "--distribution-id", distributionId,
    "--paths", ...paths,
    "--query", "Invalidation.Id",
    "--output", "text",
    "--region", S3_REGION,
    "--no-cli-pager",
  ]
}

function aws(args) {
  const result = spawnSync("aws", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  if (result.status !== 0) {
    const detail = (result.stderr || "").split("\n").find((line) => line.trim()) ?? "no stderr"
    throw new Error(`aws ${args[0]} ${args[1]} failed (exit ${result.status ?? 1}): ${detail}`)
  }
  return result.stdout ? result.stdout.trim() : ""
}

function awsJson(args) {
  const output = aws(args)
  return output ? JSON.parse(output) : null
}

export function resolveBuckets(env = process.env) {
  const primary = env.GODOT_PRIMARY_BUCKET
  const staging = env.GODOT_STAGING_BUCKET
  if (primary && staging) return { primary, staging }
  const stack = assertSafeEdgeStatus(awsJson(buildStackStatusArgs()))
  if (!stack?.primaryClientBucketName || !stack?.stagingClientBucketName) {
    throw new Error("Edge stack did not expose client bucket names; pass GODOT_PRIMARY_BUCKET/GODOT_STAGING_BUCKET")
  }
  return {
    primary: primary ?? stack.primaryClientBucketName,
    staging: staging ?? stack.stagingClientBucketName,
  }
}

function readEntries(exportDir) {
  const paths = listExportFiles(exportDir)
  return paths.map((path) => {
    const bytes = readFileSync(join(exportDir, path))
    return { path, sha256: sha256Hex(bytes), bytes: bytes.length }
  })
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim().toLowerCase()
}

function protocolVersionFromRepo() {
  return JSON.parse(readFileSync(join(repoRoot, "shared", "protocol-version.json"), "utf8")).version
}

// ---------------------------------------------------------------------------
// Commands

export function pack({ exportDir, outDir, commit, write = process.stdout.write.bind(process.stdout) }) {
  const absoluteExport = resolve(exportDir)
  if (!existsSync(absoluteExport)) throw new Error(`Export directory not found: ${absoluteExport}`)
  const paths = listExportFiles(absoluteExport)
  const shapeProblems = validateExportShape(paths)
  if (shapeProblems.length > 0) throw new Error(`Not a Godot Web export: ${shapeProblems.join("; ")}`)

  const entries = readEntries(absoluteExport)
  const manifestHash = assetManifestHash(entries)
  const sourceCommit = (commit ?? gitHead()).toLowerCase()
  const artifactId = artifactIdFrom(sourceCommit, manifestHash)
  const manifest = buildManifest({
    artifactId,
    sourceCommit: sourceCommit.slice(0, 12),
    manifestHash,
    protocolVersion: protocolVersionFromRepo(),
    entries,
    createdAt: new Date().toISOString(),
  })

  const artifactDir = join(resolve(outDir ?? join(repoRoot, "dist-godot")), artifactId)
  mkdirSync(artifactDir, { recursive: true })
  for (const path of paths) {
    const target = join(artifactDir, path)
    mkdirSync(dirname(target), { recursive: true })
    copyFileSync(join(absoluteExport, path), target)
  }
  writeFileSync(join(artifactDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  write(`${JSON.stringify({ ok: true, action: "pack", artifactId, artifactDir, files: paths.length, assetManifestHash: manifestHash }, null, 2)}\n`)
  return { artifactId, artifactDir, manifest }
}

export function publish({ artifactDir, buckets, resume = false, write = process.stdout.write.bind(process.stdout) }) {
  const absolute = resolve(artifactDir)
  const manifest = JSON.parse(readFileSync(join(absolute, "manifest.json"), "utf8"))
  if (!isArtifactId(manifest.artifactId)) throw new Error("manifest.json does not carry a canonical artifactId")
  const entries = readEntries(absolute).filter((entry) => entry.path !== "manifest.json")
  const problems = verifyManifestAgainstEntries(manifest, entries)
  if (problems.length > 0) throw new Error(`Artifact failed integrity verification: ${problems.join("; ")}`)

  const prefix = `${GODOT_PREFIX}${manifest.artifactId}/`
  const uploads = [...entries.map((entry) => entry.path), "manifest.json"]
  const results = {}
  for (const bucket of buckets) {
    const existing = new Set((awsJson(buildListArgs(bucket, prefix)) ?? []).filter(Boolean))
    if (existing.size > 0 && !resume) {
      throw new Error(
        `s3://${bucket}/${prefix} already holds ${existing.size} object(s). Artifacts are immutable; a changed export must produce a new artifact id. Use --resume to upload only missing files of the SAME artifact.`,
      )
    }
    let uploaded = 0
    let skipped = 0
    for (const path of uploads) {
      const key = `${prefix}${path}`
      if (existing.has(key)) {
        skipped += 1
        continue
      }
      aws(buildPutArgs(bucket, key, join(absolute, path)))
      uploaded += 1
    }
    results[bucket] = { uploaded, skipped }
  }
  write(`${JSON.stringify({ ok: true, action: "publish", artifactId: manifest.artifactId, prefix: `/${prefix}`, buckets: results }, null, 2)}\n`)
  return { artifactId: manifest.artifactId, results }
}

function fetchManifestFromBucket(bucket, artifactId) {
  const tmp = join(repoRoot, "node_modules", ".cache", `godot-manifest-${artifactId}.json`)
  mkdirSync(dirname(tmp), { recursive: true })
  aws(buildGetArgs(bucket, `${GODOT_PREFIX}${artifactId}/manifest.json`, tmp))
  return JSON.parse(readFileSync(tmp, "utf8"))
}

export function setPointer({ artifactId, buckets, distributionId, action, write = process.stdout.write.bind(process.stdout) }) {
  if (!isArtifactId(artifactId)) throw new Error("Refusing pointer update: artifact id is not canonical <commit12>-<hash12>")
  const manifest = fetchManifestFromBucket(buckets[0], artifactId)
  if (manifest.artifactId !== artifactId) throw new Error("Published manifest does not match the requested artifact id")
  const promotedAt = new Date().toISOString()
  const pointer = buildPointer({ artifactId, manifest, promotedAt, action })
  const pointerFile = join(repoRoot, "node_modules", ".cache", "godot-pointer.json")
  mkdirSync(dirname(pointerFile), { recursive: true })
  writeFileSync(pointerFile, `${JSON.stringify(pointer, null, 2)}\n`)

  const historyKey = `${HISTORY_PREFIX}${promotedAt.replace(/[:.]/g, "-")}-${action}-${artifactId}.json`
  for (const bucket of buckets) {
    aws(buildPutArgs(bucket, POINTER_KEY, pointerFile))
    aws(buildPutArgs(bucket, historyKey, pointerFile))
  }
  const invalidationId = aws(buildInvalidationArgs(distributionId, ["/godot/current.json"]))
  write(`${JSON.stringify({ ok: true, action, pointer, invalidationId }, null, 2)}\n`)
  return { pointer, invalidationId }
}

export function status({ buckets, write = process.stdout.write.bind(process.stdout) }) {
  const report = {}
  for (const bucket of buckets) {
    const keys = (awsJson(buildListArgs(bucket, GODOT_PREFIX)) ?? []).filter(Boolean)
    const artifacts = [...new Set(
      keys
        .map((key) => key.slice(GODOT_PREFIX.length).split("/")[0])
        .filter((segment) => ARTIFACT_ID_PATTERN.test(segment)),
    )].sort()
    let pointer = null
    if (keys.includes(POINTER_KEY)) {
      try {
        pointer = fetchPointer(bucket)
      } catch {
        pointer = { error: "pointer exists but could not be read" }
      }
    }
    report[bucket] = { artifacts, pointer }
  }
  write(`${JSON.stringify({ ok: true, action: "status", buckets: report }, null, 2)}\n`)
  return report
}

function fetchPointer(bucket) {
  const tmp = join(repoRoot, "node_modules", ".cache", "godot-pointer-read.json")
  mkdirSync(dirname(tmp), { recursive: true })
  aws(buildGetArgs(bucket, POINTER_KEY, tmp))
  return JSON.parse(readFileSync(tmp, "utf8"))
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined
}

export function runGodotArtifact({ argv = process.argv.slice(2), env = process.env, write = process.stdout.write.bind(process.stdout) } = {}) {
  const action = argv[0]
  const distributionId = env.CLIENT_DISTRIBUTION_ID || DEFAULT_DISTRIBUTION_ID
  if (action === "pack") {
    const exportDir = argValue(argv, "--export-dir")
    if (!exportDir) throw new Error("pack requires --export-dir <godot-web-export>")
    return pack({ exportDir, outDir: argValue(argv, "--out"), commit: argValue(argv, "--commit"), write })
  }
  if (action === "publish") {
    const artifactDir = argValue(argv, "--artifact-dir")
    if (!artifactDir) throw new Error("publish requires --artifact-dir <dist-godot/artifact-id>")
    const { primary, staging } = resolveBuckets(env)
    return publish({ artifactDir, buckets: [primary, staging], resume: argv.includes("--resume"), write })
  }
  if (action === "promote" || action === "rollback") {
    const artifactId = argValue(argv, "--artifact-id")
    if (!artifactId) throw new Error(`${action} requires --artifact-id <commit12-hash12>`)
    const { primary, staging } = resolveBuckets(env)
    return setPointer({ artifactId, buckets: [primary, staging], distributionId, action, write })
  }
  if (action === "status") {
    const { primary, staging } = resolveBuckets(env)
    return status({ buckets: [primary, staging], write })
  }
  throw new Error(
    "Usage: node tools/godot-artifact.mjs <pack --export-dir DIR [--out DIR] [--commit SHA] | publish --artifact-dir DIR [--resume] | promote --artifact-id ID | rollback --artifact-id ID | status>",
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    runGodotArtifact()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Godot artifact command failed"}\n`)
    process.exitCode = 1
  }
}
