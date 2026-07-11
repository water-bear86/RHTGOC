create table public.sherwood_campaigns (
  id uuid primary key,
  slug text not null unique check (slug ~ '^[a-z0-9-]{1,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  phase text not null check (phase in ('active', 'paused', 'finale', 'succeeded', 'failed', 'archived')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  pressure integer not null check (pressure between 0 and 100),
  revision integer not null check (revision > 0),
  state jsonb not null,
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check ((phase = 'archived') = (archived_at is not null))
);

create table public.sherwood_campaign_events (
  id bigint generated always as identity primary key,
  campaign_id uuid not null references public.sherwood_campaigns(id) on delete restrict,
  sequence integer not null check (sequence > 0),
  event_id text not null unique check (char_length(event_id) between 1 and 100),
  event_type text not null check (event_type in ('mission', 'contribution', 'operator')),
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  snapshot_revision integer not null check (snapshot_revision > 0),
  unique (campaign_id, sequence)
);

create index sherwood_campaigns_phase_updated_idx on public.sherwood_campaigns (phase, updated_at desc);
create index sherwood_campaign_events_campaign_time_idx on public.sherwood_campaign_events (campaign_id, occurred_at);

alter table public.sherwood_campaigns enable row level security;
alter table public.sherwood_campaign_events enable row level security;
revoke all on table public.sherwood_campaigns, public.sherwood_campaign_events from public, anon, authenticated;
grant all on table public.sherwood_campaigns, public.sherwood_campaign_events to service_role;
grant usage, select on sequence public.sherwood_campaign_events_id_seq to service_role;

create or replace function public.record_sherwood_campaign_transition(
  p_sequence integer,
  p_occurred_at timestamptz,
  p_event_id text,
  p_event_type text,
  p_snapshot jsonb,
  p_payload jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  campaign_id uuid := (p_snapshot ->> 'id')::uuid;
  incoming_revision integer := (p_snapshot ->> 'revision')::integer;
  event_inserted integer;
begin
  if p_sequence <= 0 or incoming_revision <= 0 then raise exception 'INVALID_CAMPAIGN_SEQUENCE'; end if;
  if p_event_type not in ('mission', 'contribution', 'operator') then raise exception 'INVALID_CAMPAIGN_EVENT'; end if;
  if exists (select 1 from public.sherwood_campaign_events where event_id = p_event_id) then return false; end if;
  if exists (select 1 from public.sherwood_campaigns where id = campaign_id and revision > incoming_revision) then raise exception 'STALE_CAMPAIGN_REVISION'; end if;

  insert into public.sherwood_campaigns (id, slug, name, phase, starts_at, ends_at, pressure, revision, state, archived_at, updated_at)
  values (
    campaign_id,
    p_snapshot ->> 'slug',
    p_snapshot ->> 'name',
    p_snapshot ->> 'phase',
    to_timestamp((p_snapshot ->> 'startsAt')::double precision / 1000.0),
    to_timestamp((p_snapshot ->> 'endsAt')::double precision / 1000.0),
    (p_snapshot ->> 'pressure')::integer,
    incoming_revision,
    p_snapshot,
    case when p_snapshot ->> 'archivedAt' is null then null else to_timestamp((p_snapshot ->> 'archivedAt')::double precision / 1000.0) end,
    now()
  ) on conflict (id) do update set
    name = excluded.name,
    phase = excluded.phase,
    ends_at = excluded.ends_at,
    pressure = excluded.pressure,
    revision = excluded.revision,
    state = excluded.state,
    archived_at = excluded.archived_at,
    updated_at = now()
  where public.sherwood_campaigns.revision <= excluded.revision;

  insert into public.sherwood_campaign_events (campaign_id, sequence, event_id, event_type, occurred_at, payload, snapshot_revision)
  values (campaign_id, p_sequence, p_event_id, p_event_type, p_occurred_at, p_payload, incoming_revision)
  on conflict (event_id) do nothing;
  get diagnostics event_inserted = row_count;
  return event_inserted = 1;
end;
$$;

revoke all on function public.record_sherwood_campaign_transition(integer, timestamptz, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.record_sherwood_campaign_transition(integer, timestamptz, text, text, jsonb, jsonb) to service_role;
