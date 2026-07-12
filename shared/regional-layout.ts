import type { MissionDefinition } from "./mission-definition"

export interface RegionCell {
  index: number
  row: number
  column: number
  center: { x: number; z: number }
}

export interface RegionalMissionLayout {
  gridSize: 5
  cellSize: number
  worldBounds: number
  campfireCell: RegionCell
  objectiveCell: RegionCell
  campfirePosition: { x: number; z: number }
  objectivePosition: { x: number; z: number }
  crossingPositions: [{ x: number; z: number }, { x: number; z: number }]
  guardPositions: Array<{ x: number; z: number }>
  bowCachePositions: Array<{ x: number; z: number }>
  reinforcementSignalPosition: { x: number; z: number }
  disguisePosition: { x: number; z: number }
  playerSpawns: Array<{ x: number; z: number }>
}

export interface RegionalizedMission {
  definition: MissionDefinition
  layout: RegionalMissionLayout
}

export const SHERWOOD_GRID_SIZE = 5 as const
export const SHERWOOD_CELL_SIZE = 26
export const SHERWOOD_REGIONAL_BOUNDS = 67
export const SHERWOOD_RIVER_CENTER_X = 1
export const SHERWOOD_RIVER_SLOPE = -0.1

export function riverPointAt(z: number): { x: number; z: number } {
  return { x: SHERWOOD_RIVER_CENTER_X + SHERWOOD_RIVER_SLOPE * z, z }
}

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
  const centerOffset = (SHERWOOD_GRID_SIZE - 1) / 2
  return Object.freeze(Array.from({ length: SHERWOOD_GRID_SIZE ** 2 }, (_, index) => {
    const row = Math.floor(index / SHERWOOD_GRID_SIZE)
    const column = index % SHERWOOD_GRID_SIZE
    return Object.freeze({
      index,
      row,
      column,
      center: Object.freeze({ x: (column - centerOffset) * SHERWOOD_CELL_SIZE, z: (row - centerOffset) * SHERWOOD_CELL_SIZE }),
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
  const campfireCandidates = cells.filter((cell) => cell.row === 0 || cell.column === 0 || cell.row === SHERWOOD_GRID_SIZE - 1 || cell.column === SHERWOOD_GRID_SIZE - 1)
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
  const crossingBands = [-42, -26, -10, 10, 26, 42]
  const firstCrossingIndex = Math.floor(random() * (crossingBands.length - 2))
  const secondCandidates = crossingBands.filter((_, index) => Math.abs(index - firstCrossingIndex) >= 2)
  const crossingZs = [crossingBands[firstCrossingIndex], secondCandidates[Math.floor(random() * secondCandidates.length)]].sort((left, right) => left - right)
  const crossingPositions = crossingZs.map((value) => riverPointAt(value + (random() - 0.5) * 5)) as RegionalMissionLayout["crossingPositions"]

  const definition = structuredClone(base)
  const originalCampfire = base.spawns.village
  const originalObjective = base.spawns.cart
  definition.spawns.village = { ...campfirePosition }
  definition.spawns.cart = { ...objectivePosition }
  definition.spawns.players = base.spawns.players.map((position) => offset(position, originalCampfire, campfirePosition))
  definition.spawns.reinforcementSignal = offset(base.spawns.reinforcementSignal, originalObjective, objectivePosition)
  const keepAwayFromCamp = (point: { x: number; z: number }): { x: number; z: number } => {
    let resolved = point
    for (const safeZone of [{ center: campfirePosition, radius: 25 }, { center: { x: -8, z: 7 }, radius: 16 }]) {
      const x = resolved.x - safeZone.center.x
      const z = resolved.z - safeZone.center.z
      const length = Math.max(0.001, Math.hypot(x, z))
      if (length < safeZone.radius) resolved = { x: safeZone.center.x + (x / length) * safeZone.radius, z: safeZone.center.z + (z / length) * safeZone.radius }
    }
    return resolved
  }
  const guardPosts = [
    { x: objectivePosition.x + 5.5, z: objectivePosition.z - 3.5 },
    { x: crossingPositions[0].x + 4.8, z: crossingPositions[0].z + 1.8 },
    { x: crossingPositions[1].x - 4.8, z: crossingPositions[1].z - 1.8 },
    { x: (campfirePosition.x + objectivePosition.x) / 2 + 3, z: (campfirePosition.z + objectivePosition.z) / 2 - 3 },
  ].map(keepAwayFromCamp)
  const guardPositions = guardPosts.flatMap((post, postIndex) => Array.from({ length: 3 }, (_, guardIndex) => {
    const angle = postIndex * 1.7 + guardIndex * (Math.PI * 2 / 3)
    return { x: post.x + Math.cos(angle) * 1.8, z: post.z + Math.sin(angle) * 1.8 }
  }))
  definition.spawns.guards = guardPositions.map((position, index) => ({
    ...(base.spawns.guards[index % base.spawns.guards.length]),
    id: index,
    position: { ...position },
  }))
  const bowCachePositions = cells
    .filter((cell) => cell.index !== campfireCell.index && cell.index !== objectiveCell.index)
    .sort(() => random() - 0.5)
    .slice(0, 4)
    .map((cell) => jittered(cell, random))
  definition.routes.entry = base.routes.entry.map((route) => ({ ...route, position: radialOffset(route.position, originalObjective, objectivePosition, 7) }))
  definition.routes.escape = base.routes.escape.map((route) => ({ ...route, position: radialOffset(route.position, originalCampfire, campfirePosition, 7) }))
  const nearestCrossing = (point: { x: number; z: number }): { x: number; z: number } => [...crossingPositions]
    .sort((left, right) => Math.hypot(point.x - left.x, point.z - left.z) - Math.hypot(point.x - right.x, point.z - right.z))[0]
  const entryRiver = definition.routes.entry.find((route) => route.id === "river")
  const escapeRiver = definition.routes.escape.find((route) => route.id === "river")
  if (entryRiver) entryRiver.position = { ...nearestCrossing(objectivePosition) }
  if (escapeRiver) escapeRiver.position = { ...nearestCrossing(campfirePosition) }
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
    crossingPositions: crossingPositions.map((position) => ({ ...position })) as RegionalMissionLayout["crossingPositions"],
    guardPositions: definition.spawns.guards.map((guard) => ({ ...guard.position })),
    bowCachePositions: bowCachePositions.map((position) => ({ ...position })),
    reinforcementSignalPosition: { ...definition.spawns.reinforcementSignal },
    disguisePosition,
    playerSpawns: definition.spawns.players.map((position) => ({ ...position })),
  }
  return { definition, layout }
}

export function regionCellIndexAt(position: { x: number; z: number }): number {
  const span = SHERWOOD_GRID_SIZE * SHERWOOD_CELL_SIZE
  const column = Math.max(0, Math.min(SHERWOOD_GRID_SIZE - 1, Math.floor((position.x + span / 2) / SHERWOOD_CELL_SIZE)))
  const row = Math.max(0, Math.min(SHERWOOD_GRID_SIZE - 1, Math.floor((position.z + span / 2) / SHERWOOD_CELL_SIZE)))
  return row * SHERWOOD_GRID_SIZE + column
}
