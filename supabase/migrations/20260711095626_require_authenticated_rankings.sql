-- Public ranking reads go through a narrow, privacy-preserving RPC. Browser
-- roles never receive Auth UUIDs, verification UUIDs, score payloads, or raw
-- snapshots, and only authenticated players may enter verified rankings.

create or replace function public.reject_finalized_leaderboard_entry()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.player_id is null then raise exception 'AUTHENTICATED_PLAYER_REQUIRED' using errcode = '23502'; end if;
  if exists (
    select 1 from public.leaderboard_seasons
    where id = new.season_id and lifecycle_state = 'finalized'
  ) then
    raise exception 'SEASON_FINALIZED' using errcode = '55000';
  end if;
  return new;
end;
$$;

create or replace function public.read_leaderboard(
  p_kind text default 'master-outlaws',
  p_season_slug text default 'season-zero',
  p_character_id text default null,
  p_party_size integer default null,
  p_mission_slug text default null,
  p_band_id uuid default null,
  p_player_ids uuid[] default null,
  p_excluded_player_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  viewer_id uuid := auth.uid();
  result jsonb;
begin
  if p_kind not in ('master-outlaws', 'peoples-champions', 'clean-escapes', 'rescuers', 'swift-arrows') then
    raise exception 'INVALID_LEADERBOARD_KIND';
  end if;
  if p_character_id is not null and p_character_id not in ('robin', 'marian', 'little-john', 'much') then
    raise exception 'INVALID_CHARACTER_FILTER';
  end if;
  if p_party_size is not null and p_party_size not between 1 and 4 then raise exception 'INVALID_PARTY_FILTER'; end if;
  if p_mission_slug is not null and p_mission_slug !~ '^[a-z0-9-]{1,60}$' then raise exception 'INVALID_MISSION_FILTER'; end if;

  if coalesce(cardinality(p_player_ids), 0) > 0 then
    if viewer_id is null then return '[]'::jsonb; end if;
    if exists (
      select 1
      from unnest(p_player_ids) requested(user_id)
      where requested.user_id is null
        or (
          requested.user_id <> viewer_id
          and not exists (
            select 1
            from public.player_friendships friendship
            where friendship.status = 'accepted'
              and (
                (friendship.user_low = viewer_id and friendship.user_high = requested.user_id)
                or (friendship.user_high = viewer_id and friendship.user_low = requested.user_id)
              )
          )
        )
    ) then raise exception 'FORBIDDEN_LEADERBOARD_SCOPE'; end if;
  end if;

  if p_band_id is not null and (
    viewer_id is null
    or not exists (
      select 1 from public.merry_band_members member
      where member.band_id = p_band_id and member.user_id = viewer_id and member.left_at is null
    )
  ) then raise exception 'FORBIDDEN_LEADERBOARD_SCOPE'; end if;

  select coalesce(jsonb_agg(to_jsonb(ranked)), '[]'::jsonb) into result
  from (
    select
      entry.id,
      entry.player_name,
      entry.character_id,
      entry.score,
      entry.grade,
      entry.mission_seconds,
      entry.delivered,
      entry.verified,
      entry.created_at,
      entry.party_size,
      entry.mission_slug,
      entry.rescues,
      entry.precision,
      entry.generosity,
      entry.clean_escape
    from public.leaderboard_entries entry
    join public.leaderboard_seasons season on season.id = entry.season_id
    where season.slug = p_season_slug
      and season.is_public = true
      and entry.verified = true
      and (p_character_id is null or entry.character_id = p_character_id)
      and (p_party_size is null or entry.party_size = p_party_size)
      and (p_mission_slug is null or entry.mission_slug = p_mission_slug)
      and (p_band_id is null or entry.band_id = p_band_id)
      and (coalesce(cardinality(p_player_ids), 0) = 0 or entry.player_id = any(p_player_ids))
      and (coalesce(cardinality(p_excluded_player_ids), 0) = 0 or entry.player_id <> all(p_excluded_player_ids))
      and (p_kind <> 'clean-escapes' or entry.clean_escape = true)
      and (
        viewer_id is null
        or not exists (
          select 1 from public.player_blocks block
          where (block.blocker_id = viewer_id and block.blocked_id = entry.player_id)
             or (block.blocker_id = entry.player_id and block.blocked_id = viewer_id)
        )
      )
    order by
      case when p_kind = 'master-outlaws' then entry.score end desc nulls last,
      case when p_kind = 'peoples-champions' then entry.delivered end desc nulls last,
      case when p_kind = 'clean-escapes' then entry.delivered end desc nulls last,
      case when p_kind = 'rescuers' then entry.rescues end desc nulls last,
      case when p_kind = 'swift-arrows' then entry.mission_seconds end asc nulls last,
      case when p_kind = 'master-outlaws' then entry.mission_seconds end asc nulls last,
      case when p_kind = 'clean-escapes' then entry.score end desc nulls last,
      case when p_kind = 'clean-escapes' then entry.mission_seconds end asc nulls last,
      entry.score desc,
      case when p_kind = 'swift-arrows' then entry.precision end desc nulls last,
      entry.id
    limit 50
  ) ranked;
  return result;
end;
$$;

revoke all on table public.leaderboard_entries from anon, authenticated;
revoke all on table public.leaderboard_season_snapshots from anon, authenticated;
revoke all on function public.read_leaderboard(text,text,text,integer,text,uuid,uuid[],uuid[]) from public,anon,authenticated;
grant execute on function public.read_leaderboard(text,text,text,integer,text,uuid,uuid[],uuid[]) to anon,authenticated;
revoke all on function public.reject_finalized_leaderboard_entry() from public,anon,authenticated,service_role;
