create or replace function public.get_accepted_friend_ids(p_user_id uuid)
returns uuid[] language sql stable security invoker set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(case when user_low=p_user_id then user_high else user_low end), '{}'::uuid[])
  from public.player_friendships
  where status='accepted' and p_user_id in (user_low,user_high)
    and not exists (select 1 from public.player_blocks where blocker_id in (p_user_id,user_low,user_high) and blocked_id in (p_user_id,user_low,user_high));
$$;
revoke all on function public.get_accepted_friend_ids(uuid) from public, anon, authenticated;
grant execute on function public.get_accepted_friend_ids(uuid) to service_role;
