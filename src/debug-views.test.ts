import { describe, expect, it } from "vitest"
import { DEBUG_VIEWS, resolveDebugView } from "./debug-views"

describe("debug views", () => {
  it("resolves a known view from the query string", () => {
    expect(resolveDebugView("?view=horizon")).toBe(DEBUG_VIEWS.horizon)
  })

  it("returns null when no view is requested", () => {
    expect(resolveDebugView("")).toBeNull()
  })

  it("returns null for an unknown view name", () => {
    expect(resolveDebugView("?view=nope")).toBeNull()
  })
})
