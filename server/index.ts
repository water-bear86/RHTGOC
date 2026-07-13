import { createServer } from "node:http"
import { randomInt, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { WebSocket, WebSocketServer } from "ws"
import { PROTOCOL_VERSION, parseClientMessage, type ClientDiagnosticCode, type ServerMessage } from "../shared/protocol"
import { Room, type ContributionTransition, type RescueOfferTransition } from "./room"
import { createBandStoreFromEnv, type CompletedBandMission, type PersistentBandRecord } from "./band-store"
import { createLeaderboardStoreFromEnv, terminalLeaderboardFailure, type VerifiedRun } from "./leaderboard-store"
import { structuredLog, Telemetry } from "./telemetry"
import { getMissionDefinition } from "../shared/mission-catalog"
import type { SheriffRotation } from "../shared/sheriff-rotation"
import { SheriffRotationService } from "./rotation-service"
import { createRescueOfferStoreFromEnv } from "./rescue-offer-store"
import { createContributionStoreFromEnv } from "./contribution-store"
import { SherwoodSeasonService, type SeasonTransition } from "./season-service"
import { campaignRotationWindow } from "../shared/sherwood-season"
import { createSeasonStoreFromEnv } from "./season-store"
import { createSocialStoreFromEnv } from "./social-store"
import { PublicHubService, type HubParticipant } from "./public-hub"
import { createTokenAccessServiceFromEnv, REFERENCE_PRICE_USD, tokenAccessGateEnabled, walletAddressFromIdentities } from "./token-access-service"
import { normalizeBuildId, staticCacheControl } from "../shared/release"
import { GameplayAnalyticsAggregator } from "./gameplay-analytics"
import { createGameplayAnalyticsStoreFromEnv } from "./gameplay-analytics-store"
import { createExperimentServiceFromEnv } from "./experiment-service"
import type { GameplayAnalyticsBatch, GameplayAnalyticsDimension, GameplayAnalyticsEvent } from "../shared/gameplay-analytics"

const port = Number(process.env.PORT ?? 8787)
const buildId = normalizeBuildId(process.env.BUILD_ID)
const rooms = new Map<string, Room>()
const bandStore = createBandStoreFromEnv()
const leaderboardStore = createLeaderboardStoreFromEnv()
const rescueOfferStore = createRescueOfferStoreFromEnv()
const contributionStore = createContributionStoreFromEnv()
const seasonStore = createSeasonStoreFromEnv()
const socialStore = createSocialStoreFromEnv()
const publicHub = new PublicHubService()
const tokenAccessService = createTokenAccessServiceFromEnv()
const tokenAccessGate = tokenAccessGateEnabled(process.env.TOKEN_ACCESS_GATE_ENABLED)
const gameplayAnalyticsEnabled = process.env.GAMEPLAY_ANALYTICS_ENABLED === "true"
const gameplayAnalyticsStore = gameplayAnalyticsEnabled ? createGameplayAnalyticsStoreFromEnv() : null
const gameplayAnalytics = gameplayAnalyticsStore ? new GameplayAnalyticsAggregator() : null
const experimentService = gameplayAnalyticsStore ? createExperimentServiceFromEnv() : null
const publicOrigin = process.env.PUBLIC_ORIGIN?.replace(/\/$/, "")
let seasonReady = seasonStore === null
const telemetry = new Telemetry()
const rotationService = new SheriffRotationService()
const seasonService = new SherwoodSeasonService()
const opsAdminSecret = process.env.OPS_ADMIN_SECRET
const supabaseUrl = process.env.SUPABASE_URL
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY
const defaultMission = getMissionDefinition()
const observedRoomPhases = new Map<string, string>()
const observedMissionStatus = new Map<string, string>()
const roomTraces = new Map<string, string>()
const reservedRoomsUntil = new Map<string, number>()
let activeConnections = 0
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const pendingRescueTransitions = new Map<string, { transition: RescueOfferTransition; attempts: number; nextAttemptAt: number }>()
let rescuePersistenceFlushing = false
const pendingContributionTransitions = new Map<string, { transition: ContributionTransition; attempts: number; nextAttemptAt: number }>()
let contributionPersistenceFlushing = false
const pendingSeasonTransitions = new Map<string, { transition: SeasonTransition; attempts: number; nextAttemptAt: number }>()
let seasonPersistenceFlushing = false
const pendingRecentPlayers = new Map<string, { userIds: string[]; attempts: number; nextAttemptAt: number }>()
let recentPlayersFlushing = false
const pendingBandMissions = new Map<string, { outcome: CompletedBandMission; room: Room; traceId: string | null; attempts: number; nextAttemptAt: number }>()
let bandPersistenceFlushing = false
const pendingLeaderboardRuns = new Map<string, { run: VerifiedRun; traceId: string | null; attempts: number; nextAttemptAt: number }>()
let leaderboardPersistenceFlushing = false
let leaderboardFinalizationRunning = false
let acceptingNewSessions = true
let draining = false
const pendingGameplayAnalytics = new Map<string, { batch: GameplayAnalyticsBatch; attempts: number; nextAttemptAt: number }>()
const observedGameplayEventSequences = new Map<string, { roomScope: string; sequence: number }>()
let gameplayAnalyticsFlushing = false

function roomCode(): string {
  let code = ""
  do {
    code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("")
  } while (rooms.has(code))
  return code
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
}

function assignRoomExperiments(roomScope: string) {
  if (!experimentService) return []
  try {
    const assignments = experimentService.assignRoom(roomScope)
    if (assignments.length > 1) {
      telemetry.increment("experiment_overlap_suppressed_total")
      structuredLog("experiment_overlap_suppressed", { activeAssignments: assignments.length }, "warn")
    }
    return assignments.slice(0, 1)
  } catch (error) {
    telemetry.increment("experiment_assignment_failure_total")
    structuredLog("experiment_assignment_failed", { reason: error instanceof Error ? error.message : "unknown" }, "error")
    return []
  }
}

function analyticsDimension(room: Room, clientBuildId: string): GameplayAnalyticsDimension | null {
  const mission = room.mission
  if (!mission) return null
  const assignment = room.experimentAssignments[0] ?? null
  return {
    buildId: clientBuildId,
    missionSlug: mission.definition.slug,
    mapVersion: mission.definition.contentHash,
    phase: mission.phase,
    experimentId: assignment?.experimentId ?? null,
    experimentRevision: assignment?.experimentRevision ?? null,
    variantId: assignment?.variantId ?? null,
  }
}

function recordGameplayEvent(room: Room, event: GameplayAnalyticsEvent, playerId: string | null, observedAtMs = Date.now()): void {
  if (!gameplayAnalytics) return
  const candidates = playerId ? [room.players.get(playerId)].filter(Boolean) : [...room.players.values()]
  const player = candidates.find((candidate) => candidate && room.hasProductAnalyticsConsent(candidate.id))
  if (!player) return
  const dimension = analyticsDimension(room, room.clientBuildId(player.id))
  if (!dimension) return
  try {
    gameplayAnalytics.recordEvent({
      observedAtMs,
      x: player.position.x,
      z: player.position.z,
      event,
      dimension,
    })
  } catch (error) {
    telemetry.increment("gameplay_analytics_observation_rejected_total")
    structuredLog("gameplay_analytics_observation_rejected", { reason: error instanceof Error ? error.message : "unknown" }, "warn")
  }
}

function recordGameplayDiagnostic(room: Room, code: ClientDiagnosticCode, playerId: string, observedAtMs = Date.now()): void {
  if (!gameplayAnalytics || !room.hasProductAnalyticsConsent(playerId)) return
  const player = room.players.get(playerId)
  if (!player) return
  const dimension = analyticsDimension(room, room.clientBuildId(player.id))
  if (!dimension) return
  try {
    gameplayAnalytics.recordDiagnostic({
      observedAtMs,
      x: player.position.x,
      z: player.position.z,
      code,
      dimension,
    })
  } catch (error) {
    telemetry.increment("gameplay_analytics_observation_rejected_total")
    structuredLog("gameplay_analytics_observation_rejected", { reason: error instanceof Error ? error.message : "unknown" }, "warn")
  }
}

const objectiveAnalyticsEvents = new Set([
  "route_selected",
  "cart_robbed",
  "loot_delivered",
  "wagon_intercepted",
  "lock_breached",
  "captives_freed",
  "captive_extracted",
  "alarm_sabotaged",
  "disguise_acquired",
  "cache_looted",
  "intel_found",
  "ledger_stolen",
  "extraction_reached",
])

function analyticsEventForMissionEvent(type: string): GameplayAnalyticsEvent | null {
  if (type === "mission_started") return "mission-start"
  if (type === "mission_succeeded") return "mission-success"
  if (type === "mission_failed") return "mission-failure"
  if (type === "player_downed") return "player-downed"
  return objectiveAnalyticsEvents.has(type) ? "objective-interaction" : null
}

function observeRoomGameplay(room: Room, now = Date.now()): void {
  if (!gameplayAnalytics || !room.mission) return
  const mission = room.mission
  const roomScope = room.analyticsScope()
  const prior = observedGameplayEventSequences.get(room.code)
  const lastSequence = prior?.roomScope === roomScope ? prior.sequence : 0
  for (const event of mission.events) {
    if (event.sequence <= lastSequence) continue
    const analyticsEvent = analyticsEventForMissionEvent(event.type)
    if (analyticsEvent) recordGameplayEvent(room, analyticsEvent, event.playerId ?? null, now)
  }
  observedGameplayEventSequences.set(room.code, { roomScope, sequence: mission.events.at(-1)?.sequence ?? lastSequence })

  ;[...room.players.values()].forEach((player, playerSlot) => {
    if (!player.connected || !room.hasProductAnalyticsConsent(player.id)) return
    const dimension = analyticsDimension(room, room.clientBuildId(player.id))
    if (!dimension) return
    const dangerNearby = mission.guards.some((guard) => guard.stunnedFor <= 0 && Math.hypot(guard.position.x - player.position.x, guard.position.z - player.position.z) <= 10)
    gameplayAnalytics.observe(roomScope, playerSlot, {
      observedAtMs: now,
      x: player.position.x,
      z: player.position.z,
      dangerNearby,
      dimension,
    })
  })
}

const MAX_PENDING_GAMEPLAY_BATCHES = 64

function enqueueGameplayAnalytics(batch: GameplayAnalyticsBatch): void {
  if (pendingGameplayAnalytics.has(batch.batchId)) return
  if (pendingGameplayAnalytics.size >= MAX_PENDING_GAMEPLAY_BATCHES) {
    const oldest = pendingGameplayAnalytics.keys().next().value as string | undefined
    if (oldest) pendingGameplayAnalytics.delete(oldest)
    telemetry.increment("gameplay_analytics_backpressure_drops_total")
  }
  pendingGameplayAnalytics.set(batch.batchId, { batch, attempts: 0, nextAttemptAt: Date.now() })
  telemetry.gauge("gameplay_analytics_persistence_queue", pendingGameplayAnalytics.size)
}

async function flushGameplayAnalytics(now = Date.now()): Promise<void> {
  if (!gameplayAnalyticsStore || gameplayAnalyticsFlushing) return
  gameplayAnalyticsFlushing = true
  try {
    for (const [batchId, pending] of pendingGameplayAnalytics) {
      if (pending.nextAttemptAt > now) continue
      try {
        const result = await gameplayAnalyticsStore.recordBatch(pending.batch)
        pendingGameplayAnalytics.delete(batchId)
        telemetry.increment(result.inserted ? "gameplay_analytics_batches_inserted_total" : "gameplay_analytics_batches_replayed_total")
        telemetry.increment("gameplay_analytics_rows_persisted_total", result.rows)
      } catch (error) {
        pending.attempts += 1
        if (pending.attempts >= 8) {
          pendingGameplayAnalytics.delete(batchId)
          telemetry.increment("gameplay_analytics_dead_letter_total")
          structuredLog("gameplay_analytics_batch_dropped", { attempts: pending.attempts, reason: error instanceof Error ? error.message : "unknown" }, "error")
        } else {
          pending.nextAttemptAt = now + Math.min(60_000, 1_000 * 2 ** pending.attempts)
          telemetry.increment("gameplay_analytics_persistence_retry_total")
        }
      }
    }
  } finally {
    gameplayAnalyticsFlushing = false
    telemetry.gauge("gameplay_analytics_persistence_queue", pendingGameplayAnalytics.size)
  }
}

function reservePublicBand(group: HubParticipant[], automatic: boolean): void {
  const code = roomCode()
  const room = new Room(code, (now) => campaignRotationWindow(rotationService.window(now), seasonService.snapshot(now)), (now) => seasonService.snapshot(now), null, assignRoomExperiments)
  rooms.set(code, room)
  reservedRoomsUntil.set(code, Date.now() + 10_000)
  roomTraces.set(code, randomUUID())
  group.forEach((participant, index) => send(participant.socket, { type: "hub_band_ready", roomCode: code, leader: index === 0 }))
  telemetry.increment("hub_private_bands_formed_total")
  structuredLog("hub_private_band_formed", { traceId: roomTraces.get(code) ?? null, partySize: group.length, automatic })
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
}

function json(response: import("node:http").ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" })
  response.end(JSON.stringify(value))
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > 65_536) throw new Error("BODY_TOO_LARGE")
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as unknown
}

function bearerToken(request: import("node:http").IncomingMessage): string | undefined {
  const authorization = request.headers.authorization
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined
}

function operatorAuthorized(request: import("node:http").IncomingMessage): boolean {
  return Boolean(opsAdminSecret && request.headers.authorization === `Bearer ${opsAdminSecret}`)
}

interface SupabaseIdentity {
  id: string
  sherwoodOperator: boolean
  walletAddress: string | null
}

async function verifySupabaseIdentity(accessToken: string | undefined): Promise<SupabaseIdentity | null> {
  if (!accessToken || !supabaseUrl || !supabasePublishableKey) return null
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabasePublishableKey, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return null
    const value = await response.json() as { id?: unknown; app_metadata?: unknown; identities?: unknown }
    if (typeof value.id !== "string" || !value.id.match(/^[0-9a-f-]{36}$/)) return null
    const appMetadata = value.app_metadata && typeof value.app_metadata === "object" ? value.app_metadata as Record<string, unknown> : {}
    return {
      id: value.id,
      sherwoodOperator: appMetadata.sherwood_operator === true,
      walletAddress: walletAddressFromIdentities(value.identities),
    }
  } catch {
    return null
  }
}

async function verifySupabaseUser(accessToken: string | undefined): Promise<string | null> {
  return (await verifySupabaseIdentity(accessToken))?.id ?? null
}

async function tokenAccessAllows(userId: string | null): Promise<boolean> {
  if (!tokenAccessGate) return true
  if (!userId || !tokenAccessService) return false
  try {
    return (await tokenAccessService.access(userId)).entitled
  } catch (error) {
    telemetry.increment("token_access_failure_total")
    structuredLog("token_access_failed", { reason: error instanceof Error ? error.message : "unknown" }, "error")
    return false
  }
}

function enqueueRescueTransition(transition: RescueOfferTransition): void {
  if (!rescueOfferStore) return
  const key = `${transition.offer.id}:${transition.sequence}`
  pendingRescueTransitions.set(key, { transition, attempts: 0, nextAttemptAt: Date.now() })
  telemetry.gauge("rescue_persistence_queue", pendingRescueTransitions.size)
}

async function flushRescueTransitions(now = Date.now()): Promise<void> {
  if (!rescueOfferStore || rescuePersistenceFlushing) return
  rescuePersistenceFlushing = true
  try {
    for (const [key, pending] of pendingRescueTransitions) {
      if (pending.nextAttemptAt > now) continue
      try {
        await rescueOfferStore.recordTransition(pending.transition)
        pendingRescueTransitions.delete(key)
        telemetry.increment("rescue_persistence_success_total")
      } catch (error) {
        pending.attempts += 1
        pending.nextAttemptAt = now + Math.min(60_000, 1_000 * 2 ** Math.min(6, pending.attempts))
        telemetry.increment("rescue_persistence_retry_total")
        structuredLog("rescue_persistence_retry", {
          offerId: pending.transition.offer.id,
          sequence: pending.transition.sequence,
          attempts: pending.attempts,
          reason: error instanceof Error ? error.message : "unknown",
        }, "error")
      }
    }
  } finally {
    rescuePersistenceFlushing = false
    telemetry.gauge("rescue_persistence_queue", pendingRescueTransitions.size)
  }
}

function enqueueContributionTransition(transition: ContributionTransition): void {
  if (!contributionStore) return
  const key = `${transition.contribution.id}:${transition.sequence}`
  pendingContributionTransitions.set(key, { transition, attempts: 0, nextAttemptAt: Date.now() })
  telemetry.gauge("contribution_persistence_queue", pendingContributionTransitions.size)
}

async function flushContributionTransitions(now = Date.now()): Promise<void> {
  if (!contributionStore || contributionPersistenceFlushing) return
  contributionPersistenceFlushing = true
  try {
    for (const [key, pending] of pendingContributionTransitions) {
      if (pending.nextAttemptAt > now) continue
      try {
        await contributionStore.recordTransition(pending.transition)
        pendingContributionTransitions.delete(key)
        telemetry.increment("contribution_persistence_success_total")
      } catch (error) {
        pending.attempts += 1
        pending.nextAttemptAt = now + Math.min(60_000, 1_000 * 2 ** Math.min(6, pending.attempts))
        telemetry.increment("contribution_persistence_retry_total")
        structuredLog("contribution_persistence_retry", {
          contributionId: pending.transition.contribution.id,
          sequence: pending.transition.sequence,
          attempts: pending.attempts,
          reason: error instanceof Error ? error.message : "unknown",
        }, "error")
      }
    }
  } finally {
    contributionPersistenceFlushing = false
    telemetry.gauge("contribution_persistence_queue", pendingContributionTransitions.size)
  }
}

function enqueueSeasonTransition(transition: SeasonTransition): void {
  if (!seasonStore) return
  pendingSeasonTransitions.set(transition.eventId, { transition, attempts: 0, nextAttemptAt: Date.now() })
  telemetry.gauge("season_persistence_queue", pendingSeasonTransitions.size)
}

function captureSeasonTransitions(): void {
  for (const transition of seasonService.drainTransitions()) {
    enqueueSeasonTransition(transition)
    telemetry.increment(`season_${transition.eventType}_events_total`)
    telemetry.gauge("season_pressure", transition.snapshot.pressure)
    structuredLog("season_transition", { eventId: transition.eventId, eventType: transition.eventType, phase: transition.snapshot.phase, revision: transition.snapshot.revision, sequence: transition.sequence })
  }
}

async function flushSeasonTransitions(now = Date.now()): Promise<void> {
  if (!seasonStore || seasonPersistenceFlushing) return
  seasonPersistenceFlushing = true
  try {
    for (const [key, pending] of pendingSeasonTransitions) {
      if (pending.nextAttemptAt > now) continue
      try {
        await seasonStore.recordTransition(pending.transition)
        pendingSeasonTransitions.delete(key)
        telemetry.increment("season_persistence_success_total")
      } catch (error) {
        pending.attempts += 1
        pending.nextAttemptAt = now + Math.min(60_000, 1_000 * 2 ** Math.min(6, pending.attempts))
        telemetry.increment("season_persistence_retry_total")
        structuredLog("season_persistence_retry", { eventId: pending.transition.eventId, attempts: pending.attempts, reason: error instanceof Error ? error.message : "unknown" }, "error")
      }
    }
  } finally {
    seasonPersistenceFlushing = false
    telemetry.gauge("season_persistence_queue", pendingSeasonTransitions.size)
  }
}

async function flushRecentPlayers(now = Date.now()): Promise<void> {
  if (!socialStore || recentPlayersFlushing) return
  recentPlayersFlushing = true
  try {
    for (const [missionId, pending] of pendingRecentPlayers) {
      if (pending.nextAttemptAt > now) continue
      try {
        await socialStore.recordRecentPlayers(missionId, pending.userIds)
        pendingRecentPlayers.delete(missionId)
        telemetry.increment("recent_players_persistence_success_total")
      } catch (error) {
        pending.attempts += 1
        pending.nextAttemptAt = now + Math.min(60_000, 1_000 * 2 ** Math.min(6, pending.attempts))
        telemetry.increment("recent_players_persistence_retry_total")
        structuredLog("recent_players_persistence_retry", { missionId, attempts: pending.attempts, reason: error instanceof Error ? error.message : "unknown" }, "error")
      }
    }
  } finally {
    recentPlayersFlushing = false
    telemetry.gauge("recent_players_persistence_queue", pendingRecentPlayers.size)
  }
}

function enqueueBandMission(room: Room, outcome: CompletedBandMission, traceId: string | null): void {
  if (!bandStore || pendingBandMissions.has(outcome.missionId)) return
  pendingBandMissions.set(outcome.missionId, { outcome, room, traceId, attempts: 0, nextAttemptAt: Date.now() })
  telemetry.gauge("band_persistence_queue", pendingBandMissions.size)
}

async function flushBandMissions(now = Date.now()): Promise<void> {
  if (!bandStore || bandPersistenceFlushing) return
  bandPersistenceFlushing = true
  try {
    for (const [missionId, pending] of pendingBandMissions) {
      if (pending.nextAttemptAt > now) continue
      try {
        const result = await bandStore.recordMission(pending.outcome)
        pendingBandMissions.delete(missionId)
        pending.room.refreshPersistentBand(result.band)
        pending.room.broadcastRoomState()
        telemetry.increment(result.recorded ? "band_persistence_success_total" : "band_persistence_idempotent_total")
      } catch (error) {
        pending.attempts += 1
        pending.nextAttemptAt = now + Math.min(60_000, 1_000 * 2 ** Math.min(6, pending.attempts))
        telemetry.increment("band_persistence_retry_total")
        structuredLog("band_persistence_retry", { traceId: pending.traceId, missionId, attempts: pending.attempts, reason: error instanceof Error ? error.message : "unknown" }, "error")
      }
    }
  } finally {
    bandPersistenceFlushing = false
    telemetry.gauge("band_persistence_queue", pendingBandMissions.size)
  }
}

function enqueueVerifiedRun(run: VerifiedRun, traceId: string | null): void {
  if (!leaderboardStore) return
  const key = `${run.missionId}:${run.playerId}`
  if (pendingLeaderboardRuns.has(key)) return
  pendingLeaderboardRuns.set(key, { run, traceId, attempts: 0, nextAttemptAt: Date.now() })
  telemetry.gauge("leaderboard_persistence_queue", pendingLeaderboardRuns.size)
}

async function flushVerifiedRuns(now = Date.now()): Promise<void> {
  if (!leaderboardStore || leaderboardPersistenceFlushing) return
  leaderboardPersistenceFlushing = true
  try {
    for (const [key, pending] of pendingLeaderboardRuns) {
      if (pending.nextAttemptAt > now) continue
      try {
        const entryId = await leaderboardStore.recordVerifiedRun(pending.run)
        pendingLeaderboardRuns.delete(key)
        telemetry.increment(entryId ? "leaderboard_persistence_success_total" : "leaderboard_quarantine_total")
      } catch (error) {
        const terminalReason = terminalLeaderboardFailure(error)
        if (terminalReason) {
          pendingLeaderboardRuns.delete(key)
          telemetry.increment("leaderboard_dead_letter_total")
          structuredLog("leaderboard_dead_lettered", { traceId: pending.traceId, missionId: pending.run.missionId, reason: terminalReason }, "error")
        } else {
          pending.attempts += 1
          pending.nextAttemptAt = now + Math.min(60_000, 1_000 * 2 ** Math.min(6, pending.attempts))
          telemetry.increment("leaderboard_persistence_retry_total")
          structuredLog("leaderboard_persistence_retry", { traceId: pending.traceId, missionId: pending.run.missionId, attempts: pending.attempts, reason: error instanceof Error ? error.message : "unknown" }, "error")
        }
      }
    }
  } finally {
    leaderboardPersistenceFlushing = false
    telemetry.gauge("leaderboard_persistence_queue", pendingLeaderboardRuns.size)
  }
}

async function finalizeLeaderboardSeasons(): Promise<void> {
  if (!leaderboardStore || leaderboardFinalizationRunning || leaderboardPersistenceFlushing || pendingLeaderboardRuns.size > 0) return
  if ([...rooms.values()].some((room) => room.hasRankedMissionInFlight())) return
  leaderboardFinalizationRunning = true
  try {
    const result = await leaderboardStore.finalizeDueSeasons()
    if (result.seasonsFinalized > 0) {
      telemetry.increment("leaderboard_seasons_finalized_total", result.seasonsFinalized)
      telemetry.increment("leaderboard_snapshots_created_total", result.snapshotsCreated)
      structuredLog("leaderboard_seasons_finalized", { seasonsFinalized: result.seasonsFinalized, snapshotsCreated: result.snapshotsCreated })
    }
  } catch (error) {
    telemetry.increment("leaderboard_finalization_failure_total")
    structuredLog("leaderboard_finalization_failed", { reason: error instanceof Error ? error.message : "unknown" }, "error")
  } finally {
    leaderboardFinalizationRunning = false
  }
}

const httpServer = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname
  const requestOrigin = request.headers.origin
  if (publicOrigin && requestOrigin === publicOrigin) {
    response.setHeader("Access-Control-Allow-Origin", publicOrigin)
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type")
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    response.setHeader("Vary", "Origin")
  }
  if (request.method === "OPTIONS" && pathname.startsWith("/access")) {
    response.writeHead(requestOrigin === publicOrigin ? 204 : 403)
    response.end()
    return
  }
  if (pathname === "/access" && request.method === "GET") {
    const identity = await verifySupabaseIdentity(bearerToken(request))
    let entitled = false
    let accessExpiresAt: string | null = null
    if (identity && tokenAccessService) {
      try {
        const access = await tokenAccessService.access(identity.id)
        entitled = access.entitled
        accessExpiresAt = access.expiresAt
      } catch (error) {
        telemetry.increment("token_access_failure_total")
        structuredLog("token_access_failed", { reason: error instanceof Error ? error.message : "unknown" }, "error")
      }
    }
    const payment = tokenAccessService?.payment
    json(response, 200, {
      gateEnabled: tokenAccessGate,
      authenticated: identity !== null,
      entitled: tokenAccessGate ? entitled : true,
      accessExpiresAt,
      referencePriceUsd: REFERENCE_PRICE_USD,
      payment: payment ? {
        chainId: payment.chainId,
        chainName: payment.chainName,
        tokenContract: payment.tokenContract,
        treasuryAddress: payment.treasuryAddress,
        amountBaseUnits: payment.amountBaseUnits,
        amountDisplay: payment.amountDisplay,
        tokenSymbol: payment.tokenSymbol,
        passDays: payment.passDays,
      } : null,
    })
    return
  }
  if (pathname === "/access/claim" && request.method === "POST") {
    if (!tokenAccessService) {
      json(response, 503, { error: "Token payments are not configured" })
      return
    }
    const identity = await verifySupabaseIdentity(bearerToken(request))
    if (!identity?.walletAddress) {
      json(response, 401, { error: "Sign in with Robinhood Wallet first" })
      return
    }
    try {
      const body = await readJsonBody(request) as { transactionHash?: unknown }
      const access = await tokenAccessService.claim(identity.id, identity.walletAddress, String(body.transactionHash ?? ""))
      telemetry.increment("token_access_claim_success_total")
      json(response, 200, {
        gateEnabled: tokenAccessGate,
        authenticated: true,
        entitled: access.entitled,
        accessExpiresAt: access.expiresAt,
        referencePriceUsd: REFERENCE_PRICE_USD,
        payment: tokenAccessService.payment,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Token payment could not be verified"
      telemetry.increment("token_access_claim_failure_total")
      structuredLog("token_access_claim_failed", { reason: message }, "error")
      const pending = message.includes("CONFIRMATIONS") || message === "TOKEN_PAYMENT_NOT_CONFIRMED"
      const conflict = message === "TOKEN_PAYMENT_ALREADY_CLAIMED" || pending
      const invalid = message.startsWith("TOKEN_PAYMENT_") && !message.startsWith("TOKEN_PAYMENT_WRITE") && message !== "TOKEN_PAYMENT_BLOCK_UNAVAILABLE" && !pending
      const publicMessage = message === "TOKEN_PAYMENT_ALREADY_CLAIMED"
        ? "That token payment has already been claimed"
        : pending
          ? "Token payment is still confirming on Robinhood Chain"
          : invalid
            ? "That transaction does not match the required token payment"
            : "Token payment verification is temporarily unavailable"
      json(response, conflict ? 409 : invalid ? 400 : 503, { error: publicMessage })
    }
    return
  }
  if (pathname === "/rotations" && request.method === "GET") {
    json(response, 200, campaignRotationWindow(rotationService.window(), seasonService.snapshot()))
    return
  }
  if (pathname === "/season" && request.method === "GET") {
    json(response, 200, seasonService.snapshot())
    return
  }
  if (pathname.startsWith("/admin/rotations/") && request.method === "POST") {
    if (!opsAdminSecret) {
      json(response, 503, { error: "Operator controls are not configured" })
      return
    }
    if (!operatorAuthorized(request)) {
      telemetry.increment("rotation_admin_unauthorized_total")
      json(response, 401, { error: "Unauthorized" })
      return
    }
    try {
      if (pathname === "/admin/rotations/pause") {
        const body = await readJsonBody(request) as { until?: unknown }
        rotationService.pause(Number(body.until))
        telemetry.increment("rotation_admin_pause_total")
      } else if (pathname === "/admin/rotations/replace") {
        const body = await readJsonBody(request) as { rotations?: unknown }
        if (!Array.isArray(body.rotations)) throw new Error("ROTATIONS_REQUIRED")
        rotationService.replace(body.rotations as SheriffRotation[])
        telemetry.increment("rotation_admin_replace_total")
      } else if (pathname === "/admin/rotations/rollback") {
        rotationService.rollback()
        telemetry.increment("rotation_admin_rollback_total")
      } else {
        json(response, 404, { error: "Unknown rotation operation" })
        return
      }
      structuredLog("rotation_admin_changed", { operation: pathname.split("/").at(-1) ?? "unknown" })
      json(response, 200, rotationService.window())
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : "Invalid rotation operation" })
    }
    return
  }
  if (pathname.startsWith("/admin/season/") && request.method === "POST") {
    if (!opsAdminSecret) {
      json(response, 503, { error: "Operator controls are not configured" })
      return
    }
    if (!operatorAuthorized(request)) {
      telemetry.increment("season_admin_unauthorized_total")
      json(response, 401, { error: "Unauthorized" })
      return
    }
    captureSeasonTransitions()
    if (seasonStore && (seasonPersistenceFlushing || pendingSeasonTransitions.size > 0)) {
      telemetry.increment("season_admin_persistence_barrier_total")
      json(response, 503, { error: "A previous campaign transition is still awaiting durable storage" })
      return
    }
    try {
      const operation = pathname.split("/").at(-1) ?? "unknown"
      if (operation === "pause") seasonService.pause()
      else if (operation === "resume") seasonService.resume()
      else if (operation === "extend") {
        const body = await readJsonBody(request) as { endsAt?: unknown }
        seasonService.extend(Number(body.endsAt))
      } else if (operation === "archive") seasonService.archive()
      else if (operation === "rollback") seasonService.rollback()
      else if (operation === "start") {
        const body = await readJsonBody(request) as { slug?: unknown; name?: unknown; startsAt?: unknown; endsAt?: unknown }
        seasonService.start({ slug: String(body.slug ?? ""), name: String(body.name ?? ""), startsAt: Number(body.startsAt), endsAt: Number(body.endsAt) })
      } else {
        json(response, 404, { error: "Unknown season operation" })
        return
      }
      const snapshot = seasonService.snapshot()
      captureSeasonTransitions()
      if (seasonStore) {
        await flushSeasonTransitions()
        if (pendingSeasonTransitions.size > 0) {
          telemetry.increment("season_admin_persistence_pending_total")
          structuredLog("season_admin_persistence_pending", { operation }, "error")
          json(response, 503, { error: "Campaign transition is active in memory but still awaiting durable storage", season: snapshot })
          return
        }
      }
      telemetry.increment(`season_admin_${operation}_total`)
      structuredLog("season_admin_changed", { operation })
      for (const room of rooms.values()) room.broadcastRoomState()
      json(response, 200, snapshot)
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : "Invalid season operation" })
    }
    return
  }
  if (pathname === "/admin/leaderboard/quarantine/review" && request.method === "POST") {
    if (!opsAdminSecret || !leaderboardStore) {
      json(response, 503, { error: "Leaderboard operator controls are not configured" })
      return
    }
    if (!operatorAuthorized(request)) {
      telemetry.increment("leaderboard_review_unauthorized_total")
      json(response, 401, { error: "Unauthorized" })
      return
    }
    const operatorToken = request.headers["x-sherwood-operator-token"]
    const operatorIdentity = await verifySupabaseIdentity(typeof operatorToken === "string" ? operatorToken : undefined)
    if (!operatorIdentity) {
      telemetry.increment("leaderboard_review_unauthorized_total")
      json(response, 401, { error: "Valid operator identity required" })
      return
    }
    if (!operatorIdentity.sherwoodOperator) {
      telemetry.increment("leaderboard_review_forbidden_total")
      json(response, 403, { error: "Sherwood operator role required" })
      return
    }
    try {
      const body = await readJsonBody(request) as { quarantineId?: unknown; decision?: unknown }
      const quarantineId = String(body.quarantineId ?? "")
      const decision = String(body.decision ?? "")
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      if (!uuidPattern.test(quarantineId) || (decision !== "approved" && decision !== "rejected")) throw new Error("INVALID_LEADERBOARD_REVIEW")
      const result = await leaderboardStore.reviewQuarantine(quarantineId, operatorIdentity.id, decision)
      telemetry.increment(`leaderboard_review_${result.status}_total`)
      structuredLog("leaderboard_quarantine_reviewed", { decision: result.status, promoted: result.entryId !== null })
      json(response, 200, result)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid leaderboard review"
      const conflict = message.includes("REVIEW_DECISION_CONFLICT") || message.includes("SEASON_FINALIZED") || message.includes("VERIFICATION_CONFLICT")
      const missing = message.includes("QUARANTINE_NOT_FOUND")
      const unavailable = message.startsWith("LEADERBOARD_REVIEW_FAILED") && !conflict && !missing
      telemetry.increment(conflict ? "leaderboard_review_conflict_total" : "leaderboard_review_failure_total")
      json(response, conflict ? 409 : missing ? 404 : unavailable ? 503 : 400, { error: message })
    }
    return
  }
  if (request.url === "/metrics") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    response.end(JSON.stringify(telemetry.snapshot()))
    return
  }
  if (request.url === "/ready") {
    const ready = acceptingNewSessions && seasonReady
    json(response, ready ? 200 : 503, { ready, buildId, protocolVersion: PROTOCOL_VERSION })
    return
  }
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify({
      ok: true,
      buildId,
      acceptingNewSessions,
      rooms: rooms.size,
      protocolVersion: PROTOCOL_VERSION,
      bandPersistence: bandStore !== null,
      verifiedLeaderboardWrites: leaderboardStore !== null,
      rescueOfferPersistence: rescueOfferStore !== null,
      contributionPersistence: contributionStore !== null,
      seasonPersistence: seasonStore !== null,
      socialPersistence: socialStore !== null,
      gameplayAnalytics: gameplayAnalyticsStore !== null,
      experiments: experimentService !== null,
      tokenAccessGate,
      tokenPaymentConfigured: tokenAccessService !== null,
      missionId: defaultMission.id,
      missionVersion: defaultMission.missionVersion,
      missionContentHash: defaultMission.contentHash,
      rotations: rotationService.window(),
      season: seasonService.snapshot(),
    }))
    return
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "Content-Type": "application/json" })
    response.end(JSON.stringify({ error: "Method not allowed" }))
    return
  }
  const requested = pathname === "/" ? "index.html" : normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "")
  const filePath = join(process.cwd(), "dist", requested)
  try {
    const body = await readFile(filePath)
    response.writeHead(200, {
      "Content-Type": contentTypes[extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": staticCacheControl(pathname),
    })
    if (request.method === "HEAD") response.end()
    else response.end(body)
  } catch {
    try {
      const body = await readFile(join(process.cwd(), "dist", "index.html"))
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
      response.end(body)
    } catch {
      response.writeHead(404, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: "Not found" }))
    }
  }
})

function settleRoomOutcomes(code: string, room: Room): boolean {
  let seasonChanged = false
  const seasonOutcome = room.claimSeasonOutcome()
  if (seasonOutcome) {
    seasonChanged = seasonService.recordMission(seasonOutcome)
    const authenticatedUserIds = room.authenticatedUserIds()
    if (socialStore && authenticatedUserIds.length >= 2) {
      pendingRecentPlayers.set(seasonOutcome.eventId, { userIds: authenticatedUserIds, attempts: 0, nextAttemptAt: Date.now() })
      telemetry.gauge("recent_players_persistence_queue", pendingRecentPlayers.size)
    }
  }
  const bandOutcome = room.claimBandMission()
  if (bandOutcome && bandStore) enqueueBandMission(room, bandOutcome, roomTraces.get(code) ?? null)
  const verifiedRuns = room.claimVerifiedRuns()
  if (verifiedRuns && leaderboardStore) for (const run of verifiedRuns) enqueueVerifiedRun(run, roomTraces.get(code) ?? null)
  return seasonChanged
}

const sockets = new WebSocketServer({ server: httpServer, path: "/rooms" })
sockets.on("connection", (socket) => {
  telemetry.increment("connections_total")
  activeConnections += 1
  telemetry.gauge("active_connections", activeConnections)
  let joinedRoom: Room | null = null
  let playerId: string | null = null
  let hubParticipantId: string | null = null
  let lastClientMetricsAt = 0
  let lastClientDiagnosticAt = 0
  let productAnalyticsConsent = false

  socket.on("message", async (raw) => {
    let value: unknown
    try {
      value = JSON.parse(raw.toString())
    } catch {
      telemetry.increment("protocol_invalid_json_total")
      send(socket, { type: "error", code: "INVALID_MESSAGE", message: "Message must be valid JSON" })
      return
    }
    const initial = value && typeof value === "object" ? value as Record<string, unknown> : null
    const initialType = initial?.type
    const isHandshake = initialType === "create_room" || initialType === "join_room" || initialType === "join_public_hub"
    if (isHandshake && initial?.version !== PROTOCOL_VERSION) {
      telemetry.increment("protocol_version_mismatch_total")
      send(socket, { type: "error", code: "VERSION_MISMATCH", message: "A newer Sherwood build is ready. Refreshing…", buildId })
      return
    }
    const message = parseClientMessage(value)
    if (!message) {
      telemetry.increment("protocol_invalid_message_total")
      send(socket, { type: "error", code: "INVALID_MESSAGE", message: "Message failed protocol validation" })
      return
    }

    if (message.type === "create_room" || message.type === "join_room") {
      try {
        if (message.type === "create_room" && !acceptingNewSessions) {
          send(socket, { type: "error", code: "FORBIDDEN", message: "This server is draining for an update. Try again in a moment." })
          return
        }
        productAnalyticsConsent = message.productAnalytics
        if (hubParticipantId) {
          publicHub.leave(hubParticipantId)
          hubParticipantId = null
        }
        const authUserId = await verifySupabaseUser(message.accessToken)
        if (message.accessToken && supabaseUrl && supabasePublishableKey && !authUserId) {
          send(socket, { type: "error", code: "FORBIDDEN", message: "Your Sherwood sign-in expired. Sign in again or continue as a guest." })
          return
        }
        if (!await tokenAccessAllows(authUserId)) {
          telemetry.increment("token_access_room_rejected_total")
          send(socket, { type: "error", code: "FORBIDDEN", message: "Sherwood requires an active 30-day token pass" })
          return
        }
        let persistentBand: PersistentBandRecord | null = null
        if (message.type === "create_room" && authUserId && bandStore) {
          try {
            persistentBand = await bandStore.ensureBand(authUserId, message.displayName, message.characterId)
            telemetry.increment("band_restore_success_total")
          } catch (error) {
            telemetry.increment("band_restore_failure_total")
            structuredLog("band_restore_failed", { reason: error instanceof Error ? error.message : "unknown" }, "error")
          }
        }
        const room = message.type === "create_room"
          ? new Room(
            roomCode(),
            (now) => campaignRotationWindow(rotationService.window(now), seasonService.snapshot(now)),
            (now) => seasonService.snapshot(now),
            persistentBand,
            assignRoomExperiments,
          )
          : rooms.get(message.roomCode)
        if (!room) {
          send(socket, { type: "error", code: "ROOM_NOT_FOUND", message: "Merry Band room not found" })
          return
        }
        if (message.type === "create_room") rooms.set(room.code, room)
        if (message.type === "join_room" && room.players.size === 0 && !room.band && authUserId && bandStore) {
          try {
            room.attachPersistentBand(await bandStore.ensureBand(authUserId, message.displayName, message.characterId))
            telemetry.increment("band_restore_success_total")
          } catch (error) {
            telemetry.increment("band_restore_failure_total")
            structuredLog("band_restore_failed", { traceId: roomTraces.get(room.code) ?? null, reason: error instanceof Error ? error.message : "unknown" }, "error")
          }
        }
        if (message.type === "join_room" && message.reconnectToken) telemetry.increment("reconnect_attempts_total")
        const reconnected = message.type === "join_room" && message.reconnectToken
          ? room.reconnect(socket, message.reconnectToken, Date.now(), authUserId, message.productAnalytics, message.buildId)
          : null
        const player = reconnected ?? room.addPlayer(socket, message.displayName, message.characterId, authUserId, false, message.productAnalytics, message.buildId)
        telemetry.increment(reconnected ? "reconnect_success_total" : message.type === "create_room" ? "rooms_created_total" : "room_joins_total")
        if (message.type === "create_room") {
          const traceId = randomUUID()
          roomTraces.set(room.code, traceId)
          structuredLog("room_created", { traceId })
        }
        joinedRoom = room
        reservedRoomsUntil.delete(room.code)
        playerId = player.id
        send(socket, { type: "welcome", version: PROTOCOL_VERSION, buildId, playerId: player.id, reconnectToken: player.reconnectToken, roomCode: room.code })
        room.broadcastRoomState()
      } catch (error) {
        const reason = error instanceof Error ? error.message : "MISSION_STARTED"
        const code = reason === "ROOM_FULL" ? "ROOM_FULL" : reason === "ROLE_FULL" ? "ROLE_FULL" : "MISSION_STARTED"
        const message = code === "ROOM_FULL"
          ? "This Merry Band is full"
          : code === "ROLE_FULL"
            ? "That role is full — choose the other outlaw"
            : "This mission has already begun"
        send(socket, { type: "error", code, message })
      }
      return
    }

    if (message.type === "join_public_hub") {
      if (!acceptingNewSessions) {
        send(socket, { type: "error", code: "FORBIDDEN", message: "This server is draining for an update. Try again in a moment." })
        return
      }
      productAnalyticsConsent = message.productAnalytics
      if (joinedRoom || hubParticipantId) {
        send(socket, { type: "error", code: "FORBIDDEN", message: "Leave the current band or public camp before joining another" })
        return
      }
      const authUserId = await verifySupabaseUser(message.accessToken)
      if (!authUserId) {
        telemetry.increment("hub_auth_rejected_total")
        send(socket, { type: "error", code: "FORBIDDEN", message: "The public camp requires a current Sherwood sign-in" })
        return
      }
      if (!await tokenAccessAllows(authUserId)) {
        telemetry.increment("token_access_hub_rejected_total")
        send(socket, { type: "error", code: "FORBIDDEN", message: "The public camp requires an active 30-day token pass" })
        return
      }
      const [friendIds, blockedIds] = await Promise.all([
        socialStore?.getAcceptedFriendIds(authUserId).catch(() => []) ?? [],
        socialStore?.getHubBlockedIds(authUserId).catch(() => []) ?? [],
      ])
      const participant = publicHub.join(socket, authUserId, message.displayName, message.characterId, friendIds, Date.now(), blockedIds)
      hubParticipantId = participant.id
      telemetry.increment("hub_opt_ins_total")
      return
    }

    if (message.type === "client_diagnostic") {
      if (productAnalyticsConsent && Date.now() - lastClientDiagnosticAt >= 10_000) {
        lastClientDiagnosticAt = Date.now()
        telemetry.increment("client_diagnostic_reports_total")
        telemetry.increment(`client_diagnostic_${message.code}_total`)
        telemetry.increment(`client_render_${message.renderProfile}_total`)
        telemetry.increment(`client_browser_${message.browserFamily}_total`)
        if (joinedRoom && playerId) recordGameplayDiagnostic(joinedRoom, message.code, playerId)
      }
      return
    }

    if (message.type === "set_product_analytics") {
      productAnalyticsConsent = message.consented
      if (joinedRoom && playerId) joinedRoom.setProductAnalyticsConsent(playerId, message.consented)
      telemetry.increment(message.consented ? "gameplay_analytics_consent_enabled_total" : "gameplay_analytics_consent_disabled_total")
      return
    }

    if (hubParticipantId) {
      if (message.type === "hub_intent") publicHub.setIntent(hubParticipantId, message.looking, message.targetPreference, message.desiredPartySize as 2 | 3 | 4)
      else if (message.type === "hub_move") publicHub.move(hubParticipantId, message.sequence, message.move)
      else if (message.type === "hub_emote") {
        if (publicHub.emote(hubParticipantId, message.kind)) telemetry.increment(`hub_emote_${message.kind}_total`)
        else telemetry.increment("hub_emote_rate_limited_total")
      } else if (message.type === "hub_ping") {
        if (publicHub.ping(hubParticipantId, message.kind)) telemetry.increment(`hub_ping_${message.kind}_total`)
        else telemetry.increment("hub_ping_rate_limited_total")
      } else if (message.type === "hub_report") {
        const report = publicHub.report(hubParticipantId, message.targetParticipantId, message.reason)
        if (report) {
          telemetry.increment("hub_reports_total")
          structuredLog("hub_reported", { reason: message.reason })
          void socialStore?.recordHubReport(report.reporterUserId, report.targetUserId, report.reason).catch(() => telemetry.increment("hub_report_persistence_failure_total"))
        } else telemetry.increment("hub_report_rate_limited_total")
      } else if (message.type === "hub_block") {
        const block = publicHub.block(hubParticipantId, message.targetParticipantId)
        if (block) {
          telemetry.increment("hub_blocks_total")
          void socialStore?.recordHubBlock(block.blockerUserId, block.blockedUserId).catch(() => telemetry.increment("hub_block_persistence_failure_total"))
        }
      } else if (message.type === "hub_form_band") {
        const group = publicHub.formBand(hubParticipantId)
        if (!group) send(socket, { type: "error", code: "FORBIDDEN", message: "At least one compatible looking-for-band outlaw is required" })
        else reservePublicBand(group, false)
      } else if (message.type === "hub_leave") {
        publicHub.leave(hubParticipantId)
        hubParticipantId = null
        telemetry.increment("hub_leaves_total")
      } else if (message.type === "ping") send(socket, { type: "pong", clientTime: message.clientTime, serverTime: Date.now() })
      return
    }

    if (!joinedRoom || !playerId) {
      send(socket, { type: "error", code: "NOT_JOINED", message: "Join a room before sending mission actions" })
      return
    }
    if (message.type === "set_ready" && !joinedRoom.setReady(playerId, message.ready) && message.ready) {
      send(socket, { type: "error", code: "FORBIDDEN", message: joinedRoom.hasConfirmedRole(playerId) ? "That daily target expired or requires a different party size" : "Choose an available outlaw before readying up" })
    }
    if (message.type === "set_ready" && message.ready) telemetry.increment("players_ready_total")
    if (message.type === "select_character") {
      if (!joinedRoom.selectCharacter(playerId, message.characterId)) {
        send(socket, { type: "error", code: "ROLE_FULL", message: "That role is full — choose another outlaw" })
        joinedRoom.broadcastRoomState()
      } else {
        const mutation = joinedRoom.bandHeroRoleUpdate(playerId)
        if (mutation && bandStore) {
          try {
            joinedRoom.refreshPersistentBand(await bandStore.setHeroRole(mutation.bandId, mutation.userId, mutation.heroRole))
            joinedRoom.broadcastRoomState()
            telemetry.increment("band_hero_role_update_total")
          } catch (error) {
            telemetry.increment("band_hero_role_update_failure_total")
            structuredLog("band_hero_role_update_failed", { traceId: roomTraces.get(joinedRoom.code) ?? null, reason: error instanceof Error ? error.message : "unknown" }, "error")
          }
        }
      }
    }
    if (message.type === "offer_band_membership") {
      if (!joinedRoom.offerBandMembership(playerId, message.targetPlayerId)) send(socket, { type: "error", code: "FORBIDDEN", message: "Only the band leader can offer an authenticated outlaw permanent membership" })
      else telemetry.increment("band_membership_offers_total")
    }
    if (message.type === "respond_band_membership") {
      if (!message.accept) {
        if (!joinedRoom.declineBandMembership(playerId)) send(socket, { type: "error", code: "FORBIDDEN", message: "There is no active band offer to decline" })
        else telemetry.increment("band_membership_declines_total")
      } else {
        const mutation = joinedRoom.bandMembershipCandidate(playerId)
        if (!mutation || !bandStore) send(socket, { type: "error", code: "FORBIDDEN", message: bandStore ? "There is no active band offer to accept" : "Permanent Merry Bands are not available on this server" })
        else {
          try {
            const record = await bandStore.addMember(mutation.bandId, mutation.actorUserId, mutation.memberUserId, mutation.heroRole)
            if (!joinedRoom.acceptBandMembership(playerId, record)) throw new Error("BAND_OFFER_EXPIRED")
            telemetry.increment("band_membership_accepts_total")
          } catch (error) {
            telemetry.increment("band_membership_accept_failure_total")
            send(socket, { type: "error", code: "FORBIDDEN", message: "Permanent band membership could not be saved" })
            structuredLog("band_membership_accept_failed", { traceId: roomTraces.get(joinedRoom.code) ?? null, reason: error instanceof Error ? error.message : "unknown" }, "error")
          }
        }
      }
    }
    if (message.type === "update_band_identity") {
      const actor = joinedRoom.bandIdentityActor(playerId)
      if (!actor || !bandStore) send(socket, { type: "error", code: "FORBIDDEN", message: "Only the persistent band leader can change its name or banner" })
      else {
        try {
          joinedRoom.refreshPersistentBand(await bandStore.updateIdentity(actor.bandId, actor.actorUserId, message.name, message.bannerId))
          joinedRoom.broadcastRoomState()
          telemetry.increment("band_identity_updates_total")
        } catch (error) {
          telemetry.increment("band_identity_update_failure_total")
          send(socket, { type: "error", code: "FORBIDDEN", message: "The band name or banner could not be saved" })
          structuredLog("band_identity_update_failed", { traceId: roomTraces.get(joinedRoom.code) ?? null, reason: error instanceof Error ? error.message : "unknown" }, "error")
        }
      }
    }
    if (message.type === "remove_band_member") {
      const mutation = joinedRoom.bandRemovalCandidate(playerId, message.targetPlayerId)
      if (!mutation || !bandStore) send(socket, { type: "error", code: "FORBIDDEN", message: "Only the band leader can remove an active member" })
      else {
        try {
          joinedRoom.refreshPersistentBand(await bandStore.removeMember(mutation.bandId, mutation.actorUserId, mutation.memberUserId))
          joinedRoom.broadcastRoomState()
          telemetry.increment("band_membership_removals_total")
        } catch (error) {
          telemetry.increment("band_membership_remove_failure_total")
          send(socket, { type: "error", code: "FORBIDDEN", message: "That band member could not be removed" })
          structuredLog("band_membership_remove_failed", { traceId: roomTraces.get(joinedRoom.code) ?? null, reason: error instanceof Error ? error.message : "unknown" }, "error")
        }
      }
    }
    if (message.type === "select_mission" && !joinedRoom.selectMission(playerId, message.missionSlug)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "Only the band leader can choose an available mission" })
    }
    if (message.type === "select_rotation" && !joinedRoom.selectRotation(playerId, message.rotationId)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "That Sheriff target is expired, paused, or unavailable" })
    }
    if (message.type === "select_loadout" && !joinedRoom.selectLoadout(playerId, message.loadoutId)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "Field kits can only change at the campfire" })
    }
    if (message.type === "return_to_hub") {
      const completedMissionScope = joinedRoom.analyticsScope()
      joinedRoom.update(0)
      settleRoomOutcomes(joinedRoom.code, joinedRoom)
      if (!joinedRoom.returnToHub(playerId)) send(socket, { type: "error", code: "FORBIDDEN", message: "Resolve the village vote before the leader returns the band to camp" })
      else experimentService?.releaseRoom(completedMissionScope)
    }
    if (message.type === "accept_rescue" && !joinedRoom.acceptRescue(playerId, message.offerId)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "That rescue offer expired, was already handled, or requires the band leader" })
    }
    if (message.type === "abandon_rescue" && !joinedRoom.abandonRescue(playerId, message.offerId)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "That rescue offer cannot be abandoned" })
    }
    if (message.type === "deposit_contribution" && !joinedRoom.depositContribution(playerId, message.contributionType)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "The shared cache is full, expired, or unavailable during a mission" })
    }
    if (message.type === "toggle_contribution" && !joinedRoom.toggleContribution(playerId, message.contributionId)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "Only the band leader can select up to three available preparations" })
    }
    if (message.type === "revoke_contribution" && !joinedRoom.revokeContribution(playerId, message.contributionId)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "Only the contributor can revoke an unlocked preparation" })
    }
    if (message.type === "input") joinedRoom.setInput(playerId, message.sequence, message.move)
    if (message.type === "action") {
      joinedRoom.action(playerId, message.action, message.targetPlayerId)
      telemetry.increment(`action_${message.action}_total`)
    }
    if (message.type === "world_ping") joinedRoom.ping(playerId, message.kind)
    if (message.type === "world_ping") telemetry.increment("world_pings_total")
    if (message.type === "redistribution_vote") {
      joinedRoom.vote(playerId, message.choice)
      telemetry.increment("redistribution_votes_total")
    }
    if (message.type === "select_mission") telemetry.increment("hub_mission_selections_total")
    if (message.type === "select_rotation") telemetry.increment("rotation_selections_total")
    if (message.type === "select_loadout") telemetry.increment(`hub_loadout_${message.loadoutId}_total`)
    if (message.type === "return_to_hub") telemetry.increment("hub_returns_total")
    if (message.type === "accept_rescue") telemetry.increment("rescue_offer_accept_attempts_total")
    if (message.type === "abandon_rescue") telemetry.increment("rescue_offer_abandon_attempts_total")
    if (message.type === "deposit_contribution") telemetry.increment(`contribution_${message.contributionType}_deposit_attempts_total`)
    if (message.type === "toggle_contribution") telemetry.increment("contribution_selection_attempts_total")
    if (message.type === "revoke_contribution") telemetry.increment("contribution_revoke_attempts_total")
    if (message.type === "moderation" && !joinedRoom.moderate(playerId, message.targetPlayerId, message.action, message.reason)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "That moderation action is not allowed" })
    }
    if (message.type === "moderation") telemetry.increment(`moderation_${message.action}_total`)
    if (message.type === "client_metrics" && Date.now() - lastClientMetricsAt >= 5_000) {
      lastClientMetricsAt = Date.now()
      telemetry.increment("client_metrics_reports_total")
      telemetry.increment(`input_backlog_${message.inputBacklog <= 2 ? "healthy" : message.inputBacklog <= 10 ? "degraded" : "desynced"}_total`)
      telemetry.increment(`snapshot_gap_${message.snapshotGapMs <= 250 ? "healthy" : message.snapshotGapMs <= 1_000 ? "degraded" : "desynced"}_total`)
    }
    if (message.type === "ping") send(socket, { type: "pong", clientTime: message.clientTime, serverTime: Date.now() })
  })

  socket.on("close", () => {
    activeConnections = Math.max(0, activeConnections - 1)
    telemetry.gauge("active_connections", activeConnections)
    telemetry.increment("disconnects_total")
    if (joinedRoom && playerId) joinedRoom.disconnect(playerId)
    if (hubParticipantId) publicHub.leave(hubParticipantId)
  })
})

setInterval(() => {
  let activePlayers = 0
  let seasonChanged = false
  for (const [code, room] of rooms) {
    room.update(1 / 20)
    try {
      observeRoomGameplay(room)
    } catch (error) {
      telemetry.increment("gameplay_analytics_observation_rejected_total")
      structuredLog("gameplay_analytics_observation_rejected", { reason: error instanceof Error ? error.message : "unknown" }, "warn")
    }
    for (const transition of room.drainRescueOfferEvents()) {
      enqueueRescueTransition(transition)
      telemetry.increment(`rescue_offer_${transition.offer.status}_total`)
      structuredLog("rescue_offer_transition", {
        traceId: roomTraces.get(code) ?? null,
        offerId: transition.offer.id,
        status: transition.offer.status,
        context: transition.offer.context,
        targetCount: transition.offer.targetCount,
        attempts: transition.offer.attempts,
      })
    }
    for (const transition of room.drainContributionEvents()) {
      enqueueContributionTransition(transition)
      if (transition.contribution.status === "consumed") seasonChanged = seasonService.recordContribution({ eventId: transition.contribution.id, occurredAt: transition.at, type: transition.contribution.type }) || seasonChanged
      telemetry.increment(`contribution_${transition.contribution.status}_total`)
      structuredLog("contribution_transition", {
        traceId: roomTraces.get(code) ?? null,
        contributionId: transition.contribution.id,
        contributionType: transition.contribution.type,
        status: transition.contribution.status,
        missionId: transition.contribution.missionId,
      })
    }
    seasonChanged = settleRoomOutcomes(code, room) || seasonChanged
    if (room.players.size === 0 && (reservedRoomsUntil.get(code) ?? 0) <= Date.now()) {
      rooms.delete(code)
      reservedRoomsUntil.delete(code)
      observedRoomPhases.delete(code)
      observedMissionStatus.delete(code)
      observedGameplayEventSequences.delete(code)
      experimentService?.releaseRoom(room.analyticsScope())
      const traceId = roomTraces.get(code) ?? null
      roomTraces.delete(code)
      structuredLog("room_expired", { traceId })
      continue
    }
    activePlayers += [...room.players.values()].filter((player) => player.connected).length
    const phase = room.mission?.phase
    if (phase && observedRoomPhases.get(code) !== phase) {
      observedRoomPhases.set(code, phase)
      telemetry.increment(`mission_phase_${phase}_total`)
      structuredLog("mission_phase_changed", { traceId: roomTraces.get(code) ?? null, phase, partySize: room.players.size })
      if (phase === "scout" && room.mission?.rotationId) {
        telemetry.increment("rotation_starts_total")
        if (room.rotationAttemptCount > 1) telemetry.increment("rotation_repeat_attempts_total")
        telemetry.increment(`rotation_party_${room.players.size}_starts_total`)
        for (const modifier of room.mission.rotationModifierIds) telemetry.increment(`rotation_modifier_${modifier}_starts_total`)
        for (const player of room.players.values()) telemetry.increment(`rotation_role_${player.characterId}_starts_total`)
      }
    }
    const status = room.mission?.status
    if (status && observedMissionStatus.get(code) !== status) {
      observedMissionStatus.set(code, status)
      if (status !== "active") {
        telemetry.increment(`mission_${status}_total`)
        if (room.mission?.rotationId) telemetry.increment(`rotation_${status}_total`)
        structuredLog("mission_finished", { traceId: roomTraces.get(code) ?? null, status, partySize: room.players.size })
      }
    }
  }
  telemetry.gauge("active_rooms", rooms.size)
  telemetry.gauge("active_players", activePlayers)
  if (seasonReady) {
    captureSeasonTransitions()
  }
  if (seasonChanged) for (const room of rooms.values()) room.broadcastRoomState()
}, 50)

setInterval(() => void flushRescueTransitions(), 1_000)
setInterval(() => void flushContributionTransitions(), 1_000)
setInterval(() => void flushSeasonTransitions(), 1_000)
setInterval(() => void flushRecentPlayers(), 1_000)
setInterval(() => void flushBandMissions(), 1_000)
setInterval(() => void flushVerifiedRuns(), 1_000)
setInterval(() => void finalizeLeaderboardSeasons(), 30_000)
setInterval(() => {
  const now = Date.now()
  for (const batch of gameplayAnalytics?.flushReady(now) ?? []) enqueueGameplayAnalytics(batch)
  void flushGameplayAnalytics(now)
}, 15_000)
setInterval(() => void experimentService?.refresh().catch((error) => {
  telemetry.increment("experiment_refresh_failure_total")
  structuredLog("experiment_refresh_failed", { reason: error instanceof Error ? error.message : "unknown" }, "error")
}), 60_000)

setInterval(() => {
  for (const room of rooms.values()) room.broadcastSnapshot()
}, 100)

setInterval(() => {
  publicHub.cleanup()
  if (acceptingNewSessions) for (const group of publicHub.drainMatches()) reservePublicBand(group, true)
  publicHub.broadcastAll()
  telemetry.gauge("public_hub_instances", publicHub.instances.size)
  telemetry.gauge("public_hub_players", [...publicHub.instances.values()].reduce((sum, instance) => sum + instance.participants.size, 0))
}, 250)

async function startServer(): Promise<void> {
  if (seasonStore) {
    const recovered = await seasonStore.loadCurrent()
    if (recovered) {
      seasonService.hydrate(recovered.snapshot, recovered.processedEventIds, recovered.lastSequence)
      structuredLog("season_recovered", { seasonSlug: recovered.snapshot.slug, phase: recovered.snapshot.phase, revision: recovered.snapshot.revision, replayIds: recovered.processedEventIds.length, lastSequence: recovered.lastSequence })
    }
    seasonReady = true
  }
  if (experimentService) {
    try {
      await experimentService.refresh(Date.now(), true)
      telemetry.gauge("active_experiment_definitions", experimentService.activeDefinitionCount())
    } catch (error) {
      telemetry.increment("experiment_refresh_failure_total")
      structuredLog("experiment_refresh_failed", { reason: error instanceof Error ? error.message : "unknown" }, "error")
    }
  }
  httpServer.listen(port, "0.0.0.0", () => {
    structuredLog("server_started", {
      port,
      buildId,
      protocolVersion: PROTOCOL_VERSION,
      bandPersistence: bandStore !== null,
      verifiedLeaderboardWrites: leaderboardStore !== null,
      rescueOfferPersistence: rescueOfferStore !== null,
      contributionPersistence: contributionStore !== null,
      seasonPersistence: seasonStore !== null,
      socialPersistence: socialStore !== null,
      gameplayAnalytics: gameplayAnalyticsStore !== null,
      experiments: experimentService !== null,
      tokenAccessGate,
      tokenPaymentConfigured: tokenAccessService !== null,
      seasonSlug: seasonService.snapshot().slug,
      seasonPhase: seasonService.snapshot().phase,
      missionId: defaultMission.id,
      missionVersion: defaultMission.missionVersion,
      missionContentHash: defaultMission.contentHash,
    })
  })
}

void startServer().catch((error) => {
  structuredLog("server_start_failed", { reason: error instanceof Error ? error.message : "unknown" }, "error")
  process.exit(1)
})

function beginDrain(signal: NodeJS.Signals): void {
  if (draining) return
  draining = true
  acceptingNewSessions = false
  structuredLog("server_draining", { signal, buildId, activeConnections, activeRooms: rooms.size })
  sockets.close()
  const now = Date.now()
  for (const batch of gameplayAnalytics?.flushAll(now) ?? []) enqueueGameplayAnalytics(batch)
  let analyticsFlushComplete = gameplayAnalyticsStore === null
  void flushGameplayAnalytics(Date.now()).finally(() => {
    analyticsFlushComplete = true
  })

  let finished = false
  const finish = (): void => {
    if (finished) return
    finished = true
    clearInterval(check)
    clearTimeout(deadline)
    httpServer.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 1_000).unref()
  }
  const check = setInterval(() => {
    if (activeConnections === 0 && analyticsFlushComplete) finish()
  }, 250)
  check.unref()
  const deadline = setTimeout(() => {
    for (const client of sockets.clients) client.terminate()
    finish()
  }, 25_000)
  deadline.unref()
}

process.once("SIGTERM", () => beginDrain("SIGTERM"))
process.once("SIGINT", () => beginDrain("SIGINT"))
