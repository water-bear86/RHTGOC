import { describe, expect, it } from "vitest"
import { expectedGodotHeaders, roomsEndpointFor, summarizeEvidence, ARTIFACT_ID_PATTERN } from "./godot-release-verify.mjs"

describe("Godot release verification", () => {
  it("derives the secure rooms endpoint from the public origin", () => {
    expect(roomsEndpointFor("https://rhtgoc.site")).toBe("wss://rhtgoc.site/rooms")
    expect(roomsEndpointFor("http://127.0.0.1:8787")).toBe("ws://127.0.0.1:8787/rooms")
    expect(() => roomsEndpointFor("ftp://rhtgoc.site")).toThrow(/http/)
  })

  it("requires the exact isolation headers the Godot lane is deployed with", () => {
    expect(expectedGodotHeaders()).toEqual({
      "cross-origin-opener-policy": "same-origin",
      "cross-origin-embedder-policy": "require-corp",
    })
  })

  it("fails the run when any required check fails, ignoring optional warnings", () => {
    expect(summarizeEvidence([
      { step: "a", ok: true, required: true },
      { step: "b", ok: false, required: false },
    ])).toEqual({ ok: true, checks: 2, failed: [] })
    expect(summarizeEvidence([
      { step: "a", ok: true, required: true },
      { step: "c", ok: false, required: true },
    ])).toEqual({ ok: false, checks: 2, failed: ["c"] })
  })

  it("accepts only canonical artifact ids", () => {
    expect(ARTIFACT_ID_PATTERN.test("0c70a62f3b21-9d8e7f6a5b4c")).toBe(true)
    expect(ARTIFACT_ID_PATTERN.test("main")).toBe(false)
  })
})
