import type { MissionDefinition } from "./mission-definition"
import { SHERWOOD_SETTLEMENT_SITES, sherwoodTopologyHeightAt } from "./world-topology"
import { SHERWOOD_RIDGE_ROCK_LAYOUT } from "./world-ridge-rock-layout"

export interface RegionCell {
  index: number
  row: number
  column: number
  center: { x: number; z: number }
}

export type RegionalLayoutVariant = "long-haul" | "cross-river" | "same-bank" | "central-expedition"

export interface RegionalMissionLayout {
  seed: number
  variant: RegionalLayoutVariant
  gridSize: 5
  cellSize: number
  worldBounds: number
  campfireCell: RegionCell
  objectiveCell: RegionCell
  campfirePosition: { x: number; z: number }
  objectivePosition: { x: number; z: number }
  objectiveStockadeEnabled: boolean
  objectiveGatePosition: { x: number; z: number }
  objectiveGateKeyPosition: { x: number; z: number }
  objectiveGateRotation: number
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
/** Cell-center clearance leaves room for anchor jitter, the river, and a full road corridor. */
export const SHERWOOD_MISSION_ANCHOR_RIVER_CLEARANCE = 10
export const SHERWOOD_STOCKADE_MAX_HEIGHT_SPREAD = 0.65
export const SHERWOOD_STOCKADE_KEY_MIN_DISTANCE = 18
export const SHERWOOD_STOCKADE_KEY_MAX_DISTANCE = 28

export function sherwoodStockadeFootprintHeightSpread(
  position: Readonly<{ x: number; z: number }>,
  rotation: number,
): number {
  const cosine = Math.cos(rotation)
  const sine = Math.sin(rotation)
  const heights: number[] = []
  // This matches the stockade's authoritative 14 by 11 metre footprint.
  for (const localX of [-7, -3.5, 0, 3.5, 7]) {
    for (const localZ of [-5.5, -2.75, 0, 2.75, 5.5]) {
      heights.push(sherwoodTopologyHeightAt(
        position.x + cosine * localX + sine * localZ,
        position.z - sine * localX + cosine * localZ,
      ))
    }
  }
  return Math.max(...heights) - Math.min(...heights)
}

export function riverPointAt(z: number): { x: number; z: number } {
  return { x: SHERWOOD_RIVER_CENTER_X + SHERWOOD_RIVER_SLOPE * z, z }
}

function missionAnchorCellClearOfRiver(cell: RegionCell): boolean {
  return Math.abs(cell.center.x - SHERWOOD_RIVER_CENTER_X - SHERWOOD_RIVER_SLOPE * cell.center.z)
    >= SHERWOOD_MISSION_ANCHOR_RIVER_CLEARANCE
}

function isPerimeterCell(cell: RegionCell): boolean {
  return cell.row === 0
    || cell.column === 0
    || cell.row === SHERWOOD_GRID_SIZE - 1
    || cell.column === SHERWOOD_GRID_SIZE - 1
}

function cellDistance(left: RegionCell, right: RegionCell): number {
  return Math.abs(left.row - right.row) + Math.abs(left.column - right.column)
}

function riverSide(cell: RegionCell): -1 | 1 {
  return cell.center.x < riverPointAt(cell.center.z).x ? -1 : 1
}

function choose<T>(values: readonly T[], random: () => number): T {
  return values[Math.min(values.length - 1, Math.floor(random() * values.length))]
}

function orientPathToward(
  path: readonly { x: number; z: number }[],
  originalOrigin: { x: number; z: number },
  regionalOrigin: { x: number; z: number },
  target: { x: number; z: number },
): Array<{ x: number; z: number }> {
  const final = path[path.length - 1] ?? originalOrigin
  const originalLength = Math.max(0.001, Math.hypot(final.x - originalOrigin.x, final.z - originalOrigin.z))
  const targetLength = Math.max(0.001, Math.hypot(target.x - regionalOrigin.x, target.z - regionalOrigin.z))
  const originalDirection = {
    x: (final.x - originalOrigin.x) / originalLength,
    z: (final.z - originalOrigin.z) / originalLength,
  }
  const targetDirection = {
    x: (target.x - regionalOrigin.x) / targetLength,
    z: (target.z - regionalOrigin.z) / targetLength,
  }
  const cosine = originalDirection.x * targetDirection.x + originalDirection.z * targetDirection.z
  const sine = originalDirection.x * targetDirection.z - originalDirection.z * targetDirection.x
  return path.map((position) => {
    const relativeX = position.x - originalOrigin.x
    const relativeZ = position.z - originalOrigin.z
    return {
      x: regionalOrigin.x + relativeX * cosine - relativeZ * sine,
      z: regionalOrigin.z + relativeX * sine + relativeZ * cosine,
    }
  })
}

function chooseAnchorCells(
  anchorCells: readonly RegionCell[],
  objectiveAnchorCells: readonly RegionCell[],
  variant: RegionalLayoutVariant,
  random: () => number,
): { campfireCell: RegionCell; objectiveCell: RegionCell } {
  const perimeterCells = anchorCells.filter(isPerimeterCell)
  const interiorCells = anchorCells.filter((cell) => !isPerimeterCell(cell))
  const campfireCell = choose(
    variant === "central-expedition" && interiorCells.length > 0 ? interiorCells : perimeterCells,
    random,
  )
  const distance = (cell: RegionCell): number => cellDistance(cell, campfireCell)
  let objectiveCandidates: readonly RegionCell[]

  if (variant === "long-haul") {
    const farthest = Math.max(...objectiveAnchorCells.map(distance))
    objectiveCandidates = objectiveAnchorCells.filter((cell) => distance(cell) === farthest)
  } else if (variant === "cross-river") {
    objectiveCandidates = objectiveAnchorCells.filter((cell) => (
      riverSide(cell) !== riverSide(campfireCell) && distance(cell) >= 3
    ))
  } else if (variant === "same-bank") {
    objectiveCandidates = objectiveAnchorCells.filter((cell) => (
      riverSide(cell) === riverSide(campfireCell)
      && distance(cell) >= 2
      && distance(cell) <= 4
    ))
  } else {
    objectiveCandidates = objectiveAnchorCells.filter((cell) => isPerimeterCell(cell) && distance(cell) >= 3)
  }

  const usableCandidates = objectiveCandidates.length > 0
    ? objectiveCandidates
    : objectiveAnchorCells.filter((cell) => cell.index !== campfireCell.index && distance(cell) >= 2)
  return { campfireCell, objectiveCell: choose(usableCandidates, random) }
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

function flatStockadeSites(): typeof SHERWOOD_SETTLEMENT_SITES {
  return SHERWOOD_SETTLEMENT_SITES.filter((site) => (
    sherwoodStockadeFootprintHeightSpread(site.center, 0) <= SHERWOOD_STOCKADE_MAX_HEIGHT_SPREAD
    && SHERWOOD_RIDGE_ROCK_LAYOUT.every((rock) => (
      Math.hypot(site.center.x - rock.x, site.center.z - rock.z) >= 11.5
    ))
  ))
}

function stockadePositionInCell(
  cell: RegionCell,
  campfirePosition: Readonly<{ x: number; z: number }>,
): { x: number; z: number } {
  const candidates = flatStockadeSites().filter((site) => regionCellIndexAt(site.center) === cell.index)
  const scored = candidates.map((site) => {
    const rotation = Math.atan2(
      campfirePosition.x - site.center.x,
      campfirePosition.z - site.center.z,
    )
    return { site, spread: sherwoodStockadeFootprintHeightSpread(site.center, rotation) }
  }).sort((left, right) => left.spread - right.spread || left.site.id.localeCompare(right.site.id))
  return { ...scored[0].site.center }
}

function localTerrainSpread(position: Readonly<{ x: number; z: number }>): number {
  const heights = [-0.8, 0, 0.8].flatMap((x) => [-0.8, 0, 0.8].map((z) => (
    sherwoodTopologyHeightAt(position.x + x, position.z + z)
  )))
  return Math.max(...heights) - Math.min(...heights)
}

function chooseStockadeKeyPosition(
  objectivePosition: Readonly<{ x: number; z: number }>,
  campfirePosition: Readonly<{ x: number; z: number }>,
  seed: number,
): { x: number; z: number } {
  const approachAngle = Math.atan2(
    campfirePosition.z - objectivePosition.z,
    campfirePosition.x - objectivePosition.x,
  )
  const phase = ((seed >>> 0) % 16) * Math.PI / 8
  const candidates = [22, 26].flatMap((radius) => Array.from({ length: 16 }, (_, index) => {
    const angle = approachAngle + phase + index * Math.PI / 8
    const position = {
      x: objectivePosition.x + Math.cos(angle) * radius,
      z: objectivePosition.z + Math.sin(angle) * radius,
    }
    return { position, radius, index, terrainSpread: localTerrainSpread(position) }
  })).filter(({ position }) => (
    Math.abs(position.x) <= SHERWOOD_REGIONAL_BOUNDS - 3
    && Math.abs(position.z) <= SHERWOOD_REGIONAL_BOUNDS - 3
    && Math.hypot(position.x - campfirePosition.x, position.z - campfirePosition.z) >= 18
    && Math.abs(position.x - SHERWOOD_RIVER_CENTER_X - SHERWOOD_RIVER_SLOPE * position.z) >= 6
  )).sort((left, right) => (
    left.terrainSpread - right.terrainSpread
    || Math.abs(left.radius - 22) - Math.abs(right.radius - 22)
    || left.index - right.index
  ))
  return { ...candidates[0].position }
}

export function regionalizeMissionDefinition(base: MissionDefinition, seed: number): RegionalizedMission {
  const random = seededUnit(seed)
  const cells = sherwoodRegionCells()
  const anchorCells = cells.filter(missionAnchorCellClearOfRiver)
  const variants: readonly RegionalLayoutVariant[] = ["long-haul", "cross-river", "same-bank", "central-expedition"]
  const variant = choose(variants, random)
  const objectiveStockadeEnabled = base.scenario === undefined
  const stockadeCellIndices = new Set(flatStockadeSites().map((site) => regionCellIndexAt(site.center)))
  const objectiveAnchorCells = objectiveStockadeEnabled
    ? anchorCells.filter((cell) => stockadeCellIndices.has(cell.index))
    : anchorCells
  const { campfireCell, objectiveCell } = chooseAnchorCells(anchorCells, objectiveAnchorCells, variant, random)
  const campfirePosition = jittered(campfireCell, random)
  const objectivePosition = objectiveStockadeEnabled
    ? stockadePositionInCell(objectiveCell, campfirePosition)
    : jittered(objectiveCell, random)
  const approachLength = Math.max(
    0.001,
    Math.hypot(campfirePosition.x - objectivePosition.x, campfirePosition.z - objectivePosition.z),
  )
  const objectiveApproach = {
    x: (campfirePosition.x - objectivePosition.x) / approachLength,
    z: (campfirePosition.z - objectivePosition.z) / approachLength,
  }
  const objectiveGateRotation = Math.atan2(objectiveApproach.x, objectiveApproach.z)
  const objectiveGatePosition = {
    x: objectivePosition.x + objectiveApproach.x * 5.5,
    z: objectivePosition.z + objectiveApproach.z * 5.5,
  }
  const objectiveGateKeyPosition = objectiveStockadeEnabled
    ? chooseStockadeKeyPosition(objectivePosition, campfirePosition, seed)
    : { ...objectiveGatePosition }
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
  const sheriffLootPositions = base.scenario?.kind === "storehouse"
    ? base.scenario.lootCaches.map((cache) => offset(cache.position, originalObjective, objectivePosition))
    : [{ ...objectivePosition }]
  const guardPosts = [
    ...sheriffLootPositions,
    ...(objectiveStockadeEnabled ? [objectiveGateKeyPosition] : []),
    { x: crossingPositions[0].x + 4.8, z: crossingPositions[0].z + 1.8 },
    { x: crossingPositions[1].x - 4.8, z: crossingPositions[1].z - 1.8 },
    { x: (campfirePosition.x + objectivePosition.x) / 2 + 3, z: (campfirePosition.z + objectivePosition.z) / 2 - 3 },
  ].map(keepAwayFromCamp)
  const occupiedGuardCells = new Set(guardPosts.map(regionCellIndexAt))
  const targetGuardCells = Math.max(occupiedGuardCells.size, 4 + Math.floor(random() * 4))
  const patrolCandidates = cells
    .filter((cell) => cell.index !== campfireCell.index && !occupiedGuardCells.has(cell.index))
    .sort(() => random() - 0.5)
  for (const cell of patrolCandidates) {
    if (occupiedGuardCells.size >= Math.min(7, targetGuardCells)) break
    const post = keepAwayFromCamp(jittered(cell, random))
    const postCell = regionCellIndexAt(post)
    if (postCell === campfireCell.index || occupiedGuardCells.has(postCell)) continue
    guardPosts.push(post)
    occupiedGuardCells.add(postCell)
  }
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
    // The authored route points west from its original spawn. Rotate that shape
    // toward the regional camp so perimeter objectives send the wagon into the
    // playable map instead of preserving an arbitrary out-of-bounds heading.
    definition.scenario.wagonPath = orientPathToward(
      base.scenario.wagonPath,
      originalObjective,
      objectivePosition,
      campfirePosition,
    )
  }
  if (definition.scenario?.kind === "storehouse" && base.scenario?.kind === "storehouse") {
    definition.scenario.alarmPanels = base.scenario.alarmPanels.map((alarm) => ({ ...alarm, position: offset(alarm.position, originalObjective, objectivePosition) }))
    definition.scenario.lootCaches = base.scenario.lootCaches.map((cache) => ({ ...cache, position: offset(cache.position, originalObjective, objectivePosition) }))
    definition.scenario.disguisePosition = offset(base.scenario.disguisePosition, originalObjective, objectivePosition)
    disguisePosition = { ...definition.scenario.disguisePosition }
  }

  const layout: RegionalMissionLayout = {
    seed,
    variant,
    gridSize: SHERWOOD_GRID_SIZE,
    cellSize: SHERWOOD_CELL_SIZE,
    worldBounds: SHERWOOD_REGIONAL_BOUNDS,
    campfireCell: cloneCell(campfireCell),
    objectiveCell: cloneCell(objectiveCell),
    campfirePosition: { ...campfirePosition },
    objectivePosition: { ...objectivePosition },
    objectiveStockadeEnabled,
    objectiveGatePosition: { ...objectiveGatePosition },
    objectiveGateKeyPosition: { ...objectiveGateKeyPosition },
    objectiveGateRotation,
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
