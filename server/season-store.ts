import { createClient } from "@supabase/supabase-js"
import type { RpcClient } from "./band-store"
import type { SeasonTransition } from "./season-service"
import type { SherwoodSeasonSnapshot } from "../shared/sherwood-season"

export class SupabaseSeasonStore {
  constructor(private readonly client: RpcClient) {}

  async recordTransition(transition: SeasonTransition): Promise<boolean> {
    const { data, error } = await this.client.rpc("record_sherwood_campaign_transition", {
      p_sequence: transition.sequence,
      p_occurred_at: new Date(transition.at).toISOString(),
      p_event_id: transition.eventId,
      p_event_type: transition.eventType,
      p_snapshot: transition.snapshot,
      p_payload: transition.payload,
    })
    if (error) throw new Error(`SEASON_PERSISTENCE_FAILED: ${error.message}`)
    return data === true
  }

  async loadCurrent(): Promise<{ snapshot: SherwoodSeasonSnapshot; processedEventIds: string[]; lastSequence: number } | null> {
    const { data, error } = await this.client.rpc("load_current_sherwood_campaign", {})
    if (error) throw new Error(`SEASON_RECOVERY_FAILED: ${error.message}`)
    if (data === null) return null
    if (typeof data !== "object") throw new Error("SEASON_RECOVERY_FAILED: invalid payload")
    const value = data as { snapshot?: unknown; processedEventIds?: unknown; lastSequence?: unknown }
    if (!value.snapshot || !Array.isArray(value.processedEventIds) || value.processedEventIds.some((id) => typeof id !== "string") || !Number.isSafeInteger(value.lastSequence) || (value.lastSequence as number) < 0) throw new Error("SEASON_RECOVERY_FAILED: invalid payload")
    return { snapshot: value.snapshot as SherwoodSeasonSnapshot, processedEventIds: value.processedEventIds, lastSequence: value.lastSequence as number }
  }
}

export function createSeasonStoreFromEnv(): SupabaseSeasonStore | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) return null
  const client = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  return new SupabaseSeasonStore(client as unknown as RpcClient)
}
