import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migration = readFileSync(new URL("../supabase/migrations/20260713183627_add_robinhood_token_access.sql", import.meta.url), "utf8")

describe("token access persistence migration", () => {
  it("keeps payment and entitlement tables server-only behind RLS", () => {
    expect(migration).toContain("alter table public.player_token_access enable row level security")
    expect(migration).toContain("alter table public.token_access_payments enable row level security")
    expect(migration).toContain("revoke all on table public.token_access_payments from public, anon, authenticated")
    expect(migration).toContain("to service_role")
  })

  it("serializes renewals and rejects transaction replay", () => {
    expect(migration).toContain("tx_hash text primary key")
    expect(migration).toContain("pg_advisory_xact_lock")
    expect(migration).toContain("TOKEN_PAYMENT_REPLAY")
    expect(migration).toContain("make_interval(days => p_pass_days)")
  })
})
