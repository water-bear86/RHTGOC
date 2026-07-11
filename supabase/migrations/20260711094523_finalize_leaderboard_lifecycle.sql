-- Finish the seasonal leaderboard boundary: late authoritative runs get a minimum
-- drain window, quarantines settle before immutable snapshots, operator identity
-- is durable, and append-only records cannot be rewritten by the runtime role.

alter table public.leaderboard_seasons
  add column campaign_id uuid unique references public.sherwood_campaigns(id) on delete restrict,
  add column lifecycle_state text not null default 'open' check (lifecycle_state in ('open', 'closing', 'finalized')),
  add column closed_at timestamptz,
  add column finalize_after timestamptz,
  add column finalized_at timestamptz,
  add constraint leaderboard_seasons_lifecycle_check check (
    (lifecycle_state = 'open' and closed_at is null and finalize_after is null and finalized_at is null)
    or
    (lifecycle_state = 'closing' and closed_at is not null and finalize_after >= closed_at and finalized_at is null)
    or
    (lifecycle_state = 'finalized' and closed_at is not null and finalize_after >= closed_at and finalized_at is not null)
  );

alter table public.leaderboard_entries
  add column mission_started_at timestamptz;

update public.leaderboard_entries
set mission_started_at = created_at
where mission_started_at is null;

alter table public.leaderboard_entries
  alter column mission_started_at set not null;

alter table public.leaderboard_quarantine
  add column reviewer_audit_id uuid;

alter table public.sherwood_campaign_events
  add column event_snapshot jsonb;

update public.sherwood_campaign_events events
set event_snapshot = campaigns.state
from public.sherwood_campaigns campaigns
where campaigns.id = events.campaign_id and events.event_snapshot is null;

alter table public.sherwood_campaign_events
  alter column event_snapshot set not null,
  add constraint sherwood_campaign_events_snapshot_check check (
    jsonb_typeof(event_snapshot) = 'object' and event_snapshot ? 'id' and event_snapshot ? 'revision'
  );

alter table public.leaderboard_quarantine
  drop constraint leaderboard_quarantine_reviewed_by_fkey,
  add constraint leaderboard_quarantine_reviewed_by_fkey
    foreign key (reviewed_by) references auth.users(id) on delete restrict;

alter table public.leaderboard_quarantine
  add constraint leaderboard_quarantine_review_audit_check check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null and reviewer_audit_id is null)
    or
    (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null and reviewer_audit_id is not null)
  );

create index leaderboard_quarantine_season_status_idx
  on public.leaderboard_quarantine ((payload ->> 'seasonId'), status, created_at);

create unique index sherwood_campaigns_one_open_idx
  on public.sherwood_campaigns ((true))
  where phase <> 'archived';

drop index if exists public.leaderboard_entries_champion_idx;
drop index if exists public.leaderboard_entries_clean_idx;
drop index if exists public.leaderboard_entries_precision_idx;
create index leaderboard_entries_champion_v2_idx
  on public.leaderboard_entries (season_id, delivered desc, score desc, id)
  where verified = true;
create index leaderboard_entries_clean_v2_idx
  on public.leaderboard_entries (season_id, delivered desc, score desc, mission_seconds asc, id)
  where verified = true and clean_escape = true;
create index leaderboard_entries_swift_v2_idx
  on public.leaderboard_entries (season_id, mission_slug, party_size, mission_seconds asc, score desc, precision desc, id)
  where verified = true;

do $$
begin
  if exists (
    select 1
    from public.leaderboard_quarantine quarantine
    join public.leaderboard_entries entry using (verification_id)
    where quarantine.status <> 'approved'
  ) then
    raise exception 'INVALID_LEADERBOARD_VERIFICATION_OVERLAP';
  end if;
end;
$$;

create or replace function public.reject_immutable_leaderboard_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'IMMUTABLE_LEADERBOARD_RECORD:%', tg_table_name using errcode = '55000';
end;
$$;

create or replace function public.reject_finalized_leaderboard_entry()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.leaderboard_seasons
    where id = new.season_id and lifecycle_state = 'finalized'
  ) then
    raise exception 'SEASON_FINALIZED' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger leaderboard_entries_finalized_guard
before insert on public.leaderboard_entries
for each row execute function public.reject_finalized_leaderboard_entry();

create trigger leaderboard_snapshots_append_only
before update or delete on public.leaderboard_season_snapshots
for each row execute function public.reject_immutable_leaderboard_mutation();

create trigger sherwood_campaign_events_append_only
before update or delete on public.sherwood_campaign_events
for each row execute function public.reject_immutable_leaderboard_mutation();

drop function if exists public.record_verified_leaderboard_entry(
  text,uuid,text,uuid,uuid,text,text,smallint,integer,text,integer,integer,integer,integer,smallint,smallint,jsonb
);

create function public.record_verified_leaderboard_entry(
  p_season_slug text,
  p_verification_id uuid,
  p_mission_slug text,
  p_mission_started_at timestamptz,
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
  p_clean_escape boolean,
  p_score_breakdown jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_season public.leaderboard_seasons%rowtype;
  existing_quarantine public.leaderboard_quarantine%rowtype;
  entry_id uuid;
  quarantine_reason text;
  candidate_payload jsonb;
begin
  if p_verification_id is null or p_mission_started_at is null then raise exception 'INVALID_VERIFICATION_IDENTITY'; end if;
  perform pg_advisory_xact_lock(hashtextextended('leaderboard-season-lifecycle', 0));
  perform pg_advisory_xact_lock(hashtextextended('leaderboard-verification:' || p_verification_id::text, 0));

  select * into target_season
  from public.leaderboard_seasons
  where slug = p_season_slug and is_public = true;
  if not found then raise exception 'LEADERBOARD_SEASON_NOT_FOUND'; end if;
  if p_mission_started_at > clock_timestamp() + interval '5 minutes' then raise exception 'MISSION_START_IN_FUTURE'; end if;

  candidate_payload := jsonb_build_object(
    'seasonId', target_season.id,
    'missionSlug', p_mission_slug,
    'missionStartedAt', p_mission_started_at,
    'bandId', p_band_id,
    'playerId', p_player_id,
    'playerName', p_player_name,
    'characterId', p_character_id,
    'partySize', p_party_size,
    'score', p_score,
    'grade', p_grade,
    'missionSeconds', p_mission_seconds,
    'delivered', p_delivered,
    'rescues', p_rescues,
    'damageTaken', p_damage_taken,
    'precision', p_precision,
    'generosity', p_generosity,
    'scoreBreakdown', p_score_breakdown,
    'cleanEscape', p_clean_escape
  );

  select * into existing_quarantine
  from public.leaderboard_quarantine
  where verification_id = p_verification_id;
  if found then
    if existing_quarantine.payload <> candidate_payload then raise exception 'VERIFICATION_CONFLICT'; end if;
    if existing_quarantine.status = 'rejected' then raise exception 'VERIFICATION_REJECTED'; end if;
    if existing_quarantine.status = 'pending' then
      if target_season.lifecycle_state = 'finalized' then raise exception 'FINALIZED_SEASON_HAS_PENDING_REVIEW'; end if;
      return null;
    end if;
    select id into entry_id
    from public.leaderboard_entries
    where verification_id = p_verification_id
      and season_id = target_season.id
      and mission_slug = p_mission_slug
      and mission_started_at = p_mission_started_at
      and band_id is not distinct from p_band_id
      and player_id is not distinct from p_player_id
      and player_name = p_player_name
      and character_id = p_character_id
      and party_size = p_party_size
      and score = p_score
      and grade = p_grade
      and mission_seconds = p_mission_seconds
      and delivered = p_delivered
      and rescues = p_rescues
      and damage_taken = p_damage_taken
      and precision = p_precision
      and generosity = p_generosity
      and clean_escape = p_clean_escape
      and score_breakdown = p_score_breakdown;
    if entry_id is null then raise exception 'APPROVED_VERIFICATION_ENTRY_MISSING'; end if;
    return entry_id;
  end if;

  select id into entry_id
  from public.leaderboard_entries
  where verification_id = p_verification_id
    and season_id = target_season.id
    and mission_slug = p_mission_slug
    and mission_started_at = p_mission_started_at
    and band_id is not distinct from p_band_id
    and player_id is not distinct from p_player_id
    and player_name = p_player_name
    and character_id = p_character_id
    and party_size = p_party_size
    and score = p_score
    and grade = p_grade
    and mission_seconds = p_mission_seconds
    and delivered = p_delivered
    and rescues = p_rescues
    and damage_taken = p_damage_taken
    and precision = p_precision
    and generosity = p_generosity
    and clean_escape = p_clean_escape
    and score_breakdown = p_score_breakdown;
  if entry_id is not null then return entry_id; end if;
  if exists (select 1 from public.leaderboard_entries where verification_id = p_verification_id) then raise exception 'VERIFICATION_CONFLICT'; end if;
  if target_season.lifecycle_state = 'finalized' then raise exception 'SEASON_FINALIZED'; end if;
  if p_mission_started_at < target_season.starts_at
    or (target_season.lifecycle_state = 'closing' and p_mission_started_at > target_season.closed_at)
  then
    raise exception 'MISSION_OUTSIDE_SEASON';
  end if;

  if p_score > 10000 then quarantine_reason := 'score:above-maximum';
  elsif p_mission_seconds < 60 then quarantine_reason := 'time:below-minimum';
  elsif p_precision < 0 or p_precision > 100 then quarantine_reason := 'precision:out-of-range';
  elsif p_player_name !~ '^[A-Za-z0-9 _-]{1,20}$' then quarantine_reason := 'name:invalid';
  end if;

  if quarantine_reason is not null then
    insert into public.leaderboard_quarantine (verification_id, reason, payload)
    values (p_verification_id, quarantine_reason, candidate_payload);
    return null;
  end if;

  insert into public.leaderboard_entries (
    season_id, mission_slug, mission_started_at, player_id, player_name, character_id, party_size,
    score, grade, mission_seconds, delivered, rescues, damage_taken, verified,
    verification_id, score_breakdown, band_id, precision, generosity, clean_escape, suspicious
  ) values (
    target_season.id, p_mission_slug, p_mission_started_at, p_player_id, p_player_name, p_character_id, p_party_size,
    p_score, p_grade, p_mission_seconds, p_delivered, p_rescues, p_damage_taken, true,
    p_verification_id, p_score_breakdown, p_band_id, p_precision, p_generosity, p_clean_escape, false
  ) returning id into entry_id;

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
  target_season public.leaderboard_seasons%rowtype;
  inserted_count integer := 0;
  board text;
  board_entries jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('leaderboard-season-lifecycle', 0));
  select * into target_season from public.leaderboard_seasons where id = p_season_id;
  if not found then raise exception 'LEADERBOARD_SEASON_NOT_FOUND'; end if;
  if target_season.lifecycle_state = 'finalized' then
    if (select count(*) from public.leaderboard_season_snapshots where season_id = p_season_id) <> 5 then
      raise exception 'INCOMPLETE_FINALIZED_SNAPSHOT';
    end if;
    return 0;
  end if;
  if target_season.lifecycle_state <> 'closing' then raise exception 'SEASON_NOT_CLOSING'; end if;
  if clock_timestamp() < target_season.finalize_after then raise exception 'SEASON_DRAIN_WINDOW_OPEN'; end if;
  if exists (
    select 1 from public.leaderboard_quarantine
    where status = 'pending' and payload ->> 'seasonId' = p_season_id::text
  ) then
    raise exception 'PENDING_QUARANTINE_REVIEWS';
  end if;

  foreach board in array array['master-outlaws', 'peoples-champions', 'clean-escapes', 'rescuers', 'swift-arrows'] loop
    if board = 'swift-arrows' then
      select coalesce(
        jsonb_agg(to_jsonb(ranked) - 'group_rank' order by ranked.mission_slug, ranked.party_size, ranked.mission_seconds, ranked.score desc, ranked.precision desc, ranked.id),
        '[]'::jsonb
      ) into board_entries
      from (
        select grouped.*
        from (
          select
            entry.id, entry.verification_id, entry.player_id, entry.player_name, entry.character_id, entry.score, entry.grade,
            entry.mission_seconds, entry.delivered, entry.verified, entry.created_at, entry.party_size,
            entry.mission_slug, entry.band_id, entry.rescues, entry.precision, entry.generosity,
            entry.clean_escape, entry.suspicious, entry.mission_started_at,
            entry.mission_version, entry.mission_content_hash, entry.damage_taken, entry.score_breakdown,
            row_number() over (
              partition by entry.mission_slug, entry.party_size
              order by entry.mission_seconds asc, entry.score desc, entry.precision desc, entry.id
            ) as group_rank
          from public.leaderboard_entries entry
          where entry.season_id = p_season_id and entry.verified = true
        ) grouped
        where grouped.group_rank <= 50
      ) ranked;
    else
      select coalesce(jsonb_agg(to_jsonb(ranked)), '[]'::jsonb) into board_entries
      from (
        select
          entry.id, entry.verification_id, entry.player_id, entry.player_name, entry.character_id, entry.score, entry.grade,
          entry.mission_seconds, entry.delivered, entry.verified, entry.created_at, entry.party_size,
          entry.mission_slug, entry.band_id, entry.rescues, entry.precision, entry.generosity,
          entry.clean_escape, entry.suspicious, entry.mission_started_at,
          entry.mission_version, entry.mission_content_hash, entry.damage_taken, entry.score_breakdown
        from public.leaderboard_entries entry
        where entry.season_id = p_season_id and entry.verified = true
          and (board <> 'clean-escapes' or entry.clean_escape = true)
        order by
          case when board = 'master-outlaws' then entry.score end desc nulls last,
          case when board = 'peoples-champions' then entry.delivered end desc nulls last,
          case when board = 'clean-escapes' then entry.delivered end desc nulls last,
          case when board = 'rescuers' then entry.rescues end desc nulls last,
          case when board = 'master-outlaws' then entry.mission_seconds end asc nulls last,
          case when board = 'clean-escapes' then entry.score end desc nulls last,
          case when board = 'clean-escapes' then entry.mission_seconds end asc nulls last,
          entry.score desc,
          entry.id
        limit 100
      ) ranked;
    end if;

    insert into public.leaderboard_season_snapshots (season_id, board_slug, entries)
    values (p_season_id, board, board_entries)
    on conflict (season_id, board_slug) do nothing;
    if found then inserted_count := inserted_count + 1; end if;
  end loop;
  if (select count(*) from public.leaderboard_season_snapshots where season_id = p_season_id) <> 5 then
    raise exception 'INCOMPLETE_LEADERBOARD_SNAPSHOT';
  end if;
  update public.leaderboard_seasons
  set lifecycle_state = 'finalized', finalized_at = clock_timestamp()
  where id = p_season_id;
  return inserted_count;
end;
$$;

create or replace function public.sync_leaderboard_season_from_campaign(
  p_snapshot jsonb,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_season_id uuid;
  campaign_id uuid := (p_snapshot ->> 'id')::uuid;
  season_slug text := p_snapshot ->> 'slug';
  season_name text := p_snapshot ->> 'name';
  season_phase text := p_snapshot ->> 'phase';
  season_starts_at timestamptz := to_timestamp((p_snapshot ->> 'startsAt')::double precision / 1000.0);
  season_ends_at timestamptz := to_timestamp((p_snapshot ->> 'endsAt')::double precision / 1000.0);
  season_finalize_after timestamptz;
begin
  if season_slug is null or season_slug !~ '^[a-z0-9-]{1,40}$'
    or season_name is null or char_length(season_name) not between 1 and 60
    or season_ends_at <= season_starts_at
    or season_phase not in ('active', 'paused', 'finale', 'succeeded', 'failed', 'archived')
  then
    raise exception 'INVALID_LEADERBOARD_SEASON';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leaderboard-season-lifecycle', 0));
  season_finalize_after := case when season_phase = 'archived' then p_occurred_at + interval '30 minutes' else null end;
  insert into public.leaderboard_seasons (
    campaign_id, slug, name, starts_at, ends_at, lifecycle_state, closed_at, finalize_after, finalized_at, is_public
  )
  values (
    campaign_id,
    season_slug,
    season_name,
    season_starts_at,
    case when season_phase = 'archived' then greatest(season_starts_at + interval '1 second', p_occurred_at) else season_ends_at end,
    case when season_phase = 'archived' then 'closing' else 'open' end,
    case when season_phase = 'archived' then p_occurred_at else null end,
    season_finalize_after,
    null,
    true
  )
  on conflict (slug) do update set
    campaign_id = excluded.campaign_id,
    name = excluded.name,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    lifecycle_state = excluded.lifecycle_state,
    closed_at = excluded.closed_at,
    finalize_after = excluded.finalize_after,
    finalized_at = excluded.finalized_at,
    is_public = true
  where public.leaderboard_seasons.lifecycle_state <> 'finalized'
  returning id into target_season_id;

  if target_season_id is null then
    select id into target_season_id from public.leaderboard_seasons where slug = season_slug;
  end if;
  if season_phase <> 'archived' and exists (
    select 1 from public.leaderboard_seasons
    where id = target_season_id and lifecycle_state = 'finalized'
  ) then
    raise exception 'FINALIZED_SEASON_IMMUTABLE';
  end if;
  select finalize_after into season_finalize_after from public.leaderboard_seasons where id = target_season_id;
  return jsonb_build_object(
    'seasonId', target_season_id,
    'lifecycleState', (select lifecycle_state from public.leaderboard_seasons where id = target_season_id),
    'finalizeAfter', season_finalize_after,
    'pendingQuarantines', (
      select count(*) from public.leaderboard_quarantine
      where status = 'pending' and payload ->> 'seasonId' = target_season_id::text
    )
  );
end;
$$;

create or replace function public.finalize_due_leaderboard_seasons()
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  candidate record;
  created integer;
  seasons_finalized integer := 0;
  snapshots_created integer := 0;
begin
  for candidate in
    select season.id
    from public.leaderboard_seasons season
    where season.lifecycle_state = 'closing'
      and season.finalize_after <= clock_timestamp()
      and not exists (
        select 1 from public.leaderboard_quarantine quarantine
        where quarantine.status = 'pending' and quarantine.payload ->> 'seasonId' = season.id::text
      )
    order by season.finalize_after
  loop
    created := public.snapshot_leaderboard_season(candidate.id);
    snapshots_created := snapshots_created + created;
    if created > 0 then seasons_finalized := seasons_finalized + 1; end if;
  end loop;
  return jsonb_build_object('seasonsFinalized', seasons_finalized, 'snapshotsCreated', snapshots_created);
end;
$$;

create or replace function public.review_leaderboard_quarantine(
  p_quarantine_id uuid,
  p_reviewer_id uuid,
  p_decision text
)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  quarantine public.leaderboard_quarantine%rowtype;
  entry_id uuid;
  target_season_id uuid;
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'INVALID_REVIEW_DECISION'; end if;
  if p_reviewer_id is null then raise exception 'UNKNOWN_REVIEWER'; end if;

  perform pg_advisory_xact_lock(hashtextextended('leaderboard-season-lifecycle', 0));
  select * into quarantine from public.leaderboard_quarantine where id = p_quarantine_id for update;
  if not found then raise exception 'QUARANTINE_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('leaderboard-verification:' || quarantine.verification_id::text, 0));

  if quarantine.status <> 'pending' then
    if quarantine.status <> p_decision then raise exception 'REVIEW_DECISION_CONFLICT'; end if;
    if quarantine.status = 'approved' then
      select id into entry_id from public.leaderboard_entries where verification_id = quarantine.verification_id;
      if entry_id is null then raise exception 'APPROVED_VERIFICATION_ENTRY_MISSING'; end if;
    elsif exists (select 1 from public.leaderboard_entries where verification_id = quarantine.verification_id) then
      raise exception 'REJECTED_VERIFICATION_HAS_ENTRY';
    end if;
    return jsonb_build_object('status', quarantine.status, 'entryId', entry_id, 'snapshotsCreated', 0);
  end if;

  if quarantine.payload ->> 'seasonId' is null
    or quarantine.payload ->> 'characterId' is null
    or quarantine.payload ->> 'scoreBreakdown' is null
    or quarantine.payload ->> 'missionStartedAt' is null
  then
    raise exception 'QUARANTINE_PAYLOAD_INCOMPLETE';
  end if;
  target_season_id := (quarantine.payload ->> 'seasonId')::uuid;
  if exists (
    select 1 from public.leaderboard_seasons
    where id = target_season_id and lifecycle_state = 'finalized'
  ) then
    raise exception 'SEASON_FINALIZED';
  end if;
  if exists (select 1 from public.leaderboard_entries where verification_id = quarantine.verification_id) then
    raise exception 'VERIFICATION_CONFLICT';
  end if;

  if p_decision = 'approved' then
    insert into public.leaderboard_entries (
      season_id, mission_slug, mission_started_at, player_id, player_name, character_id, party_size,
      score, grade, mission_seconds, delivered, rescues, damage_taken, verified,
      verification_id, score_breakdown, band_id, precision, generosity, clean_escape, suspicious
    ) values (
      target_season_id,
      quarantine.payload ->> 'missionSlug',
      (quarantine.payload ->> 'missionStartedAt')::timestamptz,
      (quarantine.payload ->> 'playerId')::uuid,
      quarantine.payload ->> 'playerName',
      quarantine.payload ->> 'characterId',
      (quarantine.payload ->> 'partySize')::smallint,
      (quarantine.payload ->> 'score')::integer,
      quarantine.payload ->> 'grade',
      (quarantine.payload ->> 'missionSeconds')::integer,
      (quarantine.payload ->> 'delivered')::integer,
      (quarantine.payload ->> 'rescues')::integer,
      (quarantine.payload ->> 'damageTaken')::integer,
      true,
      quarantine.verification_id,
      quarantine.payload -> 'scoreBreakdown',
      (quarantine.payload ->> 'bandId')::uuid,
      (quarantine.payload ->> 'precision')::smallint,
      (quarantine.payload ->> 'generosity')::smallint,
      (quarantine.payload ->> 'cleanEscape')::boolean,
      true
    ) returning id into entry_id;
  end if;

  update public.leaderboard_quarantine
  set
    status = p_decision,
    reviewed_by = p_reviewer_id,
    reviewer_audit_id = p_reviewer_id,
    reviewed_at = clock_timestamp()
  where id = p_quarantine_id;

  return jsonb_build_object('status', p_decision, 'entryId', entry_id, 'snapshotsCreated', 0);
end;
$$;

create or replace function public.load_current_sherwood_campaign()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'snapshot', campaign.state,
    'processedEventIds', coalesce((
      select jsonb_agg(events.event_id order by events.sequence)
      from public.sherwood_campaign_events events
      where events.campaign_id = campaign.id
        and events.event_type in ('mission', 'contribution')
    ), '[]'::jsonb),
    'lastSequence', coalesce((
      select max(events.sequence)
      from public.sherwood_campaign_events events
      where events.campaign_id = campaign.id
    ), 0)
  )
  from public.sherwood_campaigns campaign
  order by case when campaign.phase = 'archived' then 1 else 0 end, campaign.updated_at desc, campaign.revision desc
  limit 1;
$$;

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
  target_campaign_id uuid := (p_snapshot ->> 'id')::uuid;
  incoming_revision integer := (p_snapshot ->> 'revision')::integer;
  event_inserted integer;
begin
  if p_sequence <= 0 or incoming_revision <= 0 then raise exception 'INVALID_CAMPAIGN_SEQUENCE'; end if;
  if p_event_type not in ('mission', 'contribution', 'operator') then raise exception 'INVALID_CAMPAIGN_EVENT'; end if;
  perform pg_advisory_xact_lock(hashtextextended('sherwood-campaign-succession', 0));
  perform pg_advisory_xact_lock(hashtextextended('sherwood-campaign:' || target_campaign_id::text, 0));
  if exists (
    select 1 from public.sherwood_campaign_events events
    where events.event_id = p_event_id
      and events.campaign_id = target_campaign_id
      and events.sequence = p_sequence
      and events.event_type = p_event_type
      and events.occurred_at = p_occurred_at
      and events.payload = p_payload
      and events.event_snapshot = p_snapshot
      and events.snapshot_revision = incoming_revision
  ) then return false; end if;
  if exists (select 1 from public.sherwood_campaign_events where event_id = p_event_id) then
    raise exception 'CAMPAIGN_EVENT_REPLAY_MISMATCH';
  end if;
  if not exists (select 1 from public.sherwood_campaigns where id = target_campaign_id)
    and exists (select 1 from public.sherwood_campaigns where phase <> 'archived')
  then
    raise exception 'ACTIVE_CAMPAIGN_EXISTS';
  end if;
  if p_sequence <> coalesce((
    select max(events.sequence) + 1
    from public.sherwood_campaign_events events
    where events.campaign_id = target_campaign_id
  ), 1) then
    raise exception 'STALE_CAMPAIGN_SEQUENCE';
  end if;
  if exists (select 1 from public.sherwood_campaigns where id = target_campaign_id and revision >= incoming_revision) then
    raise exception 'STALE_CAMPAIGN_REVISION';
  end if;

  insert into public.sherwood_campaigns (id, slug, name, phase, starts_at, ends_at, pressure, revision, state, archived_at, updated_at)
  values (
    target_campaign_id,
    p_snapshot ->> 'slug',
    p_snapshot ->> 'name',
    p_snapshot ->> 'phase',
    to_timestamp((p_snapshot ->> 'startsAt')::double precision / 1000.0),
    to_timestamp((p_snapshot ->> 'endsAt')::double precision / 1000.0),
    (p_snapshot ->> 'pressure')::integer,
    incoming_revision,
    p_snapshot,
    case when p_snapshot ->> 'archivedAt' is null then null else to_timestamp((p_snapshot ->> 'archivedAt')::double precision / 1000.0) end,
    clock_timestamp()
  ) on conflict (id) do update set
    name = excluded.name,
    phase = excluded.phase,
    ends_at = excluded.ends_at,
    pressure = excluded.pressure,
    revision = excluded.revision,
    state = excluded.state,
    archived_at = excluded.archived_at,
    updated_at = clock_timestamp()
  where public.sherwood_campaigns.revision < excluded.revision;

  insert into public.sherwood_campaign_events (campaign_id, sequence, event_id, event_type, occurred_at, payload, event_snapshot, snapshot_revision)
  values (target_campaign_id, p_sequence, p_event_id, p_event_type, p_occurred_at, p_payload, p_snapshot, incoming_revision);
  get diagnostics event_inserted = row_count;
  if event_inserted = 1 then perform public.sync_leaderboard_season_from_campaign(p_snapshot, p_occurred_at); end if;
  return event_inserted = 1;
end;
$$;

revoke all on table public.leaderboard_entries from service_role;
revoke all on table public.leaderboard_quarantine from service_role;
revoke all on table public.leaderboard_season_snapshots from service_role;
revoke all on table public.leaderboard_seasons from service_role;
revoke all on table public.sherwood_campaign_events from service_role;
revoke all on table public.sherwood_campaigns from service_role;
grant select, insert on table public.leaderboard_entries to service_role;
grant select, insert, update on table public.leaderboard_quarantine to service_role;
grant select, insert on table public.leaderboard_season_snapshots to service_role;
grant select, insert, update on table public.leaderboard_seasons to service_role;
grant select, insert on table public.sherwood_campaign_events to service_role;
grant select, insert, update on table public.sherwood_campaigns to service_role;

revoke all on function public.record_verified_leaderboard_entry(text,uuid,text,timestamptz,uuid,uuid,text,text,smallint,integer,text,integer,integer,integer,integer,smallint,smallint,boolean,jsonb) from public,anon,authenticated;
revoke all on function public.snapshot_leaderboard_season(uuid) from public,anon,authenticated;
revoke all on function public.sync_leaderboard_season_from_campaign(jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.finalize_due_leaderboard_seasons() from public,anon,authenticated;
revoke all on function public.review_leaderboard_quarantine(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.load_current_sherwood_campaign() from public,anon,authenticated;
revoke all on function public.record_sherwood_campaign_transition(integer,timestamptz,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.reject_immutable_leaderboard_mutation() from public,anon,authenticated,service_role;
revoke all on function public.reject_finalized_leaderboard_entry() from public,anon,authenticated,service_role;
grant execute on function public.record_verified_leaderboard_entry(text,uuid,text,timestamptz,uuid,uuid,text,text,smallint,integer,text,integer,integer,integer,integer,smallint,smallint,boolean,jsonb) to service_role;
grant execute on function public.snapshot_leaderboard_season(uuid) to service_role;
grant execute on function public.sync_leaderboard_season_from_campaign(jsonb,timestamptz) to service_role;
grant execute on function public.finalize_due_leaderboard_seasons() to service_role;
grant execute on function public.review_leaderboard_quarantine(uuid,uuid,text) to service_role;
grant execute on function public.load_current_sherwood_campaign() to service_role;
grant execute on function public.record_sherwood_campaign_transition(integer,timestamptz,text,text,jsonb,jsonb) to service_role;
