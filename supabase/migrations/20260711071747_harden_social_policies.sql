create index if not exists player_blocks_blocked_idx on public.player_blocks (blocked_id, blocker_id);
create index if not exists player_friendships_user_high_idx on public.player_friendships (user_high, user_low);
create index if not exists player_friendships_requested_by_idx on public.player_friendships (requested_by, created_at desc);
create index if not exists recent_band_players_other_idx on public.recent_band_players (other_id, last_played_at desc);

drop policy "Participants see friendships" on public.player_friendships;
create policy "Participants see friendships" on public.player_friendships for select to authenticated using ((select auth.uid()) in (user_low,user_high));

drop policy "Owners see their blocks" on public.player_blocks;
create policy "Owners see their blocks" on public.player_blocks for select to authenticated using (blocker_id=(select auth.uid()));

drop policy "Invite participants see invites" on public.direct_band_invites;
create policy "Invite participants see invites" on public.direct_band_invites for select to authenticated using ((select auth.uid()) in (sender_id,recipient_id));

drop policy "Players see their recent bandmates" on public.recent_band_players;
create policy "Players see their recent bandmates" on public.recent_band_players for select to authenticated using (owner_id=(select auth.uid()));

drop policy "Trusted social profiles are visible" on public.player_social_profiles;
create policy "Trusted social profiles are visible" on public.player_social_profiles for select to authenticated using (
  user_id=(select auth.uid())
  or exists (select 1 from public.player_friendships friendship where friendship.status='accepted' and friendship.user_low in ((select auth.uid()),player_social_profiles.user_id) and friendship.user_high in ((select auth.uid()),player_social_profiles.user_id))
  or exists (select 1 from public.recent_band_players recent where recent.owner_id=(select auth.uid()) and recent.other_id=player_social_profiles.user_id)
);
