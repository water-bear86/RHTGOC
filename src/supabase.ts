import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./database.types"

let client: SupabaseClient<Database> | null | undefined

export function getSupabase(): SupabaseClient<Database> | null {
  if (client !== undefined) return client
  const url = import.meta.env.VITE_SUPABASE_URL
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  client = url && publishableKey
    ? createClient<Database>(url, publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null
  return client
}
