create index leaderboard_entries_band_fk_idx
  on public.leaderboard_entries (band_id)
  where band_id is not null;

create index leaderboard_quarantine_reviewer_idx
  on public.leaderboard_quarantine (reviewed_by)
  where reviewed_by is not null;

create policy "Client quarantine access is denied"
  on public.leaderboard_quarantine for select to authenticated
  using (false);
