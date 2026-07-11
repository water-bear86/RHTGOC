create or replace function public.get_merry_band_state(p_band_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id',band.id,
    'name',band.name,
    'bannerId',band.banner_id,
    'actorUserId',band.created_by,
    'camp',band.camp_state,
    'village',band.village_state,
    'progressionVersion',band.progression_version,
    'missionCount',(select count(*) from public.band_mission_history history where history.band_id=band.id),
    'memberCount',(select count(*) from public.merry_band_members membership where membership.band_id=band.id and membership.left_at is null),
    'members',coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId',membership.user_id,
        'membershipRole',membership.membership_role,
        'heroRole',membership.hero_role
      ) order by (membership.membership_role='leader') desc,membership.joined_at)
      from public.merry_band_members membership
      where membership.band_id=band.id and membership.left_at is null
    ),'[]'::jsonb)
  )
  from public.merry_bands band
  where band.id=p_band_id;
$$;

revoke all on function public.get_merry_band_state(uuid) from public,anon,authenticated;
grant execute on function public.get_merry_band_state(uuid) to service_role;

create or replace function public.add_merry_band_member(
  p_band_id uuid,
  p_actor_user_id uuid,
  p_member_user_id uuid,
  p_hero_role text
)
returns jsonb
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
declare existing_band_id uuid;
begin
  if p_actor_user_id=p_member_user_id then raise exception 'CANNOT_INVITE_SELF'; end if;
  if p_hero_role not in ('robin','marian','little-john','much') then raise exception 'INVALID_HERO_ROLE'; end if;
  if not exists(select 1 from auth.users where id=p_member_user_id) then raise exception 'UNKNOWN_BAND_MEMBER'; end if;
  if not exists(select 1 from public.merry_band_members where band_id=p_band_id and user_id=p_actor_user_id and membership_role='leader' and left_at is null) then raise exception 'BAND_LEADER_REQUIRED'; end if;

  perform pg_advisory_xact_lock(hashtextextended('merry-band:' || p_member_user_id::text,0));
  select band_id into existing_band_id from public.merry_band_members where user_id=p_member_user_id and left_at is null limit 1;
  if existing_band_id is not null and existing_band_id<>p_band_id then raise exception 'ALREADY_IN_ANOTHER_BAND'; end if;
  perform set_config('app.actor_user_id',p_actor_user_id::text,true);

  insert into public.merry_band_members(band_id,user_id,membership_role,hero_role,left_at)
  values(p_band_id,p_member_user_id,'member',p_hero_role,null)
  on conflict(band_id,user_id) do update set membership_role='member',hero_role=excluded.hero_role,left_at=null,joined_at=now();

  return public.get_merry_band_state(p_band_id);
end;
$$;

create or replace function public.remove_merry_band_member(
  p_band_id uuid,
  p_actor_user_id uuid,
  p_member_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  if p_actor_user_id=p_member_user_id then raise exception 'LEADER_CANNOT_REMOVE_SELF'; end if;
  if not exists(select 1 from public.merry_band_members where band_id=p_band_id and user_id=p_actor_user_id and membership_role='leader' and left_at is null) then raise exception 'BAND_LEADER_REQUIRED'; end if;
  perform set_config('app.actor_user_id',p_actor_user_id::text,true);
  update public.merry_band_members set left_at=now()
  where band_id=p_band_id and user_id=p_member_user_id and membership_role='member' and left_at is null;
  if not found then raise exception 'ACTIVE_MEMBER_NOT_FOUND'; end if;
  return public.get_merry_band_state(p_band_id);
end;
$$;

create or replace function public.update_merry_band_identity(
  p_band_id uuid,
  p_actor_user_id uuid,
  p_name text,
  p_banner_id text
)
returns jsonb
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  if not exists(select 1 from public.merry_band_members where band_id=p_band_id and user_id=p_actor_user_id and membership_role='leader' and left_at is null) then raise exception 'BAND_LEADER_REQUIRED'; end if;
  if p_name is null or char_length(trim(p_name)) not between 3 and 28 or trim(p_name) !~ '^[A-Za-z0-9 _-]+$' then raise exception 'INVALID_BAND_NAME'; end if;
  if p_banner_id not in ('oak','fox','arrow','stag') then raise exception 'INVALID_BANNER'; end if;
  perform set_config('app.actor_user_id',p_actor_user_id::text,true);
  update public.merry_bands set name=trim(p_name),banner_id=p_banner_id,updated_at=now() where id=p_band_id;
  return public.get_merry_band_state(p_band_id);
end;
$$;

create or replace function public.set_merry_band_hero_role(
  p_band_id uuid,
  p_user_id uuid,
  p_hero_role text
)
returns jsonb
language plpgsql
security invoker
set search_path=pg_catalog,public
as $$
begin
  if p_hero_role not in ('robin','marian','little-john','much') then raise exception 'INVALID_HERO_ROLE'; end if;
  if not exists(select 1 from public.merry_band_members where band_id=p_band_id and user_id=p_user_id and left_at is null) then raise exception 'ACTIVE_MEMBER_NOT_FOUND'; end if;
  perform set_config('app.actor_user_id',p_user_id::text,true);
  update public.merry_band_members set hero_role=p_hero_role where band_id=p_band_id and user_id=p_user_id and left_at is null and hero_role is distinct from p_hero_role;
  return public.get_merry_band_state(p_band_id);
end;
$$;

revoke all on function public.add_merry_band_member(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.remove_merry_band_member(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.update_merry_band_identity(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.set_merry_band_hero_role(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.add_merry_band_member(uuid,uuid,uuid,text) to service_role;
grant execute on function public.remove_merry_band_member(uuid,uuid,uuid) to service_role;
grant execute on function public.update_merry_band_identity(uuid,uuid,text,text) to service_role;
grant execute on function public.set_merry_band_hero_role(uuid,uuid,text) to service_role;
