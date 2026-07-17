import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { getMissionDefinition } from "../shared/mission-catalog"
import type { MissionDefinition } from "../shared/mission-definition"
import {
  MAP_QUALITY_DIMENSIONS,
  evaluateRegionalMapQuality,
  selectNondominatedMapCandidates,
  type MapQualityEvidence,
  type MapQualityVector,
} from "../shared/map-quality"
import type { RegionalizedMission, RegionalMissionLayout } from "../shared/regional-layout"
import { stableSeed } from "../shared/regional-layout"
import {
  RegionalMapGenerationError,
  regionalizeFeasibleMissionDefinition,
  type RegionalMapGenerationReport,
} from "../shared/regional-map-generator"
import { composeSherwoodWorld, type ComposedWorld } from "../shared/world-composer"

export const REGIONAL_MAP_BAKER_VERSION = "regional-map-baker@1"

export interface RegionalMapBakeOptions {
  candidateCount?: number
  portfolioSize?: number
  seedNamespace?: string
}

export interface BakedRegionalMapCandidate {
  requestedSeed: number
  layoutSeed: number
  attempts: number
  fingerprint: string
  quality: MapQualityVector
  evidence: MapQualityEvidence
  layout: {
    campfireCell: number
    objectiveCell: number
    campfirePosition: { x: number; z: number }
    objectivePosition: { x: number; z: number }
    crossingPositions: Array<{ x: number; z: number }>
    playerSpawns: Array<{ x: number; z: number }>
    guardPositions: Array<{ x: number; z: number }>
    bowCachePositions: Array<{ x: number; z: number }>
  }
}

export interface RegionalMapBakeFailure {
  requestedSeed: number
  code: string
  diagnosticCodes: string[]
}

export interface RegionalMapPortfolioManifest {
  schemaVersion: 1
  generatorVersion: string
  status: "curation-candidate"
  mission: {
    id: string
    slug: string
    missionVersion: string
    contentHash: string
  }
  seedNamespace: string
  requestedCandidateCount: number
  feasibleCandidateCount: number
  uniqueCandidateCount: number
  nondominatedCandidateCount: number
  failedCandidates: RegionalMapBakeFailure[]
  qualityDimensions: readonly string[]
  baselineFingerprint: string
  portfolio: BakedRegionalMapCandidate[]
  manifestHash: string
}

export interface RegionalMapBakeResult {
  manifest: RegionalMapPortfolioManifest
  manifestJson: string
  contactSheetSvg: string
}

interface ScoredRegionalMap {
  requestedSeed: number
  regional: RegionalizedMission
  generation: RegionalMapGenerationReport
  world: ComposedWorld
  fingerprint: string
  quality: MapQualityVector
  evidence: MapQualityEvidence
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.floor(value!)))
}

function candidateSeed(seedNamespace: string, index: number): number {
  return stableSeed(`${seedNamespace}:candidate:${index}`)
}

function bakedCandidate(candidate: ScoredRegionalMap): BakedRegionalMapCandidate {
  const { layout } = candidate.regional
  return {
    requestedSeed: candidate.requestedSeed,
    layoutSeed: candidate.generation.layoutSeed,
    attempts: candidate.generation.attempts,
    fingerprint: candidate.fingerprint,
    quality: { ...candidate.quality },
    evidence: structuredClone(candidate.evidence),
    layout: {
      campfireCell: layout.campfireCell.index,
      objectiveCell: layout.objectiveCell.index,
      campfirePosition: { ...layout.campfirePosition },
      objectivePosition: { ...layout.objectivePosition },
      crossingPositions: layout.crossingPositions.map((position) => ({ ...position })),
      playerSpawns: layout.playerSpawns.map((position) => ({ ...position })),
      guardPositions: layout.guardPositions.map((position) => ({ ...position })),
      bowCachePositions: layout.bowCachePositions.map((position) => ({ ...position })),
    },
  }
}

/**
 * Caps a Pareto archive without inventing a weighted total. Selection rotates
 * through individual quality dimensions, taking the strongest remaining
 * candidate on each dimension with deterministic fingerprint tie-breaking.
 */
export function selectCurationPortfolio<T extends { fingerprint: string; quality: MapQualityVector }>(
  candidates: readonly T[],
  limit: number,
): T[] {
  const archive = selectNondominatedMapCandidates(candidates)
  const selected: T[] = []
  const selectedFingerprints = new Set<string>()
  while (selected.length < Math.min(limit, archive.length)) {
    let addedThisPass = false
    for (const dimension of MAP_QUALITY_DIMENSIONS) {
      const candidate = [...archive]
        .filter(({ fingerprint }) => !selectedFingerprints.has(fingerprint))
        .sort((left, right) => (
          right.quality[dimension] - left.quality[dimension]
            || left.fingerprint.localeCompare(right.fingerprint)
        ))[0]
      if (!candidate) continue
      selected.push(candidate)
      selectedFingerprints.add(candidate.fingerprint)
      addedThisPass = true
      if (selected.length >= limit) break
    }
    if (!addedThisPass) break
  }
  return selected
}

function manifestHash(value: Omit<RegionalMapPortfolioManifest, "manifestHash">): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character]!)
}

function compactQuality(vector: MapQualityVector): string {
  const labels: Record<keyof MapQualityVector, string> = {
    traversalFairness: "TF",
    routeChoice: "RC",
    riskRewardDistribution: "RR",
    pacingShape: "PS",
    landmarkLegibility: "LL",
    cooperationCoverage: "CO",
    novelty: "NV",
  }
  return MAP_QUALITY_DIMENSIONS.map((dimension) => (
    `${labels[dimension]} ${vector[dimension].toFixed(2)}`
  )).join(" · ")
}

function polyline(points: readonly { x: number; z: number }[], project: (point: { x: number; z: number }) => { x: number; y: number }): string {
  return points.map((point) => {
    const projected = project(point)
    return `${projected.x.toFixed(1)},${projected.y.toFixed(1)}`
  }).join(" ")
}

function renderCandidatePanel(
  candidate: ScoredRegionalMap,
  index: number,
  x: number,
  y: number,
  panelWidth: number,
  panelHeight: number,
): string {
  const mapInset = 18
  const titleHeight = 48
  const mapSize = Math.min(panelWidth - mapInset * 2, panelHeight - titleHeight - 34)
  const mapX = x + (panelWidth - mapSize) / 2
  const mapY = y + titleHeight
  const bounds = candidate.regional.layout.worldBounds
  const project = (point: { x: number; z: number }): { x: number; y: number } => ({
    x: mapX + ((point.x + bounds) / (bounds * 2)) * mapSize,
    y: mapY + ((point.z + bounds) / (bounds * 2)) * mapSize,
  })
  const layout = candidate.regional.layout
  const riverStart = project({ x: 1 - 0.1 * -bounds, z: -bounds })
  const riverEnd = project({ x: 1 - 0.1 * bounds, z: bounds })
  const camp = project(layout.campfirePosition)
  const objective = project(layout.objectivePosition)
  const gridLines = Array.from({ length: 6 }, (_, gridIndex) => {
    const amount = gridIndex / 5
    const gx = mapX + mapSize * amount
    const gy = mapY + mapSize * amount
    return `<path d="M ${gx.toFixed(1)} ${mapY.toFixed(1)} V ${(mapY + mapSize).toFixed(1)} M ${mapX.toFixed(1)} ${gy.toFixed(1)} H ${(mapX + mapSize).toFixed(1)}" />`
  }).join("")
  const roads = candidate.world.roads.map((road) => (
    `<polyline points="${polyline(road.points, project)}" class="road road-${road.width >= 3 ? "major" : "minor"}" />`
  )).join("")
  const settlements = candidate.world.settlements.map((settlement) => {
    const center = project(settlement.center)
    return `<rect x="${(center.x - 3.5).toFixed(1)}" y="${(center.y - 3.5).toFixed(1)}" width="7" height="7" class="settlement"><title>${escapeXml(settlement.kind)}</title></rect>`
  }).join("")
  const guards = layout.guardPositions.map((position) => {
    const point = project(position)
    return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="1.8" class="guard" />`
  }).join("")
  const caches = layout.bowCachePositions.map((position) => {
    const point = project(position)
    return `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="2.7" class="cache" />`
  }).join("")
  const crossings = layout.crossingPositions.map((position) => {
    const point = project(position)
    return `<rect x="${(point.x - 3).toFixed(1)}" y="${(point.y - 2).toFixed(1)}" width="6" height="4" class="crossing" />`
  }).join("")
  return `
    <g class="panel">
      <rect x="${x}" y="${y}" width="${panelWidth}" height="${panelHeight}" rx="8" class="panel-bg" />
      <text x="${x + 16}" y="${y + 20}" class="panel-title">${index + 1}. seed ${candidate.generation.layoutSeed} · ${candidate.fingerprint}</text>
      <text x="${x + 16}" y="${y + 38}" class="quality">${escapeXml(compactQuality(candidate.quality))}</text>
      <rect x="${mapX}" y="${mapY}" width="${mapSize}" height="${mapSize}" class="map-bg" />
      <g class="grid">${gridLines}</g>
      <line x1="${riverStart.x.toFixed(1)}" y1="${riverStart.y.toFixed(1)}" x2="${riverEnd.x.toFixed(1)}" y2="${riverEnd.y.toFixed(1)}" class="river" />
      ${roads}
      ${settlements}
      ${guards}
      ${caches}
      ${crossings}
      <circle cx="${camp.x.toFixed(1)}" cy="${camp.y.toFixed(1)}" r="5" class="camp"><title>campfire</title></circle>
      <path d="M ${objective.x.toFixed(1)} ${(objective.y - 6).toFixed(1)} L ${(objective.x + 6).toFixed(1)} ${objective.y.toFixed(1)} L ${objective.x.toFixed(1)} ${(objective.y + 6).toFixed(1)} L ${(objective.x - 6).toFixed(1)} ${objective.y.toFixed(1)} Z" class="objective"><title>objective</title></path>
    </g>`
}

export function renderRegionalMapContactSheet(
  mission: MissionDefinition,
  candidates: readonly ScoredRegionalMap[],
  manifestHashValue: string,
): string {
  const columns = 2
  const panelWidth = 520
  const panelHeight = 390
  const headerHeight = 104
  const rows = Math.max(1, Math.ceil(candidates.length / columns))
  const width = columns * panelWidth + 48
  const height = headerHeight + rows * panelHeight + 52
  const panels = candidates.map((candidate, index) => renderCandidatePanel(
    candidate,
    index,
    24 + (index % columns) * panelWidth,
    headerHeight + Math.floor(index / columns) * panelHeight,
    panelWidth - 12,
    panelHeight - 12,
  )).join("")
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <title>${escapeXml(mission.name)} regional map curation contact sheet</title>
  <style>
    .sheet-bg { fill: #0d2118; }
    .sheet-title { fill: #f7e8b2; font: 700 26px Georgia, serif; }
    .sheet-meta, .legend { fill: #bcd0bd; font: 12px ui-monospace, monospace; }
    .panel-bg { fill: #173629; stroke: #54755a; stroke-width: 1; }
    .panel-title { fill: #f7e8b2; font: 700 12px ui-monospace, monospace; }
    .quality { fill: #bcd0bd; font: 10px ui-monospace, monospace; }
    .map-bg { fill: #365c39; stroke: #86a16f; stroke-width: 1; }
    .grid path { fill: none; stroke: #9bb58a; stroke-opacity: .2; stroke-width: .7; }
    .river { stroke: #4f9fbd; stroke-width: 15; stroke-linecap: round; opacity: .8; }
    .road { fill: none; stroke: #c5ad78; stroke-linecap: round; stroke-linejoin: round; }
    .road-major { stroke-width: 3.8; }
    .road-minor { stroke-width: 2.4; stroke-dasharray: 4 2; }
    .settlement { fill: #d08445; stroke: #f1c47a; stroke-width: 1; }
    .guard { fill: #cf4c3f; stroke: #6d1f1a; stroke-width: .7; }
    .cache { fill: #efca49; stroke: #5e4a0b; stroke-width: .8; }
    .crossing { fill: #e6e0c0; stroke: #554e39; stroke-width: .8; }
    .camp { fill: #ff9f3f; stroke: #fff0b2; stroke-width: 1.5; }
    .objective { fill: #e44737; stroke: #ffe1b5; stroke-width: 1.2; }
  </style>
  <rect width="${width}" height="${height}" class="sheet-bg" />
  <text x="24" y="34" class="sheet-title">${escapeXml(mission.name)} · procedural map curation</text>
  <text x="24" y="57" class="sheet-meta">${escapeXml(REGIONAL_MAP_BAKER_VERSION)} · ${escapeXml(manifestHashValue)}</text>
  <text x="24" y="78" class="legend">● camp · ◆ objective · ▬ crossing · ■ settlement · red guard · gold cache · tan road</text>
  ${panels}
</svg>
`
}

export function bakeRegionalMapPortfolio(
  mission: MissionDefinition,
  options: RegionalMapBakeOptions = {},
): RegionalMapBakeResult {
  const candidateCount = boundedInteger(options.candidateCount, 64, 1, 1_000)
  const portfolioSize = boundedInteger(options.portfolioSize, 8, 1, 32)
  const seedNamespace = options.seedNamespace ?? `${mission.id}:${REGIONAL_MAP_BAKER_VERSION}`
  const generated: Array<{
    requestedSeed: number
    regional: ReturnType<typeof regionalizeFeasibleMissionDefinition>
  }> = []
  const failedCandidates: RegionalMapBakeFailure[] = []
  for (let index = 0; index < candidateCount; index += 1) {
    const requestedSeed = candidateSeed(seedNamespace, index)
    try {
      generated.push({
        requestedSeed,
        regional: regionalizeFeasibleMissionDefinition(mission, requestedSeed),
      })
    } catch (error) {
      if (!(error instanceof RegionalMapGenerationError)) throw error
      failedCandidates.push({
        requestedSeed,
        code: error.code,
        diagnosticCodes: [...new Set(error.rejectedCandidates.flatMap((candidate) => (
          candidate.diagnostics.map((diagnostic) => diagnostic.code)
        )))].sort(),
      })
    }
  }
  if (generated.length === 0) throw new Error(`No feasible regional map candidates for ${mission.slug}`)

  const referenceLayout = generated[0].regional.layout
  const uniqueByFingerprint = new Map<string, ScoredRegionalMap>()
  for (const { requestedSeed, regional } of generated) {
    const result = evaluateRegionalMapQuality(regional, { referenceLayouts: [referenceLayout] })
    if (uniqueByFingerprint.has(result.fingerprint)) continue
    uniqueByFingerprint.set(result.fingerprint, {
      requestedSeed,
      regional,
      generation: regional.generation,
      world: composeSherwoodWorld(regional.layout),
      fingerprint: result.fingerprint,
      quality: result.vector,
      evidence: result.evidence,
    })
  }
  const uniqueCandidates = [...uniqueByFingerprint.values()].sort((left, right) => (
    left.fingerprint.localeCompare(right.fingerprint)
  ))
  const nondominated = selectNondominatedMapCandidates(uniqueCandidates)
  const portfolio = selectCurationPortfolio(nondominated, portfolioSize)
  const withoutHash: Omit<RegionalMapPortfolioManifest, "manifestHash"> = {
    schemaVersion: 1,
    generatorVersion: REGIONAL_MAP_BAKER_VERSION,
    status: "curation-candidate",
    mission: {
      id: mission.id,
      slug: mission.slug,
      missionVersion: mission.missionVersion,
      contentHash: mission.contentHash,
    },
    seedNamespace,
    requestedCandidateCount: candidateCount,
    feasibleCandidateCount: generated.length,
    uniqueCandidateCount: uniqueCandidates.length,
    nondominatedCandidateCount: nondominated.length,
    failedCandidates,
    qualityDimensions: MAP_QUALITY_DIMENSIONS,
    baselineFingerprint: evaluateRegionalMapQuality(generated[0].regional, {
      referenceLayouts: [referenceLayout],
    }).fingerprint,
    portfolio: portfolio.map(bakedCandidate),
  }
  const hash = manifestHash(withoutHash)
  const manifest: RegionalMapPortfolioManifest = { ...withoutHash, manifestHash: hash }
  return {
    manifest,
    manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
    contactSheetSvg: renderRegionalMapContactSheet(mission, portfolio, hash),
  }
}

async function main(): Promise<void> {
  const slug = process.argv[2] ?? "peoples-purse"
  const candidateCount = process.argv[3] ? Number(process.argv[3]) : undefined
  const portfolioSize = process.argv[4] ? Number(process.argv[4]) : undefined
  const mission = getMissionDefinition(slug)
  const result = bakeRegionalMapPortfolio(mission, { candidateCount, portfolioSize })
  const outputDirectory = resolve("docs/maps")
  await mkdir(outputDirectory, { recursive: true })
  const baseName = `${mission.slug}-seed-candidates.v1`
  await Promise.all([
    writeFile(resolve(outputDirectory, `${baseName}.json`), result.manifestJson),
    writeFile(resolve(outputDirectory, `${baseName}.svg`), result.contactSheetSvg),
  ])
  console.log(
    `Baked ${result.manifest.portfolio.length} ${mission.slug} curation candidates `
      + `from ${result.manifest.feasibleCandidateCount}/${result.manifest.requestedCandidateCount} feasible requests `
      + `(${result.manifest.nondominatedCandidateCount} nondominated)`,
  )
  console.log(result.manifest.manifestHash)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
