create or replace function public.create_merry_band(
  p_name text,
  p_banner_id text,
  p_creator_user_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  new_band_id uuid;
begin
  insert into public.merry_bands (name, banner_id, created_by)
  values (p_name, p_banner_id, p_creator_user_id)
  returning id into new_band_id;

  insert into public.merry_band_members (band_id, user_id, membership_role)
  values (new_band_id, p_creator_user_id, 'leader');

  return new_band_id;
end;
$$;

create or replace function public.apply_band_mission_reward(
  p_band_id uuid,
  p_mission_id uuid,
  p_mission_slug text,
  p_seed bigint,
  p_result jsonb,
  p_allocation_choice text,
  p_allocation_coin integer
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  inserted_grant_id uuid;
begin
  insert into public.band_mission_history (
    band_id, mission_id, mission_slug, seed, result, allocation_choice, allocation_coin
  ) values (
    p_band_id, p_mission_id, p_mission_slug, p_seed, p_result, p_allocation_choice, p_allocation_coin
  ) on conflict (band_id, mission_id) do nothing;

  insert into public.band_progression_grants (
    band_id, mission_id, grant_key, amount, payload
  ) values (
    p_band_id,
    p_mission_id,
    'community:' || p_allocation_choice,
    p_allocation_coin,
    jsonb_build_object('choice', p_allocation_choice, 'mission_slug', p_mission_slug)
  ) on conflict (band_id, mission_id, grant_key) do nothing
  returning id into inserted_grant_id;

  if inserted_grant_id is null then
    return false;
  end if;

  update public.merry_bands
  set village_state = jsonb_set(
        village_state,
        array[p_allocation_choice],
        to_jsonb(coalesce((village_state ->> p_allocation_choice)::integer, 0) + 1),
        true
      ),
      progression_version = progression_version + 1,
      updated_at = now()
  where id = p_band_id;

  return true;
end;
$$;

revoke all on function public.create_merry_band(text, text, uuid) from public, anon, authenticated;
revoke all on function public.apply_band_mission_reward(uuid, uuid, text, bigint, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.create_merry_band(text, text, uuid) to service_role;
grant execute on function public.apply_band_mission_reward(uuid, uuid, text, bigint, jsonb, text, integer) to service_role;
