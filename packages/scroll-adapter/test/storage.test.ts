import { describe, expect, it } from "vitest"
import { MemoryScrollStorage, ResilientScrollStorage, type ScrollAdapterStorage } from "../src/index.js"

describe("MemoryScrollStorage", () => {
  it("implements the adapter's asynchronous storage contract", async () => {
    const storage = new MemoryScrollStorage()
    await expect(storage.get("queue")).resolves.toBeNull()
    await storage.set("queue", "value")
    await expect(storage.get("queue")).resolves.toBe("value")
    await storage.remove("queue")
    await expect(storage.get("queue")).resolves.toBeNull()
  })
})

describe("ResilientScrollStorage", () => {
  it("keeps gameplay queueing available when browser persistence is blocked", async () => {
    const blocked: ScrollAdapterStorage = {
      get: async () => { throw new Error("blocked") },
      set: async () => { throw new Error("blocked") },
      remove: async () => { throw new Error("blocked") },
    }
    const storage = new ResilientScrollStorage(blocked)
    await storage.set("queue", "pending")
    await expect(storage.get("queue")).resolves.toBe("pending")
    await storage.remove("queue")
    await expect(storage.get("queue")).resolves.toBeNull()
  })
})
