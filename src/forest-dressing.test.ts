import { describe, expect, it } from "vitest"
import { createForestDressing } from "./forest-dressing"

describe("forest dressing", () => {
  it("creates a dense instanced forest floor without hundreds of draw objects", () => {
    const dressing = createForestDressing({ seed: 7 })
    expect(dressing.instanceCount).toBeGreaterThanOrEqual(500)
    expect(dressing.group.children).toHaveLength(5)
  })

  it("uses a smaller deterministic population for degraded rendering", () => {
    const full = createForestDressing({ seed: 7 })
    const degraded = createForestDressing({ seed: 7, degraded: true })
    expect(degraded.instanceCount).toBeLessThan(full.instanceCount)
    expect(degraded.instanceCount).toBeGreaterThan(200)
  })
})

