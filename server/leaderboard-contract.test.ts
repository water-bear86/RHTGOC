import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const migrations = [
  "20260710214214_create_leaderboard.sql",
  "20260711032909_add_verified_seasonal_leaderboards.sql",
  "20260711033002_harden_verified_leaderboards.sql",
  "20260711044948_add_leaderboard_mission_identity.sql",
  "20260711085555_manage_leaderboard_lifecycle.sql",
  "20260711094523_finalize_leaderboard_lifecycle.sql",
  "20260711095626_require_authenticated_rankings.sql",
  "20260711100722_remove_leaderboard_identity_oracle.sql",
].map((file) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8")).join("\n")

describe("Leaderboard schema contract", () => {
  it("defines all five board slugs in the snapshot table check constraint", () => {
    expect(migrations).toContain("master-outlaws")
    expect(migrations).toContain("peoples-champions")
    expect(migrations).toContain("clean-escapes")
    expect(migrations).toContain("rescuers")
    expect(migrations).toContain("swift-arrows")
    expect(migrations).toContain("board_slug in ('master-outlaws', 'peoples-champions', 'clean-escapes', 'rescuers', 'swift-arrows')")
  })

  it("enforces one snapshot row per season per board", () => {
    expect(migrations).toContain("unique (season_id, board_slug)")
  })

  it("keeps snapshots append-only via a trigger that rejects update and delete", () => {
    expect(migrations).toContain("create trigger leaderboard_snapshots_append_only")
    expect(migrations).toContain("before update or delete on public.leaderboard_season_snapshots")
    expect(migrations).toContain("reject_immutable_leaderboard_mutation")
  })

  it("keeps campaign events append-only", () => {
    expect(migrations).toContain("create trigger sherwood_campaign_events_append_only")
    expect(migrations).toContain("before update or delete on public.sherwood_campaign_events")
  })

  it("guards entries against finalized-season inserts", () => {
    expect(migrations).toContain("create trigger leaderboard_entries_finalized_guard")
    expect(migrations).toContain("before insert on public.leaderboard_entries")
    expect(migrations).toContain("reject_finalized_leaderboard_entry")
    expect(migrations).toContain("SEASON_FINALIZED")
  })

  it("enforces the three-state lifecycle with a check constraint", () => {
    expect(migrations).toContain("lifecycle_state text not null default 'open' check (lifecycle_state in ('open', 'closing', 'finalized'))")
    expect(migrations).toContain("leaderboard_seasons_lifecycle_check")
  })

  it("records mission_started_at and bounds it within the season window", () => {
    expect(migrations).toContain("mission_started_at timestamptz")
    expect(migrations).toContain("MISSION_OUTSIDE_SEASON")
  })

  it("makes verification_id unique for idempotent replay", () => {
    expect(migrations).toContain("verification_id uuid unique")
  })

  it("derives clean_escape server-side rather than trusting client input", () => {
    expect(migrations).toContain("clean_escape boolean not null default false")
    expect(migrations).toContain("p_clean_escape boolean")
  })

  it("validates score bounds and mission duration", () => {
    expect(migrations).toContain("score integer not null check (score between 0 and 100000)")
    expect(migrations).toContain("mission_seconds integer not null check (mission_seconds between 1 and 86400)")
  })

  it("validates precision and generosity ranges", () => {
    expect(migrations).toContain("precision smallint not null default 0 check (precision between 0 and 100)")
    expect(migrations).toContain("generosity smallint not null default 0 check (generosity between 0 and 100)")
  })

  it("validates party_size is 1-4", () => {
    expect(migrations).toContain("party_size smallint not null check (party_size between 1 and 4)")
  })

  it("validates character_id against the four-hero roster", () => {
    expect(migrations).toContain("robin', 'marian', 'little-john', 'much")
  })

  it("hydrates mission version and content hash from the score breakdown", () => {
    expect(migrations).toContain("hydrate_leaderboard_mission_identity")
    expect(migrations).toContain("mission_version")
    expect(migrations).toContain("mission_content_hash")
  })
})

describe("Leaderboard index contract", () => {
  it("has a partial index for master-outlaws ranking (score desc, time asc)", () => {
    expect(migrations).toContain("leaderboard_entries_ranking_idx")
    expect(migrations).toContain("season_id, verified desc, score desc, mission_seconds asc, created_at asc")
  })

  it("has a partial index for people's champions (delivered desc, score desc)", () => {
    expect(migrations).toContain("leaderboard_entries_champion_v2_idx")
    expect(migrations).toContain("delivered desc, score desc, id")
  })

  it("has a partial index for clean escapes (delivered desc, score desc, time asc) filtered to clean_escape = true", () => {
    expect(migrations).toContain("leaderboard_entries_clean_v2_idx")
    expect(migrations).toContain("delivered desc, score desc, mission_seconds asc, id")
    expect(migrations).toContain("clean_escape = true")
  })

  it("has a partial index for rescuers (rescues desc, score desc)", () => {
    expect(migrations).toContain("leaderboard_entries_rescuer_idx")
    expect(migrations).toContain("rescues desc, score desc")
  })

  it("has a partial index for swift arrows partitioned by mission and party size (time asc, score desc, precision desc)", () => {
    expect(migrations).toContain("leaderboard_entries_swift_v2_idx")
    expect(migrations).toContain("mission_slug, party_size, mission_seconds asc, score desc, precision desc, id")
  })

  it("has a partial index for band-scoped reads", () => {
    expect(migrations).toContain("leaderboard_entries_band_idx")
    expect(migrations).toContain("band_id is not null")
  })

  it("has a partial index for character + party_size filtering", () => {
    expect(migrations).toContain("leaderboard_entries_character_idx")
    expect(migrations).toContain("character_id, party_size, score desc")
  })
})

describe("Leaderboard RPC contract", () => {
  it("exposes read_leaderboard only to service_role and revokes it from public roles", () => {
    expect(migrations).toContain("revoke all on function public.read_leaderboard")
    expect(migrations).toContain("grant execute on function public.read_leaderboard")
  })

  it("exposes record_verified_leaderboard_entry only to service_role", () => {
    expect(migrations).toContain("revoke all on function public.record_verified_leaderboard_entry")
    expect(migrations).toContain("grant execute on function public.record_verified_leaderboard_entry")
    expect(migrations).toContain("to service_role")
  })

  it("exposes snapshot_leaderboard_season only to service_role", () => {
    expect(migrations).toContain("revoke all on function public.snapshot_leaderboard_season")
    expect(migrations).toContain("grant execute on function public.snapshot_leaderboard_season")
  })

  it("exposes review_leaderboard_quarantine only to service_role", () => {
    expect(migrations).toContain("revoke all on function public.review_leaderboard_quarantine")
    expect(migrations).toContain("grant execute on function public.review_leaderboard_quarantine")
  })

  it("exposes finalize_due_leaderboard_seasons only to service_role", () => {
    expect(migrations).toContain("revoke all on function public.finalize_due_leaderboard_seasons")
    expect(migrations).toContain("grant execute on function public.finalize_due_leaderboard_seasons")
  })

  it("revokes direct table access from anon and authenticated roles", () => {
    expect(migrations).toContain("revoke all on table public.leaderboard_entries from anon, authenticated")
    expect(migrations).toContain("revoke all on table public.leaderboard_season_snapshots from anon, authenticated")
  })

  it("drops the identity-oracle overload that exposed player IDs", () => {
    expect(migrations).toContain("drop function if exists public.read_leaderboard(text,text,text,integer,text,uuid,uuid[],uuid[])")
  })
})

describe("Quarantine and review contract", () => {
  it("stores quarantine reason and payload for server-observable violations", () => {
    expect(migrations).toContain("create table public.leaderboard_quarantine")
    expect(migrations).toContain("reason text not null")
    expect(migrations).toContain("payload jsonb not null")
    expect(migrations).toContain("status text not null default 'pending'")
  })

  it("raises VERIFICATION_CONFLICT on payload mismatch for the same verification_id", () => {
    expect(migrations).toContain("VERIFICATION_CONFLICT")
  })

  it("raises VERIFICATION_REJECTED when a run was already rejected", () => {
    expect(migrations).toContain("VERIFICATION_REJECTED")
  })

  it("raises REVIEW_DECISION_CONFLICT when the opposite terminal decision is requested", () => {
    expect(migrations).toContain("REVIEW_DECISION_CONFLICT")
  })

  it("raises APPROVED_VERIFICATION_ENTRY_MISSING when an approved quarantine has no entry", () => {
    expect(migrations).toContain("APPROVED_VERIFICATION_ENTRY_MISSING")
  })

  it("raises REJECTED_VERIFICATION_HAS_ENTRY when a rejected verification somehow has an entry", () => {
    expect(migrations).toContain("REJECTED_VERIFICATION_HAS_ENTRY")
  })

  it("requires reviewer attribution (reviewed_by and reviewer_audit_id) for terminal decisions", () => {
    expect(migrations).toContain("reviewer_audit_id uuid")
    expect(migrations).toContain("leaderboard_quarantine_review_audit_check")
  })

  it("blocks finalization while pending quarantines exist", () => {
    expect(migrations).toContain("PENDING_QUARANTINE_REVIEWS")
  })
})

describe("Season lifecycle contract", () => {
  it("sets finalize_after to 30 minutes after archive", () => {
    expect(migrations).toContain("interval '30 minutes'")
  })

  it("raises SEASON_DRAIN_WINDOW_OPEN if finalization is attempted too early", () => {
    expect(migrations).toContain("SEASON_DRAIN_WINDOW_OPEN")
  })

  it("raises INCOMPLETE_LEADERBOARD_SNAPSHOT if any board is missing", () => {
    expect(migrations).toContain("INCOMPLETE_LEADERBOARD_SNAPSHOT")
  })

  it("raises INCOMPLETE_FINALIZED_SNAPSHOT if a finalized season lacks all five snapshots", () => {
    expect(migrations).toContain("INCOMPLETE_FINALIZED_SNAPSHOT")
  })

  it("raises FINALIZED_SEASON_IMMUTABLE when sync attempts to modify a finalized season", () => {
    expect(migrations).toContain("FINALIZED_SEASON_IMMUTABLE")
  })

  it("raises FINALIZED_SEASON_HAS_PENDING_REVIEW when a finalized season still has pending quarantines", () => {
    expect(migrations).toContain("FINALIZED_SEASON_HAS_PENDING_REVIEW")
  })

  it("uses advisory locks for serialization across concurrent writers", () => {
    expect(migrations).toContain("pg_advisory_xact_lock")
    expect(migrations).toContain("leaderboard-season-lifecycle")
    expect(migrations).toContain("leaderboard-verification:")
  })
})
