import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migration = readFileSync(new URL("../supabase/migrations/20260904013551_add_sherwood_finery.sql", import.meta.url), "utf8")

describe("Sherwood Finery persistence migration", () => {
  it("keeps ownership, ledger, and equipment tables server-only behind RLS", () => {
    for (const table of ["player_vanity_owned", "vanity_purchases", "player_vanity_state"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`)
      expect(migration).toContain(`revoke all on table public.${table} from public, anon, authenticated`)
      expect(migration).toContain(`to service_role`)
    }
  })

  it("stores deterministic shared item ids and never client-writable prices", () => {
    expect(migration).toContain("'fox-plume', 'sherwood-fireflies', 'kings-ransom-trail'")
    expect(migration).toContain("granted_at")
    expect(migration).toContain("equipped_item_ids text[] not null default '{}'::text[]")
  })

  it("rejects transaction-hash replay inside a single transaction", () => {
    expect(migration).toContain("tx_hash text primary key")
    expect(migration.match(/hashtextextended\(pg_catalog\.lower\(p_tx_hash\), 0\)/g)).toHaveLength(2)
    expect(migration).toContain("VANITY_PAYMENT_REPLAY")
    expect(migration).toContain("token_access_payments where tx_hash = p_tx_hash")
  })

  it("grants equipment only for owned items", () => {
    expect(migration).toContain("VANITY_ITEM_NOT_OWNED")
    expect(migration).toContain("left join public.player_vanity_owned owned")
  })

  it("extends cross-ledger replay protection to the existing token pass claim", () => {
    expect(migration).toContain("create or replace function public.record_token_access_payment")
    expect(migration).toContain("or exists (select 1 from public.vanity_purchases where tx_hash = p_tx_hash)")
  })

  it("exposes every RPC only to the service role", () => {
    expect(migration).toContain("revoke execute on function public.record_vanity_purchase")
    expect(migration).toContain("grant execute on function public.record_vanity_purchase")
    expect(migration).toContain("revoke execute on function public.set_vanity_equipped")
    expect(migration).toContain("grant execute on function public.set_vanity_equipped")
  })
})
