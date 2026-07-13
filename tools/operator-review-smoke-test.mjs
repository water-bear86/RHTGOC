import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const secretKey = "server-secret-test-only"
const opsSecret = "operator-secret-test-only"
const operatorToken = "operator-access-token-test-only"
const nonOperatorToken = "member-access-token-test-only"
const operatorUserId = "b9fd2fb4-2114-4e4f-aa40-619a0af652a3"
let reviewRpcCalls = 0
let reviewRpcBody = null

const supabaseServer = createServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname
  if (pathname === "/auth/v1/user") {
    const token = request.headers.authorization?.replace(/^Bearer /, "")
    const validKey = request.headers.apikey === "publishable-test-only"
    if (!validKey || (token !== operatorToken && token !== nonOperatorToken)) {
      response.writeHead(401, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ message: "invalid access token" }))
      return
    }
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify({
      id: token === operatorToken ? operatorUserId : "64fbd7f2-e7aa-44a8-b49d-4a5360b2225e",
      app_metadata: { sherwood_operator: token === operatorToken },
      user_metadata: { sherwood_operator: true },
    }))
    return
  }
  const authorized = request.headers.apikey === secretKey && request.headers.authorization === `Bearer ${secretKey}`
  response.writeHead(authorized ? 200 : 401, { "Content-Type": "application/json" })
  if (!authorized) response.end(JSON.stringify({ message: "invalid server key" }))
  else if (pathname.endsWith("/load_current_sherwood_campaign")) response.end("null")
  else if (pathname.endsWith("/review_leaderboard_quarantine")) {
    reviewRpcCalls += 1
    reviewRpcBody = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
    response.end(JSON.stringify({ status: "approved", entryId: "993a8d20-c073-4f55-87ce-8b7e727b19b0" }))
  } else response.end("true")
})

await new Promise((resolve, reject) => {
  supabaseServer.once("error", reject)
  supabaseServer.listen(0, "127.0.0.1", resolve)
})
const supabaseAddress = supabaseServer.address()
if (supabaseAddress === null || typeof supabaseAddress === "string") throw new Error("Fake Supabase server did not expose a TCP port")
const supabasePort = supabaseAddress.port

const roomPort = await new Promise((resolvePort, reject) => {
  const probe = createServer()
  probe.once("error", reject)
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address()
    if (address === null || typeof address === "string") {
      probe.close(() => reject(new Error("Room port probe did not expose a TCP port")))
      return
    }
    probe.close((error) => error ? reject(error) : resolvePort(address.port))
  })
})

const roomServer = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "server/index.ts"], {
  cwd: projectDirectory,
  env: {
    ...process.env,
    PORT: String(roomPort),
    SUPABASE_URL: `http://127.0.0.1:${supabasePort}`,
    SUPABASE_PUBLISHABLE_KEY: "publishable-test-only",
    SUPABASE_SECRET_KEY: secretKey,
    OPS_ADMIN_SECRET: opsSecret,
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let roomLogs = ""
roomServer.stdout.on("data", (chunk) => { roomLogs += chunk.toString() })
roomServer.stderr.on("data", (chunk) => { roomLogs += chunk.toString() })

async function waitForHealth() {
  let lastHealth = null
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${roomPort}/health`)
      const body = await response.text()
      lastHealth = { status: response.status, body }
      if (response.ok && JSON.parse(body).verifiedLeaderboardWrites === true) return
    } catch (error) { lastHealth = { error: error instanceof Error ? error.message : "unknown" } }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Room server failed to start: ${JSON.stringify(lastHealth)}\n${roomLogs}`)
}

const reviewBody = {
  quarantineId: "6c1a07e3-e521-4be7-a1cb-7b32e734a579",
  reviewerUserId: "11111111-1111-4111-8111-111111111111",
  decision: "approved",
}

try {
  await waitForHealth()
  const unauthorized = await fetch(`http://127.0.0.1:${roomPort}/admin/leaderboard/quarantine/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reviewBody),
  })
  const invalidIdentity = await fetch(`http://127.0.0.1:${roomPort}/admin/leaderboard/quarantine/review`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opsSecret}`, "X-Sherwood-Operator-Token": "invalid", "Content-Type": "application/json" },
    body: JSON.stringify(reviewBody),
  })
  const forbidden = await fetch(`http://127.0.0.1:${roomPort}/admin/leaderboard/quarantine/review`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opsSecret}`, "X-Sherwood-Operator-Token": nonOperatorToken, "Content-Type": "application/json" },
    body: JSON.stringify(reviewBody),
  })
  const invalid = await fetch(`http://127.0.0.1:${roomPort}/admin/leaderboard/quarantine/review`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opsSecret}`, "X-Sherwood-Operator-Token": operatorToken, "Content-Type": "application/json" },
    body: JSON.stringify({ ...reviewBody, decision: "free-text" }),
  })
  const approved = await fetch(`http://127.0.0.1:${roomPort}/admin/leaderboard/quarantine/review`, {
    method: "POST",
    headers: { Authorization: `Bearer ${opsSecret}`, "X-Sherwood-Operator-Token": operatorToken, "Content-Type": "application/json" },
    body: JSON.stringify(reviewBody),
  })
  const result = await approved.json()
  const reviewerBound = reviewRpcBody?.p_reviewer_id === operatorUserId
  if (unauthorized.status !== 401 || invalidIdentity.status !== 401 || forbidden.status !== 403 || invalid.status !== 400 || approved.status !== 200 || result.status !== "approved" || reviewRpcCalls !== 1 || !reviewerBound) {
    throw new Error(`Operator review smoke failed: ${JSON.stringify({ unauthorized: unauthorized.status, invalidIdentity: invalidIdentity.status, forbidden: forbidden.status, invalid: invalid.status, approved: approved.status, result, reviewRpcCalls, reviewerBound, roomLogs })}`)
  }
  process.stdout.write(`${JSON.stringify({ ok: true, unauthorizedRejected: true, invalidIdentityRejected: true, nonOperatorRejected: true, invalidDecisionRejected: true, reviewerBound: true, approvedReviewPersisted: true, reviewRpcCalls })}\n`)
} finally {
  roomServer.kill("SIGTERM")
  await new Promise((resolveExit) => {
    if (roomServer.exitCode !== null) resolveExit()
    else roomServer.once("exit", resolveExit)
  })
  await new Promise((resolve) => supabaseServer.close(resolve))
}
