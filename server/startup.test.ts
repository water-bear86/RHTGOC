import { afterEach, describe, expect, it, vi } from "vitest"
import { StartupDependencyTimeoutError, withStartupDeadline } from "./startup"

describe("startup dependency deadlines", () => {
  afterEach(() => vi.useRealTimers())

  it("returns a dependency result before its deadline", async () => {
    await expect(withStartupDeadline("season recovery", Promise.resolve("ready"), 100)).resolves.toBe("ready")
  })

  it("preserves a dependency rejection", async () => {
    await expect(withStartupDeadline("season recovery", Promise.reject(new Error("offline")), 100)).rejects.toThrow("offline")
  })

  it("rejects a dependency that never settles", async () => {
    vi.useFakeTimers()
    const result = withStartupDeadline("season recovery", new Promise<never>(() => undefined), 100)
    const assertion = expect(result).rejects.toEqual(new StartupDependencyTimeoutError("season recovery", 100))

    await vi.advanceTimersByTimeAsync(100)
    await assertion
  })
})
