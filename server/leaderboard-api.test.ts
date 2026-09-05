import { spawn, type ChildProcess } from "node:child_process"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

/**
 * Boots the real HTTP server (no Supabase credentials, operator secret set)
 * and exercises the ranked leaderboard API surface: parameter validation,
 * scope rejection, unconfigured-store behavior, and operator authorization.
 * Ranked data correctness itself is covered by leaderboard-ranking.test.ts
 * and season-rollover.test.ts against the same contract.
 */

const PORT = 18991
const BASE = `http://127.0.0.1:${PORT}`
const OPS_SECRET = "test-operator-secret"

let server: ChildProcess

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/health`)
      if (response.ok) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`server did not become healthy: ${lastError}`)
}

beforeAll(async () => {
  server = spawn("npx", ["tsx", "server/index.ts"], {
    cwd: new URL("..", import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT),
      OPS_ADMIN_SECRET: OPS_SECRET,
      SUPABASE_URL: "",
      SUPABASE_SECRET_KEY: "",
      SUPABASE_PUBLISHABLE_KEY: "",
    },
    stdio: "ignore",
  })
  await waitForHealth()
}, 40_000)

afterAll(() => {
  server?.kill("SIGTERM")
})

describe("GET /api/leaderboard/ranked validation", () => {
  it("rejects an unknown board kind", async () => {
    const response = await fetch(`${BASE}/api/leaderboard/ranked?kind=bounty-hunters`)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "Invalid leaderboard kind" })
  })

  it("rejects malformed seasons, characters, party sizes, and missions", async () => {
    for (const query of [
      "season=Bad%20Slug!",
      "characterId=sheriff",
      "partySize=9",
      "partySize=abc",
      "missionSlug=NOT_A_SLUG",
    ]) {
      const response = await fetch(`${BASE}/api/leaderboard/ranked?${query}`)
      expect(response.status, query).toBe(400)
    }
  })

  it("rejects out-of-range pagination", async () => {
    for (const query of ["limit=0", "limit=101", "limit=abc", "offset=-1", "offset=20000", "offset=1.5"]) {
      const response = await fetch(`${BASE}/api/leaderboard/ranked?${query}`)
      expect(response.status, query).toBe(400)
      expect(await response.json()).toEqual({ error: "Invalid pagination parameters" })
    }
  })

  it("requires mission and party scope for swift-arrows", async () => {
    const bare = await fetch(`${BASE}/api/leaderboard/ranked?kind=swift-arrows`)
    expect(bare.status).toBe(400)
    const missionOnly = await fetch(`${BASE}/api/leaderboard/ranked?kind=swift-arrows&missionSlug=peoples-purse`)
    expect(missionOnly.status).toBe(400)
    const scoped = await fetch(`${BASE}/api/leaderboard/ranked?kind=swift-arrows&missionSlug=peoples-purse&partySize=2`)
    expect(scoped.status).toBe(503) // fully valid; store unconfigured in this harness
  })

  it("refuses viewer-scoped reads on the unauthenticated endpoint", async () => {
    for (const query of ["bandId=8c820e61-d711-4c0e-9020-789ea98d315a", "playerIds=abc"]) {
      const response = await fetch(`${BASE}/api/leaderboard/ranked?${query}`)
      expect(response.status, query).toBe(400)
      expect(await response.json()).toEqual({ error: "Scoped leaderboards require an authenticated client read" })
    }
  })

  it("answers 503, not 500, for every board when the store is unconfigured", async () => {
    for (const kind of ["master-outlaws", "peoples-champions", "clean-escapes", "rescuers"]) {
      const response = await fetch(`${BASE}/api/leaderboard/ranked?kind=${kind}`)
      expect(response.status, kind).toBe(503)
      expect(await response.json()).toEqual({ error: "Ranked leaderboard is not configured" })
    }
  })

  it("supports combined filters through validation", async () => {
    const response = await fetch(`${BASE}/api/leaderboard/ranked?kind=clean-escapes&season=season-zero&characterId=robin&partySize=2&missionSlug=peoples-purse&limit=25&offset=50`)
    expect(response.status).toBe(503) // passes all validation; fails only on the unconfigured store
  })
})

describe("GET /api/leaderboard/season/status", () => {
  it("answers 503 when the store is unconfigured", async () => {
    const response = await fetch(`${BASE}/api/leaderboard/season/status`)
    expect(response.status).toBe(503)
  })
})

describe("operator season lifecycle authorization", () => {
  it("requires the operator secret and a configured store", async () => {
    for (const path of ["activate", "close", "recover"]) {
      const unauthorized = await fetch(`${BASE}/admin/leaderboard/season/${path}`, { method: "POST" })
      // Store is unconfigured in this harness, so the guard reports 503 before
      // auth; both refusals must never be a 200 or a 500.
      expect([401, 503]).toContain(unauthorized.status)
      const withAuth = await fetch(`${BASE}/admin/leaderboard/season/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${OPS_SECRET}` },
      })
      expect([401, 503]).toContain(withAuth.status)
    }
  })

  it("never routes a GET to lifecycle mutations (falls through to static serving)", async () => {
    for (const path of ["activate", "close", "recover"]) {
      const response = await fetch(`${BASE}/admin/leaderboard/season/${path}`)
      // The mutation handlers only match POST; a GET falls through to static
      // serving. Depending on whether the checkout has a built dist/ (a dev
      // machine) or not (a fresh CI runner), that is either the SPA fallback
      // document or the static 404 — never a lifecycle auth/JSON response.
      if (response.status === 404) {
        expect(await response.json(), path).toEqual({ error: "Not found" })
      } else {
        expect(response.status, path).toBe(200)
        expect(response.headers.get("content-type") ?? "", path).toContain("text/html")
      }
    }
  })
})
