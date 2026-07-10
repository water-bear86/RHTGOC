create table public.leaderboard_seasons (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.leaderboard_seasons(id) on delete cascade,
  mission_slug text not null check (mission_slug ~ '^[a-z0-9-]{1,60}$'),
  player_id uuid references auth.users(id) on delete set null,
  player_name text not null check (char_length(player_name) between 1 and 20 and player_name ~ '^[A-Za-z0-9 _-]+$'),
  character_id text not null check (character_id in ('robin', 'marian')),
  party_size smallint not null check (party_size between 1 and 4),
  score integer not null check (score between 0 and 100000),
  grade text not null check (grade in ('S', 'A', 'B', 'C', 'D')),
  mission_seconds integer not null check (mission_seconds between 1 and 86400),
  delivered integer not null check (delivered between 0 and 1000000),
  rescues integer not null default 0 check (rescues between 0 and 1000),
  damage_taken integer not null default 0 check (damage_taken between 0 and 1000),
  verified boolean not null default false,
  verification_id uuid unique,
  score_breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index leaderboard_entries_ranking_idx
  on public.leaderboard_entries (season_id, verified desc, score desc, mission_seconds asc, created_at asc);
create index leaderboard_entries_character_idx
  on public.leaderboard_entries (season_id, character_id, party_size, score desc)
  where verified = true;
create index leaderboard_entries_player_idx
  on public.leaderboard_entries (player_id, created_at desc)
  where player_id is not null;

alter table public.leaderboard_seasons enable row level security;
alter table public.leaderboard_entries enable row level security;

revoke all on table public.leaderboard_seasons from anon, authenticated;
revoke all on table public.leaderboard_entries from anon, authenticated;
grant select on table public.leaderboard_seasons to anon, authenticated;
grant select on table public.leaderboard_entries to anon, authenticated;
grant all on table public.leaderboard_seasons to service_role;
grant all on table public.leaderboard_entries to service_role;

create policy "Public seasons are readable"
  on public.leaderboard_seasons
  for select
  to anon, authenticated
  using (is_public = true);

create policy "Verified leaderboard entries are readable"
  on public.leaderboard_entries
  for select
  to anon, authenticated
  using (
    verified = true
    and exists (
      select 1
      from public.leaderboard_seasons seasons
      where seasons.id = leaderboard_entries.season_id
        and seasons.is_public = true
    )
  );

insert into public.leaderboard_seasons (slug, name, starts_at, ends_at, is_public)
values ('season-zero', 'Season Zero', now(), now() + interval '90 days', true);

alter publication supabase_realtime add table public.leaderboard_entries;
