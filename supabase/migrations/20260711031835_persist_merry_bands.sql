create schema if not exists private;

create table public.merry_bands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 28 and name ~ '^[A-Za-z0-9 _-]+$'),
  banner_id text not null default 'oak' check (banner_id in ('oak', 'fox', 'arrow', 'stag')),
  created_by uuid not null references auth.users(id) on delete restrict,
  camp_state jsonb not null default '{"hearth":1,"workbench":0,"stores":0}'::jsonb,
  village_state jsonb not null default '{"granary":0,"infirmary":0,"watchtower":0}'::jsonb,
  progression_version integer not null default 1 check (progression_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.merry_band_members (
  band_id uuid not null references public.merry_bands(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  membership_role text not null default 'member' check (membership_role in ('leader', 'member')),
  hero_role text check (hero_role in ('robin', 'marian', 'little-john', 'much')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (band_id, user_id),
  check (left_at is null or left_at >= joined_at)
);

create table public.band_mission_history (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references public.merry_bands(id) on delete cascade,
  mission_id uuid not null,
  mission_slug text not null check (mission_slug ~ '^[a-z0-9-]{1,60}$'),
  seed bigint not null check (seed >= 0),
  result jsonb not null,
  allocation_choice text check (allocation_choice in ('granary', 'infirmary', 'watchtower')),
  allocation_coin integer not null default 0 check (allocation_coin >= 0),
  completed_at timestamptz not null default now(),
  unique (band_id, mission_id)
);

create table public.band_progression_grants (
  id uuid primary key default gen_random_uuid(),
  band_id uuid not null references public.merry_bands(id) on delete cascade,
  mission_id uuid not null,
  grant_key text not null check (grant_key ~ '^[a-z0-9:_-]{1,80}$'),
  amount integer not null check (amount >= 0),
  payload jsonb not null default '{}'::jsonb,
  granted_at timestamptz not null default now(),
  unique (band_id, mission_id, grant_key)
);

create table public.band_audit_log (
  id bigint generated always as identity primary key,
  band_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action ~ '^[a-z0-9:_-]{1,80}$'),
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create index merry_bands_created_by_idx on public.merry_bands (created_by);
create index merry_band_members_user_idx on public.merry_band_members (user_id, band_id) where left_at is null;
create index band_mission_history_band_idx on public.band_mission_history (band_id, completed_at desc);
create index band_progression_grants_mission_idx on public.band_progression_grants (mission_id, band_id);
create index band_audit_log_band_idx on public.band_audit_log (band_id, created_at desc);

create or replace function private.audit_merry_band_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  insert into public.band_audit_log (band_id, actor_user_id, action, before_state, after_state)
  values (
    coalesce(new.id, old.id),
    (select auth.uid()),
    'band:' || lower(tg_op),
    case when old is null then null else to_jsonb(old) end,
    case when new is null then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

revoke all on function private.audit_merry_band_change() from public, anon, authenticated;

create trigger audit_merry_band_change
after insert or update or delete on public.merry_bands
for each row execute function private.audit_merry_band_change();

create or replace function private.audit_band_child_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  insert into public.band_audit_log (band_id, actor_user_id, action, before_state, after_state)
  values (
    coalesce(new.band_id, old.band_id),
    (select auth.uid()),
    tg_table_name || ':' || lower(tg_op),
    case when old is null then null else to_jsonb(old) end,
    case when new is null then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

revoke all on function private.audit_band_child_change() from public, anon, authenticated;

create trigger audit_merry_band_member_change
after insert or update or delete on public.merry_band_members
for each row execute function private.audit_band_child_change();
create trigger audit_band_mission_history_change
after insert or update or delete on public.band_mission_history
for each row execute function private.audit_band_child_change();
create trigger audit_band_progression_grant_change
after insert or update or delete on public.band_progression_grants
for each row execute function private.audit_band_child_change();

alter table public.merry_bands enable row level security;
alter table public.merry_band_members enable row level security;
alter table public.band_mission_history enable row level security;
alter table public.band_progression_grants enable row level security;
alter table public.band_audit_log enable row level security;

revoke all on table public.merry_bands, public.merry_band_members, public.band_mission_history, public.band_progression_grants, public.band_audit_log from anon, authenticated;
grant select on table public.merry_bands, public.merry_band_members, public.band_mission_history, public.band_progression_grants, public.band_audit_log to authenticated;
grant all on table public.merry_bands, public.merry_band_members, public.band_mission_history, public.band_progression_grants, public.band_audit_log to service_role;
grant usage, select on sequence public.band_audit_log_id_seq to service_role;

create policy "Members can read their band"
  on public.merry_bands for select to authenticated
  using (
    id in (
      select band_id from public.merry_band_members
      where user_id = (select auth.uid()) and left_at is null
    )
  );

create policy "Members can read their own active membership"
  on public.merry_band_members for select to authenticated
  using (user_id = (select auth.uid()) and left_at is null);

create policy "Members can read band mission history"
  on public.band_mission_history for select to authenticated
  using (
    band_id in (
      select band_id from public.merry_band_members
      where user_id = (select auth.uid()) and left_at is null
    )
  );

create policy "Members can read band progression grants"
  on public.band_progression_grants for select to authenticated
  using (
    band_id in (
      select band_id from public.merry_band_members
      where user_id = (select auth.uid()) and left_at is null
    )
  );

create policy "Leaders can read band audit log"
  on public.band_audit_log for select to authenticated
  using (
    band_id in (
      select band_id from public.merry_band_members
      where user_id = (select auth.uid()) and membership_role = 'leader' and left_at is null
    )
  );
