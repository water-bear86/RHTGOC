import { createServer } from "node:http"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { WebSocket } from "ws"

const { version: protocolVersion } = JSON.parse(readFileSync(new URL("../shared/protocol-version.json", import.meta.url), "utf8"))
const handshake = { version: protocolVersion, buildId: process.env.BUILD_ID ?? "dev", productAnalytics: false }
const roomPort = 18_788
const authPort = 19_999
const roomEndpoint = `ws://127.0.0.1:${roomPort}/rooms`
const users = new Map([
  ["Bearer token-a-header.payload.signature-long", "66778899-aabb-4cdd-8eef-001122334455"],
  ["Bearer token-b-header.payload.signature-long", "778899aa-bbcc-4dee-8ff0-112233445566"],
])
let persistedChatReport = null

const authServer = createServer(async (request, response) => {
  if (request.url?.startsWith("/rest/v1/rpc/")) {
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
    const rpc = request.url.split("/").at(-1)
    if (rpc === "record_public_hub_chat_report") persistedChatReport = body
    let result = true
    if (rpc === "load_current_sherwood_campaign") result = null
    else if (rpc === "get_accepted_friend_ids" || rpc === "get_public_hub_blocked_ids") result = []
    else if (rpc === "prune_public_hub_chat_reports") result = 0
    response.writeHead(200, { "Content-Type": "application/json" })
    response.end(JSON.stringify(result))
    return
  }
  const id = users.get(request.headers.authorization ?? "")
  response.writeHead(id ? 200 : 401, { "Content-Type": "application/json" })
  response.end(JSON.stringify(id ? { id } : { error: "invalid" }))
})
await new Promise((resolve, reject) => {
  authServer.once("error", reject)
  authServer.listen(authPort, "127.0.0.1", resolve)
})

const roomServer = spawn("npm", ["run", "server"], {
  cwd: new URL("..", import.meta.url),
  env: {
    ...process.env,
    PORT: String(roomPort),
    SUPABASE_URL: `http://127.0.0.1:${authPort}`,
    SUPABASE_PUBLISHABLE_KEY: "test",
    SUPABASE_SECRET_KEY: "test-service-secret",
    PUBLIC_CAMP_CHAT_ENABLED: "true",
    OPS_ADMIN_SECRET: "test",
  },
  stdio: ["ignore", "pipe", "pipe"],
})
let roomLogs = ""
roomServer.stdout.on("data", (chunk) => { roomLogs += chunk.toString() })
roomServer.stderr.on("data", (chunk) => { roomLogs += chunk.toString() })

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${roomPort}/health`)
      if (response.ok) return
    } catch { /* server is still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Room server failed to start\n${roomLogs}`)
}

function waitForMessage(socket, predicate, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage)
      reject(new Error(`Timed out waiting for public-hub message after ${timeoutMs}ms`))
    }, timeoutMs)
    const onMessage = (raw) => {
      const message = JSON.parse(raw.toString())
      if (!predicate(message)) return
      clearTimeout(timeout)
      socket.off("message", onMessage)
      resolve(message)
    }
    socket.on("message", onMessage)
  })
}

async function connect() {
  const socket = new WebSocket(roomEndpoint)
  await new Promise((resolve, reject) => {
    socket.once("open", resolve)
    socket.once("error", reject)
  })
  return socket
}

const sockets = []
try {
  await waitForHealth()
  const first = await connect(); sockets.push(first)
  const second = await connect(); sockets.push(second)
  const firstWelcomePromise = waitForMessage(first, (message) => message.type === "hub_welcome")
  const secondWelcomePromise = waitForMessage(second, (message) => message.type === "hub_welcome")
  const firstChatHistoryPromise = waitForMessage(first, (message) => message.type === "chat_history" && message.channel === "camp")
  const secondChatHistoryPromise = waitForMessage(second, (message) => message.type === "chat_history" && message.channel === "camp")
  first.send(JSON.stringify({ type: "join_public_hub", ...handshake, displayName: "Oakheart", characterId: "robin", accessToken: "token-a-header.payload.signature-long" }))
  second.send(JSON.stringify({ type: "join_public_hub", ...handshake, displayName: "Willow", characterId: "marian", accessToken: "token-b-header.payload.signature-long" }))
  const [firstWelcome, secondWelcome] = await Promise.all([firstWelcomePromise, secondWelcomePromise])
  await Promise.all([firstChatHistoryPromise, secondChatHistoryPromise])

  const receivedChatPromise = waitForMessage(second, (message) => message.type === "chat_message" && message.message?.channel === "camp")
  first.send(JSON.stringify({ type: "chat_send", channel: "camp", text: "Meet by the public fire" }))
  const receivedChat = await receivedChatPromise
  second.send(JSON.stringify({ type: "chat_report", channel: "camp", messageId: receivedChat.message.id, reason: "griefing" }))
  for (let attempt = 0; attempt < 50 && !persistedChatReport; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 20))
  if (persistedChatReport?.p_message_id !== receivedChat.message.id) throw new Error("Camp report did not persist server-resolved message evidence")

  const firstAssignmentPromise = waitForMessage(first, (message) => message.type === "hub_band_ready")
  const secondAssignmentPromise = waitForMessage(second, (message) => message.type === "hub_band_ready")
  first.send(JSON.stringify({ type: "hub_intent", looking: true, targetPreference: "peoples-purse", desiredPartySize: 2 }))
  second.send(JSON.stringify({ type: "hub_intent", looking: true, targetPreference: "any", desiredPartySize: 2 }))
  const [firstAssignment, secondAssignment] = await Promise.all([firstAssignmentPromise, secondAssignmentPromise])

  const firstRoomWelcome = waitForMessage(first, (message) => message.type === "welcome")
  const firstProvisionalState = waitForMessage(first, (message) => message.type === "room_state" && message.players.length === 1 && message.players.every((player) => !player.roleConfirmed))
  first.send(JSON.stringify({ type: "join_room", ...handshake, roomCode: firstAssignment.roomCode, displayName: "Oakheart", characterId: "robin", accessToken: "token-a-header.payload.signature-long" }))
  await Promise.all([firstRoomWelcome, firstProvisionalState])
  const secondRoomWelcome = waitForMessage(second, (message) => message.type === "welcome")
  const twoPlayerState = waitForMessage(first, (message) => message.type === "room_state" && message.players.length === 2 && message.players.every((player) => !player.roleConfirmed))
  second.send(JSON.stringify({ type: "join_room", ...handshake, roomCode: secondAssignment.roomCode, displayName: "Willow", characterId: "marian", accessToken: "token-b-header.payload.signature-long" }))
  await secondRoomWelcome
  await twoPlayerState
  const confirmedState = waitForMessage(first, (message) => message.type === "room_state" && message.players.length === 2 && message.players.every((player) => player.roleConfirmed))
  first.send(JSON.stringify({ type: "select_character", characterId: "robin" }))
  second.send(JSON.stringify({ type: "select_character", characterId: "marian" }))
  const finalState = await confirmedState

  process.stdout.write(`${JSON.stringify({ ok: true, automaticAssignment: true, campChatDelivered: true, campReportPersisted: true, sameInstance: firstWelcome.instanceId === secondWelcome.instanceId, capacity: firstWelcome.capacity, samePrivateRoom: firstAssignment.roomCode === secondAssignment.roomCode, oneLeader: Number(firstAssignment.leader) + Number(secondAssignment.leader) === 1, privateRoomPlayers: finalState.players.length, rolesConfirmedInRoom: finalState.players.every((player) => player.roleConfirmed) })}\n`)
} finally {
  for (const socket of sockets) socket.close()
  roomServer.kill("SIGTERM")
  await new Promise((resolve) => authServer.close(resolve))
}
