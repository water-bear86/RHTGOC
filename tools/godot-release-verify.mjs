// Verify the public release surface for both client lanes from the outside:
//   1. /build-info, /ready, /health identity (build, commit, protocol, image)
//   2. Three.js lane: entry document + hashed asset headers
//   3. Godot lane: pointer -> manifest -> per-file Content-Type, Cache-Control,
//      COOP/COEP isolation headers, and content hashes
//   4. wss:// room connectivity: create_room + join_room from two sockets
// Produces timestamped JSON evidence and exits non-zero when a required check
// fails. Runs read-only against the origin except for one ephemeral room.

import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { WebSocket } from "ws"

export const DEFAULT_ORIGIN = "https://rhtgoc.site"
export const ARTIFACT_ID_PATTERN = /^[0-9a-f]{12}-[0-9a-f]{12}$/
// Full-content hash verification is skipped above this size unless --full.
const HASH_BUDGET_BYTES = 16 * 1024 * 1024

export function roomsEndpointFor(origin) {
  const url = new URL(origin)
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Origin must be http(s)")
  const scheme = url.protocol === "https:" ? "wss:" : "ws:"
  return `${scheme}//${url.host}/rooms`
}

export function expectedGodotHeaders() {
  return {
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
  }
}

export function summarizeEvidence(entries) {
  const failed = entries.filter((entry) => entry.required !== false && entry.ok !== true)
  return { ok: failed.length === 0, checks: entries.length, failed: failed.map((entry) => entry.step) }
}

function nowIso() {
  return new Date().toISOString()
}

function makeRecorder(evidence) {
  return (step, ok, detail, required = true) => {
    const entry = { step, ok, required, at: nowIso(), detail }
    evidence.push(entry)
    const marker = ok ? "ok " : required ? "FAIL" : "warn"
    process.stdout.write(`[${marker}] ${step}${detail ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}\n`)
    return entry
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { "cache-control": "no-cache" } })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

function sha256Hex(buffer) {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex")
}

async function checkServerIdentity(origin, record) {
  let buildInfo = null
  try {
    buildInfo = await fetchJson(`${origin}/build-info`)
    const complete = Boolean(buildInfo.buildId) && Number.isInteger(buildInfo.protocolVersion) && Boolean(buildInfo.missionContentHash)
    record("server.build-info", complete, {
      buildId: buildInfo.buildId,
      commitSha: buildInfo.commitSha,
      protocolVersion: buildInfo.protocolVersion,
      containerImage: buildInfo.containerImage,
      missionContentHash: buildInfo.missionContentHash,
      startedAt: buildInfo.startedAt,
    })
  } catch (error) {
    record("server.build-info", false, String(error))
  }
  try {
    const ready = await fetchJson(`${origin}/ready`)
    record("server.ready", ready.ready === true, { buildId: ready.buildId, protocolVersion: ready.protocolVersion })
  } catch (error) {
    record("server.ready", false, String(error))
  }
  try {
    const health = await fetchJson(`${origin}/health`)
    record("server.health", health.ok === true, { buildId: health.buildId, rooms: health.rooms, missionContentHash: health.missionContentHash })
  } catch (error) {
    record("server.health", false, String(error))
  }
  return buildInfo
}

async function checkThreeLane(origin, record) {
  try {
    const response = await fetch(`${origin}/`, { headers: { "cache-control": "no-cache" } })
    const html = await response.text()
    const contentType = response.headers.get("content-type") ?? ""
    const cache = response.headers.get("cache-control") ?? ""
    const htmlOk = response.ok && contentType.startsWith("text/html") && /no-(cache|store)/.test(cache)
    record("three.entry-document", htmlOk, { status: response.status, contentType, cacheControl: cache })

    const scriptMatch = html.match(/src="([^"]+\.js)"/)
    if (!scriptMatch) {
      record("three.hashed-asset", false, "index.html references no JavaScript entry")
      return
    }
    const assetUrl = new URL(scriptMatch[1], `${origin}/`).toString()
    const asset = await fetch(assetUrl, { method: "HEAD" })
    const assetType = asset.headers.get("content-type") ?? ""
    const assetCache = asset.headers.get("cache-control") ?? ""
    // dist/assets mixes vite-hashed emissions with stable public/ files, so the
    // deploy intentionally relies on ?v=BUILD_ID cache keys + invalidation
    // rather than browser immutability. Content type and availability gate;
    // the observed cache header is recorded as evidence.
    const assetOk = asset.ok && assetType.includes("javascript")
    record("three.hashed-asset", assetOk, { url: assetUrl, contentType: assetType, cacheControl: assetCache || "(none)" })
  } catch (error) {
    record("three.entry-document", false, String(error))
  }
}

async function checkGodotLane(origin, requestedArtifact, full, record) {
  let pointer = null
  try {
    const response = await fetch(`${origin}/godot/current.json`, { headers: { "cache-control": "no-cache" } })
    if (response.status === 404) {
      const requiredPointer = Boolean(requestedArtifact)
      record("godot.pointer", !requiredPointer, "no candidate promoted (godot/current.json absent)", requiredPointer)
      if (!requestedArtifact) return
    } else {
      pointer = await response.json()
      const pointerOk = ARTIFACT_ID_PATTERN.test(pointer.artifactId ?? "")
      record("godot.pointer", pointerOk, pointer)
    }
  } catch (error) {
    record("godot.pointer", !requestedArtifact, String(error), Boolean(requestedArtifact))
  }

  const artifactId = requestedArtifact ?? pointer?.artifactId
  if (!artifactId) return
  if (!ARTIFACT_ID_PATTERN.test(artifactId)) {
    record("godot.artifact-id", false, `${artifactId} is not canonical <commit12>-<hash12>`)
    return
  }
  if (pointer && requestedArtifact && pointer.artifactId !== requestedArtifact) {
    record("godot.pointer-matches-request", false, { pointer: pointer.artifactId, requested: requestedArtifact }, false)
  }

  let manifest = null
  try {
    manifest = await fetchJson(`${origin}/godot/${artifactId}/manifest.json`)
    const manifestOk = manifest.artifactId === artifactId && Array.isArray(manifest.files) && manifest.files.length > 0
    record("godot.manifest", manifestOk, {
      artifactId: manifest.artifactId,
      sourceCommit: manifest.sourceCommit,
      assetManifestHash: manifest.assetManifestHash,
      protocolVersion: manifest.protocolVersion,
      files: manifest.files?.length,
    })
  } catch (error) {
    record("godot.manifest", false, String(error))
    return
  }

  const isolation = expectedGodotHeaders()
  for (const file of manifest.files) {
    const url = `${origin}/godot/${artifactId}/${file.path}`
    const step = `godot.file.${file.path}`
    try {
      const wantHash = full || file.bytes <= HASH_BUDGET_BYTES
      const response = await fetch(url, wantHash ? {} : { method: "HEAD" })
      const problems = []
      if (!response.ok) problems.push(`status ${response.status}`)
      const contentType = response.headers.get("content-type") ?? ""
      if (!contentType.startsWith(file.contentType.split(";")[0])) {
        problems.push(`content-type ${contentType || "(none)"} wanted ${file.contentType}`)
      }
      const cache = response.headers.get("cache-control") ?? ""
      const expectedCache = file.path.endsWith(".html") ? /no-(cache|store)/ : new RegExp("immutable")
      if (!expectedCache.test(cache)) problems.push(`cache-control ${cache || "(none)"}`)
      for (const [header, value] of Object.entries(isolation)) {
        const got = response.headers.get(header)
        if (got !== value) problems.push(`${header} ${got ?? "(missing)"} wanted ${value}`)
      }
      if (wantHash) {
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength !== file.bytes) problems.push(`size ${bytes.byteLength} wanted ${file.bytes}`)
        const digest = sha256Hex(bytes)
        if (digest !== file.sha256) problems.push(`sha256 mismatch`)
      }
      record(step, problems.length === 0, problems.length > 0 ? problems.join("; ") : { bytes: file.bytes, hashed: wantHash })
    } catch (error) {
      record(step, false, String(error))
    }
  }
}

function waitForMessage(socket, predicate, label, timeoutMs = 10_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage)
      rejectPromise(new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`))
    }, timeoutMs)
    const onMessage = (raw) => {
      let message
      try {
        message = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (message.type === "error") {
        clearTimeout(timeout)
        socket.off("message", onMessage)
        rejectPromise(new Error(`Server error while waiting for ${label}: ${message.code ?? message.message}`))
        return
      }
      if (!predicate(message)) return
      clearTimeout(timeout)
      socket.off("message", onMessage)
      resolvePromise(message)
    }
    socket.on("message", onMessage)
  })
}

function openSocket(endpoint) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = new WebSocket(endpoint, { handshakeTimeout: 10_000 })
    socket.once("open", () => resolvePromise(socket))
    socket.once("error", rejectPromise)
    socket.once("unexpected-response", (_request, response) => {
      rejectPromise(new Error(`WebSocket upgrade rejected with HTTP ${response.statusCode}`))
    })
  })
}

async function checkRoomConnectivity(origin, buildInfo, record) {
  const endpoint = roomsEndpointFor(origin)
  if (!buildInfo || !Number.isInteger(buildInfo.protocolVersion)) {
    record("wss.rooms", false, "cannot handshake without a live protocolVersion from /build-info")
    return
  }
  const handshake = {
    version: buildInfo.protocolVersion,
    buildId: buildInfo.buildId ?? "dev",
    productAnalytics: false,
  }
  let creator = null
  let joiner = null
  try {
    creator = await openSocket(endpoint)
    record("wss.upgrade", true, { endpoint })
    creator.send(JSON.stringify({ type: "create_room", ...handshake, displayName: "Verify Ranger", characterId: "robin" }))
    const welcome = await waitForMessage(creator, (message) => message.type === "welcome", "create_room welcome")
    record("wss.create-room", Boolean(welcome.roomCode), {
      roomCode: welcome.roomCode,
      serverBuildId: welcome.buildId,
      protocolVersion: welcome.version,
    })

    joiner = await openSocket(endpoint)
    joiner.send(JSON.stringify({
      type: "join_room",
      ...handshake,
      roomCode: welcome.roomCode,
      displayName: "Verify Marian",
      characterId: "marian",
    }))
    const joined = await waitForMessage(joiner, (message) => message.type === "welcome", "join_room welcome")
    record("wss.join-room", joined.roomCode === welcome.roomCode, { roomCode: joined.roomCode })
  } catch (error) {
    record("wss.rooms", false, String(error))
  } finally {
    for (const socket of [creator, joiner]) {
      if (socket && socket.readyState === WebSocket.OPEN) socket.close(1000, "verification complete")
      else if (socket) socket.terminate()
    }
  }
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag)
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : undefined
}

export async function runVerification({ argv = process.argv.slice(2) } = {}) {
  const origin = (argValue(argv, "--origin") ?? DEFAULT_ORIGIN).replace(/\/$/, "")
  const artifact = argValue(argv, "--artifact")
  const jsonOut = argValue(argv, "--json")
  const full = argv.includes("--full")
  const skipWs = argv.includes("--skip-ws")

  const evidence = []
  const record = makeRecorder(evidence)
  record("verify.begin", true, { origin, artifact: artifact ?? null, full, skipWs })

  const buildInfo = await checkServerIdentity(origin, record)
  await checkThreeLane(origin, record)
  await checkGodotLane(origin, artifact, full, record)
  if (!skipWs) await checkRoomConnectivity(origin, buildInfo, record)

  const summary = summarizeEvidence(evidence)
  const report = { origin, generatedAt: nowIso(), summary, evidence }
  if (jsonOut) {
    writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`evidence written to ${jsonOut}\n`)
  }
  process.stdout.write(`${JSON.stringify(summary)}\n`)
  return report
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runVerification()
    .then((report) => {
      if (!report.summary.ok) process.exitCode = 1
    })
    .catch((error) => {
      process.stderr.write(`${error instanceof Error ? error.message : "verification failed"}\n`)
      process.exitCode = 1
    })
}
