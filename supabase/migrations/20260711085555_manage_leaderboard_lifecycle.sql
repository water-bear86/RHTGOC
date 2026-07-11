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
  where slug = p_season_slug and is_public = true and clock_timestamp() between starts_at and ends_at;

  if target_season_id is null then raise exception 'ACTIVE_SEASON_NOT_FOUND'; end if;

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
      jsonb_build_object(
        'seasonId', target_season_id,
        'missionSlug', p_mission_slug,
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
        'cleanEscape', p_damage_taken = 0
      )
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
  if exists (select 1 from public.leaderboard_seasons where id = p_season_id and ends_at > clock_timestamp()) then raise exception 'SEASON_NOT_ENDED'; end if;
  if not exists (select 1 from public.leaderboard_seasons where id = p_season_id) then raise exception 'SEASON_NOT_FOUND'; end if;

  perform pg_advisory_xact_lock(hashtextextended('leaderboard-snapshot:' || p_season_id::text, 0));
  foreach board in array array['master-outlaws', 'peoples-champions', 'clean-escapes', 'rescuers', 'swift-arrows'] loop
    select coalesce(jsonb_agg(to_jsonb(ranked)), '[]'::jsonb) into board_entries
    from (
      select id, player_name, character_id, party_size, mission_slug, score, mission_seconds, rescues, precision, generosity
      from public.leaderboard_entries
      where season_id = p_season_id and verified = true
        and (board <> 'clean-escapes' or clean_escape = true)
      order by
        case when board = 'clean-escapes' then mission_seconds end asc,
        case board when 'peoples-champions' then generosity when 'rescuers' then least(rescues, 100) when 'swift-arrows' then precision else score end desc,
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
  season_slug text := p_snapshot ->> 'slug';
  season_name text := p_snapshot ->> 'name';
  season_phase text := p_snapshot ->> 'phase';
  season_starts_at timestamptz := to_timestamp((p_snapshot ->> 'startsAt')::double precision / 1000.0);
  season_ends_at timestamptz := to_timestamp((p_snapshot ->> 'endsAt')::double precision / 1000.0);
  snapshots_created integer := 0;
begin
  if season_slug is null or season_slug !~ '^[a-z0-9-]{1,40}$' or season_name is null or char_length(season_name) not between 1 and 60 or season_ends_at <= season_starts_at then
    raise exception 'INVALID_LEADERBOARD_SEASON';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('leaderboard-season-lifecycle', 0));
  insert into public.leaderboard_seasons (slug, name, starts_at, ends_at, is_public)
  values (season_slug, season_name, season_starts_at, season_ends_at, true)
  on conflict (slug) do update set
    name = excluded.name,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    is_public = true
  where not exists (
    select 1 from public.leaderboard_season_snapshots snapshot
    where snapshot.season_id = public.leaderboard_seasons.id
  )
  returning id into target_season_id;

  if target_season_id is null then select id into target_season_id from public.leaderboard_seasons where slug = season_slug; end if;
  if season_phase = 'archived' then
    update public.leaderboard_seasons
    set ends_at = greatest(starts_at + interval '1 second', least(ends_at, p_occurred_at))
    where id = target_season_id
      and not exists (select 1 from public.leaderboard_season_snapshots snapshot where snapshot.season_id = target_season_id);
    snapshots_created := public.snapshot_leaderboard_season(target_season_id);
  end if;

  return jsonb_build_object('seasonId', target_season_id, 'snapshotsCreated', snapshots_created);
end;
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
  if event_inserted = 1 then perform public.sync_leaderboard_season_from_campaign(p_snapshot, p_occurred_at); end if;
  return event_inserted = 1;
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
begin
  if p_decision not in ('approved', 'rejected') then raise exception 'INVALID_REVIEW_DECISION'; end if;
  if not exists (select 1 from auth.users where id = p_reviewer_id) then raise exception 'UNKNOWN_REVIEWER'; end if;

  select * into quarantine from public.leaderboard_quarantine where id = p_quarantine_id for update;
  if not found then raise exception 'QUARANTINE_NOT_FOUND'; end if;
  if quarantine.status <> 'pending' then
    select id into entry_id from public.leaderboard_entries where verification_id = quarantine.verification_id;
    return jsonb_build_object('status', quarantine.status, 'entryId', entry_id);
  end if;

  if p_decision = 'approved' then
    if quarantine.payload ->> 'seasonId' is null or quarantine.payload ->> 'characterId' is null or quarantine.payload ->> 'scoreBreakdown' is null then
      raise exception 'QUARANTINE_PAYLOAD_INCOMPLETE';
    end if;
    insert into public.leaderboard_entries (
      season_id, mission_slug, player_id, player_name, character_id, party_size,
      score, grade, mission_seconds, delivered, rescues, damage_taken, verified,
      verification_id, score_breakdown, band_id, precision, generosity, clean_escape, suspicious
    ) values (
      (quarantine.payload ->> 'seasonId')::uuid,
      quarantine.payload ->> 'missionSlug',
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
    ) on conflict (verification_id) do nothing
    returning id into entry_id;
    if entry_id is null then select id into entry_id from public.leaderboard_entries where verification_id = quarantine.verification_id; end if;
  end if;

  update public.leaderboard_quarantine
  set status = p_decision, reviewed_by = p_reviewer_id, reviewed_at = now()
  where id = p_quarantine_id;
  return jsonb_build_object('status', p_decision, 'entryId', entry_id);
end;
$$;

revoke all on function public.record_verified_leaderboard_entry(text,uuid,text,uuid,uuid,text,text,smallint,integer,text,integer,integer,integer,integer,smallint,smallint,jsonb) from public,anon,authenticated;
revoke all on function public.snapshot_leaderboard_season(uuid) from public,anon,authenticated;
revoke all on function public.sync_leaderboard_season_from_campaign(jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.record_sherwood_campaign_transition(integer,timestamptz,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.review_leaderboard_quarantine(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_verified_leaderboard_entry(text,uuid,text,uuid,uuid,text,text,smallint,integer,text,integer,integer,integer,integer,smallint,smallint,jsonb) to service_role;
grant execute on function public.snapshot_leaderboard_season(uuid) to service_role;
grant execute on function public.sync_leaderboard_season_from_campaign(jsonb,timestamptz) to service_role;
grant execute on function public.record_sherwood_campaign_transition(integer,timestamptz,text,text,jsonb,jsonb) to service_role;
grant execute on function public.review_leaderboard_quarantine(uuid,uuid,text) to service_role;
