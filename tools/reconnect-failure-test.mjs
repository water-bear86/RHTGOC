import { WebSocket } from "ws"

const endpoint = process.env.ROOM_SERVER_URL ?? "ws://127.0.0.1:8787/rooms"

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
  return socket
}

const original = await connect()
const invalidResponse = waitForMessage(original, (message) => message.type === "error")
original.send("not-json")
const invalid = await invalidResponse
if (invalid.code !== "INVALID_MESSAGE") throw new Error(`Unexpected invalid-message response: ${JSON.stringify(invalid)}`)

const welcomeResponse = waitForMessage(original, (message) => message.type === "welcome")
original.send(JSON.stringify({ type: "create_room", version: 4, displayName: "Failure Robin", characterId: "robin" }))
const welcome = await welcomeResponse
original.terminate()
await new Promise((resolve) => setTimeout(resolve, 150))

const reconnected = await connect()
const reconnectResponse = waitForMessage(reconnected, (message) => message.type === "welcome")
reconnected.send(JSON.stringify({
  type: "join_room",
  version: 4,
  roomCode: welcome.roomCode,
  displayName: "Failure Robin",
  characterId: "robin",
  reconnectToken: welcome.reconnectToken,
}))
const reconnectWelcome = await reconnectResponse
if (reconnectWelcome.playerId !== welcome.playerId) throw new Error("Reconnect created a new player identity")

const pongResponse = waitForMessage(reconnected, (message) => message.type === "pong")
reconnected.send(JSON.stringify({ type: "ping", clientTime: Date.now() }))
await pongResponse
reconnected.close()
process.stdout.write(`${JSON.stringify({ ok: true, endpoint, invalidMessageRejected: true, abruptDisconnectRecovered: true, identityPreserved: true })}\n`)
