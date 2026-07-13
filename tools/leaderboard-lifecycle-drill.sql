-- Transactional service-role assertion for season closure, verified writes,
-- quarantine review, ranking definitions, immutable snapshots, and replay.
-- All disposable rows are rolled back.
begin;

select set_config('sherwood.drill.player_id', gen_random_uuid()::text, true);
select set_config('sherwood.drill.reviewer_id', gen_random_uuid()::text, true);
select set_config('sherwood.drill.viewer_id', gen_random_uuid()::text, true);
select set_config('sherwood.drill.friend_id', gen_random_uuid()::text, true);
select set_config('sherwood.drill.outsider_id', gen_random_uuid()::text, true);
select set_config('sherwood.drill.viewer_blocked_id', gen_random_uuid()::text, true);
select set_config('sherwood.drill.viewer_blocked_by_id', gen_random_uuid()::text, true);
select set_config('sherwood.drill.band_id', gen_random_uuid()::text, true);
select set_config('sherwood.drill.campaign_id', gen_random_uuid()::text, true);
select set_config('sherwood.drill.season_slug', 'drill-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), true);

insert into auth.users(id)
values
  (current_setting('sherwood.drill.player_id')::uuid),
  (current_setting('sherwood.drill.reviewer_id')::uuid),
  (current_setting('sherwood.drill.viewer_id')::uuid),
  (current_setting('sherwood.drill.friend_id')::uuid),
  (current_setting('sherwood.drill.outsider_id')::uuid),
  (current_setting('sherwood.drill.viewer_blocked_id')::uuid),
  (current_setting('sherwood.drill.viewer_blocked_by_id')::uuid);

set local role service_role;

do $drill$
declare
  player_user uuid := current_setting('sherwood.drill.player_id')::uuid;
  reviewer_user uuid := current_setting('sherwood.drill.reviewer_id')::uuid;
  viewer_user uuid := current_setting('sherwood.drill.viewer_id')::uuid;
  friend_user uuid := current_setting('sherwood.drill.friend_id')::uuid;
  outsider_user uuid := current_setting('sherwood.drill.outsider_id')::uuid;
  viewer_blocked_user uuid := current_setting('sherwood.drill.viewer_blocked_id')::uuid;
  viewer_blocked_by_user uuid := current_setting('sherwood.drill.viewer_blocked_by_id')::uuid;
  drill_band_id uuid := current_setting('sherwood.drill.band_id')::uuid;
  drill_campaign_id uuid := current_setting('sherwood.drill.campaign_id')::uuid;
  season_slug text := current_setting('sherwood.drill.season_slug');
  starts_at timestamptz := clock_timestamp() - interval '1 hour';
  scheduled_end timestamptz := clock_timestamp() - interval '10 minutes';
  archive_at timestamptz := clock_timestamp() - interval '1 second';
  starts_ms bigint;
  ends_ms bigint;
  archived_ms bigint;
  snapshot jsonb;
  result jsonb;
  normal_verification uuid := gen_random_uuid();
  normal_entry uuid;
  quarantine_approve_verification uuid := gen_random_uuid();
  quarantine_reject_verification uuid := gen_random_uuid();
  quarantine_gate_verification uuid := gen_random_uuid();
  quarantine_approve_id uuid;
  quarantine_reject_id uuid;
  quarantine_gate_id uuid;
  promoted_entry uuid;
  first_name text;
begin
  starts_ms := floor(extract(epoch from starts_at) * 1000);
  ends_ms := floor(extract(epoch from scheduled_end) * 1000);
  archived_ms := floor(extract(epoch from archive_at) * 1000);
  snapshot := jsonb_build_object(
    'id', drill_campaign_id, 'slug', season_slug, 'name', 'Lifecycle Drill', 'phase', 'finale',
    'startsAt', starts_ms, 'endsAt', ends_ms, 'pressure', 70, 'revision', 1, 'archivedAt', null
  );
  if public.record_sherwood_campaign_transition(1, clock_timestamp(), 'drill:start:' || drill_campaign_id, 'operator', snapshot, '{"operation":"finale"}'::jsonb) is not true then
    raise exception 'campaign start was not recorded';
  end if;
  if not exists (
    select 1 from public.leaderboard_seasons
    where slug = season_slug and lifecycle_state = 'open' and leaderboard_seasons.campaign_id = drill_campaign_id
  ) then raise exception 'open leaderboard season was not synchronized'; end if;

  insert into public.player_friendships(user_low,user_high,requested_by,status,responded_at)
  values (least(viewer_user,friend_user),greatest(viewer_user,friend_user),viewer_user,'accepted',clock_timestamp());
  insert into public.player_blocks(blocker_id,blocked_id)
  values (viewer_user,viewer_blocked_user),(viewer_blocked_by_user,viewer_user);
  insert into public.merry_bands(id,name,banner_id,created_by)
  values (drill_band_id,'Scope Drill Band','oak',viewer_user);
  insert into public.merry_band_members(band_id,user_id,membership_role)
  values (drill_band_id,viewer_user,'leader'),(drill_band_id,friend_user,'member');

  -- Distinct identities exercise self, friend, band, outsider, and bilateral
  -- block scopes through the browser-facing SECURITY DEFINER read boundary.
  perform public.record_verified_leaderboard_entry(
    season_slug, gen_random_uuid(), 'scope-drill', clock_timestamp() - interval '4 minutes', drill_band_id, viewer_user,
    'Scope Self', 'robin', 2::smallint, 6400, 'B', 170, 220, 0, 1, 70::smallint, 50::smallint, true,
    '{"speed":70,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );
  perform public.record_verified_leaderboard_entry(
    season_slug, gen_random_uuid(), 'scope-drill', clock_timestamp() - interval '4 minutes', drill_band_id, friend_user,
    'Scope Friend', 'marian', 2::smallint, 6300, 'B', 175, 210, 0, 0, 72::smallint, 48::smallint, true,
    '{"speed":68,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );
  perform public.record_verified_leaderboard_entry(
    season_slug, gen_random_uuid(), 'scope-drill', clock_timestamp() - interval '4 minutes', null::uuid, outsider_user,
    'Scope Outsider', 'robin', 2::smallint, 6200, 'B', 180, 200, 0, 0, 71::smallint, 47::smallint, true,
    '{"speed":66,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );
  perform public.record_verified_leaderboard_entry(
    season_slug, gen_random_uuid(), 'scope-drill', clock_timestamp() - interval '4 minutes', null::uuid, viewer_blocked_user,
    'Scope Viewer Blocked', 'robin', 2::smallint, 6100, 'B', 185, 190, 0, 0, 69::smallint, 46::smallint, true,
    '{"speed":64,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );
  perform public.record_verified_leaderboard_entry(
    season_slug, gen_random_uuid(), 'scope-drill', clock_timestamp() - interval '4 minutes', null::uuid, viewer_blocked_by_user,
    'Scope Blocked By', 'marian', 2::smallint, 6000, 'B', 190, 180, 0, 0, 68::smallint, 45::smallint, true,
    '{"speed":62,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );

  -- A finale run beginning after the scheduled campaign end remains rank eligible.
  normal_entry := public.record_verified_leaderboard_entry(
    season_slug, normal_verification, 'peoples-purse', clock_timestamp() - interval '5 minutes', null::uuid, player_user,
    'Finale Scout', 'robin', 2::smallint, 8000, 'A', 180, 500, 1, 0, 90::smallint, 70::smallint, true,
    '{"speed":80,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );
  if normal_entry is null then raise exception 'finale run was rejected'; end if;

  -- Fixtures deliberately oppose the old, incorrect board metrics.
  perform public.record_verified_leaderboard_entry(
    season_slug, gen_random_uuid(), 'peoples-purse', clock_timestamp() - interval '4 minutes', null::uuid, player_user,
    'High Ratio', 'marian', 2::smallint, 9000, 'S', 160, 100, 0, 2, 95::smallint, 100::smallint, false,
    '{"speed":90,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );
  perform public.record_verified_leaderboard_entry(
    season_slug, gen_random_uuid(), 'peoples-purse', clock_timestamp() - interval '4 minutes', null::uuid, player_user,
    'People Wealth', 'marian', 2::smallint, 7000, 'B', 200, 900, 0, 2, 80::smallint, 10::smallint, false,
    '{"speed":70,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );
  perform public.record_verified_leaderboard_entry(
    season_slug, gen_random_uuid(), 'clean-drill', clock_timestamp() - interval '4 minutes', null::uuid, player_user,
    'Clean Fast', 'robin', 2::smallint, 6000, 'B', 60, 100, 0, 0, 70::smallint, 40::smallint, true,
    '{"speed":100,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );
  perform public.record_verified_leaderboard_entry(
    season_slug, gen_random_uuid(), 'clean-drill', clock_timestamp() - interval '4 minutes', null::uuid, player_user,
    'Clean Value', 'robin', 2::smallint, 7500, 'A', 240, 800, 0, 0, 75::smallint, 80::smallint, true,
    '{"speed":60,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );
  perform public.record_verified_leaderboard_entry(
    season_slug, gen_random_uuid(), 'swift-drill', clock_timestamp() - interval '4 minutes', null::uuid, player_user,
    'Precise Slow', 'robin', 3::smallint, 9000, 'S', 200, 300, 0, 0, 100::smallint, 50::smallint, true,
    '{"speed":50,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );
  perform public.record_verified_leaderboard_entry(
    season_slug, gen_random_uuid(), 'swift-drill', clock_timestamp() - interval '4 minutes', null::uuid, player_user,
    'Swift First', 'robin', 3::smallint, 7000, 'B', 100, 300, 0, 0, 20::smallint, 50::smallint, true,
    '{"speed":95,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );

  perform public.record_verified_leaderboard_entry(
    season_slug, quarantine_approve_verification, 'peoples-purse', clock_timestamp() - interval '4 minutes', null::uuid, player_user,
    'Approve Me', 'robin', 2::smallint, 10001, 'S', 180, 50, 1, 0, 90::smallint, 50::smallint, true,
    '{"speed":100,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );
  perform public.record_verified_leaderboard_entry(
    season_slug, quarantine_reject_verification, 'peoples-purse', clock_timestamp() - interval '4 minutes', null::uuid, player_user,
    'Reject Me', 'robin', 2::smallint, 10002, 'S', 180, 50, 1, 0, 90::smallint, 50::smallint, true,
    '{"speed":100,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );
  perform public.record_verified_leaderboard_entry(
    season_slug, quarantine_gate_verification, 'peoples-purse', clock_timestamp() - interval '4 minutes', null::uuid, player_user,
    'Gate Me', 'robin', 2::smallint, 10003, 'S', 180, 50, 1, 0, 90::smallint, 50::smallint, true,
    '{"speed":100,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  );
  select id into quarantine_approve_id from public.leaderboard_quarantine where verification_id = quarantine_approve_verification;
  select id into quarantine_reject_id from public.leaderboard_quarantine where verification_id = quarantine_reject_verification;
  select id into quarantine_gate_id from public.leaderboard_quarantine where verification_id = quarantine_gate_verification;
  if quarantine_approve_id is null or quarantine_reject_id is null or quarantine_gate_id is null then raise exception 'quarantine fixtures missing'; end if;

  snapshot := snapshot || jsonb_build_object('phase', 'archived', 'revision', 2, 'archivedAt', archived_ms);
  if public.record_sherwood_campaign_transition(2, archive_at, 'drill:archive:' || drill_campaign_id, 'operator', snapshot, '{"operation":"archive"}'::jsonb) is not true then
    raise exception 'campaign archive was not recorded';
  end if;
  if not exists (
    select 1 from public.leaderboard_seasons
    where slug = season_slug and lifecycle_state = 'closing' and closed_at = archive_at and finalize_after > closed_at
  ) then raise exception 'archive did not enter leaderboard closing state'; end if;

  -- A run started before archive can drain afterward.
  if public.record_verified_leaderboard_entry(
    season_slug, gen_random_uuid(), 'peoples-purse', archive_at - interval '30 seconds', null::uuid, player_user,
    'Late Finisher', 'marian', 2::smallint, 7800, 'A', 300, 600, 0, 0, 80::smallint, 70::smallint, true,
    '{"speed":70,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  ) is null then raise exception 'pre-archive mission did not drain'; end if;
  begin
    perform public.record_verified_leaderboard_entry(
      season_slug, gen_random_uuid(), 'peoples-purse', archive_at + interval '500 milliseconds', null::uuid, player_user,
      'Too Late', 'robin', 2::smallint, 7000, 'B', 180, 300, 0, 0, 70::smallint, 50::smallint, true,
      '{"speed":70,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
    );
    raise exception 'post-close mission was accepted';
  exception when others then
    if sqlerrm not like '%MISSION_OUTSIDE_SEASON%' then raise; end if;
  end;

  -- Fast-forward only the minimum finalization eligibility; pending reviews still block.
  update public.leaderboard_seasons set finalize_after = clock_timestamp() - interval '1 second' where slug = season_slug;
  result := public.finalize_due_leaderboard_seasons();
  if (result ->> 'seasonsFinalized')::integer <> 0 then raise exception 'pending quarantine did not block finalization'; end if;

  result := public.review_leaderboard_quarantine(quarantine_approve_id, reviewer_user, 'approved');
  promoted_entry := (result ->> 'entryId')::uuid;
  if promoted_entry is null or not exists (
    select 1 from public.leaderboard_entries where id = promoted_entry and verified and suspicious
  ) then raise exception 'approved quarantine was not promoted'; end if;
  if (public.review_leaderboard_quarantine(quarantine_approve_id, reviewer_user, 'approved') ->> 'entryId')::uuid <> promoted_entry then
    raise exception 'same-decision approval replay changed entry';
  end if;
  begin
    perform public.review_leaderboard_quarantine(quarantine_approve_id, reviewer_user, 'rejected');
    raise exception 'opposite terminal decision was accepted';
  exception when others then
    if sqlerrm not like '%REVIEW_DECISION_CONFLICT%' then raise; end if;
  end;

  result := public.review_leaderboard_quarantine(quarantine_reject_id, reviewer_user, 'rejected');
  if result ->> 'entryId' is not null or exists (
    select 1 from public.leaderboard_entries where verification_id = quarantine_reject_verification
  ) then raise exception 'rejected quarantine entered public rankings'; end if;
  perform public.review_leaderboard_quarantine(quarantine_reject_id, reviewer_user, 'rejected');
  perform public.review_leaderboard_quarantine(quarantine_gate_id, reviewer_user, 'rejected');
  if not exists (
    select 1 from public.leaderboard_quarantine
    where id = quarantine_approve_id and reviewed_by = reviewer_user and reviewer_audit_id = reviewer_user and reviewed_at is not null
  ) then raise exception 'durable reviewer attribution missing'; end if;

  result := public.finalize_due_leaderboard_seasons();
  if (result ->> 'seasonsFinalized')::integer <> 1 or (result ->> 'snapshotsCreated')::integer <> 5 then
    raise exception 'eligible season did not create exactly five snapshots: %', result;
  end if;
  if not exists (
    select 1 from public.leaderboard_seasons
    where slug = season_slug and lifecycle_state = 'finalized' and finalized_at is not null
  ) then raise exception 'season was not marked finalized'; end if;

  select item.value ->> 'player_name' into first_name
  from public.leaderboard_season_snapshots snapshot_row,
       lateral jsonb_array_elements(snapshot_row.entries) with ordinality item(value, position)
  where snapshot_row.season_id = (select id from public.leaderboard_seasons where slug = season_slug)
    and snapshot_row.board_slug = 'peoples-champions'
  order by item.position limit 1;
  if first_name <> 'People Wealth' then raise exception 'People''s Champions used the wrong metric: %', first_name; end if;

  select item.value ->> 'player_name' into first_name
  from public.leaderboard_season_snapshots snapshot_row,
       lateral jsonb_array_elements(snapshot_row.entries) with ordinality item(value, position)
  where snapshot_row.season_id = (select id from public.leaderboard_seasons where slug = season_slug)
    and snapshot_row.board_slug = 'clean-escapes'
  order by item.position limit 1;
  if first_name <> 'Clean Value' then raise exception 'Clean Escapes used the wrong metric: %', first_name; end if;

  select item.value ->> 'player_name' into first_name
  from public.leaderboard_season_snapshots snapshot_row,
       lateral jsonb_array_elements(snapshot_row.entries) with ordinality item(value, position)
  where snapshot_row.season_id = (select id from public.leaderboard_seasons where slug = season_slug)
    and snapshot_row.board_slug = 'swift-arrows'
    and item.value ->> 'mission_slug' = 'swift-drill'
    and (item.value ->> 'party_size')::integer = 3
  order by item.position limit 1;
  if first_name <> 'Swift First' then raise exception 'Swift Arrows used the wrong metric: %', first_name; end if;

  -- Finalization freezes new writes but permits an exact idempotent replay.
  if public.record_verified_leaderboard_entry(
    season_slug, normal_verification, 'peoples-purse',
    (select mission_started_at from public.leaderboard_entries where id = normal_entry), null::uuid, player_user,
    'Finale Scout', 'robin', 2::smallint, 8000, 'A', 180, 500, 1, 0, 90::smallint, 70::smallint, true,
    '{"speed":80,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
  ) <> normal_entry then raise exception 'finalized exact replay changed result'; end if;
  begin
    perform public.record_verified_leaderboard_entry(
      season_slug, gen_random_uuid(), 'peoples-purse', archive_at - interval '30 seconds', null::uuid, player_user,
      'New After Final', 'robin', 2::smallint, 7000, 'B', 180, 300, 0, 0, 70::smallint, 50::smallint, true,
      '{"speed":70,"missionVersion":"1.0.0","missionContentHash":"fnv1a32:ec1c4b0c"}'::jsonb
    );
    raise exception 'new finalized-season entry was accepted';
  exception when others then
    if sqlerrm not like '%SEASON_FINALIZED%' then raise; end if;
  end;

  if has_function_privilege('anon', 'public.review_leaderboard_quarantine(uuid,uuid,text)', 'execute')
    or has_function_privilege('authenticated', 'public.review_leaderboard_quarantine(uuid,uuid,text)', 'execute')
    or has_function_privilege('public', 'public.review_leaderboard_quarantine(uuid,uuid,text)', 'execute')
  then raise exception 'browser role can execute leaderboard review'; end if;

  result := public.read_leaderboard('master-outlaws', season_slug, null, null, null, null, null);
  if jsonb_array_length(result) = 0
    or result -> 0 ? 'player_id'
    or result -> 0 ? 'verification_id'
    or result -> 0 ? 'score_breakdown'
  then raise exception 'public leaderboard RPC exposed private ranking identity or audit data'; end if;
  if has_table_privilege('anon', 'public.leaderboard_entries', 'select')
    or has_table_privilege('authenticated', 'public.leaderboard_season_snapshots', 'select')
  then raise exception 'browser role can bypass privacy-preserving leaderboard RPC'; end if;

  begin
    update public.leaderboard_season_snapshots set captured_at = clock_timestamp() where season_id = (select id from public.leaderboard_seasons where slug = season_slug);
    raise exception 'snapshot update succeeded';
  exception when insufficient_privilege or sqlstate '55000' then null;
  end;
  begin
    delete from public.sherwood_campaign_events where sherwood_campaign_events.campaign_id = drill_campaign_id;
    raise exception 'campaign event delete succeeded';
  exception when insufficient_privilege or sqlstate '55000' then null;
  end;
end;
$drill$;

reset role;

do $signature$
begin
  if to_regprocedure('public.read_leaderboard(text,text,text,integer,text,uuid,uuid[],uuid[])') is not null then
    raise exception 'identity-oracle leaderboard overload still exists';
  end if;
end;
$signature$;

select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $anon_scope$
declare
  result jsonb;
begin
  result := public.read_leaderboard('master-outlaws', current_setting('sherwood.drill.season_slug'), null, null, null, null, null);
  if jsonb_array_length(result) = 0 then raise exception 'anon global leaderboard unexpectedly empty'; end if;
  result := public.read_leaderboard(
    'master-outlaws', current_setting('sherwood.drill.season_slug'), null, null, null, null,
    array[current_setting('sherwood.drill.friend_id')::uuid]
  );
  if result <> '[]'::jsonb then raise exception 'anon caller received identity-scoped leaderboard rows'; end if;
end;
$anon_scope$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('sherwood.drill.viewer_id'), true);
set local role authenticated;
do $viewer_scope$
declare
  result jsonb;
begin
  result := public.read_leaderboard(
    'master-outlaws', current_setting('sherwood.drill.season_slug'), null, null, null, null,
    array[current_setting('sherwood.drill.viewer_id')::uuid]
  );
  if jsonb_array_length(result) = 0 or result::text not like '%Scope Self%' then
    raise exception 'authenticated self scope was not readable';
  end if;

  result := public.read_leaderboard(
    'master-outlaws', current_setting('sherwood.drill.season_slug'), null, null, null, null,
    array[current_setting('sherwood.drill.friend_id')::uuid]
  );
  if jsonb_array_length(result) = 0 or result::text not like '%Scope Friend%' then
    raise exception 'accepted friend scope was not readable';
  end if;

  begin
    perform public.read_leaderboard(
      'master-outlaws', current_setting('sherwood.drill.season_slug'), null, null, null, null,
      array[current_setting('sherwood.drill.outsider_id')::uuid]
    );
    raise exception 'unrelated identity scope was accepted';
  exception when others then
    if sqlerrm not like '%FORBIDDEN_LEADERBOARD_SCOPE%' then raise; end if;
  end;

  result := public.read_leaderboard(
    'master-outlaws', current_setting('sherwood.drill.season_slug'), null, null, null,
    current_setting('sherwood.drill.band_id')::uuid, null
  );
  if jsonb_array_length(result) = 0 or result::text not like '%Scope Friend%' then
    raise exception 'active band member scope was not readable';
  end if;

  result := public.read_leaderboard('master-outlaws', current_setting('sherwood.drill.season_slug'), null, null, null, null, null);
  if result::text like '%Scope Viewer Blocked%' or result::text like '%Scope Blocked By%' then
    raise exception 'bilateral block suppression failed';
  end if;
end;
$viewer_scope$;
reset role;

select set_config('request.jwt.claim.sub', current_setting('sherwood.drill.outsider_id'), true);
set local role authenticated;
do $outsider_scope$
begin
  begin
    perform public.read_leaderboard(
      'master-outlaws', current_setting('sherwood.drill.season_slug'), null, null, null,
      current_setting('sherwood.drill.band_id')::uuid, null
    );
    raise exception 'nonmember band scope was accepted';
  exception when others then
    if sqlerrm not like '%FORBIDDEN_LEADERBOARD_SCOPE%' then raise; end if;
  end;
end;
$outsider_scope$;
reset role;

rollback;
