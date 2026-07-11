import { createClient } from "@supabase/supabase-js"
import type { RpcClient } from "./band-store"
import type { RescueOfferTransition } from "./room"

export class SupabaseRescueOfferStore {
  constructor(private readonly client: RpcClient) {}

  async recordTransition(transition: RescueOfferTransition, bandId?: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("record_rescue_offer_transition", {
      p_sequence: transition.sequence,
      p_occurred_at: new Date(transition.at).toISOString(),
      p_offer: transition.offer,
      p_band_id: bandId ?? null,
    })
    if (error) throw new Error(`RESCUE_OFFER_PERSISTENCE_FAILED: ${error.message}`)
    return data === true
  }
}

export function createRescueOfferStoreFromEnv(): SupabaseRescueOfferStore | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  if (!url || !secretKey) return null
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  return new SupabaseRescueOfferStore(client as unknown as RpcClient)
}
