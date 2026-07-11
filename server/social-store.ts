import { createClient } from "@supabase/supabase-js"
import type { RpcClient } from "./band-store"

export class SupabaseSocialStore {
  constructor(private readonly client: RpcClient) {}

  async recordRecentPlayers(missionId: string, userIds: string[]): Promise<boolean> {
    const { data, error } = await this.client.rpc("record_recent_band_players", { p_mission_id: missionId, p_user_ids: userIds })
    if (error) throw new Error(`RECENT_PLAYERS_PERSISTENCE_FAILED: ${error.message}`)
    return data === true
  }
}

export function createSocialStoreFromEnv(): SupabaseSocialStore | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) return null
  return new SupabaseSocialStore(createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) as unknown as RpcClient)
}
