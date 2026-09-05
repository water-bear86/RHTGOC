-- Leaderboard privacy projection, block masking, and moderation hooks.
--
-- 1. Blocked players are ANONYMIZED IN PLACE instead of filtered out. Filtering
--    changed `pagination.total`, ranks, and row sets per viewer, which let
--    either side of a block detect the block by comparing against an anonymous
--    read. Masking keeps every count, rank, tie flag, and position identical
--    for every viewer; only the identity fields are replaced.
-- 2. Moderators can hide/restore whole entries (uniform removal for everyone,
--    so no per-viewer count oracle), hide/restore identities (masked label for
--    everyone including the owner), and annotate. Every action appends an
--    immutable audit row with a reason code.
-- 3. Deleted accounts (player_id null) stay pseudonymous, never match block
--    pairs, never match a viewer's self row, and never error.
--
-- The masked label is intentionally identical for block masking and for
-- moderator identity-hiding so an observer cannot distinguish the two.

-- ---------------------------------------------------------------------------
-- 1. Moderation state on entries
-- ---------------------------------------------------------------------------
alter table public.leaderboard_entries
  add column if not exists identity_hidden boolean not null default false,
  add column if not exists entry_hidden boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Append-only moderation audit log
-- ---------------------------------------------------------------------------
-- entry_id / player_ref are plain uuids (no FK) so audit history survives any
-- future entry or account deletion. Referential validity is enforced by the
-- moderation RPCs at write time.
create table if not exists public.leaderboard_moderation_log (
  id bigint generated always as identity primary key,
  entry_id uuid,
  player_ref uuid,
  actor text not null check (char_length(actor) between 1 and 40 and actor ~ '^[A-Za-z0-9 _-]+$'),
  action text not null check (action in ('hide-entry', 'restore-entry', 'hide-identity', 'restore-identity', 'annotate')),
  reason_code text not null check (reason_code in ('offensive-name', 'harassment', 'impersonation', 'cheating-review', 'legal-removal', 'other')),
  note text check (note is null or char_length(note) <= 280),
  changed boolean not null default false,
  created_at timestamptz not null default now(),
  check (entry_id is not null or player_ref is not null)
);

create index if not exists leaderboard_moderation_log_entry_idx
  on public.leaderboard_moderation_log (entry_id, created_at desc)
  where entry_id is not null;
create index if not exists leaderboard_moderation_log_player_idx
  on public.leaderboard_moderation_log (player_ref, created_at desc)
  where player_ref is not null;

alter table public.leaderboard_moderation_log enable row level security;
revoke all on table public.leaderboard_moderation_log from public, anon, authenticated;
grant select, insert on table public.leaderboard_moderation_log to service_role;

create or replace function public.leaderboard_moderation_log_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'IMMUTABLE_LEADERBOARD_RECORD';
end;
$$;

drop trigger if exists leaderboard_moderation_log_append_only on public.leaderboard_moderation_log;
create trigger leaderboard_moderation_log_append_only
  before update or delete on public.leaderboard_moderation_log
  for each row execute function public.leaderboard_moderation_log_append_only();

-- ---------------------------------------------------------------------------
-- 3. Moderation RPCs (service_role only; server enforces operator auth)
-- ---------------------------------------------------------------------------
create or replace function public.moderate_leaderboard_entry(
  p_entry_id uuid,
  p_action text,
  p_reason_code text,
  p_actor text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  did_change boolean := false;
begin
  if p_action not in ('hide-entry', 'restore-entry', 'hide-identity', 'restore-identity', 'annotate') then
    raise exception 'INVALID_MODERATION_ACTION';
  end if;
  if p_reason_code not in ('offensive-name', 'harassment', 'impersonation', 'cheating-review', 'legal-removal', 'other') then
    raise exception 'INVALID_MODERATION_REASON';
  end if;
  if p_actor is null or char_length(p_actor) not between 1 and 40 or p_actor !~ '^[A-Za-z0-9 _-]+$' then
    raise exception 'INVALID_MODERATION_ACTOR';
  end if;
  if p_note is not null and char_length(p_note) > 280 then
    raise exception 'INVALID_MODERATION_NOTE';
  end if;
  if not exists (select 1 from public.leaderboard_entries where id = p_entry_id) then
    raise exception 'MODERATION_ENTRY_NOT_FOUND';
  end if;

  if p_action = 'hide-entry' then
    update public.leaderboard_entries set entry_hidden = true where id = p_entry_id and entry_hidden = false;
    did_change := found;
  elsif p_action = 'restore-entry' then
    update public.leaderboard_entries set entry_hidden = false where id = p_entry_id and entry_hidden = true;
    did_change := found;
  elsif p_action = 'hide-identity' then
    update public.leaderboard_entries set identity_hidden = true where id = p_entry_id and identity_hidden = false;
    did_change := found;
  elsif p_action = 'restore-identity' then
    update public.leaderboard_entries set identity_hidden = false where id = p_entry_id and identity_hidden = true;
    did_change := found;
  end if;

  insert into public.leaderboard_moderation_log (entry_id, actor, action, reason_code, note, changed)
  values (p_entry_id, p_actor, p_action, p_reason_code, p_note, did_change);

  return jsonb_build_object('entry_id', p_entry_id, 'action', p_action, 'changed', did_change);
end;
$$;

revoke all on function public.moderate_leaderboard_entry(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.moderate_leaderboard_entry(uuid, text, text, text, text) to service_role;

-- Player-level hook: the ban / account-removal surface. Applies the action to
-- every entry the account has ever recorded (all seasons) and appends one
-- audit row. A missing or already-deleted account is not an error: it simply
-- affects zero rows and the invocation is still recorded.
create or replace function public.moderate_leaderboard_player(
  p_player_id uuid,
  p_action text,
  p_reason_code text,
  p_actor text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  affected integer := 0;
begin
  if p_action not in ('hide-entry', 'restore-entry', 'hide-identity', 'restore-identity') then
    raise exception 'INVALID_MODERATION_ACTION';
  end if;
  if p_reason_code not in ('offensive-name', 'harassment', 'impersonation', 'cheating-review', 'legal-removal', 'other') then
    raise exception 'INVALID_MODERATION_REASON';
  end if;
  if p_actor is null or char_length(p_actor) not between 1 and 40 or p_actor !~ '^[A-Za-z0-9 _-]+$' then
    raise exception 'INVALID_MODERATION_ACTOR';
  end if;
  if p_note is not null and char_length(p_note) > 280 then
    raise exception 'INVALID_MODERATION_NOTE';
  end if;
  if p_player_id is null then
    raise exception 'INVALID_MODERATION_PLAYER';
  end if;

  if p_action = 'hide-entry' then
    update public.leaderboard_entries set entry_hidden = true where player_id = p_player_id and entry_hidden = false;
  elsif p_action = 'restore-entry' then
    update public.leaderboard_entries set entry_hidden = false where player_id = p_player_id and entry_hidden = true;
  elsif p_action = 'hide-identity' then
    update public.leaderboard_entries set identity_hidden = true where player_id = p_player_id and identity_hidden = false;
  elsif p_action = 'restore-identity' then
    update public.leaderboard_entries set identity_hidden = false where player_id = p_player_id and identity_hidden = true;
  end if;
  get diagnostics affected = row_count;

  insert into public.leaderboard_moderation_log (player_ref, actor, action, reason_code, note, changed)
  values (p_player_id, p_actor, p_action, p_reason_code, p_note, affected > 0);

  return jsonb_build_object('player_ref', p_player_id, 'action', p_action, 'changed_entries', affected);
end;
$$;

revoke all on function public.moderate_leaderboard_player(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.moderate_leaderboard_player(uuid, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Ranked read: block masking in place, moderation-aware, count-stable
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
  if p_kind = 'swift-arrows' and (p_mission_slug is null or p_party_size is null) then
    raise exception 'SWIFT_ARROWS_SCOPE_REQUIRED';
  end if;

  -- Friend scope: every requested id must be the caller or an accepted friend.
  -- A block deletes the friendship, so a blocked ex-friend fails this check
  -- exactly like any non-friend (FORBIDDEN_LEADERBOARD_SCOPE); the error is
  -- identical in both cases and reveals nothing about blocks.
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
      entry.identity_hidden,
      -- Masking is computed per row but NEVER filters: totals, ranks, ties,
      -- and positions are identical for every viewer, so neither side of a
      -- block (nor anyone else) can detect it from counts or pagination.
      -- Deleted accounts have player_id null, which never matches a block row.
      (
        viewer_id is not null
        and entry.player_id is not null
        and exists (
          select 1 from public.player_blocks block
          where (block.blocker_id = viewer_id and block.blocked_id = entry.player_id)
             or (block.blocker_id = entry.player_id and block.blocked_id = viewer_id)
        )
      ) as viewer_blocked,
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
      -- Moderator-hidden entries are removed for EVERY viewer (including the
      -- owner and anonymous readers), so removal is uniform and count-safe.
      and entry.entry_hidden = false
      and (p_character_id is null or entry.character_id = p_character_id)
      and (p_party_size is null or entry.party_size = p_party_size)
      and (p_mission_slug is null or entry.mission_slug = p_mission_slug)
      and (p_band_id is null or entry.band_id = p_band_id)
      and (coalesce(cardinality(p_player_ids), 0) = 0 or entry.player_id = any(p_player_ids))
      and (p_kind <> 'clean-escapes' or entry.clean_escape = true)
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
          'player_name', case when r.identity_hidden or r.viewer_blocked then 'Hooded Outlaw' else r.player_name end,
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
          'identity_masked', (r.identity_hidden or r.viewer_blocked),
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
          'player_name', case when r.identity_hidden or r.viewer_blocked then 'Hooded Outlaw' else r.player_name end,
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
          'identity_masked', (r.identity_hidden or r.viewer_blocked),
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
-- 5. Legacy read: same masking semantics, exact legacy response shape
-- ---------------------------------------------------------------------------
-- The field set of each row is unchanged (already shipped clients keep their
-- exact response shape); only the player_name VALUE is masked and
-- moderator-hidden entries are uniformly excluded.
create or replace function public.read_leaderboard(
  p_kind text default 'master-outlaws',
  p_season_slug text default 'season-zero',
  p_character_id text default null,
  p_party_size integer default null,
  p_mission_slug text default null,
  p_band_id uuid default null,
  p_player_ids uuid[] default null
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
      case
        when entry.identity_hidden
          or (
            viewer_id is not null
            and entry.player_id is not null
            and exists (
              select 1 from public.player_blocks block
              where (block.blocker_id = viewer_id and block.blocked_id = entry.player_id)
                 or (block.blocker_id = entry.player_id and block.blocked_id = viewer_id)
            )
          )
        then 'Hooded Outlaw'
        else entry.player_name
      end as player_name,
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
      and entry.entry_hidden = false
      and (p_character_id is null or entry.character_id = p_character_id)
      and (p_party_size is null or entry.party_size = p_party_size)
      and (p_mission_slug is null or entry.mission_slug = p_mission_slug)
      and (p_band_id is null or entry.band_id = p_band_id)
      and (coalesce(cardinality(p_player_ids), 0) = 0 or entry.player_id = any(p_player_ids))
      and (p_kind <> 'clean-escapes' or entry.clean_escape = true)
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

revoke all on function public.read_leaderboard(text,text,text,integer,text,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.read_leaderboard(text,text,text,integer,text,uuid,uuid[]) to anon,authenticated;
