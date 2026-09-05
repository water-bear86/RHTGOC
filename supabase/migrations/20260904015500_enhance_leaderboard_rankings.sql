-- Ranked, paginated leaderboard reads with deterministic ties, the viewer's
-- own rank, and manual + scheduled season rollover that preserves late-event
-- handling. The existing read_leaderboard RPC is left untouched so already
-- shipped clients and finalized-season consumers keep their exact response
-- shape; ranked pagination is a new, additive RPC.

-- ---------------------------------------------------------------------------
-- 1. Scale-oriented index for the Master Outlaws sort prefix
-- ---------------------------------------------------------------------------
-- The other four boards already have partial indexes matching their ORDER BY
-- prefixes (champion_v2, clean_v2, rescuer, swift_v2). Master Outlaws was
-- missing one that includes the tie-break column.
create index if not exists leaderboard_entries_mastery_v2_idx
  on public.leaderboard_entries (season_id, score desc, mission_seconds asc, id)
  where verified = true;

-- ---------------------------------------------------------------------------
-- 2. Ranked paginated read RPC (additive; read_leaderboard is unchanged)
-- ---------------------------------------------------------------------------
create or replace function public.read_leaderboard_ranked(
  p_kind text default 'master-outlaws',
  p_season_slug text default 'season-zero',
  p_character_id text default null,
  p_party_size integer default null,
  p_mission_slug text default null,
  p_band_id uuid default null,
  p_player_ids uuid[] default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  viewer_id uuid := auth.uid();
  page jsonb;
  self_row jsonb;
  total_count bigint;
begin
  if p_kind not in ('master-outlaws', 'peoples-champions', 'clean-escapes', 'rescuers', 'swift-arrows') then
    raise exception 'INVALID_LEADERBOARD_KIND';
  end if;
  if p_character_id is not null and p_character_id not in ('robin', 'marian', 'little-john', 'much') then
    raise exception 'INVALID_CHARACTER_FILTER';
  end if;
  if p_party_size is not null and p_party_size not between 1 and 4 then
    raise exception 'INVALID_PARTY_FILTER';
  end if;
  if p_mission_slug is not null and p_mission_slug !~ '^[a-z0-9-]{1,60}$' then
    raise exception 'INVALID_MISSION_FILTER';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'INVALID_LEADERBOARD_LIMIT';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception 'INVALID_LEADERBOARD_OFFSET';
  end if;
  -- Swift Arrows ranks are only meaningful inside one (mission, party-size)
  -- partition; a global swift ranking would compare unlike rulesets.
  if p_kind = 'swift-arrows' and (p_mission_slug is null or p_party_size is null) then
    raise exception 'SWIFT_ARROWS_SCOPE_REQUIRED';
  end if;

  if coalesce(cardinality(p_player_ids), 0) > 0 then
    if viewer_id is null then
      return jsonb_build_object(
        'entries', '[]'::jsonb,
        'pagination', jsonb_build_object('total', 0, 'limit', p_limit, 'offset', p_offset, 'has_next', false),
        'self', null
      );
    end if;
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

  with filtered as (
    select
      entry.id,
      entry.player_id,
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
      entry.clean_escape,
      -- Deterministic per-board sort keys. Rank ties are defined as equality
      -- on every key except the final id tie-break.
      case p_kind
        when 'master-outlaws' then -entry.score
        when 'peoples-champions' then -entry.delivered
        when 'clean-escapes' then -entry.delivered
        when 'rescuers' then -entry.rescues
        else entry.mission_seconds
      end as sort_a,
      case p_kind
        when 'master-outlaws' then entry.mission_seconds
        else -entry.score
      end as sort_b,
      case p_kind
        when 'clean-escapes' then entry.mission_seconds
        when 'swift-arrows' then -entry.precision
        else 0
      end as sort_c
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
      and (p_kind <> 'clean-escapes' or entry.clean_escape = true)
      and (
        viewer_id is null
        or not exists (
          select 1 from public.player_blocks block
          where (block.blocker_id = viewer_id and block.blocked_id = entry.player_id)
             or (block.blocker_id = entry.player_id and block.blocked_id = viewer_id)
        )
      )
  ),
  ranked as (
    select
      f.*,
      row_number() over (order by f.sort_a, f.sort_b, f.sort_c, f.id) as row_num,
      rank() over (order by f.sort_a, f.sort_b, f.sort_c) as entry_rank,
      count(*) over (partition by f.sort_a, f.sort_b, f.sort_c) as tie_peers
    from filtered f
  )
  select
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'player_name', r.player_name,
          'character_id', r.character_id,
          'score', r.score,
          'grade', r.grade,
          'mission_seconds', r.mission_seconds,
          'delivered', r.delivered,
          'verified', r.verified,
          'created_at', r.created_at,
          'party_size', r.party_size,
          'mission_slug', r.mission_slug,
          'rescues', r.rescues,
          'precision', r.precision,
          'generosity', r.generosity,
          'clean_escape', r.clean_escape,
          'rank', r.entry_rank,
          'is_tied', r.tie_peers > 1,
          'position', r.row_num
        ) order by r.row_num
      ) filter (where r.row_num > p_offset and r.row_num <= p_offset + p_limit),
      '[]'::jsonb
    ),
    count(*),
    (
      jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'player_name', r.player_name,
          'character_id', r.character_id,
          'score', r.score,
          'grade', r.grade,
          'mission_seconds', r.mission_seconds,
          'delivered', r.delivered,
          'verified', r.verified,
          'created_at', r.created_at,
          'party_size', r.party_size,
          'mission_slug', r.mission_slug,
          'rescues', r.rescues,
          'precision', r.precision,
          'generosity', r.generosity,
          'clean_escape', r.clean_escape,
          'rank', r.entry_rank,
          'is_tied', r.tie_peers > 1,
          'position', r.row_num
        ) order by r.row_num
      ) filter (where viewer_id is not null and r.player_id = viewer_id)
    ) -> 0
  into page, total_count, self_row
  from ranked r;

  return jsonb_build_object(
    'entries', page,
    'pagination', jsonb_build_object(
      'total', coalesce(total_count, 0),
      'limit', p_limit,
      'offset', p_offset,
      'has_next', (p_offset + p_limit) < coalesce(total_count, 0)
    ),
    'self', self_row
  );
end;
$$;

revoke all on function public.read_leaderboard_ranked(text, text, text, integer, text, uuid, uuid[], integer, integer) from public, anon, authenticated;
grant execute on function public.read_leaderboard_ranked(text, text, text, integer, text, uuid, uuid[], integer, integer) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Season lifecycle: activate, manual close, recover
-- ---------------------------------------------------------------------------

-- Opens the next leaderboard season. Idempotent on slug: activating an
-- already open/closing season is a no-op; reactivating a finalized season is
-- forbidden. New entries route to a season by the slug captured at mission
-- launch, so activating a successor never moves late events out of a closing
-- predecessor.
create or replace function public.activate_leaderboard_season(
  p_slug text,
  p_name text,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  existing public.leaderboard_seasons%rowtype;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,40}$'
    or p_name is null or char_length(p_name) not between 1 and 60
    or p_starts_at is null or p_ends_at is null
    or p_ends_at <= p_starts_at
  then
    raise exception 'INVALID_LEADERBOARD_SEASON';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leaderboard-season-lifecycle', 0));

  select * into existing from public.leaderboard_seasons where slug = p_slug;
  if found then
    if existing.lifecycle_state = 'finalized' then
      raise exception 'FINALIZED_SEASON_IMMUTABLE';
    end if;
    -- Already open/closing: idempotent no-op.
    return jsonb_build_object(
      'season_id', existing.id,
      'lifecycle_state', existing.lifecycle_state,
      'activated', false
    );
  end if;

  insert into public.leaderboard_seasons (slug, name, starts_at, ends_at, lifecycle_state, closed_at, finalize_after, finalized_at, is_public)
  values (p_slug, p_name, p_starts_at, p_ends_at, 'open', null, null, null, true)
  returning * into existing;

  return jsonb_build_object(
    'season_id', existing.id,
    'lifecycle_state', existing.lifecycle_state,
    'activated', true
  );
end;
$$;

revoke all on function public.activate_leaderboard_season(text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.activate_leaderboard_season(text, text, timestamptz, timestamptz) to service_role;

-- Manually closes a season: lifecycle_state = 'closing' with a bounded drain
-- window so in-flight runs can still land (late-event guarantee). Idempotent:
-- closing an already-closing season preserves the original window.
create or replace function public.close_leaderboard_season(
  p_season_id uuid,
  p_drain_minutes integer default 30
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  target public.leaderboard_seasons%rowtype;
begin
  if p_season_id is null then
    raise exception 'LEADERBOARD_SEASON_NOT_FOUND';
  end if;
  if p_drain_minutes is null or p_drain_minutes < 1 or p_drain_minutes > 1440 then
    raise exception 'INVALID_LEADERBOARD_DRAIN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leaderboard-season-lifecycle', 0));
  select * into target from public.leaderboard_seasons where id = p_season_id;
  if not found then raise exception 'LEADERBOARD_SEASON_NOT_FOUND'; end if;

  if target.lifecycle_state = 'finalized' then
    raise exception 'FINALIZED_SEASON_IMMUTABLE';
  end if;
  if target.lifecycle_state = 'closing' then
    return jsonb_build_object(
      'season_id', target.id,
      'lifecycle_state', target.lifecycle_state,
      'closed_at', target.closed_at,
      'finalize_after', target.finalize_after,
      'changed', false
    );
  end if;

  update public.leaderboard_seasons
  set lifecycle_state = 'closing',
      closed_at = clock_timestamp(),
      finalize_after = clock_timestamp() + make_interval(mins => p_drain_minutes)
  where id = p_season_id
  returning * into target;

  return jsonb_build_object(
    'season_id', target.id,
    'lifecycle_state', target.lifecycle_state,
    'closed_at', target.closed_at,
    'finalize_after', target.finalize_after,
    'changed', true
  );
end;
$$;

revoke all on function public.close_leaderboard_season(uuid, integer) from public, anon, authenticated;
grant execute on function public.close_leaderboard_season(uuid, integer) to service_role;

-- Manual recovery for stuck rollovers: retries snapshot + finalize for every
-- 'closing' season and reports, per season, why any could not finalize yet
-- (drain window still open, pending quarantine reviews, or a snapshot error).
-- Idempotent: recovered/finalized seasons contribute zero new snapshots, and
-- snapshot_leaderboard_season itself is conflict-safe append-only.
create or replace function public.recover_leaderboard_season_drain()
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  candidate record;
  created integer;
  seasons_recovered integer := 0;
  snapshots_created integer := 0;
  blocked jsonb := '[]'::jsonb;
begin
  for candidate in
    select season.id, season.slug, season.finalize_after
    from public.leaderboard_seasons season
    where season.lifecycle_state = 'closing'
    order by season.finalize_after
  loop
    if candidate.finalize_after > clock_timestamp() then
      blocked := blocked || jsonb_build_object('season_id', candidate.id, 'slug', candidate.slug, 'reason', 'SEASON_DRAIN_WINDOW_OPEN');
      continue;
    end if;
    if exists (
      select 1 from public.leaderboard_quarantine quarantine
      where quarantine.status = 'pending' and quarantine.payload ->> 'seasonId' = candidate.id::text
    ) then
      blocked := blocked || jsonb_build_object('season_id', candidate.id, 'slug', candidate.slug, 'reason', 'PENDING_QUARANTINE_REVIEWS');
      continue;
    end if;
    begin
      created := public.snapshot_leaderboard_season(candidate.id);
      snapshots_created := snapshots_created + created;
      seasons_recovered := seasons_recovered + 1;
    exception when others then
      blocked := blocked || jsonb_build_object('season_id', candidate.id, 'slug', candidate.slug, 'reason', SQLERRM);
    end;
  end loop;
  return jsonb_build_object(
    'seasons_recovered', seasons_recovered,
    'snapshots_created', snapshots_created,
    'blocked', blocked
  );
end;
$$;

revoke all on function public.recover_leaderboard_season_drain() from public, anon, authenticated;
grant execute on function public.recover_leaderboard_season_drain() to service_role;

-- ---------------------------------------------------------------------------
-- 4. Read-only season status RPC for UI / diagnostics
-- ---------------------------------------------------------------------------
create or replace function public.get_leaderboard_season_status(
  p_season_slug text default null
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', season.id,
        'slug', season.slug,
        'name', season.name,
        'lifecycle_state', season.lifecycle_state,
        'starts_at', season.starts_at,
        'ends_at', season.ends_at,
        'closed_at', season.closed_at,
        'finalize_after', season.finalize_after,
        'finalized_at', season.finalized_at,
        'entry_count', (
          select count(*)
          from public.leaderboard_entries entry
          where entry.season_id = season.id and entry.verified = true
        )
      ) order by season.starts_at desc
    ),
    '[]'::jsonb
  )
  from public.leaderboard_seasons season
  where season.is_public = true
    and (p_season_slug is null or season.slug = p_season_slug);
$$;

revoke all on function public.get_leaderboard_season_status(text) from public, anon, authenticated;
grant execute on function public.get_leaderboard_season_status(text) to anon, authenticated, service_role;
