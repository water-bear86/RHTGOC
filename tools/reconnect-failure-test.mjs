import { WebSocket } from "ws"
import { readFileSync } from "node:fs"

const { version: protocolVersion } = JSON.parse(readFileSync(new URL("../shared/protocol-version.json", import.meta.url), "utf8"))
const handshake = { version: protocolVersion, buildId: process.env.BUILD_ID ?? "dev", productAnalytics: false }

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
original.send(JSON.stringify({ type: "create_room", ...handshake, displayName: "Failure Robin", characterId: "robin" }))
const welcome = await welcomeResponse
const sentChatResponse = waitForMessage(original, (message) => message.type === "chat_message" && message.message?.channel === "band")
original.send(JSON.stringify({ type: "chat_send", channel: "band", text: "Hold the oak line" }))
const sentChat = await sentChatResponse
original.terminate()
await new Promise((resolve) => setTimeout(resolve, 150))

const reconnected = await connect()
const reconnectResponse = waitForMessage(reconnected, (message) => message.type === "welcome")
const historyResponse = waitForMessage(reconnected, (message) => message.type === "chat_history" && message.channel === "band")
reconnected.send(JSON.stringify({
  type: "join_room",
  ...handshake,
  roomCode: welcome.roomCode,
  displayName: "Failure Robin",
  characterId: "robin",
  reconnectToken: welcome.reconnectToken,
}))
const [reconnectWelcome, history] = await Promise.all([reconnectResponse, historyResponse])
if (reconnectWelcome.playerId !== welcome.playerId) throw new Error("Reconnect created a new player identity")
if (history.messages?.at(-1)?.id !== sentChat.message.id) throw new Error("Reconnect did not restore bounded Band chat history")

const pongResponse = waitForMessage(reconnected, (message) => message.type === "pong")
reconnected.send(JSON.stringify({ type: "ping", clientTime: Date.now() }))
await pongResponse

const oversized = await connect()
const oversizedClosed = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Oversized WebSocket payload was not rejected")), 5_000)
  oversized.once("close", (code) => { clearTimeout(timeout); resolve(code) })
  oversized.once("error", () => undefined)
})
oversized.send(JSON.stringify({ type: "chat_send", channel: "band", text: "x".repeat(33_000) }))
const oversizedCloseCode = await oversizedClosed
if (oversizedCloseCode !== 1009) throw new Error(`Unexpected oversized-payload close code: ${oversizedCloseCode}`)

const survivorPongResponse = waitForMessage(reconnected, (message) => message.type === "pong")
reconnected.send(JSON.stringify({ type: "ping", clientTime: Date.now() }))
await survivorPongResponse
reconnected.close()

process.stdout.write(`${JSON.stringify({ ok: true, endpoint, invalidMessageRejected: true, abruptDisconnectRecovered: true, identityPreserved: true, bandChatHistoryRestored: true, oversizedPayloadRejected: true, serverSurvivedOversizedPayload: true })}\n`)
