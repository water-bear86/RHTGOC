import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const rankingMigration = readFileSync(
  new URL("../supabase/migrations/20260904015500_enhance_leaderboard_rankings.sql", import.meta.url),
  "utf8",
)

describe("ranked leaderboard read RPC", () => {
  it("adds read_leaderboard_ranked without touching the legacy read_leaderboard contract", () => {
    expect(rankingMigration).toContain("create or replace function public.read_leaderboard_ranked(")
    expect(rankingMigration).not.toContain("create or replace function public.read_leaderboard(")
    expect(rankingMigration).not.toMatch(/drop function[^\n]*read_leaderboard\(/)
  })

  it("paginates with validated limit and offset bounds", () => {
    expect(rankingMigration).toContain("p_limit integer default 50")
    expect(rankingMigration).toContain("p_offset integer default 0")
    expect(rankingMigration).toContain("p_limit < 1 or p_limit > 100")
    expect(rankingMigration).toContain("p_offset < 0 or p_offset > 10000")
    expect(rankingMigration).toContain("'INVALID_LEADERBOARD_LIMIT'")
    expect(rankingMigration).toContain("'INVALID_LEADERBOARD_OFFSET'")
  })

  it("computes deterministic ranks, ties, and stable positions in one window pass", () => {
    expect(rankingMigration).toContain("row_number() over (order by f.sort_a, f.sort_b, f.sort_c, f.id) as row_num")
    expect(rankingMigration).toContain("rank() over (order by f.sort_a, f.sort_b, f.sort_c) as entry_rank")
    expect(rankingMigration).toContain("count(*) over (partition by f.sort_a, f.sort_b, f.sort_c) as tie_peers")
    expect(rankingMigration).toContain("'is_tied', r.tie_peers > 1")
    expect(rankingMigration).toContain("'position', r.row_num")
  })

  it("encodes the five per-board sort key tuples from the contract", () => {
    expect(rankingMigration).toContain("when 'master-outlaws' then -entry.score")
    expect(rankingMigration).toContain("when 'peoples-champions' then -entry.delivered")
    expect(rankingMigration).toContain("when 'clean-escapes' then -entry.delivered")
    expect(rankingMigration).toContain("when 'rescuers' then -entry.rescues")
    expect(rankingMigration).toContain("else entry.mission_seconds")
    expect(rankingMigration).toContain("when 'swift-arrows' then -entry.precision")
    expect(rankingMigration).toContain("p_kind <> 'clean-escapes' or entry.clean_escape = true")
  })

  it("requires mission and party scope for swift-arrows rankings", () => {
    expect(rankingMigration).toContain("'SWIFT_ARROWS_SCOPE_REQUIRED'")
  })

  it("returns pagination metadata and the viewer's own ranked row", () => {
    expect(rankingMigration).toContain("'has_next', (p_offset + p_limit) < coalesce(total_count, 0)")
    expect(rankingMigration).toContain("'self', self_row")
    expect(rankingMigration).toContain("viewer_id is not null and r.player_id = viewer_id")
  })

  it("keeps friend, band, and block authorization checks in the definer function", () => {
    expect(rankingMigration).toContain("'FORBIDDEN_LEADERBOARD_SCOPE'")
    expect(rankingMigration).toContain("public.player_friendships")
    expect(rankingMigration).toContain("public.merry_band_members")
    expect(rankingMigration).toContain("public.player_blocks")
    expect(rankingMigration).toContain("security definer")
  })

  it("never exposes private identifiers in ranked entries", () => {
    const entryPayloads = rankingMigration.match(/jsonb_build_object\(\s*'id', r\.id[\s\S]*?\)/g) ?? []
    expect(entryPayloads.length).toBeGreaterThan(0)
    for (const payload of entryPayloads) {
      expect(payload).not.toContain("'player_id'")
      expect(payload).not.toContain("'verification_id'")
      expect(payload).not.toContain("'score_breakdown'")
      expect(payload).not.toContain("'suspicious'")
    }
  })

  it("only filters public seasons and verified entries", () => {
    expect(rankingMigration).toContain("season.is_public = true")
    expect(rankingMigration).toContain("entry.verified = true")
  })

  it("adds the missing master-outlaws ranking index for scale-oriented plans", () => {
    expect(rankingMigration).toContain("create index if not exists leaderboard_entries_mastery_v2_idx")
    expect(rankingMigration).toContain("(season_id, score desc, mission_seconds asc, id)")
    expect(rankingMigration).toContain("where verified = true")
  })

  it("grants ranked reads to browser roles after an explicit revoke", () => {
    expect(rankingMigration).toContain("revoke all on function public.read_leaderboard_ranked")
    expect(rankingMigration).toContain("grant execute on function public.read_leaderboard_ranked(text, text, text, integer, text, uuid, uuid[], integer, integer) to anon, authenticated, service_role")
  })
})

describe("season lifecycle: activate", () => {
  it("exposes an activate_leaderboard_season RPC for service_role only", () => {
    expect(rankingMigration).toContain("create or replace function public.activate_leaderboard_season(")
    expect(rankingMigration).toContain("revoke all on function public.activate_leaderboard_season(text, text, timestamptz, timestamptz) from public, anon, authenticated")
    expect(rankingMigration).toContain("grant execute on function public.activate_leaderboard_season(text, text, timestamptz, timestamptz) to service_role")
  })

  it("validates slug, name, and window before writing", () => {
    expect(rankingMigration).toContain("p_slug !~ '^[a-z0-9-]{1,40}$'")
    expect(rankingMigration).toContain("char_length(p_name) not between 1 and 60")
    expect(rankingMigration).toContain("p_ends_at <= p_starts_at")
    expect(rankingMigration).toContain("'INVALID_LEADERBOARD_SEASON'")
  })

  it("is idempotent on an existing season and refuses to reopen a finalized one", () => {
    expect(rankingMigration).toContain("'activated', false")
    expect(rankingMigration).toContain("'activated', true")
    expect(rankingMigration).toContain("'FINALIZED_SEASON_IMMUTABLE'")
  })

  it("serializes lifecycle mutations behind the shared advisory lock", () => {
    const occurrences = rankingMigration.match(/pg_advisory_xact_lock\(hashtextextended\('leaderboard-season-lifecycle', 0\)\)/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(2)
  })
})

describe("season lifecycle: manual close", () => {
  it("moves an open season to closing with a bounded drain window", () => {
    expect(rankingMigration).toContain("create or replace function public.close_leaderboard_season(")
    expect(rankingMigration).toContain("p_drain_minutes integer default 30")
    expect(rankingMigration).toContain("p_drain_minutes < 1 or p_drain_minutes > 1440")
    expect(rankingMigration).toContain("'INVALID_LEADERBOARD_DRAIN'")
    expect(rankingMigration).toContain("make_interval(mins => p_drain_minutes)")
    expect(rankingMigration).toContain("lifecycle_state = 'closing'")
  })

  it("is idempotent: re-closing preserves the original drain window", () => {
    expect(rankingMigration).toContain("'changed', false")
    expect(rankingMigration).toContain("'changed', true")
  })

  it("forbids closing a finalized season", () => {
    expect(rankingMigration).toContain("'FINALIZED_SEASON_IMMUTABLE'")
  })

  it("is restricted to service_role", () => {
    expect(rankingMigration).toContain("revoke all on function public.close_leaderboard_season(uuid, integer) from public, anon, authenticated")
    expect(rankingMigration).toContain("grant execute on function public.close_leaderboard_season(uuid, integer) to service_role")
  })
})

describe("season lifecycle: recovery", () => {
  it("retries snapshot + finalize for stuck closing seasons", () => {
    expect(rankingMigration).toContain("create or replace function public.recover_leaderboard_season_drain()")
    expect(rankingMigration).toContain("public.snapshot_leaderboard_season(candidate.id)")
    expect(rankingMigration).toContain("'seasons_recovered'")
    expect(rankingMigration).toContain("'snapshots_created'")
  })

  it("reports, per season, why recovery is still blocked instead of failing the batch", () => {
    expect(rankingMigration).toContain("'SEASON_DRAIN_WINDOW_OPEN'")
    expect(rankingMigration).toContain("'PENDING_QUARANTINE_REVIEWS'")
    expect(rankingMigration).toContain("exception when others then")
    expect(rankingMigration).toContain("'blocked', blocked")
  })

  it("respects the drain window and pending quarantine gates before snapshotting", () => {
    expect(rankingMigration).toContain("candidate.finalize_after > clock_timestamp()")
    expect(rankingMigration).toContain("quarantine.status = 'pending'")
  })

  it("is restricted to service_role", () => {
    expect(rankingMigration).toContain("revoke all on function public.recover_leaderboard_season_drain() from public, anon, authenticated")
    expect(rankingMigration).toContain("grant execute on function public.recover_leaderboard_season_drain() to service_role")
  })
})

describe("season status RPC", () => {
  it("exposes public season lifecycle metadata for UI and diagnostics", () => {
    expect(rankingMigration).toContain("create or replace function public.get_leaderboard_season_status(")
    expect(rankingMigration).toContain("'lifecycle_state', season.lifecycle_state")
    expect(rankingMigration).toContain("'entry_count'")
    expect(rankingMigration).toContain("season.is_public = true")
    expect(rankingMigration).toContain("(p_season_slug is null or season.slug = p_season_slug)")
  })

  it("is readable by anon and authenticated roles", () => {
    expect(rankingMigration).toContain("grant execute on function public.get_leaderboard_season_status(text) to anon, authenticated, service_role")
  })
})
