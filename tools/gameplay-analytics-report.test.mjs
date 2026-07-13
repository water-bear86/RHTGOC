import { describe, expect, it, vi } from "vitest"
import {
  fetchGameplayAnalyticsReport,
  parseReportArgs,
  renderGameplayAnalyticsReport,
  summarizeGameplayAnalyticsReport,
} from "./gameplay-analytics-report.mjs"

const NOW = Date.parse("2026-07-13T20:00:00.000Z")

function row(overrides = {}) {
  return {
    windowStart: "2026-07-13T19:55:00.000Z",
    missionSlug: "peoples-purse",
    mapVersion: "fnv1a32:1234abcd",
    buildId: "stable.1",
    phase: "scout",
    experimentId: null,
    experimentRevision: null,
    variantId: null,
    cellX: 1,
    cellZ: 2,
    sampleCount: 100,
    entryCount: 10,
    dangerSampleCount: 40,
    objectiveInteractionCount: 2,
    downedCount: 2,
    stuckRecoveryCount: 0,
    clientErrorCount: 0,
    webglContextLostCount: 0,
    assetLoadFailedCount: 0,
    uncaughtErrorCount: 0,
    unhandledRejectionCount: 0,
    frameStallCount: 0,
    snapshotDesyncCount: 0,
    missionStartCount: 10,
    missionSuccessCount: 4,
    missionFailureCount: 6,
    ...overrides,
  }
}

function payload(rows) {
  return {
    since: "2026-07-12T20:00:00.000Z",
    until: "2026-07-13T20:00:00.000Z",
    rows,
  }
}

describe("gameplay analytics report arguments", () => {
  it("defaults to the last 24 hours and the RPC default limit", () => {
    expect(parseReportArgs([], NOW)).toEqual({
      since: "2026-07-12T20:00:00.000Z",
      until: "2026-07-13T20:00:00.000Z",
      limit: 1_000,
      json: false,
    })
  })

  it("parses explicit timestamps, limit, and JSON output", () => {
    expect(parseReportArgs([
      "--since=2026-07-01T00:00:00Z",
      "--until",
      "2026-07-13T00:00:00Z",
      "--limit",
      "250",
      "--json",
    ], NOW)).toEqual({
      since: "2026-07-01T00:00:00.000Z",
      until: "2026-07-13T00:00:00.000Z",
      limit: 250,
      json: true,
    })
  })

  it("derives a 24-hour range from an explicit until and enforces RPC bounds", () => {
    expect(parseReportArgs(["--until", "2026-07-01T10:00:00Z"], NOW).since).toBe("2026-06-30T10:00:00.000Z")
    expect(() => parseReportArgs(["--since", "2026-01-01T00:00:00Z"], NOW)).toThrow(/90 days/)
    expect(() => parseReportArgs(["--limit", "5001"], NOW)).toThrow(/1 to 5000/)
    expect(() => parseReportArgs(["--json", "--json"], NOW)).toThrow(/only be provided once/)
    expect(() => parseReportArgs(["--surprise"], NOW)).toThrow(/Unknown/)
  })
})

describe("gameplay analytics report RPC", () => {
  it("posts the exact RPC arguments with service-role authentication", async () => {
    const report = payload([])
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => report }))
    const result = await fetchGameplayAnalyticsReport({
      url: "https://project.supabase.co/",
      secretKey: "service-secret",
      since: report.since,
      until: report.until,
      limit: 321,
      fetchImpl,
    })

    expect(result).toBe(report)
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://project.supabase.co/rest/v1/rpc/get_gameplay_analytics_report")
    expect(request).toMatchObject({ method: "POST" })
    expect(request.headers.apikey).toBe("service-secret")
    expect(request.headers.Authorization).toBe("Bearer service-secret")
    expect(request.headers["Content-Type"]).toBe("application/json")
    expect(JSON.parse(request.body)).toEqual({
      p_since: report.since,
      p_until: report.until,
      p_limit: 321,
    })
  })

  it("withholds upstream response bodies and thrown messages from errors", async () => {
    const secret = "super-sensitive-service-key"
    const json = vi.fn(async () => ({ secret }))
    const httpFailure = fetchGameplayAnalyticsReport({
      url: "https://project.supabase.co",
      secretKey: secret,
      since: "2026-07-12T00:00:00.000Z",
      until: "2026-07-13T00:00:00.000Z",
      limit: 100,
      fetchImpl: vi.fn(async () => ({ ok: false, status: 403, json })),
    })
    const networkFailure = fetchGameplayAnalyticsReport({
      url: "https://project.supabase.co",
      secretKey: secret,
      since: "2026-07-12T00:00:00.000Z",
      until: "2026-07-13T00:00:00.000Z",
      limit: 100,
      fetchImpl: vi.fn(async () => { throw new Error(`request leaked ${secret}`) }),
    })

    await expect(httpFailure).rejects.toThrow(/status 403; response body withheld/)
    await expect(httpFailure).rejects.not.toThrow(secret)
    await expect(networkFailure).rejects.toThrow(/before receiving a response/)
    await expect(networkFailure).rejects.not.toThrow(secret)
    expect(json).not.toHaveBeenCalled()
  })

  it("rejects unsafe endpoints and out-of-contract request ranges before fetch", async () => {
    const fetchImpl = vi.fn()
    const request = {
      secretKey: "service-secret",
      since: "2026-07-12T00:00:00.000Z",
      until: "2026-07-13T00:00:00.000Z",
      limit: 100,
      fetchImpl,
    }

    await expect(fetchGameplayAnalyticsReport({ ...request, url: "http://project.supabase.co" })).rejects.toThrow(/SUPABASE_URL is invalid/)
    await expect(fetchGameplayAnalyticsReport({ ...request, url: "https://project.supabase.co", limit: 5001 })).rejects.toThrow(/1 to 5000/)
    await expect(fetchGameplayAnalyticsReport({ ...request, url: "https://project.supabase.co", until: request.since })).rejects.toThrow(/later than/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe("gameplay analytics report summary", () => {
  const rows = [
    row({
      buildId: "stable.1",
      experimentId: "ridge-routing",
      experimentRevision: 1,
      variantId: "control",
      clientErrorCount: 2,
      frameStallCount: 1,
    }),
    row({
      buildId: "stable.1-canary.2",
      experimentId: "ridge-routing",
      experimentRevision: 1,
      variantId: "ridge-pass",
      sampleCount: 100,
      entryCount: 20,
      dangerSampleCount: 10,
      downedCount: 0,
      missionSuccessCount: 8,
      missionFailureCount: 2,
    }),
    row({
      windowStart: "2026-07-13T19:50:00.000Z",
      cellX: -2,
      cellZ: 5,
      sampleCount: 4,
      entryCount: 4,
      dangerSampleCount: 0,
      objectiveInteractionCount: 0,
      downedCount: 0,
      missionStartCount: 0,
      missionSuccessCount: 0,
      missionFailureCount: 0,
    }),
  ]

  it("surfaces pressure, pass-through, fixed-counter bugs, experiments, and canary deltas", () => {
    const summary = summarizeGameplayAnalyticsReport(payload(rows))

    expect(summary.rowCount).toBe(3)
    expect(summary.totals).toMatchObject({ sampleCount: 204, entryCount: 34, bugCount: 2, frameStallCount: 1 })
    expect(summary.hotspots[0]).toMatchObject({ cellX: 1, cellZ: 2, issueCount: 62 })
    expect(summary.lowDwellCells[0]).toMatchObject({ cellX: -2, cellZ: 5, averageDwellSeconds: 1, passThrough: true })
    expect(summary.bugHotspots[0]).toMatchObject({ cellX: 1, cellZ: 2, bugCount: 2, frameStallCount: 1 })
    expect(summary.fixedBugHotspots[0]).toMatchObject({
      baselineBuildId: "stable.1",
      candidateBuildId: "stable.1-canary.2",
      candidateIsCanary: true,
      baselineBugCount: 2,
      candidateBugCount: 0,
    })
    expect(summary.experimentVariants.map((variant) => variant.variantId)).toEqual(["control", "ridge-pass"])
    expect(summary.buildComparisons[0]).toMatchObject({
      baselineBuildId: "stable.1",
      candidateBuildId: "stable.1-canary.2",
      candidateIsCanary: true,
      deltas: { dangerRate: -0.284615, missionSuccessRate: 0.4 },
    })
  })

  it("renders an operator-readable report with every decision surface", () => {
    const rendered = renderGameplayAnalyticsReport(summarizeGameplayAnalyticsReport(payload(rows)))

    expect(rendered).toContain("Gameplay analytics report")
    expect(rendered).toContain("Gameplay hotspots")
    expect(rendered).toContain("Low-dwell / pass-through cells")
    expect(rendered).toContain("pass-through")
    expect(rendered).toContain("Bug hotspots (fixed diagnostic counters)")
    expect(rendered).toContain("Fixed bug hotspots")
    expect(rendered).toContain("ridge-routing r1/ridge-pass")
    expect(rendered).toContain("stable.1-canary.2 (canary) vs stable.1")
    expect(rendered).not.toContain("undefined")
  })
})
