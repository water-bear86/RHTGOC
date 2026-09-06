import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migration = readFileSync(
  new URL("../supabase/migrations/20260905174500_leaderboard_privacy_moderation.sql", import.meta.url),
  "utf8",
)

describe("leaderboard privacy + moderation migration", () => {
  it("adds moderation flags on leaderboard_entries and an append-only audit table", () => {
    expect(migration).toContain("alter table public.leaderboard_entries")
    expect(migration).toContain("identity_hidden boolean not null default false")
    expect(migration).toContain("entry_hidden boolean not null default false")
    expect(migration).toContain("create table if not exists public.leaderboard_moderation_log")
    expect(migration).toContain("leaderboard_moderation_log_append_only")
    expect(migration).toContain("IMMUTABLE_LEADERBOARD_RECORD")
  })

  it("restricts moderation log to service_role (select+insert)", () => {
    expect(migration).toContain("revoke all on table public.leaderboard_moderation_log from public, anon, authenticated")
    expect(migration).toContain("grant select, insert on table public.leaderboard_moderation_log to service_role")
  })

  it("moderation RPCs validate action, reason, actor, note, and target", () => {
    expect(migration).toContain("create or replace function public.moderate_leaderboard_entry(")
    expect(migration).toContain("create or replace function public.moderate_leaderboard_player(")
    for (const action of ["hide-entry", "restore-entry", "hide-identity", "restore-identity", "annotate"]) {
      expect(migration).toContain(`'${action}'`)
    }
    for (const reason of ["offensive-name", "harassment", "impersonation", "cheating-review", "legal-removal", "other"]) {
      expect(migration).toContain(`'${reason}'`)
    }
    expect(migration).toContain("'INVALID_MODERATION_ACTION'")
    expect(migration).toContain("'INVALID_MODERATION_REASON'")
    expect(migration).toContain("'INVALID_MODERATION_ACTOR'")
    expect(migration).toContain("'INVALID_MODERATION_NOTE'")
    expect(migration).toContain("'MODERATION_ENTRY_NOT_FOUND'")
    expect(migration).toContain("MODERATION_ENTRY_NOT_FOUND")
  })

  it("moderation RPCs append an audit row with changed flag on every call", () => {
    expect(migration).toMatch(/insert into public\.leaderboard_moderation_log[\s\S]*changed/)
    expect(migration).toContain("changed boolean not null default false")
  })

  it("moderate_leaderboard_player tolerates missing/banned/deleted accounts (no FK, not exists guard)", () => {
    // player_ref is a plain uuid with no FK so audit history survives account
    // deletion. The RPC runs the UPDATE against 0 rows and still logs the action.
    expect(migration).not.toMatch(/player_ref uuid not null references/)
    expect(migration).toContain("changed_entries")
    expect(migration).toContain("affected = row_count")
  })

  it("executed by service_role only (server enforces operator auth)", () => {
    expect(migration).toContain(
      "revoke all on function public.moderate_leaderboard_entry(uuid, text, text, text, text) from public, anon, authenticated",
    )
    expect(migration).toContain(
      "grant execute on function public.moderate_leaderboard_entry(uuid, text, text, text, text) to service_role",
    )
    expect(migration).toContain(
      "revoke all on function public.moderate_leaderboard_player(uuid, text, text, text, text) from public, anon, authenticated",
    )
    expect(migration).toContain(
      "grant execute on function public.moderate_leaderboard_player(uuid, text, text, text, text) to service_role",
    )
  })

  it("masks blocked identities in place and emits identity_masked, without per-viewer count changes", () => {
    // Block detection is computed per row but never filters.
    expect(migration).toContain("viewer_blocked")
    expect(migration).toContain("exists (\n          select 1 from public.player_blocks block")
    expect(migration).toContain("(block.blocker_id = viewer_id and block.blocked_id = entry.player_id)")
    expect(migration).toContain("(block.blocker_id = entry.player_id and block.blocked_id = viewer_id)")
    expect(migration).toContain("entry.player_id is not null")
    expect(migration).toContain("identity_masked', (r.identity_hidden or r.viewer_blocked)")
    expect(migration).toContain("case when r.identity_hidden or r.viewer_blocked then 'Hooded Outlaw'")
    // player_id stays internal: it is used for the self-block subquery only and
    // is never projected into jsonb_build_object payloads.
    const entryPayloads = migration.match(/jsonb_build_object\(\s*'id', r\.id[\s\S]*?\)/g) ?? []
    expect(entryPayloads.length).toBeGreaterThan(0)
    for (const payload of entryPayloads) {
      expect(payload).not.toContain("'player_id'")
      expect(payload).not.toContain("'verification_id'")
      expect(payload).not.toContain("'score_breakdown'")
      expect(payload).not.toContain("'suspicious'")
    }
  })

  it("excludes moderator entry-hidden rows uniformly for every viewer", () => {
    expect(migration).toContain("entry.entry_hidden = false")
  })

  it("preserves the deterministic ranking contract (sort keys + tie peers)", () => {
    expect(migration).toContain("row_number() over (order by f.sort_a, f.sort_b, f.sort_c, f.id) as row_num")
    expect(migration).toContain("rank() over (order by f.sort_a, f.sort_b, f.sort_c) as entry_rank")
    expect(migration).toContain("count(*) over (partition by f.sort_a, f.sort_b, f.sort_c) as tie_peers")
    expect(migration).toContain("is_tied', r.tie_peers > 1")
  })

  it("keeps the legacy read_leaderboard response shape but applies masking", () => {
    expect(migration).toContain("create or replace function public.read_leaderboard(")
    expect(migration).toContain("then 'Hooded Outlaw'")
    expect(migration).toContain("viewer_blocked")
    // Legacy row payload is unchanged (same 15 fields, no identity_masked).
    expect(migration).toMatch(/entry\.clean_escape[\s\S]*?limit 50/)
    const legacyMatch = migration.match(/from public\.leaderboard_entries entry[\s\S]*?limit 50/)
    expect(legacyMatch).not.toBeNull()
  })

  it("does not drop or replace read_leaderboard_ranked's brother RPC", () => {
    // The ranked RPC is replaced in place (additive migration); it still grants
    // to browser roles after revoke.
    expect(migration).toContain("revoke all on function public.read_leaderboard_ranked")
    expect(migration).toContain(
      "grant execute on function public.read_leaderboard_ranked(text, text, text, integer, text, uuid, uuid[], integer, integer) to anon, authenticated, service_role",
    )
  })
})
