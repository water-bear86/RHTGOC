import { describe, expect, it, vi } from "vitest"
import { syncGuardViewCount } from "./guard-view-pool"

describe("guard view pool", () => {
  it("creates a render view when search pressure adds a guard", () => {
    const views = [{ id: 0 }]
    const attach = vi.fn()
    syncGuardViewCount(views, 2, () => ({ id: views.length }), attach, vi.fn())
    expect(views).toEqual([{ id: 0 }, { id: 1 }])
    expect(attach).toHaveBeenCalledWith({ id: 1 })
  })

  it("detaches surplus views when authoritative guard state shrinks", () => {
    const views = [{ id: 0 }, { id: 1 }, { id: 2 }]
    const detach = vi.fn()
    syncGuardViewCount(views, 1, () => ({ id: 99 }), vi.fn(), detach)
    expect(views).toEqual([{ id: 0 }])
    expect(detach.mock.calls.map(([view]) => view.id)).toEqual([2, 1])
  })
})
