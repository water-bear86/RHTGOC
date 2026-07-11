create or replace function public.record_public_hub_block(p_blocker_id uuid, p_blocked_id uuid)
returns boolean language plpgsql security invoker set search_path = pg_catalog, public
as $$
begin
  if p_blocker_id=p_blocked_id or not exists(select 1 from auth.users where id=p_blocker_id) or not exists(select 1 from auth.users where id=p_blocked_id) then raise exception 'INVALID_HUB_BLOCK'; end if;
  insert into public.player_blocks(blocker_id,blocked_id) values(p_blocker_id,p_blocked_id) on conflict do nothing;
  delete from public.player_friendships where user_low=least(p_blocker_id,p_blocked_id) and user_high=greatest(p_blocker_id,p_blocked_id);
  update public.direct_band_invites set status='revoked',responded_at=now() where status='pending' and ((sender_id=p_blocker_id and recipient_id=p_blocked_id) or (sender_id=p_blocked_id and recipient_id=p_blocker_id));
  return true;
end;
$$;
revoke all on function public.record_public_hub_block(uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_public_hub_block(uuid,uuid) to service_role;
