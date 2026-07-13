const DAY_MS = 24 * 60 * 60 * 1_000
const MAX_REPORT_RANGE_MS = 90 * DAY_MS
const DEFAULT_REPORT_LIMIT = 1_000
const MAX_REPORT_LIMIT = 5_000
const SECTION_LIMIT = 10
const PASS_THROUGH_SECONDS = 3

const SAFE_SLUG = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/
const SAFE_VERSION = /^[a-z0-9][a-z0-9._:-]*$/
const SAFE_BUILD_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export const GAMEPLAY_REPORT_COUNTERS = Object.freeze([
  "sampleCount",
  "entryCount",
  "dangerSampleCount",
  "objectiveInteractionCount",
  "downedCount",
  "stuckRecoveryCount",
  "clientErrorCount",
  "webglContextLostCount",
  "assetLoadFailedCount",
  "uncaughtErrorCount",
  "unhandledRejectionCount",
  "frameStallCount",
  "snapshotDesyncCount",
  "missionStartCount",
  "missionSuccessCount",
  "missionFailureCount",
])

// clientErrorCount is the umbrella total; the six specific diagnostics are breakdowns, not additions.
export const FIXED_BUG_COUNTERS = Object.freeze([
  "stuckRecoveryCount",
  "clientErrorCount",
])

function optionValue(argv, index, name) {
  const argument = argv[index]
  const prefix = `${name}=`
  if (argument.startsWith(prefix)) {
    const value = argument.slice(prefix.length)
    if (!value) throw new Error(`Missing value for ${name}`)
    return { value, consumed: 1 }
  }
  if (argument === name) {
    const value = argv[index + 1]
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${name}`)
    return { value, consumed: 2 }
  }
  return null
}

function parseTimestamp(value, label) {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) throw new Error(`${label} must be a valid timestamp`)
  return milliseconds
}

export function parseReportArgs(argv, nowMs = Date.now()) {
  if (!Array.isArray(argv)) throw new Error("Report arguments must be an array")
  if (!Number.isFinite(nowMs)) throw new Error("nowMs must be a finite timestamp")

  let sinceValue
  let untilValue
  let limit = DEFAULT_REPORT_LIMIT
  let json = false
  const seen = new Set()

  for (let index = 0; index < argv.length;) {
    if (argv[index] === "--json") {
      if (seen.has("json")) throw new Error("--json may only be provided once")
      seen.add("json")
      json = true
      index += 1
      continue
    }

    let parsed = optionValue(argv, index, "--since")
    if (parsed) {
      if (seen.has("since")) throw new Error("--since may only be provided once")
      seen.add("since")
      sinceValue = parsed.value
      index += parsed.consumed
      continue
    }

    parsed = optionValue(argv, index, "--until")
    if (parsed) {
      if (seen.has("until")) throw new Error("--until may only be provided once")
      seen.add("until")
      untilValue = parsed.value
      index += parsed.consumed
      continue
    }

    parsed = optionValue(argv, index, "--limit")
    if (parsed) {
      if (seen.has("limit")) throw new Error("--limit may only be provided once")
      seen.add("limit")
      if (!/^[0-9]+$/.test(parsed.value)) throw new Error("--limit must be an integer from 1 to 5000")
      limit = Number(parsed.value)
      index += parsed.consumed
      continue
    }

    throw new Error("Unknown gameplay analytics report argument")
  }

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REPORT_LIMIT) {
    throw new Error("--limit must be an integer from 1 to 5000")
  }

  const untilMs = untilValue === undefined ? nowMs : parseTimestamp(untilValue, "--until")
  const sinceMs = sinceValue === undefined ? untilMs - DAY_MS : parseTimestamp(sinceValue, "--since")
  const rangeMs = untilMs - sinceMs
  if (rangeMs <= 0) throw new Error("--until must be later than --since")
  if (rangeMs > MAX_REPORT_RANGE_MS) throw new Error("Gameplay analytics reports cannot span more than 90 days")

  return {
    since: new Date(sinceMs).toISOString(),
    until: new Date(untilMs).toISOString(),
    limit,
    json,
  }
}

function endpointFor(url) {
  if (typeof url !== "string" || url.trim().length === 0) throw new Error("SUPABASE_URL is required")
  try {
    const base = new URL(url)
    const isLocalHttp = base.protocol === "http:"
      && (base.hostname === "127.0.0.1" || base.hostname === "localhost" || base.hostname === "[::1]")
    if (base.protocol !== "https:" && !isLocalHttp) throw new Error("unsafe protocol")
    if (base.username || base.password) throw new Error("credentials in URL")
    const endpoint = new URL("/rest/v1/rpc/get_gameplay_analytics_report", base.origin)
    return endpoint.toString()
  } catch {
    throw new Error("SUPABASE_URL is invalid")
  }
}

export async function fetchGameplayAnalyticsReport({
  url,
  secretKey,
  since,
  until,
  limit,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof secretKey !== "string" || secretKey.length === 0) throw new Error("SUPABASE_SECRET_KEY is required")
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required")
  const endpoint = endpointFor(url)
  const sinceMs = parseTimestamp(since, "since")
  const untilMs = parseTimestamp(until, "until")
  if (untilMs <= sinceMs) throw new Error("until must be later than since")
  if (untilMs - sinceMs > MAX_REPORT_RANGE_MS) throw new Error("Gameplay analytics reports cannot span more than 90 days")
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REPORT_LIMIT) {
    throw new Error("limit must be an integer from 1 to 5000")
  }

  let response
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
        apikey: secretKey,
      },
      body: JSON.stringify({ p_since: since, p_until: until, p_limit: limit }),
    })
  } catch {
    // The original exception can contain a request, headers, or user-supplied secrets.
    throw new Error("Gameplay analytics report request failed before receiving a response")
  }

  if (!response?.ok) {
    const status = Number.isInteger(response?.status) ? response.status : "unknown"
    throw new Error(`Gameplay analytics report request failed with status ${status}; response body withheld`)
  }

  try {
    return await response.json()
  } catch {
    throw new Error("Gameplay analytics report returned invalid JSON; response body withheld")
  }
}

function plainRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

function safeString(value, label, pattern, maximum) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum || !pattern.test(value)) {
    throw new Error(`${label} is invalid`)
  }
  return value
}

function counter(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`)
  return value
}

function timestamp(value, label) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be a timestamp`)
  return value
}

function boundedCell(value, label) {
  if (!Number.isInteger(value) || value < -128 || value > 128) throw new Error(`${label} is outside the analytics grid`)
  return value
}

function parseRow(value, index) {
  const row = plainRecord(value, `rows[${index}]`)
  const experimentId = row.experimentId === null
    ? null
    : safeString(row.experimentId, `rows[${index}].experimentId`, SAFE_SLUG, 60)
  const experimentRevision = row.experimentRevision === null
    ? null
    : counter(row.experimentRevision, `rows[${index}].experimentRevision`)
  const variantId = row.variantId === null
    ? null
    : safeString(row.variantId, `rows[${index}].variantId`, SAFE_SLUG, 40)
  const experimentFields = [experimentId, experimentRevision, variantId]
  if (experimentFields.some((entry) => entry === null) && experimentFields.some((entry) => entry !== null)) {
    throw new Error(`rows[${index}] has incomplete experiment dimensions`)
  }
  if (experimentRevision !== null && experimentRevision < 1) {
    throw new Error(`rows[${index}].experimentRevision must be positive`)
  }

  const parsed = {
    windowStart: timestamp(row.windowStart, `rows[${index}].windowStart`),
    missionSlug: safeString(row.missionSlug, `rows[${index}].missionSlug`, SAFE_SLUG, 60),
    mapVersion: safeString(row.mapVersion, `rows[${index}].mapVersion`, SAFE_VERSION, 64),
    buildId: safeString(row.buildId, `rows[${index}].buildId`, SAFE_BUILD_ID, 80),
    phase: safeString(row.phase, `rows[${index}].phase`, SAFE_SLUG, 32),
    experimentId,
    experimentRevision,
    variantId,
    cellX: boundedCell(row.cellX, `rows[${index}].cellX`),
    cellZ: boundedCell(row.cellZ, `rows[${index}].cellZ`),
  }
  for (const name of GAMEPLAY_REPORT_COUNTERS) parsed[name] = counter(row[name], `rows[${index}].${name}`)
  if (parsed.dangerSampleCount > parsed.sampleCount) {
    throw new Error(`rows[${index}].dangerSampleCount cannot exceed sampleCount`)
  }
  return parsed
}

function emptyCounters() {
  return Object.fromEntries(GAMEPLAY_REPORT_COUNTERS.map((name) => [name, 0]))
}

function addCounters(target, source) {
  for (const name of GAMEPLAY_REPORT_COUNTERS) {
    const sum = target[name] + source[name]
    if (!Number.isSafeInteger(sum)) throw new Error(`Aggregated ${name} exceeds JavaScript's safe integer range`)
    target[name] = sum
  }
}

function fixedBugCount(value) {
  return FIXED_BUG_COUNTERS.reduce((sum, name) => sum + value[name], 0)
}

function rounded(value, places = 6) {
  const scale = 10 ** places
  return Math.round((value + Number.EPSILON) * scale) / scale
}

function rate(numerator, denominator, multiplier = 1) {
  return denominator > 0 ? rounded((numerator / denominator) * multiplier) : null
}

function derivedMetrics(counters) {
  const bugCount = fixedBugCount(counters)
  return {
    bugCount,
    dangerRate: rate(counters.dangerSampleCount, counters.sampleCount),
    averageDwellSeconds: rate(counters.sampleCount, counters.entryCount),
    downedPer100Entries: rate(counters.downedCount, counters.entryCount, 100),
    bugsPer1000Samples: rate(bugCount, counters.sampleCount, 1_000),
    missionSuccessRate: rate(
      counters.missionSuccessCount,
      counters.missionSuccessCount + counters.missionFailureCount,
    ),
  }
}

function aggregateMapEntry(map, key, dimensions) {
  let aggregate = map.get(key)
  if (!aggregate) {
    aggregate = { ...dimensions, ...emptyCounters() }
    map.set(key, aggregate)
  }
  return aggregate
}

function stableLocation(left, right) {
  const leftKey = `${left.missionSlug}|${left.mapVersion}|${left.cellX}|${left.cellZ}`
  const rightKey = `${right.missionSlug}|${right.mapVersion}|${right.cellX}|${right.cellZ}`
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

function locationSnapshot(cell) {
  const counters = Object.fromEntries(GAMEPLAY_REPORT_COUNTERS.map((name) => [name, cell[name]]))
  return {
    missionSlug: cell.missionSlug,
    mapVersion: cell.mapVersion,
    cellX: cell.cellX,
    cellZ: cell.cellZ,
    ...counters,
    ...derivedMetrics(counters),
  }
}

function rollupSnapshot(aggregate) {
  const counters = Object.fromEntries(GAMEPLAY_REPORT_COUNTERS.map((name) => [name, aggregate[name]]))
  return { ...aggregate, ...derivedMetrics(counters) }
}

function delta(candidate, baseline, name) {
  if (candidate[name] === null || baseline[name] === null) return null
  return rounded(candidate[name] - baseline[name])
}

export function summarizeGameplayAnalyticsReport(payload) {
  const report = plainRecord(payload, "gameplay analytics report")
  const since = timestamp(report.since, "report.since")
  const until = timestamp(report.until, "report.until")
  if (Date.parse(until) <= Date.parse(since)) throw new Error("report.until must be later than report.since")
  if (!Array.isArray(report.rows)) throw new Error("report.rows must be an array")

  const rows = report.rows.map(parseRow)
  const totals = emptyCounters()
  const cells = new Map()
  const experiments = new Map()
  const buildRollups = new Map()

  for (const row of rows) {
    addCounters(totals, row)

    const cellKey = JSON.stringify([row.missionSlug, row.mapVersion, row.cellX, row.cellZ])
    let cell = cells.get(cellKey)
    if (!cell) {
      cell = {
        missionSlug: row.missionSlug,
        mapVersion: row.mapVersion,
        cellX: row.cellX,
        cellZ: row.cellZ,
        ...emptyCounters(),
        byBuild: new Map(),
      }
      cells.set(cellKey, cell)
    }
    addCounters(cell, row)
    const cellBuild = aggregateMapEntry(cell.byBuild, row.buildId, { buildId: row.buildId })
    addCounters(cellBuild, row)

    const build = aggregateMapEntry(buildRollups, row.buildId, {
      buildId: row.buildId,
      isCanary: /canary/i.test(row.buildId),
    })
    addCounters(build, row)

    if (row.experimentId !== null) {
      const experimentKey = JSON.stringify([row.experimentId, row.experimentRevision, row.variantId])
      const experiment = aggregateMapEntry(experiments, experimentKey, {
        experimentId: row.experimentId,
        experimentRevision: row.experimentRevision,
        variantId: row.variantId,
      })
      addCounters(experiment, row)
    }
  }

  const locations = [...cells.values()].map(locationSnapshot)
  const hotspots = locations
    .map((cell) => ({
      ...cell,
      issueCount: cell.dangerSampleCount + cell.downedCount + cell.missionFailureCount + cell.bugCount,
    }))
    .filter((cell) => cell.issueCount > 0)
    .sort((left, right) => right.issueCount - left.issueCount || (right.dangerRate ?? -1) - (left.dangerRate ?? -1) || stableLocation(left, right))
    .slice(0, SECTION_LIMIT)

  const lowDwellCells = locations
    .filter((cell) => cell.entryCount > 0)
    .map((cell) => ({ ...cell, passThrough: cell.averageDwellSeconds <= PASS_THROUGH_SECONDS }))
    .sort((left, right) => left.averageDwellSeconds - right.averageDwellSeconds || right.entryCount - left.entryCount || stableLocation(left, right))
    .slice(0, SECTION_LIMIT)

  const bugHotspots = locations
    .filter((cell) => cell.bugCount > 0)
    .sort((left, right) => right.bugCount - left.bugCount || (right.bugsPer1000Samples ?? -1) - (left.bugsPer1000Samples ?? -1) || stableLocation(left, right))
    .slice(0, SECTION_LIMIT)

  const builds = [...buildRollups.values()]
    .map(rollupSnapshot)
    .sort((left, right) => right.sampleCount - left.sampleCount || Number(left.isCanary) - Number(right.isCanary) || left.buildId.localeCompare(right.buildId))
  const baseline = builds.find((build) => !build.isCanary) ?? builds[0] ?? null
  const buildComparisons = baseline === null
    ? []
    : builds
      .filter((build) => build.buildId !== baseline.buildId)
      .sort((left, right) => Number(right.isCanary) - Number(left.isCanary) || right.sampleCount - left.sampleCount || left.buildId.localeCompare(right.buildId))
      .map((candidate) => ({
        baselineBuildId: baseline.buildId,
        candidateBuildId: candidate.buildId,
        candidateIsCanary: candidate.isCanary,
        baseline: {
          sampleCount: baseline.sampleCount,
          entryCount: baseline.entryCount,
          dangerRate: baseline.dangerRate,
          averageDwellSeconds: baseline.averageDwellSeconds,
          downedPer100Entries: baseline.downedPer100Entries,
          bugsPer1000Samples: baseline.bugsPer1000Samples,
          missionSuccessRate: baseline.missionSuccessRate,
        },
        candidate: {
          sampleCount: candidate.sampleCount,
          entryCount: candidate.entryCount,
          dangerRate: candidate.dangerRate,
          averageDwellSeconds: candidate.averageDwellSeconds,
          downedPer100Entries: candidate.downedPer100Entries,
          bugsPer1000Samples: candidate.bugsPer1000Samples,
          missionSuccessRate: candidate.missionSuccessRate,
        },
        deltas: {
          dangerRate: delta(candidate, baseline, "dangerRate"),
          averageDwellSeconds: delta(candidate, baseline, "averageDwellSeconds"),
          downedPer100Entries: delta(candidate, baseline, "downedPer100Entries"),
          bugsPer1000Samples: delta(candidate, baseline, "bugsPer1000Samples"),
          missionSuccessRate: delta(candidate, baseline, "missionSuccessRate"),
        },
      }))

  const fixedBugHotspots = []
  if (baseline !== null) {
    const candidates = builds.filter((build) => build.buildId !== baseline.buildId)
    for (const cell of cells.values()) {
      const baselineCell = cell.byBuild.get(baseline.buildId)
      if (!baselineCell || baselineCell.sampleCount === 0 || fixedBugCount(baselineCell) === 0) continue
      for (const candidate of candidates) {
        const candidateCell = cell.byBuild.get(candidate.buildId)
        if (!candidateCell || candidateCell.sampleCount === 0 || fixedBugCount(candidateCell) !== 0) continue
        fixedBugHotspots.push({
          missionSlug: cell.missionSlug,
          mapVersion: cell.mapVersion,
          cellX: cell.cellX,
          cellZ: cell.cellZ,
          baselineBuildId: baseline.buildId,
          candidateBuildId: candidate.buildId,
          candidateIsCanary: candidate.isCanary,
          baselineBugCount: fixedBugCount(baselineCell),
          candidateBugCount: 0,
          baselineSampleCount: baselineCell.sampleCount,
          candidateSampleCount: candidateCell.sampleCount,
        })
      }
    }
  }
  fixedBugHotspots.sort((left, right) => Number(right.candidateIsCanary) - Number(left.candidateIsCanary) || right.baselineBugCount - left.baselineBugCount || stableLocation(left, right))

  const experimentVariants = [...experiments.values()]
    .map(rollupSnapshot)
    .sort((left, right) => left.experimentId.localeCompare(right.experimentId)
      || left.experimentRevision - right.experimentRevision
      || left.variantId.localeCompare(right.variantId))

  return {
    since: new Date(Date.parse(since)).toISOString(),
    until: new Date(Date.parse(until)).toISOString(),
    rowCount: rows.length,
    totals: { ...totals, ...derivedMetrics(totals) },
    hotspots,
    lowDwellCells,
    bugHotspots,
    fixedBugHotspots: fixedBugHotspots.slice(0, SECTION_LIMIT),
    experimentVariants,
    builds,
    buildComparisons,
  }
}

function percent(value) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`
}

function decimal(value, suffix = "") {
  return value === null ? "n/a" : `${value.toFixed(2)}${suffix}`
}

function percentagePointDelta(value) {
  if (value === null) return "n/a"
  const points = value * 100
  return `${points >= 0 ? "+" : ""}${points.toFixed(1)}pp`
}

function numericDelta(value, suffix = "") {
  if (value === null) return "n/a"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}${suffix}`
}

function cellLabel(cell) {
  return `${cell.missionSlug} ${cell.mapVersion} cell (${cell.cellX}, ${cell.cellZ})`
}

function section(lines, title, values, format) {
  lines.push("", title)
  if (values.length === 0) {
    lines.push("  none")
    return
  }
  for (const value of values) lines.push(`  - ${format(value)}`)
}

export function renderGameplayAnalyticsReport(summary) {
  const report = plainRecord(summary, "gameplay analytics summary")
  const lines = [
    "Gameplay analytics report",
    `Range: ${report.since} -> ${report.until}`,
    `Rows: ${report.rowCount}`,
    `Totals: ${report.totals.sampleCount} samples, ${report.totals.entryCount} entries, ${report.totals.missionStartCount} mission starts`,
  ]

  section(lines, "Gameplay hotspots", report.hotspots, (cell) =>
    `${cellLabel(cell)} — ${cell.issueCount} pressure/bug signals, danger ${percent(cell.dangerRate)}, ${cell.downedCount} downed, ${cell.missionFailureCount} failed`)
  section(lines, "Low-dwell / pass-through cells", report.lowDwellCells, (cell) =>
    `${cellLabel(cell)} — ${decimal(cell.averageDwellSeconds, "s/entry")}, ${cell.entryCount} entries${cell.passThrough ? ", pass-through" : ""}`)
  section(lines, "Bug hotspots (fixed diagnostic counters)", report.bugHotspots, (cell) =>
    `${cellLabel(cell)} — ${cell.bugCount} bug signals, ${decimal(cell.bugsPer1000Samples, "/1k samples")}`)
  section(lines, "Fixed bug hotspots (observed zero counters in candidate)", report.fixedBugHotspots, (cell) =>
    `${cellLabel(cell)} — ${cell.baselineBuildId} ${cell.baselineBugCount} -> ${cell.candidateBuildId} 0${cell.candidateIsCanary ? " (canary)" : ""}`)
  section(lines, "Experiment variants", report.experimentVariants, (variant) =>
    `${variant.experimentId} r${variant.experimentRevision}/${variant.variantId} — ${variant.sampleCount} samples, danger ${percent(variant.dangerRate)}, success ${percent(variant.missionSuccessRate)}, ${variant.bugCount} bug signals`)

  lines.push("", "Builds / canary comparisons")
  if (report.builds.length === 0) {
    lines.push("  none")
  } else {
    for (const build of report.builds) {
      lines.push(`  - ${build.buildId}${build.isCanary ? " (canary)" : ""}: ${build.sampleCount} samples, danger ${percent(build.dangerRate)}, success ${percent(build.missionSuccessRate)}, ${decimal(build.bugsPer1000Samples, " bugs/1k samples")}`)
    }
    if (report.buildComparisons.length === 0) {
      lines.push("  Comparison: one build only")
    } else {
      for (const comparison of report.buildComparisons) {
        lines.push(`  Comparison ${comparison.candidateBuildId}${comparison.candidateIsCanary ? " (canary)" : ""} vs ${comparison.baselineBuildId}: danger ${percentagePointDelta(comparison.deltas.dangerRate)}, success ${percentagePointDelta(comparison.deltas.missionSuccessRate)}, dwell ${numericDelta(comparison.deltas.averageDwellSeconds, "s")}, downed ${numericDelta(comparison.deltas.downedPer100Entries, "/100 entries")}, bugs ${numericDelta(comparison.deltas.bugsPer1000Samples, "/1k samples")}`)
      }
    }
  }

  return `${lines.join("\n")}\n`
}

export async function runGameplayAnalyticsReport({
  argv = process.argv.slice(2),
  env = process.env,
  fetchImpl = globalThis.fetch,
  write = process.stdout.write.bind(process.stdout),
  nowMs = Date.now(),
} = {}) {
  const args = parseReportArgs(argv, nowMs)
  const payload = await fetchGameplayAnalyticsReport({
    url: env.SUPABASE_URL,
    secretKey: env.SUPABASE_SECRET_KEY,
    since: args.since,
    until: args.until,
    limit: args.limit,
    fetchImpl,
  })
  const summary = summarizeGameplayAnalyticsReport(payload)
  const output = args.json ? `${JSON.stringify(summary, null, 2)}\n` : renderGameplayAnalyticsReport(summary)
  if (env.SUPABASE_SECRET_KEY && output.includes(env.SUPABASE_SECRET_KEY)) {
    throw new Error("Refusing to print a report containing the Supabase secret key")
  }
  write(output)
  return summary
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await runGameplayAnalyticsReport()
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gameplay analytics report failed"
    const safeMessage = process.env.SUPABASE_SECRET_KEY && message.includes(process.env.SUPABASE_SECRET_KEY)
      ? "Gameplay analytics report failed; sensitive error withheld"
      : message
    process.stderr.write(`${safeMessage}\n`)
    process.exitCode = 1
  }
}
