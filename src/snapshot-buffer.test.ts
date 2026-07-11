import { describe, expect, it } from "vitest"
import { SnapshotBuffer } from "./snapshot-buffer"

describe("SnapshotBuffer", () => {
  it("interpolates behind the latest server snapshot", () => {
    const buffer = new SnapshotBuffer(100)
    buffer.push({ x: 0, z: 0 }, 1_000)
    buffer.push({ x: 10, z: 4 }, 1_200)
    expect(buffer.sample(1_200)).toEqual({ x: 5, z: 2 })
  })

  it("orders jittered arrivals and clamps outside the buffered range", () => {
    const buffer = new SnapshotBuffer(100)
    buffer.push({ x: 10, z: 0 }, 1_200)
    buffer.push({ x: 0, z: 0 }, 1_000)
    expect(buffer.sample(900)).toEqual({ x: 0, z: 0 })
    expect(buffer.sample(1_500)).toEqual({ x: 10, z: 0 })
  })
})
