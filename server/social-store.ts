import { createClient } from "@supabase/supabase-js"
import type { RpcClient } from "./band-store"

export class SupabaseSocialStore {
  constructor(private readonly client: RpcClient) {}

  async recordRecentPlayers(missionId: string, userIds: string[]): Promise<boolean> {
    const { data, error } = await this.client.rpc("record_recent_band_players", { p_mission_id: missionId, p_user_ids: userIds })
    if (error) throw new Error(`RECENT_PLAYERS_PERSISTENCE_FAILED: ${error.message}`)
    return data === true
  }

  async getAcceptedFriendIds(userId: string): Promise<string[]> {
    const { data, error } = await this.client.rpc("get_accepted_friend_ids", { p_user_id: userId })
    if (error) throw new Error(`FRIEND_LOOKUP_FAILED: ${error.message}`)
    return Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : []
  }

  async getHubBlockedIds(userId: string): Promise<string[]> {
    const { data, error } = await this.client.rpc("get_public_hub_blocked_ids", { p_user_id: userId })
    if (error) throw new Error(`HUB_BLOCK_LOOKUP_FAILED: ${error.message}`)
    return Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : []
  }

  async recordHubBlock(blockerUserId: string, blockedUserId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("record_public_hub_block", { p_blocker_id: blockerUserId, p_blocked_id: blockedUserId })
    if (error) throw new Error(`HUB_BLOCK_PERSISTENCE_FAILED: ${error.message}`)
    return data === true
  }

  async recordHubReport(reporterUserId: string, targetUserId: string, reason: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("record_public_hub_report", { p_reporter_id: reporterUserId, p_target_id: targetUserId, p_reason: reason })
    if (error) throw new Error(`HUB_REPORT_PERSISTENCE_FAILED: ${error.message}`)
    return data === true
  }
}

export function createSocialStoreFromEnv(): SupabaseSocialStore | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) return null
  return new SupabaseSocialStore(createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) as unknown as RpcClient)
}
