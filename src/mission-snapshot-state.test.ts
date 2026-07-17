import { describe, expect, it } from "vitest"
import { PEOPLES_PURSE_MISSION } from "../shared/mission-catalog"
import { regionalizeMissionDefinition, stableSeed } from "../shared/regional-layout"
import type { MissionGuard } from "../shared/protocol"
import type { GuardState } from "./simulation"
import { selectRegionalMissionLayout, synchronizeMissionGuards } from "./mission-snapshot-state"

function layoutFixture() {
  return regionalizeMissionDefinition(PEOPLES_PURSE_MISSION, stableSeed("snapshot-state-test")).layout
}

function guard(id: number, x: number, stunnedFor = 0): GuardState {
  return {
    id,
    position: { x, z: x + 1 },
    home: { x: x - 2, z: x - 1 },
    patrolAngle: id * 0.5,
    stunnedFor,
    alertFor: id,
    lastKnownPosition: { x: x + 2, z: x + 3 },
  }
}

describe("mission snapshot state", () => {
  it("preserves the canonical layout identity when a decoded snapshot has equal values", () => {
    const current = layoutFixture()
    const decodedSnapshotLayout = structuredClone(current)

    expect(decodedSnapshotLayout).not.toBe(current)
    expect(selectRegionalMissionLayout(current, decodedSnapshotLayout)).toBe(current)
  })

  it("selects a new layout when a nested layout value changes", () => {
    const current = layoutFixture()
    const movedObjective = structuredClone(current)
    movedObjective.objectiveCell.center.x += 1

    expect(selectRegionalMissionLayout(current, movedObjective)).toBe(movedObjective)
  })

  it("fully shrinks, reorders, and updates guards to match the authoritative snapshot", () => {
    const first = guard(3, 3)
    const removed = guard(7, 7)
    const last = guard(11, 11)
    const authoritative: MissionGuard[] = [
      { id: 11, position: { x: 21, z: 22 }, stunnedFor: 2, alertFor: 4 },
      { id: 3, position: { x: 31, z: 32 }, stunnedFor: 0, alertFor: 1 },
    ]

    const synchronized = synchronizeMissionGuards([first, removed, last], authoritative)

    expect(synchronized.map(({ id }) => id)).toEqual([11, 3])
    expect(synchronized).not.toContain(removed)
    expect(synchronized[0]).not.toBe(last)
    expect(synchronized[0].position).toEqual({ x: 21, z: 22 })
    expect(synchronized[0].stunnedFor).toBe(2)
    expect(synchronized[0].alertFor).toBe(4)
    expect(synchronized[0].lastKnownPosition).toEqual(last.lastKnownPosition)
    expect(synchronized[0].home).toEqual(last.home)
    expect(synchronized[0].patrolAngle).toBe(last.patrolAngle)
    expect(synchronized[1]).not.toBe(first)
    expect(synchronized[1].position).toEqual({ x: 31, z: 32 })
    expect(first.position).toEqual({ x: 3, z: 4 })
  })

  it("initializes newly authoritative guards without retaining removed client state", () => {
    const synchronized = synchronizeMissionGuards(
      [guard(1, 1)],
      [{ id: 9, position: { x: -4, z: 8 }, stunnedFor: 1.5, alertFor: 0 }],
    )

    expect(synchronized).toEqual([{
      id: 9,
      position: { x: -4, z: 8 },
      home: { x: -4, z: 8 },
      patrolAngle: 0,
      stunnedFor: 1.5,
      alertFor: 0,
      lastKnownPosition: null,
    }])
  })
})
