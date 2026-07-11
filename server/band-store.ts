import { createClient } from "@supabase/supabase-js"
import type { MissionResult, VoteChoice } from "../shared/protocol"

interface RpcResult {
  data: unknown
  error: { message: string } | null
}

export interface RpcClient {
  rpc(name: string, params: Record<string, unknown>): PromiseLike<RpcResult>
}

export interface CompletedBandMission {
  bandId: string
  missionId: string
  missionSlug: string
  seed: number
  result: MissionResult
  allocationChoice: VoteChoice
  allocationCoin: number
}

export class SupabaseBandStore {
  constructor(private readonly client: RpcClient) {}

  async createBand(name: string, bannerId: "oak" | "fox" | "arrow" | "stag", creatorUserId: string): Promise<string> {
    const { data, error } = await this.client.rpc("create_merry_band", {
      p_name: name,
      p_banner_id: bannerId,
      p_creator_user_id: creatorUserId,
    })
    if (error) throw new Error(`BAND_CREATE_FAILED: ${error.message}`)
    if (typeof data !== "string") throw new Error("BAND_CREATE_FAILED: missing band id")
    return data
  }

  async recordMission(input: CompletedBandMission): Promise<boolean> {
    const { data, error } = await this.client.rpc("apply_band_mission_reward", {
      p_band_id: input.bandId,
      p_mission_id: input.missionId,
      p_mission_slug: input.missionSlug,
      p_seed: input.seed,
      p_result: input.result,
      p_allocation_choice: input.allocationChoice,
      p_allocation_coin: input.allocationCoin,
    })
    if (error) throw new Error(`BAND_REWARD_FAILED: ${error.message}`)
    return data === true
  }
}

export function createBandStoreFromEnv(): SupabaseBandStore | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) return null
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return new SupabaseBandStore(client as unknown as RpcClient)
}
