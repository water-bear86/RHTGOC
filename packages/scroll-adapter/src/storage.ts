import type { ScrollAdapterStorage } from "./types.js"

export class MemoryScrollStorage implements ScrollAdapterStorage {
  private readonly values = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value)
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key)
  }
}

export class IndexedDbScrollStorage implements ScrollAdapterStorage {
  private readonly database: Promise<IDBDatabase>

  constructor(databaseName = "sherwood-scroll-adapter", private readonly storeName = "scroll-state") {
    if (typeof indexedDB === "undefined") throw new Error("IndexedDB is unavailable")
    this.database = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1)
      request.addEventListener("upgradeneeded", () => {
        if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName)
      })
      request.addEventListener("success", () => resolve(request.result))
      request.addEventListener("error", () => reject(request.error ?? new Error("Unable to open Scroll storage")))
    })
  }

  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const database = await this.database
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(this.storeName, mode)
      const request = operation(transaction.objectStore(this.storeName))
      request.addEventListener("success", () => resolve(request.result))
      request.addEventListener("error", () => reject(request.error ?? new Error("Scroll storage operation failed")))
      transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("Scroll storage transaction aborted")))
    })
  }

  async get(key: string): Promise<string | null> {
    const value = await this.transaction<unknown>("readonly", (store) => store.get(key))
    return typeof value === "string" ? value : null
  }

  async set(key: string, value: string): Promise<void> {
    await this.transaction<IDBValidKey>("readwrite", (store) => store.put(value, key))
  }

  async remove(key: string): Promise<void> {
    await this.transaction<undefined>("readwrite", (store) => store.delete(key) as IDBRequest<undefined>)
  }
}

export class ResilientScrollStorage implements ScrollAdapterStorage {
  constructor(
    private readonly primary: ScrollAdapterStorage,
    private readonly fallback: ScrollAdapterStorage = new MemoryScrollStorage(),
  ) {}

  async get(key: string): Promise<string | null> {
    try {
      return await this.primary.get(key)
    } catch {
      return await this.fallback.get(key)
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      await this.primary.set(key, value)
    } catch {
      await this.fallback.set(key, value)
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.primary.remove(key)
    } catch {
      await this.fallback.remove(key)
    }
  }
}

export function defaultScrollStorage(): ScrollAdapterStorage {
  if (typeof indexedDB === "undefined") return new MemoryScrollStorage()
  try {
    return new ResilientScrollStorage(new IndexedDbScrollStorage())
  } catch {
    return new MemoryScrollStorage()
  }
}
