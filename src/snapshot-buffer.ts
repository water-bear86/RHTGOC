import type { Vec2 } from "./simulation"

interface Snapshot {
  receivedAt: number
  position: Vec2
}

export class SnapshotBuffer {
  private readonly snapshots: Snapshot[] = []

  constructor(private readonly interpolationDelayMs = 140, private readonly maxSnapshots = 12) {}

  push(position: Vec2, receivedAt: number): void {
    this.snapshots.push({ position: { ...position }, receivedAt })
    this.snapshots.sort((a, b) => a.receivedAt - b.receivedAt)
    if (this.snapshots.length > this.maxSnapshots) this.snapshots.splice(0, this.snapshots.length - this.maxSnapshots)
  }

  sample(now: number): Vec2 | null {
    if (this.snapshots.length === 0) return null
    const renderTime = now - this.interpolationDelayMs
    while (this.snapshots.length > 2 && this.snapshots[1].receivedAt <= renderTime) this.snapshots.shift()
    const older = this.snapshots[0]
    const newer = this.snapshots[1]
    if (!newer) return { ...older.position }
    const duration = Math.max(1, newer.receivedAt - older.receivedAt)
    const alpha = Math.max(0, Math.min(1, (renderTime - older.receivedAt) / duration))
    return {
      x: older.position.x + (newer.position.x - older.position.x) * alpha,
      z: older.position.z + (newer.position.z - older.position.z) * alpha,
    }
  }
}
