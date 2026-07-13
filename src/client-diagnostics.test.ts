import { describe, expect, it } from "vitest"
import { browserProfile, DiagnosticRateLimiter } from "./client-diagnostics"

describe("privacy-safe client diagnostics", () => {
  it("reduces user agents to a browser family and major version", () => {
    expect(browserProfile("Mozilla/5.0 Version/19.0 Safari/605.1.15")).toEqual({ browserFamily: "safari", browserMajor: 19 })
    expect(browserProfile("Mozilla/5.0 Chrome/142.0.0.0 Safari/537.36")).toEqual({ browserFamily: "chromium", browserMajor: 142 })
    expect(browserProfile("unknown-agent")).toEqual({ browserFamily: "other" })
  })

  it("rate limits each fixed diagnostic independently", () => {
    const limiter = new DiagnosticRateLimiter(10_000)
    expect(limiter.allow("asset_load_failed", 100)).toBe(true)
    expect(limiter.allow("asset_load_failed", 5_000)).toBe(false)
    expect(limiter.allow("webgl_context_lost", 5_000)).toBe(true)
    expect(limiter.allow("asset_load_failed", 10_100)).toBe(true)
  })
})
