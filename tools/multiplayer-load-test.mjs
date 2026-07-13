import { WebSocket } from "ws"
import { readFileSync } from "node:fs"

const { version: protocolVersion } = JSON.parse(readFileSync(new URL("../shared/protocol-version.json", import.meta.url), "utf8"))

const endpoint = process.env.ROOM_SERVER_URL ?? "ws://127.0.0.1:8787/rooms"
const soak = process.env.SOAK === "1"
const roomCount = Number(process.env.ROOMS ?? (soak ? 4 : 12))
const durationMs = Number(process.env.DURATION_MS ?? (soak ? 60_000 : 5_000))
const minimumSnapshots = Number(process.env.MIN_SNAPSHOTS ?? (soak ? 400 : 8))
const clients = []

function waitForMessage(socket, predicate, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off("message", onMessage)
      reject(new Error(`Timed out waiting for server message after ${timeoutMs}ms`))
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
  const socket = new WebSocket(endpoint)
  await new Promise((resolve, reject) => {
    socket.once("open", resolve)
    socket.once("error", reject)
  })
  clients.push(socket)
  return socket
}

function send(socket, message) {
  socket.send(JSON.stringify(message))
}

async function createRoom(index) {
  const robin = await connect()
  const robinWelcome = waitForMessage(robin, (message) => message.type === "welcome")
  const robinProvisional = waitForMessage(robin, (message) => message.type === "room_state" && message.players.length === 1 && !message.players[0].roleConfirmed)
  send(robin, { type: "create_room", version: protocolVersion, displayName: `Load Robin ${index}`, characterId: "robin" })
  const { roomCode } = await robinWelcome
  await robinProvisional
  const robinConfirmed = waitForMessage(robin, (message) => message.type === "room_state" && message.players.length === 1 && message.players[0].roleConfirmed)
  send(robin, { type: "select_character", characterId: "robin" })
  await robinConfirmed

  const marian = await connect()
  const marianWelcome = waitForMessage(marian, (message) => message.type === "welcome")
  const marianProvisional = waitForMessage(marian, (message) => message.type === "room_state" && message.players.length === 2 && message.players.some((player) => !player.roleConfirmed))
  send(marian, { type: "join_room", version: protocolVersion, roomCode, displayName: `Load Marian ${index}`, characterId: "marian" })
  await Promise.all([marianWelcome, marianProvisional])
  const roomConfirmed = waitForMessage(robin, (message) => message.type === "room_state" && message.players.length === 2 && message.players.every((player) => player.roleConfirmed))
  send(marian, { type: "select_character", characterId: "marian" })
  await roomConfirmed
  return { roomCode, sockets: [robin, marian] }
}

async function run() {
  if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 100) throw new Error("ROOMS must be an integer from 1 to 100")
  if (!Number.isFinite(durationMs) || durationMs < 500) throw new Error("DURATION_MS must be at least 500")

  const rooms = await Promise.all(Array.from({ length: roomCount }, (_, index) => createRoom(index)))
  const snapshotCounts = new Map(clients.map((socket) => [socket, 0]))
  for (const socket of clients) {
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString())
      if (message.type === "snapshot") snapshotCounts.set(socket, (snapshotCounts.get(socket) ?? 0) + 1)
    })
  }

  for (const { sockets } of rooms) for (const socket of sockets) {
    send(socket, { type: "set_ready", ready: true })
    send(socket, { type: "client_metrics", inputBacklog: 0, snapshotGapMs: 100 })
  }
  let sequence = 0
  const movement = setInterval(() => {
    sequence += 1
    clients.forEach((socket, index) => {
      const angle = sequence / 8 + index
      send(socket, { type: "input", sequence, move: { x: Math.cos(angle), z: Math.sin(angle) } })
      if (sequence % 20 === 0) send(socket, { type: "ping", clientTime: Date.now() })
    })
  }, 50)
  await new Promise((resolve) => setTimeout(resolve, durationMs))
  clearInterval(movement)

  const counts = [...snapshotCounts.values()]
  if (counts.some((count) => count < minimumSnapshots)) {
    throw new Error(`Snapshot starvation: minimum=${Math.min(...counts)}, expected>=${minimumSnapshots}`)
  }
  process.stdout.write(`${JSON.stringify({ ok: true, mode: soak ? "soak" : "load", endpoint, rooms: roomCount, clients: clients.length, durationMs, snapshots: counts.reduce((sum, count) => sum + count, 0) })}\n`)
}

try {
  await run()
} finally {
  await Promise.all(clients.map((socket) => new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve()
    socket.once("close", resolve)
    socket.close()
    setTimeout(() => {
      socket.terminate()
      resolve()
    }, 1_000).unref()
  })))
}
