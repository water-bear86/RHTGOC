-- Column-scope grants that were left broader than what any caller uses, and
-- drop a stale realtime publication. None of this changes behavior for any
-- existing query — every column and table removed here is unused by src/ or
-- server/ — it only removes latent over-exposure so a future one-line grant
-- or publish change can't silently reopen it.

-- band_audit_log: leaders could read after_state/before_state, which is
-- to_jsonb(row) on merry_band_members changes and so carries the member's
-- Auth UUID — the identity-oracle shape that 20260711100722 exists to close
-- off for leaderboards. Nothing in src/ or server/ reads this table; it is
-- an operator/audit trail. Revoke client access entirely.
drop policy if exists "Leaders can read band audit log" on public.band_audit_log;
revoke all on table public.band_audit_log from authenticated;

-- merry_bands: created_by is an Auth UUID with no client reader. Replace the
-- blanket table grant with a column grant that excludes it.
revoke select on table public.merry_bands from authenticated;
grant select (id, name, banner_id, camp_state, village_state, progression_version, created_at, updated_at)
  on public.merry_bands to authenticated;

-- leaderboard_seasons: the client (src/leaderboard.ts) selects "slug,name",
-- filters on is_public, and orders by starts_at — all three need column-level
-- SELECT even though only the first two are returned. The table grant is
-- still the original blanket one from 20260710214214 even though the season
-- lifecycle columns (campaign_id, lifecycle_state, closed_at, finalize_after,
-- finalized_at) were added later — none of those are meant for anon/authenticated.
revoke select on table public.leaderboard_seasons from anon, authenticated;
grant select (slug, name, is_public, starts_at) on public.leaderboard_seasons to anon, authenticated;

-- leaderboard_entries: writes and reads already go exclusively through
-- record_verified_leaderboard_entry / read_leaderboard (service-role /
-- SECURITY DEFINER only) since 20260711095626, which revoked the table grant.
-- The select policy predating that revoke was never dropped, and the table
-- is still in the realtime publication from its original migration. Neither
-- is reachable today only because of that revoke; removing them closes the
-- path a future `grant select` one-liner would otherwise reopen without
-- review, including a full-row realtime firehose (player_id,
-- verification_id, score_breakdown).
drop policy if exists "Verified leaderboard entries are readable" on public.leaderboard_entries;
-- ALTER PUBLICATION ... DROP TABLE does not accept IF EXISTS; guard via catalog.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'leaderboard_entries'
  ) then
    execute 'alter publication supabase_realtime drop table public.leaderboard_entries';
  end if;
end
$$;
