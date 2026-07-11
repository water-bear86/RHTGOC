create table public.band_contributions (
  id uuid primary key,
  band_id uuid references public.merry_bands(id) on delete set null,
  contributor_player_id uuid not null,
  contributor_label text not null check (char_length(contributor_label) between 1 and 20),
  contribution_type text not null check (contribution_type in ('supplies', 'intelligence', 'snare-kit', 'safe-house')),
  status text not null check (status in ('available', 'locked', 'consumed', 'refunded', 'expired', 'revoked')),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  mission_id uuid,
  resolved_at timestamptz,
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((status in ('consumed', 'refunded', 'expired', 'revoked')) = (resolved_at is not null)),
  check (status <> 'locked' or mission_id is not null)
);

create table public.band_contribution_events (
  id bigint generated always as identity primary key,
  contribution_id uuid not null references public.band_contributions(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  status text not null check (status in ('available', 'locked', 'consumed', 'refunded', 'expired', 'revoked')),
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  unique (contribution_id, sequence)
);

create index band_contributions_available_expiry_idx on public.band_contributions (expires_at) where status = 'available';
create index band_contributions_band_updated_idx on public.band_contributions (band_id, updated_at desc) where band_id is not null;
create index band_contribution_events_contribution_time_idx on public.band_contribution_events (contribution_id, occurred_at);

alter table public.band_contributions enable row level security;
alter table public.band_contribution_events enable row level security;

revoke all on table public.band_contributions, public.band_contribution_events from public, anon, authenticated;
grant all on table public.band_contributions, public.band_contribution_events to service_role;
grant usage, select on sequence public.band_contribution_events_id_seq to service_role;

create or replace function public.record_band_contribution_transition(
  p_sequence integer,
  p_occurred_at timestamptz,
  p_contribution jsonb,
  p_band_id uuid default null
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  existing_status text;
  next_status text := p_contribution ->> 'status';
  event_inserted integer;
begin
  if p_sequence <= 0 then raise exception 'INVALID_SEQUENCE'; end if;
  if next_status not in ('available', 'locked', 'consumed', 'refunded', 'expired', 'revoked') then raise exception 'INVALID_CONTRIBUTION_STATUS'; end if;

  select status into existing_status
  from public.band_contributions
  where id = (p_contribution ->> 'id')::uuid
  for update;

  if existing_status is null and next_status <> 'available' then raise exception 'MISSING_AVAILABLE_CONTRIBUTION'; end if;
  if existing_status = 'available' and next_status not in ('available', 'locked', 'expired', 'revoked') then raise exception 'INVALID_AVAILABLE_TRANSITION'; end if;
  if existing_status = 'locked' and next_status not in ('locked', 'consumed', 'refunded') then raise exception 'INVALID_LOCKED_TRANSITION'; end if;
  if existing_status in ('consumed', 'refunded', 'expired', 'revoked') and existing_status <> next_status then raise exception 'TERMINAL_CONTRIBUTION'; end if;

  insert into public.band_contributions (
    id, band_id, contributor_player_id, contributor_label, contribution_type,
    status, created_at, expires_at, mission_id, resolved_at, updated_at
  ) values (
    (p_contribution ->> 'id')::uuid,
    p_band_id,
    (p_contribution ->> 'contributorPlayerId')::uuid,
    p_contribution ->> 'contributorLabel',
    p_contribution ->> 'type',
    next_status,
    to_timestamp((p_contribution ->> 'createdAt')::double precision / 1000.0),
    to_timestamp((p_contribution ->> 'expiresAt')::double precision / 1000.0),
    nullif(p_contribution ->> 'missionId', '')::uuid,
    case when p_contribution ->> 'resolvedAt' is null then null else to_timestamp((p_contribution ->> 'resolvedAt')::double precision / 1000.0) end,
    now()
  ) on conflict (id) do update set
    band_id = coalesce(excluded.band_id, public.band_contributions.band_id),
    status = excluded.status,
    mission_id = coalesce(excluded.mission_id, public.band_contributions.mission_id),
    resolved_at = excluded.resolved_at,
    updated_at = now();

  insert into public.band_contribution_events (contribution_id, sequence, status, occurred_at, payload)
  values ((p_contribution ->> 'id')::uuid, p_sequence, next_status, p_occurred_at, p_contribution)
  on conflict (contribution_id, sequence) do nothing;
  get diagnostics event_inserted = row_count;
  return event_inserted = 1;
end;
$$;

revoke all on function public.record_band_contribution_transition(integer, timestamptz, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_band_contribution_transition(integer, timestamptz, jsonb, uuid) to service_role;
