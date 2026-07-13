import { createClient } from "@supabase/supabase-js"
import type { RpcClient } from "./band-store"
import type { ContributionTransition } from "./room"

export class SupabaseContributionStore {
  constructor(private readonly client: RpcClient) {}

  async recordTransition(transition: ContributionTransition, bandId?: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("record_band_contribution_transition", {
      p_sequence: transition.sequence,
      p_occurred_at: new Date(transition.at).toISOString(),
      p_contribution: transition.contribution,
      p_band_id: bandId ?? null,
    })
    if (error) throw new Error(`CONTRIBUTION_PERSISTENCE_FAILED: ${error.message}`)
    return data === true
  }
}

export function createContributionStoreFromEnv(): SupabaseContributionStore | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) return null
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return new SupabaseContributionStore(client as unknown as RpcClient)
}
