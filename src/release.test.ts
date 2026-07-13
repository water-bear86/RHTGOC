import { describe, expect, it } from "vitest"
import { shouldRefreshForBuildMismatch } from "./release"

describe("client release refresh guard", () => {
  it("refreshes once for a newly observed server build", () => {
    expect(shouldRefreshForBuildMismatch("client-a", "server-b", null)).toBe(true)
    expect(shouldRefreshForBuildMismatch("client-a", "server-b", "server-b")).toBe(false)
  })

  it("does not refresh when client and server builds match", () => {
    expect(shouldRefreshForBuildMismatch("same-build", "same-build", null)).toBe(false)
  })
})
