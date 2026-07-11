import type { MissionDefinition } from "./mission-definition"

export interface RegionCell {
  index: number
  row: 0 | 1 | 2
  column: 0 | 1 | 2
  center: { x: number; z: number }
}

export interface RegionalMissionLayout {
  gridSize: 3
  cellSize: number
  worldBounds: number
  campfireCell: RegionCell
  objectiveCell: RegionCell
  campfirePosition: { x: number; z: number }
  objectivePosition: { x: number; z: number }
  reinforcementSignalPosition: { x: number; z: number }
  disguisePosition: { x: number; z: number }
  playerSpawns: Array<{ x: number; z: number }>
}

export interface RegionalizedMission {
  definition: MissionDefinition
  layout: RegionalMissionLayout
}

export const SHERWOOD_GRID_SIZE = 3 as const
export const SHERWOOD_CELL_SIZE = 30
export const SHERWOOD_REGIONAL_BOUNDS = 47

export function seededUnit(seed: number): () => number {
  let value = seed || 1
  return () => {
    value = (value * 16807) % 2147483647
    return (value - 1) / 2147483646
  }
}

export function stableSeed(value: string): number {
  let seed = 2166136261
  for (const character of value) seed = Math.imul(seed ^ character.charCodeAt(0), 16777619)
  return seed >>> 0
}

export function sherwoodRegionCells(): readonly RegionCell[] {
  return Object.freeze(Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3) as 0 | 1 | 2
    const column = (index % 3) as 0 | 1 | 2
    return Object.freeze({
      index,
      row,
      column,
      center: Object.freeze({ x: (column - 1) * SHERWOOD_CELL_SIZE, z: (row - 1) * SHERWOOD_CELL_SIZE }),
    })
  }))
}

function offset(point: { x: number; z: number }, origin: { x: number; z: number }, target: { x: number; z: number }): { x: number; z: number } {
  return { x: target.x + point.x - origin.x, z: target.z + point.z - origin.z }
}

function radialOffset(point: { x: number; z: number }, origin: { x: number; z: number }, target: { x: number; z: number }, radius: number): { x: number; z: number } {
  const x = point.x - origin.x
  const z = point.z - origin.z
  const length = Math.max(0.001, Math.hypot(x, z))
  return { x: target.x + (x / length) * radius, z: target.z + (z / length) * radius }
}

function jittered(cell: RegionCell, random: () => number): { x: number; z: number } {
  return {
    x: cell.center.x + (random() - 0.5) * 6,
    z: cell.center.z + (random() - 0.5) * 6,
  }
}

function cloneCell(cell: RegionCell): RegionCell {
  return { ...cell, center: { ...cell.center } }
}

export function regionalizeMissionDefinition(base: MissionDefinition, seed: number): RegionalizedMission {
  const random = seededUnit(seed)
  const cells = sherwoodRegionCells()
  const campfireCandidates = cells.filter((cell) => cell.index !== 4)
  const campfireCell = campfireCandidates[Math.floor(random() * campfireCandidates.length)]
  const distances = cells.map((cell) => ({
    cell,
    distance: Math.abs(cell.row - campfireCell.row) + Math.abs(cell.column - campfireCell.column),
  }))
  const farthest = Math.max(...distances.map(({ distance }) => distance))
  const objectiveCandidates = distances.filter(({ distance }) => distance === farthest).map(({ cell }) => cell)
  const objectiveCell = objectiveCandidates[Math.floor(random() * objectiveCandidates.length)]
  const campfirePosition = jittered(campfireCell, random)
  const objectivePosition = jittered(objectiveCell, random)

  const definition = structuredClone(base)
  const originalCampfire = base.spawns.village
  const originalObjective = base.spawns.cart
  definition.spawns.village = { ...campfirePosition }
  definition.spawns.cart = { ...objectivePosition }
  definition.spawns.players = base.spawns.players.map((position) => offset(position, originalCampfire, campfirePosition))
  definition.spawns.reinforcementSignal = offset(base.spawns.reinforcementSignal, originalObjective, objectivePosition)
  definition.spawns.guards = base.spawns.guards.map((guard) => ({
    ...guard,
    position: offset(guard.position, originalObjective, objectivePosition),
  }))
  definition.routes.entry = base.routes.entry.map((route) => ({ ...route, position: radialOffset(route.position, originalObjective, objectivePosition, 7) }))
  definition.routes.escape = base.routes.escape.map((route) => ({ ...route, position: radialOffset(route.position, originalCampfire, campfirePosition, 7) }))
  definition.rules.worldBounds = SHERWOOD_REGIONAL_BOUNDS

  let disguisePosition = { ...objectivePosition }
  if (definition.scenario?.kind === "prison-wagon" && base.scenario?.kind === "prison-wagon") {
    definition.scenario.wagonPath = base.scenario.wagonPath.map((position) => offset(position, originalObjective, objectivePosition))
  }
  if (definition.scenario?.kind === "storehouse" && base.scenario?.kind === "storehouse") {
    definition.scenario.alarmPanels = base.scenario.alarmPanels.map((alarm) => ({ ...alarm, position: offset(alarm.position, originalObjective, objectivePosition) }))
    definition.scenario.lootCaches = base.scenario.lootCaches.map((cache) => ({ ...cache, position: offset(cache.position, originalObjective, objectivePosition) }))
    definition.scenario.disguisePosition = offset(base.scenario.disguisePosition, originalObjective, objectivePosition)
    disguisePosition = { ...definition.scenario.disguisePosition }
  }

  const layout: RegionalMissionLayout = {
    gridSize: SHERWOOD_GRID_SIZE,
    cellSize: SHERWOOD_CELL_SIZE,
    worldBounds: SHERWOOD_REGIONAL_BOUNDS,
    campfireCell: cloneCell(campfireCell),
    objectiveCell: cloneCell(objectiveCell),
    campfirePosition: { ...campfirePosition },
    objectivePosition: { ...objectivePosition },
    reinforcementSignalPosition: { ...definition.spawns.reinforcementSignal },
    disguisePosition,
    playerSpawns: definition.spawns.players.map((position) => ({ ...position })),
  }
  return { definition, layout }
}
