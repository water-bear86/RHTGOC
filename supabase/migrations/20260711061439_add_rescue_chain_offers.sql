create table public.rescue_offers (
  id uuid primary key,
  source_mission_id uuid not null unique,
  band_id uuid references public.merry_bands(id) on delete set null,
  source_mission_slug text not null check (source_mission_slug ~ '^[a-z0-9-]{1,60}$'),
  rescue_mission_slug text not null check (rescue_mission_slug = 'prison-wagon'),
  context text not null check (context in ('captured-outlaws', 'lost-captives', 'lost-supplies')),
  target_count integer not null check (target_count between 1 and 16),
  status text not null check (status in ('active', 'accepted', 'completed', 'expired', 'abandoned', 'failed')),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  resolved_at timestamptz,
  attempts integer not null default 0 check (attempts between 0 and 20),
  reward_settled boolean not null default false,
  recovered_value integer not null default 0 check (recovered_value >= 0),
  updated_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((status = 'completed' and reward_settled) or status <> 'completed'),
  check (not reward_settled or resolved_at is not null)
);

create table public.rescue_offer_events (
  id bigint generated always as identity primary key,
  offer_id uuid not null references public.rescue_offers(id) on delete cascade,
  sequence integer not null check (sequence > 0),
  status text not null check (status in ('active', 'accepted', 'completed', 'expired', 'abandoned', 'failed')),
  occurred_at timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  unique (offer_id, sequence)
);

create index rescue_offers_active_expiry_idx on public.rescue_offers (expires_at) where status in ('active', 'accepted');
create index rescue_offers_band_updated_idx on public.rescue_offers (band_id, updated_at desc) where band_id is not null;
create index rescue_offer_events_offer_time_idx on public.rescue_offer_events (offer_id, occurred_at);

alter table public.rescue_offers enable row level security;
alter table public.rescue_offer_events enable row level security;

revoke all on table public.rescue_offers, public.rescue_offer_events from public, anon, authenticated;
grant all on table public.rescue_offers, public.rescue_offer_events to service_role;
grant usage, select on sequence public.rescue_offer_events_id_seq to service_role;

create or replace function public.record_rescue_offer_transition(
  p_sequence integer,
  p_occurred_at timestamptz,
  p_offer jsonb,
  p_band_id uuid default null
)
returns boolean
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  existing_status text;
  event_inserted integer;
begin
  if p_sequence <= 0 then raise exception 'INVALID_SEQUENCE'; end if;

  select status into existing_status
  from public.rescue_offers
  where id = (p_offer ->> 'id')::uuid
  for update;

  if existing_status in ('completed', 'expired', 'abandoned', 'failed')
     and existing_status <> p_offer ->> 'status' then
    raise exception 'TERMINAL_RESCUE_OFFER';
  end if;

  insert into public.rescue_offers (
    id, source_mission_id, band_id, source_mission_slug, rescue_mission_slug,
    context, target_count, status, created_at, expires_at, accepted_at,
    resolved_at, attempts, reward_settled, recovered_value, updated_at
  ) values (
    (p_offer ->> 'id')::uuid,
    (p_offer ->> 'sourceMissionId')::uuid,
    p_band_id,
    p_offer ->> 'sourceMissionSlug',
    p_offer ->> 'rescueMissionSlug',
    p_offer ->> 'context',
    (p_offer ->> 'targetCount')::integer,
    p_offer ->> 'status',
    to_timestamp((p_offer ->> 'createdAt')::double precision / 1000.0),
    to_timestamp((p_offer ->> 'expiresAt')::double precision / 1000.0),
    case when p_offer ->> 'acceptedAt' is null then null else to_timestamp((p_offer ->> 'acceptedAt')::double precision / 1000.0) end,
    case when p_offer ->> 'resolvedAt' is null then null else to_timestamp((p_offer ->> 'resolvedAt')::double precision / 1000.0) end,
    (p_offer ->> 'attempts')::integer,
    (p_offer ->> 'rewardSettled')::boolean,
    (p_offer ->> 'recoveredValue')::integer,
    now()
  ) on conflict (id) do update set
    band_id = coalesce(excluded.band_id, public.rescue_offers.band_id),
    status = excluded.status,
    accepted_at = excluded.accepted_at,
    resolved_at = excluded.resolved_at,
    attempts = greatest(public.rescue_offers.attempts, excluded.attempts),
    reward_settled = public.rescue_offers.reward_settled or excluded.reward_settled,
    recovered_value = greatest(public.rescue_offers.recovered_value, excluded.recovered_value),
    updated_at = now();

  insert into public.rescue_offer_events (offer_id, sequence, status, occurred_at, payload)
  values ((p_offer ->> 'id')::uuid, p_sequence, p_offer ->> 'status', p_occurred_at, p_offer)
  on conflict (offer_id, sequence) do nothing;
  get diagnostics event_inserted = row_count;
  return event_inserted = 1;
end;
$$;

revoke all on function public.record_rescue_offer_transition(integer, timestamptz, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.record_rescue_offer_transition(integer, timestamptz, jsonb, uuid) to service_role;
