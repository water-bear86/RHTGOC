import { createClient } from "@supabase/supabase-js"
import type { RpcClient } from "./band-store"
import {
  assignRoomExperiment,
  parseGameplayExperimentDefinition,
  type GameplayExperimentDefinition,
  type RoomExperimentAssignment,
} from "../shared/experiments"

export interface ExperimentDefinitionSource {
  loadActive(atIso: string): Promise<GameplayExperimentDefinition[]>
}

export class SupabaseExperimentDefinitionSource implements ExperimentDefinitionSource {
  constructor(private readonly client: RpcClient) {}

  async loadActive(atIso: string): Promise<GameplayExperimentDefinition[]> {
    if (new Date(atIso).toISOString() !== atIso) throw new Error("experiment query time must be a canonical ISO timestamp")
    const { data, error } = await this.client.rpc("get_active_gameplay_experiments", { p_at: atIso })
    if (error) throw new Error(`EXPERIMENT_LOAD_FAILED: ${error.message}`)
    if (!Array.isArray(data)) throw new Error("EXPERIMENT_LOAD_FAILED: invalid response")
    return data.map(parseGameplayExperimentDefinition)
  }
}

export interface ExperimentServiceOptions {
  refreshIntervalMs?: number
  maxCachedRooms?: number
}

export class ExperimentService {
  private readonly refreshIntervalMs: number
  private readonly maxCachedRooms: number
  private definitions: GameplayExperimentDefinition[] = []
  private readonly assignmentsByRoom = new Map<string, RoomExperimentAssignment[]>()
  private refreshAfter = 0
  private refreshPromise: Promise<void> | null = null

  constructor(private readonly source: ExperimentDefinitionSource, options: ExperimentServiceOptions = {}) {
    this.refreshIntervalMs = options.refreshIntervalMs ?? 60_000
    this.maxCachedRooms = options.maxCachedRooms ?? 10_000
    if (!Number.isSafeInteger(this.refreshIntervalMs) || this.refreshIntervalMs < 1_000) throw new Error("refreshIntervalMs must be at least one second")
    if (!Number.isSafeInteger(this.maxCachedRooms) || this.maxCachedRooms < 1) throw new Error("maxCachedRooms must be positive")
  }

  async refresh(nowMs = Date.now(), force = false): Promise<void> {
    if (!Number.isFinite(nowMs) || nowMs < 0) throw new Error("nowMs must be a positive timestamp")
    if (!force && nowMs < this.refreshAfter) return
    if (this.refreshPromise) return this.refreshPromise
    this.refreshPromise = this.source.loadActive(new Date(nowMs).toISOString()).then((definitions) => {
      const parsed = definitions.map(parseGameplayExperimentDefinition)
      const keys = parsed.map((definition) => `${definition.id}:${definition.revision}`)
      if (new Set(keys).size !== keys.length) throw new Error("EXPERIMENT_LOAD_FAILED: duplicate active definition")
      this.definitions = parsed.sort((left, right) => left.id.localeCompare(right.id) || left.revision - right.revision)
      this.refreshAfter = nowMs + this.refreshIntervalMs
    }).finally(() => {
      this.refreshPromise = null
    })
    return this.refreshPromise
  }

  assignRoom(roomScope: string): RoomExperimentAssignment[] {
    const existing = this.assignmentsByRoom.get(roomScope)
    if (existing) return existing.map((assignment) => ({ ...assignment, config: { ...assignment.config } }))
    const assignments = this.definitions.flatMap((definition) => {
      const assignment = assignRoomExperiment(definition, roomScope)
      return assignment ? [assignment] : []
    })
    if (this.assignmentsByRoom.size >= this.maxCachedRooms) {
      const oldest = this.assignmentsByRoom.keys().next().value as string | undefined
      if (oldest) this.assignmentsByRoom.delete(oldest)
    }
    this.assignmentsByRoom.set(roomScope, assignments)
    return assignments.map((assignment) => ({ ...assignment, config: { ...assignment.config } }))
  }

  releaseRoom(roomScope: string): void {
    this.assignmentsByRoom.delete(roomScope)
  }

  activeDefinitionCount(): number {
    return this.definitions.length
  }

  cachedRoomCount(): number {
    return this.assignmentsByRoom.size
  }
}

export function createExperimentServiceFromEnv(options: ExperimentServiceOptions = {}): ExperimentService | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) return null
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return new ExperimentService(new SupabaseExperimentDefinitionSource(client as unknown as RpcClient), options)
}
