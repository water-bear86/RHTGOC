import { describe, expect, it, vi } from "vitest"

vi.mock("./wallet-auth", () => ({ connectedRobinhoodWallet: vi.fn() }))

import { encodeErc20Transfer, roomServerHttpUrl } from "./token-access"

describe("token access server URL", () => {
  it("derives the HTTP origin from the room WebSocket URL", () => {
    expect(roomServerHttpUrl("wss://play.example.com/rooms", "https://site.example.com")).toBe("https://play.example.com")
    expect(roomServerHttpUrl("ws://127.0.0.1:8787/rooms", "http://localhost:5174")).toBe("http://127.0.0.1:8787")
  })

  it("uses the current origin when the room URL is absent", () => {
    expect(roomServerHttpUrl(undefined, "https://game.example.com")).toBe("https://game.example.com")
  })

  it("encodes the standard ERC-20 transfer call without a browser ABI dependency", () => {
    const encoded = encodeErc20Transfer("0x2222222222222222222222222222222222222222", "6000000")
    expect(encoded).toHaveLength(138)
    expect(encoded.startsWith("0xa9059cbb")).toBe(true)
    expect(encoded.endsWith("00000000000000000000000000000000000000000000000000000000005b8d80")).toBe(true)
  })
})
