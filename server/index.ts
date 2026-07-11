import { createServer } from "node:http"
import { randomInt, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { extname, join, normalize } from "node:path"
import { WebSocket, WebSocketServer } from "ws"
import { PROTOCOL_VERSION, parseClientMessage, type ServerMessage } from "../shared/protocol"
import { Room, type ContributionTransition, type RescueOfferTransition } from "./room"
import { createBandStoreFromEnv, type CompletedBandMission, type PersistentBandRecord } from "./band-store"
import { createLeaderboardStoreFromEnv, type VerifiedRun } from "./leaderboard-store"
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
import { PublicHubService } from "./public-hub"

const port = Number(process.env.PORT ?? 8787)
const rooms = new Map<string, Room>()
const bandStore = createBandStoreFromEnv()
const leaderboardStore = createLeaderboardStoreFromEnv()
const rescueOfferStore = createRescueOfferStoreFromEnv()
const contributionStore = createContributionStoreFromEnv()
const seasonStore = createSeasonStoreFromEnv()
const socialStore = createSocialStoreFromEnv()
const publicHub = new PublicHubService()
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

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
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

function operatorAuthorized(request: import("node:http").IncomingMessage): boolean {
  return Boolean(opsAdminSecret && request.headers.authorization === `Bearer ${opsAdminSecret}`)
}

async function verifySupabaseUser(accessToken: string | undefined): Promise<string | null> {
  if (!accessToken || !supabaseUrl || !supabasePublishableKey) return null
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: supabasePublishableKey, Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return null
    const value = await response.json() as { id?: unknown }
    return typeof value.id === "string" && value.id.match(/^[0-9a-f-]{36}$/) ? value.id : null
  } catch {
    return null
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
        pending.attempts += 1
        pending.nextAttemptAt = now + Math.min(60_000, 1_000 * 2 ** Math.min(6, pending.attempts))
        telemetry.increment("leaderboard_persistence_retry_total")
        structuredLog("leaderboard_persistence_retry", { traceId: pending.traceId, missionId: pending.run.missionId, attempts: pending.attempts, reason: error instanceof Error ? error.message : "unknown" }, "error")
      }
    }
  } finally {
    leaderboardPersistenceFlushing = false
    telemetry.gauge("leaderboard_persistence_queue", pendingLeaderboardRuns.size)
  }
}

const httpServer = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname
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
      telemetry.increment(`season_admin_${operation}_total`)
      structuredLog("season_admin_changed", { operation })
      const snapshot = seasonService.snapshot()
      for (const room of rooms.values()) room.broadcastRoomState()
      json(response, 200, snapshot)
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : "Invalid season operation" })
    }
    return
  }
  if (request.url === "/metrics") {
    response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" })
    response.end(JSON.stringify(telemetry.snapshot()))
    return
  }
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify({
      ok: true,
      rooms: rooms.size,
      protocolVersion: PROTOCOL_VERSION,
      bandPersistence: bandStore !== null,
      verifiedLeaderboardWrites: leaderboardStore !== null,
      rescueOfferPersistence: rescueOfferStore !== null,
      contributionPersistence: contributionStore !== null,
      seasonPersistence: seasonStore !== null,
      socialPersistence: socialStore !== null,
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
      "Cache-Control": filePath.endsWith("index.html") ? "no-cache" : "public, max-age=31536000, immutable",
    })
    if (request.method === "HEAD") response.end()
    else response.end(body)
  } catch {
    try {
      const body = await readFile(join(process.cwd(), "dist", "index.html"))
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" })
      response.end(body)
    } catch {
      response.writeHead(404, { "Content-Type": "application/json" })
      response.end(JSON.stringify({ error: "Not found" }))
    }
  }
})

const sockets = new WebSocketServer({ server: httpServer, path: "/rooms" })
sockets.on("connection", (socket) => {
  telemetry.increment("connections_total")
  activeConnections += 1
  telemetry.gauge("active_connections", activeConnections)
  let joinedRoom: Room | null = null
  let playerId: string | null = null
  let hubParticipantId: string | null = null
  let lastClientMetricsAt = 0

  socket.on("message", async (raw) => {
    let value: unknown
    try {
      value = JSON.parse(raw.toString())
    } catch {
      telemetry.increment("protocol_invalid_json_total")
      send(socket, { type: "error", code: "INVALID_MESSAGE", message: "Message must be valid JSON" })
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
        if (hubParticipantId) {
          publicHub.leave(hubParticipantId)
          hubParticipantId = null
        }
        const authUserId = await verifySupabaseUser(message.accessToken)
        if (message.accessToken && supabaseUrl && supabasePublishableKey && !authUserId) {
          send(socket, { type: "error", code: "FORBIDDEN", message: "Your Sherwood sign-in expired. Sign in again or continue as a guest." })
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
          ? room.reconnect(socket, message.reconnectToken, Date.now(), authUserId)
          : null
        const player = reconnected ?? room.addPlayer(socket, message.displayName, message.characterId, authUserId)
        telemetry.increment(reconnected ? "reconnect_success_total" : message.type === "create_room" ? "rooms_created_total" : "room_joins_total")
        if (message.type === "create_room") {
          const traceId = randomUUID()
          roomTraces.set(room.code, traceId)
          structuredLog("room_created", { traceId })
        }
        joinedRoom = room
        reservedRoomsUntil.delete(room.code)
        playerId = player.id
        send(socket, { type: "welcome", version: PROTOCOL_VERSION, playerId: player.id, reconnectToken: player.reconnectToken, roomCode: room.code })
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
      const [friendIds, blockedIds] = await Promise.all([
        socialStore?.getAcceptedFriendIds(authUserId).catch(() => []) ?? [],
        socialStore?.getHubBlockedIds(authUserId).catch(() => []) ?? [],
      ])
      const participant = publicHub.join(socket, authUserId, message.displayName, message.characterId, friendIds, Date.now(), blockedIds)
      hubParticipantId = participant.id
      telemetry.increment("hub_opt_ins_total")
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
        else {
          const code = roomCode()
          const room = new Room(code, (now) => campaignRotationWindow(rotationService.window(now), seasonService.snapshot(now)), (now) => seasonService.snapshot(now))
          rooms.set(code, room)
          reservedRoomsUntil.set(code, Date.now() + 10_000)
          roomTraces.set(code, randomUUID())
          group.forEach((participant, index) => send(participant.socket, { type: "hub_band_ready", roomCode: code, leader: index === 0 }))
          telemetry.increment("hub_private_bands_formed_total")
          structuredLog("hub_private_band_formed", { traceId: roomTraces.get(code) ?? null, partySize: group.length })
        }
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
      send(socket, { type: "error", code: "FORBIDDEN", message: "That daily target expired or requires a different party size" })
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
    if (message.type === "return_to_hub" && !joinedRoom.returnToHub(playerId)) {
      send(socket, { type: "error", code: "FORBIDDEN", message: "Resolve the village vote before the leader returns the band to camp" })
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
    const seasonOutcome = room.claimSeasonOutcome()
    if (seasonOutcome) {
      seasonChanged = seasonService.recordMission(seasonOutcome) || seasonChanged
      const authenticatedUserIds = room.authenticatedUserIds()
      if (socialStore && authenticatedUserIds.length >= 2) {
        pendingRecentPlayers.set(seasonOutcome.eventId, { userIds: authenticatedUserIds, attempts: 0, nextAttemptAt: Date.now() })
        telemetry.gauge("recent_players_persistence_queue", pendingRecentPlayers.size)
      }
    }
    const bandOutcome = bandStore ? room.claimBandMission() : null
    if (bandOutcome) enqueueBandMission(room, bandOutcome, roomTraces.get(code) ?? null)
    const verifiedRuns = leaderboardStore ? room.claimVerifiedRuns() : null
    if (verifiedRuns) for (const run of verifiedRuns) enqueueVerifiedRun(run, roomTraces.get(code) ?? null)
    if (room.players.size === 0 && (reservedRoomsUntil.get(code) ?? 0) <= Date.now()) {
      rooms.delete(code)
      reservedRoomsUntil.delete(code)
      observedRoomPhases.delete(code)
      observedMissionStatus.delete(code)
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
    for (const transition of seasonService.drainTransitions()) {
      enqueueSeasonTransition(transition)
      telemetry.increment(`season_${transition.eventType}_events_total`)
      telemetry.gauge("season_pressure", transition.snapshot.pressure)
      structuredLog("season_transition", { eventId: transition.eventId, eventType: transition.eventType, phase: transition.snapshot.phase, revision: transition.snapshot.revision })
    }
  }
  if (seasonChanged) for (const room of rooms.values()) room.broadcastRoomState()
}, 50)

setInterval(() => void flushRescueTransitions(), 1_000)
setInterval(() => void flushContributionTransitions(), 1_000)
setInterval(() => void flushSeasonTransitions(), 1_000)
setInterval(() => void flushRecentPlayers(), 1_000)
setInterval(() => void flushBandMissions(), 1_000)
setInterval(() => void flushVerifiedRuns(), 1_000)

setInterval(() => {
  for (const room of rooms.values()) room.broadcastSnapshot()
}, 100)

setInterval(() => {
  publicHub.cleanup()
  publicHub.broadcastAll()
  telemetry.gauge("public_hub_instances", publicHub.instances.size)
  telemetry.gauge("public_hub_players", [...publicHub.instances.values()].reduce((sum, instance) => sum + instance.participants.size, 0))
}, 250)

async function startServer(): Promise<void> {
  if (seasonStore) {
    const recovered = await seasonStore.loadCurrent()
    if (recovered) {
      seasonService.hydrate(recovered.snapshot, recovered.processedEventIds)
      structuredLog("season_recovered", { seasonSlug: recovered.snapshot.slug, phase: recovered.snapshot.phase, revision: recovered.snapshot.revision, replayIds: recovered.processedEventIds.length })
    }
    seasonReady = true
  }
  httpServer.listen(port, "0.0.0.0", () => {
    structuredLog("server_started", {
      port,
      protocolVersion: PROTOCOL_VERSION,
      bandPersistence: bandStore !== null,
      verifiedLeaderboardWrites: leaderboardStore !== null,
      rescueOfferPersistence: rescueOfferStore !== null,
      contributionPersistence: contributionStore !== null,
      seasonPersistence: seasonStore !== null,
      socialPersistence: socialStore !== null,
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
