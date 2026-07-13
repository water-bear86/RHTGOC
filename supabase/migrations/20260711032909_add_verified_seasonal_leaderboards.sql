alter table public.leaderboard_entries
  add column band_id uuid references public.merry_bands(id) on delete set null,
  add column precision smallint not null default 0 check (precision between 0 and 100),
  add column generosity smallint not null default 0 check (generosity between 0 and 100),
  add column clean_escape boolean not null default false,
  add column suspicious boolean not null default false;

create index leaderboard_entries_band_idx
  on public.leaderboard_entries (season_id, band_id, score desc)
  where verified = true and band_id is not null;
create index leaderboard_entries_rescuer_idx
  on public.leaderboard_entries (season_id, rescues desc, score desc)
  where verified = true;
create index leaderboard_entries_champion_idx
  on public.leaderboard_entries (season_id, generosity desc, score desc)
  where verified = true;
create index leaderboard_entries_clean_idx
  on public.leaderboard_entries (season_id, mission_seconds asc, score desc)
  where verified = true and clean_escape = true;
create index leaderboard_entries_precision_idx
  on public.leaderboard_entries (season_id, precision desc, mission_seconds asc)
  where verified = true;

create table public.leaderboard_quarantine (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null unique,
  reason text not null check (reason ~ '^[a-z0-9:_-]{1,80}$'),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.leaderboard_season_snapshots (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.leaderboard_seasons(id) on delete restrict,
  board_slug text not null check (board_slug in ('master-outlaws', 'peoples-champions', 'clean-escapes', 'rescuers', 'swift-arrows')),
  entries jsonb not null,
  captured_at timestamptz not null default now(),
  unique (season_id, board_slug)
);

create index leaderboard_quarantine_status_idx on public.leaderboard_quarantine (status, created_at);
create index leaderboard_season_snapshots_season_idx on public.leaderboard_season_snapshots (season_id, board_slug);

alter table public.leaderboard_quarantine enable row level security;
alter table public.leaderboard_season_snapshots enable row level security;
revoke all on table public.leaderboard_quarantine, public.leaderboard_season_snapshots from anon, authenticated;
grant select on table public.leaderboard_season_snapshots to anon, authenticated;
grant all on table public.leaderboard_quarantine, public.leaderboard_season_snapshots to service_role;

create policy "Public season snapshots are readable"
  on public.leaderboard_season_snapshots for select to anon, authenticated
  using (
    season_id in (
      select id from public.leaderboard_seasons where is_public = true
    )
  );

create or replace function public.record_verified_leaderboard_entry(
  p_season_slug text,
  p_verification_id uuid,
  p_mission_slug text,
  p_band_id uuid,
  p_player_id uuid,
  p_player_name text,
  p_character_id text,
  p_party_size smallint,
  p_score integer,
  p_grade text,
  p_mission_seconds integer,
  p_delivered integer,
  p_rescues integer,
  p_damage_taken integer,
  p_precision smallint,
  p_generosity smallint,
  p_score_breakdown jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_season_id uuid;
  entry_id uuid;
  quarantine_reason text;
begin
  select id into target_season_id
  from public.leaderboard_seasons
  where slug = p_season_slug and is_public = true and now() between starts_at and ends_at;

  if target_season_id is null then
    raise exception 'ACTIVE_SEASON_NOT_FOUND';
  end if;

  if p_score > 10000 then quarantine_reason := 'score:above-maximum';
  elsif p_mission_seconds < 60 then quarantine_reason := 'time:below-minimum';
  elsif p_precision < 0 or p_precision > 100 then quarantine_reason := 'precision:out-of-range';
  elsif p_player_name !~ '^[A-Za-z0-9 _-]{1,20}$' then quarantine_reason := 'name:invalid';
  end if;

  if quarantine_reason is not null then
    insert into public.leaderboard_quarantine (verification_id, reason, payload)
    values (
      p_verification_id,
      quarantine_reason,
      jsonb_build_object('mission_slug', p_mission_slug, 'score', p_score, 'mission_seconds', p_mission_seconds, 'player_name', p_player_name)
    ) on conflict (verification_id) do nothing;
    return null;
  end if;

  insert into public.leaderboard_entries (
    season_id, mission_slug, player_id, player_name, character_id, party_size,
    score, grade, mission_seconds, delivered, rescues, damage_taken, verified,
    verification_id, score_breakdown, band_id, precision, generosity, clean_escape, suspicious
  ) values (
    target_season_id, p_mission_slug, p_player_id, p_player_name, p_character_id, p_party_size,
    p_score, p_grade, p_mission_seconds, p_delivered, p_rescues, p_damage_taken, true,
    p_verification_id, p_score_breakdown, p_band_id, p_precision, p_generosity, p_damage_taken = 0, false
  ) on conflict (verification_id) do update set verification_id = excluded.verification_id
  returning id into entry_id;

  return entry_id;
end;
$$;

create or replace function public.snapshot_leaderboard_season(p_season_id uuid)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  inserted_count integer := 0;
  board text;
  board_entries jsonb;
begin
  if exists (select 1 from public.leaderboard_seasons where id = p_season_id and ends_at > now()) then
    raise exception 'SEASON_NOT_ENDED';
  end if;

  foreach board in array array['master-outlaws', 'peoples-champions', 'clean-escapes', 'rescuers', 'swift-arrows'] loop
    select coalesce(jsonb_agg(to_jsonb(ranked)), '[]'::jsonb) into board_entries
    from (
      select id, player_name, character_id, party_size, mission_slug, score, mission_seconds, rescues, precision, generosity
      from public.leaderboard_entries
      where season_id = p_season_id and verified = true
        and (board <> 'clean-escapes' or clean_escape = true)
      order by
        case board when 'peoples-champions' then generosity when 'rescuers' then least(rescues, 100) when 'swift-arrows' then precision else score end desc,
        case when board = 'clean-escapes' then mission_seconds else 0 end asc,
        score desc
      limit 100
    ) ranked;

    insert into public.leaderboard_season_snapshots (season_id, board_slug, entries)
    values (p_season_id, board, board_entries)
    on conflict (season_id, board_slug) do nothing;
    if found then inserted_count := inserted_count + 1; end if;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function public.record_verified_leaderboard_entry(text, uuid, text, uuid, uuid, text, text, smallint, integer, text, integer, integer, integer, integer, smallint, smallint, jsonb) from public, anon, authenticated;
revoke all on function public.snapshot_leaderboard_season(uuid) from public, anon, authenticated;
grant execute on function public.record_verified_leaderboard_entry(text, uuid, text, uuid, uuid, text, text, smallint, integer, text, integer, integer, integer, integer, smallint, smallint, jsonb) to service_role;
grant execute on function public.snapshot_leaderboard_season(uuid) to service_role;
