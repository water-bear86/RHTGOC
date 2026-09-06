-- Restore block isolation on social profile visibility.
--
-- The anti-block clause originally guarded profile visibility
-- (20260711070549_add_social_graph.sql). It was lost when the policy was
-- recreated in 20260711071542_add_recent_players.sql and stayed lost through
-- 20260711071747_harden_social_policies.sql.
--
-- Without it, a blocked player keeps reading their victim's row through the
-- recent_band_players branch: display_name, presence_status, last_seen_at and,
-- critically, active_room_code — the live 6-character code, which is the only
-- thing needed to join a private lobby. Blocking someone did not stop them
-- following you.
--
-- Two changes are needed, because the surviving branch is not self-healing:
--   1. the policy must exclude blocked pairs in both directions, and
--   2. blocking must delete the recent_band_players rows that grant the access,
--      since record_recent_band_players only skips blocked pairs at insert time.

drop policy "Trusted social profiles are visible" on public.player_social_profiles;
create policy "Trusted social profiles are visible" on public.player_social_profiles for select to authenticated using (
  user_id=(select auth.uid())
  or (
    not exists (
      select 1 from public.player_blocks block
      where block.blocker_id in ((select auth.uid()), player_social_profiles.user_id)
        and block.blocked_id in ((select auth.uid()), player_social_profiles.user_id)
    )
    and (
      exists (
        select 1 from public.player_friendships friendship
        where friendship.status='accepted'
          and friendship.user_low in ((select auth.uid()), player_social_profiles.user_id)
          and friendship.user_high in ((select auth.uid()), player_social_profiles.user_id)
      )
      or exists (
        select 1 from public.recent_band_players recent
        where recent.owner_id=(select auth.uid())
          and recent.other_id=player_social_profiles.user_id
      )
    )
  )
);

-- Blocking now also severs the recent-bandmate link in both directions.
create or replace function public.block_player(p_other_user_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or p_other_user_id=auth.uid() then raise exception 'INVALID_BLOCK'; end if;
  insert into public.player_blocks(blocker_id,blocked_id) values(auth.uid(),p_other_user_id) on conflict do nothing;
  delete from public.player_friendships where user_low=least(auth.uid(),p_other_user_id) and user_high=greatest(auth.uid(),p_other_user_id);
  delete from public.recent_band_players where (owner_id=auth.uid() and other_id=p_other_user_id) or (owner_id=p_other_user_id and other_id=auth.uid());
  update public.direct_band_invites set status='revoked', responded_at=now() where status='pending' and ((sender_id=auth.uid() and recipient_id=p_other_user_id) or (sender_id=p_other_user_id and recipient_id=auth.uid()));
  return true;
end;
$$;

create or replace function public.record_public_hub_block(p_blocker_id uuid, p_blocked_id uuid)
returns boolean language plpgsql security invoker set search_path = pg_catalog, public
as $$
begin
  if p_blocker_id=p_blocked_id or not exists(select 1 from auth.users where id=p_blocker_id) or not exists(select 1 from auth.users where id=p_blocked_id) then raise exception 'INVALID_HUB_BLOCK'; end if;
  insert into public.player_blocks(blocker_id,blocked_id) values(p_blocker_id,p_blocked_id) on conflict do nothing;
  delete from public.player_friendships where user_low=least(p_blocker_id,p_blocked_id) and user_high=greatest(p_blocker_id,p_blocked_id);
  delete from public.recent_band_players where (owner_id=p_blocker_id and other_id=p_blocked_id) or (owner_id=p_blocked_id and other_id=p_blocker_id);
  update public.direct_band_invites set status='revoked',responded_at=now() where status='pending' and ((sender_id=p_blocker_id and recipient_id=p_blocked_id) or (sender_id=p_blocked_id and recipient_id=p_blocker_id));
  return true;
end;
$$;
revoke all on function public.record_public_hub_block(uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_public_hub_block(uuid,uuid) to service_role;

-- Clean up links that already exist for pairs where one side has blocked the other.
delete from public.recent_band_players recent
where exists (
  select 1 from public.player_blocks block
  where block.blocker_id in (recent.owner_id, recent.other_id)
    and block.blocked_id in (recent.owner_id, recent.other_id)
);
