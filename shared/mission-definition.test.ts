import { describe, expect, it } from "vitest"
import packageJson from "../missions/peoples-purse.v1.json"
import { PEOPLES_PURSE_MISSION, getMissionDefinition } from "./mission-catalog"
import { missionContentHash, validateMissionDefinition } from "./mission-definition"

describe("versioned mission packages", () => {
  it("loads the reference package deterministically with its declared hash", () => {
    expect(getMissionDefinition()).toBe(PEOPLES_PURSE_MISSION)
    expect(missionContentHash(packageJson)).toBe(packageJson.contentHash)
    expect(PEOPLES_PURSE_MISSION.id).toBe("peoples-purse@1.0.0")
  })

  it("returns actionable field-level validation errors", () => {
    const invalid = structuredClone(packageJson) as Record<string, unknown>
    invalid.routes = { entry: [], escape: [] }
    const result = validateMissionDefinition(invalid)
    expect(result.success).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("routes.entry"), expect.stringContaining("routes.escape")]))
  })

  it("rejects unsupported schema versions and stale content hashes", () => {
    const unsupported = { ...packageJson, schemaVersion: 2 }
    expect(validateMissionDefinition(unsupported).errors[0]).toContain("schemaVersion")
    const changed = { ...packageJson, name: "Changed without a version bump" }
    expect(validateMissionDefinition(changed).errors[0]).toContain("contentHash: expected")
  })
})
