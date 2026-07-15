import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  new URL("../supabase/migrations/20260715091926_add_chat_report_evidence.sql", import.meta.url),
  "utf8",
)

describe("Camp chat report evidence migration", () => {
  it("keeps the evidence table and RPCs behind the service role", () => {
    expect(migration).toContain("create table private.public_hub_chat_reports")
    expect(migration).toContain("alter table private.public_hub_chat_reports enable row level security")
    expect(migration).toContain("revoke all on schema private from public, anon, authenticated")
    expect(migration).toContain("revoke all on table private.public_hub_chat_reports from public, anon, authenticated, service_role")
    expect(migration).toContain("grant select, insert, delete on table private.public_hub_chat_reports to service_role")
    expect(migration).toMatch(/security invoker\s+set search_path = ''/g)
    expect(migration).toContain("grant execute on function public.record_public_hub_chat_report")
    expect(migration).toContain("grant execute on function public.prune_public_hub_chat_reports")
    expect(migration).not.toMatch(/grant execute[\s\S]*?to (?:anon|authenticated)/)
  })

  it("bounds evidence size, context, deduplication, and retention", () => {
    expect(migration).toContain("unique (reporter_id, message_id)")
    expect(migration).toContain("pg_catalog.char_length(message_text) between 1 and 160")
    expect(migration).toContain("pg_catalog.octet_length(p_context::text) > 4096")
    expect(migration).toContain("pg_catalog.jsonb_array_length(p_context -> 'surroundingMessages') > 4")
    expect(migration).toContain("interval '30 days'")
    expect(migration).toContain("delete from private.public_hub_chat_reports")
  })
})
