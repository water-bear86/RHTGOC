create unique index if not exists merry_band_members_one_active_user_idx
  on public.merry_band_members(user_id)
  where left_at is null;

create or replace function public.get_merry_band_state(p_band_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'id', band.id,
    'name', band.name,
    'bannerId', band.banner_id,
    'actorUserId', band.created_by,
    'camp', band.camp_state,
    'village', band.village_state,
    'progressionVersion', band.progression_version,
    'missionCount', (select count(*) from public.band_mission_history history where history.band_id = band.id)
  )
  from public.merry_bands band
  where band.id = p_band_id;
$$;

revoke all on function public.get_merry_band_state(uuid) from public, anon, authenticated;
grant execute on function public.get_merry_band_state(uuid) to service_role;

create or replace function public.ensure_merry_band(
  p_creator_user_id uuid,
  p_display_name text,
  p_hero_role text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  active_band_id uuid;
  safe_name text;
begin
  if not exists(select 1 from auth.users where id = p_creator_user_id) then
    raise exception 'UNKNOWN_BAND_CREATOR';
  end if;
  if p_hero_role not in ('robin','marian','little-john','much') then
    raise exception 'INVALID_HERO_ROLE';
  end if;

  safe_name := left(regexp_replace(trim(p_display_name), '[^A-Za-z0-9 _-]', '', 'g'), 20);
  if char_length(safe_name) < 1 then safe_name := 'Sherwood'; end if;

  perform pg_advisory_xact_lock(hashtextextended('merry-band:' || p_creator_user_id::text, 0));
  perform set_config('app.actor_user_id', p_creator_user_id::text, true);

  select membership.band_id into active_band_id
  from public.merry_band_members membership
  where membership.user_id = p_creator_user_id and membership.left_at is null
  order by (membership.membership_role = 'leader') desc, membership.joined_at
  limit 1;

  if active_band_id is null then
    insert into public.merry_bands(name,banner_id,created_by)
    values (safe_name || ' Band','oak',p_creator_user_id)
    returning id into active_band_id;

    insert into public.merry_band_members(band_id,user_id,membership_role,hero_role)
    values (active_band_id,p_creator_user_id,'leader',p_hero_role);
  else
    update public.merry_band_members
    set hero_role = p_hero_role
    where band_id = active_band_id and user_id = p_creator_user_id and left_at is null
      and hero_role is distinct from p_hero_role;
  end if;

  return public.get_merry_band_state(active_band_id);
end;
$$;

revoke all on function public.ensure_merry_band(uuid,text,text) from public, anon, authenticated;
grant execute on function public.ensure_merry_band(uuid,text,text) to service_role;

create or replace function public.record_band_mission_outcome(
  p_band_id uuid,
  p_actor_user_id uuid,
  p_mission_id uuid,
  p_mission_slug text,
  p_seed bigint,
  p_status text,
  p_result jsonb,
  p_allocation_choice text,
  p_allocation_coin integer
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  inserted_history_id uuid;
  inserted_grant_id uuid;
  next_version integer;
begin
  if p_status not in ('succeeded','failed') then raise exception 'INVALID_MISSION_STATUS'; end if;
  if p_allocation_choice is not null and p_allocation_choice not in ('granary','infirmary','watchtower') then raise exception 'INVALID_ALLOCATION'; end if;
  if p_status = 'succeeded' and p_allocation_choice is null then raise exception 'SUCCEEDED_MISSION_REQUIRES_ALLOCATION'; end if;
  if p_status = 'failed' and p_allocation_choice is not null then raise exception 'FAILED_MISSION_CANNOT_ALLOCATE'; end if;
  if p_actor_user_id is not null and not exists(
    select 1 from public.merry_band_members
    where band_id = p_band_id and user_id = p_actor_user_id and left_at is null
  ) then raise exception 'ACTOR_NOT_IN_BAND'; end if;

  if p_actor_user_id is not null then perform set_config('app.actor_user_id', p_actor_user_id::text, true); end if;

  insert into public.band_mission_history(
    band_id,mission_id,mission_slug,seed,result,allocation_choice,allocation_coin
  ) values (
    p_band_id,p_mission_id,p_mission_slug,p_seed,
    jsonb_build_object('status',p_status,'mastery',coalesce(p_result,'{}'::jsonb)),
    p_allocation_choice,case when p_allocation_choice is null then 0 else p_allocation_coin end
  ) on conflict (band_id,mission_id) do nothing
  returning id into inserted_history_id;

  if inserted_history_id is null then
    return jsonb_build_object('recorded',false,'progressed',false,'band',public.get_merry_band_state(p_band_id));
  end if;

  if p_status = 'succeeded' then
    insert into public.band_progression_grants(band_id,mission_id,grant_key,amount,payload)
    values (
      p_band_id,p_mission_id,'community:' || p_allocation_choice,p_allocation_coin,
      jsonb_build_object('choice',p_allocation_choice,'mission_slug',p_mission_slug)
    ) on conflict (band_id,mission_id,grant_key) do nothing
    returning id into inserted_grant_id;

    if inserted_grant_id is not null then
      select progression_version + 1 into next_version
      from public.merry_bands where id = p_band_id for update;

      update public.merry_bands
      set village_state = jsonb_set(
            village_state,array[p_allocation_choice],
            to_jsonb(coalesce((village_state ->> p_allocation_choice)::integer,0) + 1),true
          ),
          camp_state = jsonb_build_object(
            'hearth',least(3,1 + ((next_version - 1) / 4)),
            'workbench',least(3,(next_version / 2)),
            'stores',least(3,(next_version / 3))
          ),
          progression_version = next_version,
          updated_at = now()
      where id = p_band_id;
    end if;
  end if;

  return jsonb_build_object(
    'recorded',true,
    'progressed',inserted_grant_id is not null,
    'band',public.get_merry_band_state(p_band_id)
  );
end;
$$;

revoke all on function public.record_band_mission_outcome(uuid,uuid,uuid,text,bigint,text,jsonb,text,integer) from public, anon, authenticated;
grant execute on function public.record_band_mission_outcome(uuid,uuid,uuid,text,bigint,text,jsonb,text,integer) to service_role;

create or replace function private.audit_merry_band_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  insert into public.band_audit_log(band_id,actor_user_id,action,before_state,after_state)
  values(
    coalesce(new.id,old.id),
    coalesce((select auth.uid()),nullif(current_setting('app.actor_user_id',true),'')::uuid),
    'band:' || lower(tg_op),
    case when old is null then null else to_jsonb(old) end,
    case when new is null then null else to_jsonb(new) end
  );
  return coalesce(new,old);
end;
$$;

create or replace function private.audit_band_child_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  insert into public.band_audit_log(band_id,actor_user_id,action,before_state,after_state)
  values(
    coalesce(new.band_id,old.band_id),
    coalesce((select auth.uid()),nullif(current_setting('app.actor_user_id',true),'')::uuid),
    tg_table_name || ':' || lower(tg_op),
    case when old is null then null else to_jsonb(old) end,
    case when new is null then null else to_jsonb(new) end
  );
  return coalesce(new,old);
end;
$$;

revoke all on function private.audit_merry_band_change() from public, anon, authenticated;
revoke all on function private.audit_band_child_change() from public, anon, authenticated;
