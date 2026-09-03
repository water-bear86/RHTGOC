import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { WebSocket } from "ws"

const { version: protocolVersion } = JSON.parse(readFileSync(new URL("../shared/protocol-version.json", import.meta.url), "utf8"))
const handshake = { version: protocolVersion, buildId: process.env.BUILD_ID ?? "dev", productAnalytics: false }
const roomPort = 18_788
const roomEndpoint = `ws://127.0.0.1:${roomPort}/rooms`

const roomServer = spawn("npm", ["run", "server"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(roomPort) },
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

function waitForMessage(socket, predicate, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage)
      reject(new Error(`Timed out waiting for quick-play message after ${timeoutMs}ms`))
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

const identities = [
  { displayName: "Oakheart", characterId: "robin" },
  { displayName: "Willow", characterId: "robin" },
  { displayName: "Bramble", characterId: "marian" },
  { displayName: "Rowan", characterId: "marian" },
]
const sockets = []
const assignmentPromises = []

try {
  await waitForHealth()
  for (const identity of identities) {
    const socket = await connect()
    sockets.push(socket)
    assignmentPromises.push(waitForMessage(socket, (message) => message.type === "hub_band_ready"))
    socket.send(JSON.stringify({ type: "join_public_hub", ...handshake, ...identity }))
  }

  const assignments = await Promise.all(assignmentPromises)
  const roomCode = assignments[0].roomCode
  if (!assignments.every((assignment) => assignment.roomCode === roomCode)) throw new Error("Quick play split one group across rooms")
  if (new Set(assignments.map((assignment) => assignment.characterId)).size !== 4) throw new Error("Quick play did not assign four unique roles")

  const missionPromises = sockets.map((socket) => waitForMessage(socket, (message) => (
    message.type === "room_state"
    && message.phase === "mission"
    && message.players.length === 4
    && message.players.every((player) => player.roleConfirmed)
  )))
  for (let index = 0; index < sockets.length; index += 1) {
    const assignment = assignments[index]
    sockets[index].send(JSON.stringify({
      type: "join_room",
      ...handshake,
      roomCode,
      displayName: identities[index].displayName,
      characterId: identities[index].characterId,
      quickPlayToken: assignment.quickPlayToken,
    }))
  }
  const missionStates = await Promise.all(missionPromises)

  const bandMessagePromise = waitForMessage(sockets[1], (message) => message.type === "chat_message" && message.message?.channel === "band")
  sockets[0].send(JSON.stringify({ type: "chat_send", channel: "band", text: "For Sherwood" }))
  const bandMessage = await bandMessagePromise

  process.stdout.write(`${JSON.stringify({
    ok: true,
    guestEntry: true,
    partySize: missionStates[0].players.length,
    sameRoom: true,
    uniqueRoles: new Set(missionStates[0].players.map((player) => player.characterId)).size === 4,
    autoStarted: missionStates.every((state) => state.phase === "mission"),
    bandChatDelivered: bandMessage.message.text === "For Sherwood",
  })}\n`)
} finally {
  for (const socket of sockets) socket.close()
  roomServer.kill("SIGTERM")
}
