import { createClient } from "@supabase/supabase-js"
import { parseGameplayAnalyticsBatch, type GameplayAnalyticsBatch } from "../shared/gameplay-analytics"
import type { RpcClient } from "./band-store"

export interface GameplayAnalyticsWriteResult {
  inserted: boolean
  rows: number
}

function writeResult(value: unknown): GameplayAnalyticsWriteResult {
  if (!value || typeof value !== "object") throw new Error("GAMEPLAY_ANALYTICS_PERSISTENCE_FAILED: invalid response")
  const record = value as Record<string, unknown>
  if (typeof record.inserted !== "boolean" || !Number.isSafeInteger(record.rows) || (record.rows as number) < 0) {
    throw new Error("GAMEPLAY_ANALYTICS_PERSISTENCE_FAILED: invalid response")
  }
  return { inserted: record.inserted, rows: record.rows as number }
}

export class SupabaseGameplayAnalyticsStore {
  constructor(private readonly client: RpcClient) {}

  async recordBatch(value: GameplayAnalyticsBatch): Promise<GameplayAnalyticsWriteResult> {
    const batch = parseGameplayAnalyticsBatch(value)
    const { data, error } = await this.client.rpc("ingest_gameplay_analytics_batch", {
      p_batch_id: batch.batchId,
      p_schema_version: batch.schemaVersion,
      p_created_at: batch.createdAt,
      p_aggregates: batch.aggregates,
    })
    if (error) throw new Error(`GAMEPLAY_ANALYTICS_PERSISTENCE_FAILED: ${error.message}`)
    return writeResult(data)
  }
}

export function createGameplayAnalyticsStoreFromEnv(): SupabaseGameplayAnalyticsStore | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) return null
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return new SupabaseGameplayAnalyticsStore(client as unknown as RpcClient)
}
