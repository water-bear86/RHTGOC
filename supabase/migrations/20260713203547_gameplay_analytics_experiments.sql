create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table private.gameplay_analytics_batches (
  batch_id text primary key check (batch_id ~ '^ga_[a-f0-9]{32,64}$'),
  schema_version smallint not null check (schema_version = 1),
  created_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  aggregate_count integer not null check (aggregate_count between 1 and 1000),
  payload_digest text not null check (payload_digest ~ '^[a-f0-9]{32}$')
);

create table private.gameplay_cell_aggregates (
  batch_id text not null references private.gameplay_analytics_batches(batch_id) on delete cascade,
  window_start timestamptz not null check ((extract(epoch from window_start)::bigint % 300) = 0),
  mission_slug text not null check (mission_slug ~ '^[a-z0-9]+([.-][a-z0-9]+)*$' and pg_catalog.char_length(mission_slug) <= 60),
  map_version text not null check (map_version ~ '^[a-z0-9][a-z0-9._:-]*$' and pg_catalog.char_length(map_version) <= 64),
  build_id text not null check (build_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' and pg_catalog.char_length(build_id) <= 80),
  phase text not null check (phase ~ '^[a-z0-9]+([.-][a-z0-9]+)*$' and pg_catalog.char_length(phase) <= 32),
  experiment_id text not null default '',
  experiment_revision integer not null default 0,
  variant_id text not null default '',
  cell_x smallint not null check (cell_x between -128 and 128),
  cell_z smallint not null check (cell_z between -128 and 128),
  sample_count bigint not null check (sample_count between 0 and 1000000000),
  entry_count bigint not null check (entry_count between 0 and 1000000000),
  danger_sample_count bigint not null check (danger_sample_count between 0 and sample_count),
  objective_interaction_count bigint not null check (objective_interaction_count between 0 and 1000000000),
  downed_count bigint not null check (downed_count between 0 and 1000000000),
  stuck_recovery_count bigint not null check (stuck_recovery_count between 0 and 1000000000),
  client_error_count bigint not null check (client_error_count between 0 and 1000000000),
  webgl_context_lost_count bigint not null check (webgl_context_lost_count between 0 and 1000000000),
  asset_load_failed_count bigint not null check (asset_load_failed_count between 0 and 1000000000),
  uncaught_error_count bigint not null check (uncaught_error_count between 0 and 1000000000),
  unhandled_rejection_count bigint not null check (unhandled_rejection_count between 0 and 1000000000),
  frame_stall_count bigint not null check (frame_stall_count between 0 and 1000000000),
  snapshot_desync_count bigint not null check (snapshot_desync_count between 0 and 1000000000),
  mission_start_count bigint not null check (mission_start_count between 0 and 1000000000),
  mission_success_count bigint not null check (mission_success_count between 0 and 1000000000),
  mission_failure_count bigint not null check (mission_failure_count between 0 and 1000000000),
  primary key (
    batch_id, window_start, mission_slug, map_version, build_id, phase,
    experiment_id, experiment_revision, variant_id, cell_x, cell_z
  ),
  check (
    (experiment_id = '' and experiment_revision = 0 and variant_id = '')
    or (
      experiment_id ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'
      and pg_catalog.char_length(experiment_id) <= 60
      and experiment_revision between 1 and 1000000
      and variant_id ~ '^[a-z0-9]+([.-][a-z0-9]+)*$'
      and pg_catalog.char_length(variant_id) <= 40
    )
  ),
  check (
    sample_count + entry_count + danger_sample_count + objective_interaction_count
      + downed_count + stuck_recovery_count + client_error_count
      + webgl_context_lost_count + asset_load_failed_count + uncaught_error_count
      + unhandled_rejection_count + frame_stall_count + snapshot_desync_count
      + mission_start_count + mission_success_count + mission_failure_count > 0
  )
);

create table private.gameplay_experiments (
  experiment_id text not null check (experiment_id ~ '^[a-z0-9]+([.-][a-z0-9]+)*$' and pg_catalog.char_length(experiment_id) <= 60),
  revision integer not null check (revision between 1 and 1000000),
  definition jsonb not null check (pg_catalog.jsonb_typeof(definition) = 'object'),
  status text not null check (status in ('draft', 'active', 'paused', 'complete')),
  starts_at timestamptz not null,
  ends_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (experiment_id, revision),
  check (ends_at is null or ends_at > starts_at),
  check (definition ->> 'id' = experiment_id),
  check ((definition ->> 'revision')::integer = revision)
);

create index gameplay_cell_aggregates_window_map_idx
  on private.gameplay_cell_aggregates (window_start, mission_slug, map_version, build_id);
create index gameplay_cell_aggregates_experiment_idx
  on private.gameplay_cell_aggregates (experiment_id, experiment_revision, variant_id, window_start)
  where experiment_id <> '';
create index gameplay_cell_aggregates_location_idx
  on private.gameplay_cell_aggregates (mission_slug, map_version, cell_x, cell_z, window_start);
create index gameplay_analytics_batches_received_idx
  on private.gameplay_analytics_batches (received_at);
create unique index gameplay_experiments_one_active_revision_idx
  on private.gameplay_experiments (experiment_id)
  where status = 'active';
create index gameplay_experiments_active_window_idx
  on private.gameplay_experiments (starts_at, ends_at)
  where status = 'active';

alter table private.gameplay_analytics_batches enable row level security;
alter table private.gameplay_cell_aggregates enable row level security;
alter table private.gameplay_experiments enable row level security;

revoke all on table private.gameplay_analytics_batches from public, anon, authenticated, service_role;
revoke all on table private.gameplay_cell_aggregates from public, anon, authenticated, service_role;
revoke all on table private.gameplay_experiments from public, anon, authenticated, service_role;

create or replace function private.assert_gameplay_experiment_definition(p_definition jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_variant jsonb;
  v_config_entry record;
  v_weight_total integer := 0;
begin
  if p_definition is null or pg_catalog.jsonb_typeof(p_definition) <> 'object' then
    raise exception 'INVALID_EXPERIMENT_DEFINITION';
  end if;
  if not p_definition ?& array['id', 'revision', 'salt', 'allocationBps', 'variants']
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_definition)) <> 5
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(p_definition) as keys(key)
      where keys.key not in ('id', 'revision', 'salt', 'allocationBps', 'variants')
    )
  then
    raise exception 'INVALID_EXPERIMENT_FIELDS';
  end if;
  if p_definition ->> 'id' !~ '^[a-z0-9]+([.-][a-z0-9]+)*$'
    or pg_catalog.char_length(p_definition ->> 'id') > 60
    or p_definition ->> 'revision' !~ '^[0-9]{1,7}$'
    or (p_definition ->> 'revision')::integer not between 1 and 1000000
    or p_definition ->> 'salt' !~ '^[a-z0-9]+([.-][a-z0-9]+)*$'
    or pg_catalog.char_length(p_definition ->> 'salt') > 80
    or p_definition ->> 'allocationBps' !~ '^[0-9]{1,5}$'
    or (p_definition ->> 'allocationBps')::integer not between 1 and 10000
    or pg_catalog.jsonb_typeof(p_definition -> 'variants') <> 'array'
    or pg_catalog.jsonb_array_length(p_definition -> 'variants') not between 2 and 8
  then
    raise exception 'INVALID_EXPERIMENT_DEFINITION';
  end if;

  if (
    select pg_catalog.count(distinct variant ->> 'id')
    from pg_catalog.jsonb_array_elements(p_definition -> 'variants') as variants(variant)
  ) <> pg_catalog.jsonb_array_length(p_definition -> 'variants') then
    raise exception 'DUPLICATE_EXPERIMENT_VARIANT';
  end if;

  for v_variant in select value from pg_catalog.jsonb_array_elements(p_definition -> 'variants') loop
    if pg_catalog.jsonb_typeof(v_variant) <> 'object'
      or not v_variant ?& array['id', 'weightBps', 'config']
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_variant)) <> 3
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(v_variant) as keys(key)
        where keys.key not in ('id', 'weightBps', 'config')
      )
      or v_variant ->> 'id' !~ '^[a-z0-9]+([.-][a-z0-9]+)*$'
      or pg_catalog.char_length(v_variant ->> 'id') > 40
      or v_variant ->> 'weightBps' !~ '^[0-9]{1,5}$'
      or (v_variant ->> 'weightBps')::integer not between 1 and 10000
      or pg_catalog.jsonb_typeof(v_variant -> 'config') <> 'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_variant -> 'config')) > 16
    then
      raise exception 'INVALID_EXPERIMENT_VARIANT';
    end if;

    for v_config_entry in select key, value from pg_catalog.jsonb_each(v_variant -> 'config') loop
      if v_config_entry.key !~ '^[a-z][A-Za-z0-9]{0,39}$'
        or pg_catalog.jsonb_typeof(v_config_entry.value) not in ('string', 'number', 'boolean')
        or (pg_catalog.jsonb_typeof(v_config_entry.value) = 'string' and pg_catalog.char_length(v_config_entry.value #>> '{}') > 120)
        or (pg_catalog.jsonb_typeof(v_config_entry.value) = 'number' and pg_catalog.abs((v_config_entry.value #>> '{}')::numeric) > 1000000)
      then
        raise exception 'INVALID_EXPERIMENT_CONFIG';
      end if;
    end loop;
    v_weight_total := v_weight_total + (v_variant ->> 'weightBps')::integer;
  end loop;
  if v_weight_total <> 10000 then raise exception 'INVALID_EXPERIMENT_WEIGHTS'; end if;
end;
$$;

revoke all on function private.assert_gameplay_experiment_definition(jsonb) from public, anon, authenticated, service_role;

create or replace function public.ingest_gameplay_analytics_batch(
  p_batch_id text,
  p_schema_version smallint,
  p_created_at timestamptz,
  p_aggregates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aggregate jsonb;
  v_metric_name text;
  v_metric_value bigint;
  v_metric_total bigint;
  v_experiment_fields integer;
  v_digest text;
  v_existing_digest text;
  v_existing_count integer;
  v_inserted boolean;
  v_row_count integer := 0;
  v_window_start timestamptz;
begin
  if p_batch_id is null or p_batch_id !~ '^ga_[a-f0-9]{32,64}$'
    or p_schema_version <> 1
    or p_created_at is null
    or p_aggregates is null
    or pg_catalog.jsonb_typeof(p_aggregates) <> 'array'
    or pg_catalog.jsonb_array_length(p_aggregates) not between 1 and 1000
  then
    raise exception 'INVALID_GAMEPLAY_ANALYTICS_BATCH';
  end if;

  v_digest := pg_catalog.md5(
    p_schema_version::text || '|' || extract(epoch from p_created_at)::text || '|' || p_aggregates::text
  );
  insert into private.gameplay_analytics_batches (
    batch_id, schema_version, created_at, aggregate_count, payload_digest
  ) values (
    p_batch_id, p_schema_version, p_created_at, pg_catalog.jsonb_array_length(p_aggregates), v_digest
  ) on conflict (batch_id) do nothing
  returning true into v_inserted;

  if not coalesce(v_inserted, false) then
    select payload_digest, aggregate_count
      into v_existing_digest, v_existing_count
      from private.gameplay_analytics_batches
      where batch_id = p_batch_id;
    if v_existing_digest is distinct from v_digest then raise exception 'GAMEPLAY_ANALYTICS_BATCH_CONFLICT'; end if;
    return pg_catalog.jsonb_build_object('inserted', false, 'rows', v_existing_count);
  end if;

  for v_aggregate in select value from pg_catalog.jsonb_array_elements(p_aggregates) loop
    if pg_catalog.jsonb_typeof(v_aggregate) <> 'object'
      or not v_aggregate ?& array[
        'windowStart', 'missionSlug', 'mapVersion', 'buildId', 'phase',
        'experimentId', 'experimentRevision', 'variantId', 'cellX', 'cellZ',
        'sampleCount', 'entryCount', 'dangerSampleCount', 'objectiveInteractionCount',
        'downedCount', 'stuckRecoveryCount', 'clientErrorCount',
        'webglContextLostCount', 'assetLoadFailedCount', 'uncaughtErrorCount',
        'unhandledRejectionCount', 'frameStallCount', 'snapshotDesyncCount',
        'missionStartCount', 'missionSuccessCount', 'missionFailureCount'
      ]
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_aggregate)) <> 26
      or exists (
        select 1 from pg_catalog.jsonb_object_keys(v_aggregate) as keys(key)
        where keys.key not in (
          'windowStart', 'missionSlug', 'mapVersion', 'buildId', 'phase',
          'experimentId', 'experimentRevision', 'variantId', 'cellX', 'cellZ',
          'sampleCount', 'entryCount', 'dangerSampleCount', 'objectiveInteractionCount',
          'downedCount', 'stuckRecoveryCount', 'clientErrorCount',
          'webglContextLostCount', 'assetLoadFailedCount', 'uncaughtErrorCount',
          'unhandledRejectionCount', 'frameStallCount', 'snapshotDesyncCount',
          'missionStartCount', 'missionSuccessCount', 'missionFailureCount'
        )
      )
    then
      raise exception 'INVALID_GAMEPLAY_ANALYTICS_FIELDS';
    end if;

    if v_aggregate ->> 'windowStart' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
      or v_aggregate ->> 'missionSlug' !~ '^[a-z0-9]+([.-][a-z0-9]+)*$'
      or pg_catalog.char_length(v_aggregate ->> 'missionSlug') > 60
      or v_aggregate ->> 'mapVersion' !~ '^[a-z0-9][a-z0-9._:-]*$'
      or pg_catalog.char_length(v_aggregate ->> 'mapVersion') > 64
      or v_aggregate ->> 'buildId' !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
      or pg_catalog.char_length(v_aggregate ->> 'buildId') > 80
      or v_aggregate ->> 'phase' !~ '^[a-z0-9]+([.-][a-z0-9]+)*$'
      or pg_catalog.char_length(v_aggregate ->> 'phase') > 32
      or v_aggregate ->> 'cellX' !~ '^-?[0-9]{1,3}$'
      or (v_aggregate ->> 'cellX')::integer not between -128 and 128
      or v_aggregate ->> 'cellZ' !~ '^-?[0-9]{1,3}$'
      or (v_aggregate ->> 'cellZ')::integer not between -128 and 128
    then
      raise exception 'INVALID_GAMEPLAY_ANALYTICS_DIMENSION';
    end if;

    v_window_start := (v_aggregate ->> 'windowStart')::timestamptz;
    if (extract(epoch from v_window_start)::bigint % 300) <> 0 then raise exception 'INVALID_GAMEPLAY_ANALYTICS_WINDOW'; end if;

    v_experiment_fields := (case when v_aggregate ->> 'experimentId' is null then 0 else 1 end)
      + (case when v_aggregate ->> 'experimentRevision' is null then 0 else 1 end)
      + (case when v_aggregate ->> 'variantId' is null then 0 else 1 end);
    if v_experiment_fields not in (0, 3) then raise exception 'INVALID_GAMEPLAY_ANALYTICS_EXPERIMENT'; end if;
    if v_experiment_fields = 3 and (
      v_aggregate ->> 'experimentId' !~ '^[a-z0-9]+([.-][a-z0-9]+)*$'
      or pg_catalog.char_length(v_aggregate ->> 'experimentId') > 60
      or v_aggregate ->> 'experimentRevision' !~ '^[0-9]{1,7}$'
      or (v_aggregate ->> 'experimentRevision')::integer not between 1 and 1000000
      or v_aggregate ->> 'variantId' !~ '^[a-z0-9]+([.-][a-z0-9]+)*$'
      or pg_catalog.char_length(v_aggregate ->> 'variantId') > 40
    ) then
      raise exception 'INVALID_GAMEPLAY_ANALYTICS_EXPERIMENT';
    end if;

    v_metric_total := 0;
    foreach v_metric_name in array array[
      'sampleCount', 'entryCount', 'dangerSampleCount', 'objectiveInteractionCount',
      'downedCount', 'stuckRecoveryCount', 'clientErrorCount',
      'webglContextLostCount', 'assetLoadFailedCount', 'uncaughtErrorCount',
      'unhandledRejectionCount', 'frameStallCount', 'snapshotDesyncCount',
      'missionStartCount', 'missionSuccessCount', 'missionFailureCount'
    ] loop
      if v_aggregate ->> v_metric_name !~ '^[0-9]{1,10}$' then raise exception 'INVALID_GAMEPLAY_ANALYTICS_METRIC'; end if;
      v_metric_value := (v_aggregate ->> v_metric_name)::bigint;
      if v_metric_value > 1000000000 then raise exception 'INVALID_GAMEPLAY_ANALYTICS_METRIC'; end if;
      v_metric_total := v_metric_total + v_metric_value;
    end loop;
    if v_metric_total = 0 or (v_aggregate ->> 'dangerSampleCount')::bigint > (v_aggregate ->> 'sampleCount')::bigint then
      raise exception 'INVALID_GAMEPLAY_ANALYTICS_METRIC';
    end if;

    insert into private.gameplay_cell_aggregates (
      batch_id, window_start, mission_slug, map_version, build_id, phase,
      experiment_id, experiment_revision, variant_id, cell_x, cell_z,
      sample_count, entry_count, danger_sample_count, objective_interaction_count,
      downed_count, stuck_recovery_count, client_error_count,
      webgl_context_lost_count, asset_load_failed_count, uncaught_error_count,
      unhandled_rejection_count, frame_stall_count, snapshot_desync_count,
      mission_start_count, mission_success_count, mission_failure_count
    ) values (
      p_batch_id,
      v_window_start,
      v_aggregate ->> 'missionSlug',
      v_aggregate ->> 'mapVersion',
      v_aggregate ->> 'buildId',
      v_aggregate ->> 'phase',
      coalesce(v_aggregate ->> 'experimentId', ''),
      coalesce((v_aggregate ->> 'experimentRevision')::integer, 0),
      coalesce(v_aggregate ->> 'variantId', ''),
      (v_aggregate ->> 'cellX')::smallint,
      (v_aggregate ->> 'cellZ')::smallint,
      (v_aggregate ->> 'sampleCount')::bigint,
      (v_aggregate ->> 'entryCount')::bigint,
      (v_aggregate ->> 'dangerSampleCount')::bigint,
      (v_aggregate ->> 'objectiveInteractionCount')::bigint,
      (v_aggregate ->> 'downedCount')::bigint,
      (v_aggregate ->> 'stuckRecoveryCount')::bigint,
      (v_aggregate ->> 'clientErrorCount')::bigint,
      (v_aggregate ->> 'webglContextLostCount')::bigint,
      (v_aggregate ->> 'assetLoadFailedCount')::bigint,
      (v_aggregate ->> 'uncaughtErrorCount')::bigint,
      (v_aggregate ->> 'unhandledRejectionCount')::bigint,
      (v_aggregate ->> 'frameStallCount')::bigint,
      (v_aggregate ->> 'snapshotDesyncCount')::bigint,
      (v_aggregate ->> 'missionStartCount')::bigint,
      (v_aggregate ->> 'missionSuccessCount')::bigint,
      (v_aggregate ->> 'missionFailureCount')::bigint
    );
    v_row_count := v_row_count + 1;
  end loop;
  return pg_catalog.jsonb_build_object('inserted', true, 'rows', v_row_count);
end;
$$;

create or replace function public.upsert_gameplay_experiment(
  p_definition jsonb,
  p_status text,
  p_starts_at timestamptz,
  p_ends_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_gameplay_experiment_definition(p_definition);
  if p_status not in ('draft', 'active', 'paused', 'complete') or p_starts_at is null or (p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise exception 'INVALID_EXPERIMENT_SCHEDULE';
  end if;
  if exists (
    select 1
    from private.gameplay_experiments
    where experiment_id = p_definition ->> 'id'
      and revision = (p_definition ->> 'revision')::integer
      and definition <> p_definition
  ) then
    raise exception 'EXPERIMENT_REVISION_IMMUTABLE';
  end if;
  if p_status = 'active' then
    update private.gameplay_experiments
      set status = 'paused', updated_at = pg_catalog.clock_timestamp()
      where experiment_id = p_definition ->> 'id'
        and revision <> (p_definition ->> 'revision')::integer
        and status = 'active';
  end if;
  insert into private.gameplay_experiments (
    experiment_id, revision, definition, status, starts_at, ends_at
  ) values (
    p_definition ->> 'id',
    (p_definition ->> 'revision')::integer,
    p_definition,
    p_status,
    p_starts_at,
    p_ends_at
  ) on conflict (experiment_id, revision) do update set
    status = excluded.status,
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at,
    updated_at = pg_catalog.clock_timestamp();
  return p_definition;
end;
$$;

create or replace function public.get_active_gameplay_experiments(p_at timestamptz default pg_catalog.clock_timestamp())
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_agg(definition order by experiment_id, revision), '[]'::jsonb)
  from private.gameplay_experiments
  where status = 'active'
    and starts_at <= p_at
    and (ends_at is null or ends_at > p_at);
$$;

create or replace function public.get_gameplay_analytics_report(
  p_since timestamptz,
  p_until timestamptz,
  p_limit integer default 1000
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if p_since is null or p_until is null or p_until <= p_since or p_until - p_since > interval '90 days' or p_limit not between 1 and 5000 then
    raise exception 'INVALID_GAMEPLAY_ANALYTICS_REPORT_RANGE';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(report_rows)), '[]'::jsonb)
    into v_rows
    from (
      select
        window_start as "windowStart",
        mission_slug as "missionSlug",
        map_version as "mapVersion",
        build_id as "buildId",
        phase,
        nullif(experiment_id, '') as "experimentId",
        nullif(experiment_revision, 0) as "experimentRevision",
        nullif(variant_id, '') as "variantId",
        cell_x as "cellX",
        cell_z as "cellZ",
        pg_catalog.sum(sample_count) as "sampleCount",
        pg_catalog.sum(entry_count) as "entryCount",
        pg_catalog.sum(danger_sample_count) as "dangerSampleCount",
        pg_catalog.sum(objective_interaction_count) as "objectiveInteractionCount",
        pg_catalog.sum(downed_count) as "downedCount",
        pg_catalog.sum(stuck_recovery_count) as "stuckRecoveryCount",
        pg_catalog.sum(client_error_count) as "clientErrorCount",
        pg_catalog.sum(webgl_context_lost_count) as "webglContextLostCount",
        pg_catalog.sum(asset_load_failed_count) as "assetLoadFailedCount",
        pg_catalog.sum(uncaught_error_count) as "uncaughtErrorCount",
        pg_catalog.sum(unhandled_rejection_count) as "unhandledRejectionCount",
        pg_catalog.sum(frame_stall_count) as "frameStallCount",
        pg_catalog.sum(snapshot_desync_count) as "snapshotDesyncCount",
        pg_catalog.sum(mission_start_count) as "missionStartCount",
        pg_catalog.sum(mission_success_count) as "missionSuccessCount",
        pg_catalog.sum(mission_failure_count) as "missionFailureCount"
      from private.gameplay_cell_aggregates
      where window_start >= p_since and window_start < p_until
      group by window_start, mission_slug, map_version, build_id, phase,
        experiment_id, experiment_revision, variant_id, cell_x, cell_z
      order by pg_catalog.sum(sample_count) desc,
        pg_catalog.sum(client_error_count + stuck_recovery_count) desc,
        window_start desc
      limit p_limit
    ) report_rows;
  return pg_catalog.jsonb_build_object('since', p_since, 'until', p_until, 'rows', v_rows);
end;
$$;

create or replace function public.prune_gameplay_analytics(p_before timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_before is null or p_before > pg_catalog.clock_timestamp() - interval '7 days' then
    raise exception 'INVALID_GAMEPLAY_ANALYTICS_RETENTION_BOUNDARY';
  end if;
  delete from private.gameplay_analytics_batches where received_at < p_before;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.ingest_gameplay_analytics_batch(text, smallint, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.upsert_gameplay_experiment(jsonb, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.get_active_gameplay_experiments(timestamptz) from public, anon, authenticated;
revoke all on function public.get_gameplay_analytics_report(timestamptz, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.prune_gameplay_analytics(timestamptz) from public, anon, authenticated;

grant execute on function public.ingest_gameplay_analytics_batch(text, smallint, timestamptz, jsonb) to service_role;
grant execute on function public.upsert_gameplay_experiment(jsonb, text, timestamptz, timestamptz) to service_role;
grant execute on function public.get_active_gameplay_experiments(timestamptz) to service_role;
grant execute on function public.get_gameplay_analytics_report(timestamptz, timestamptz, integer) to service_role;
grant execute on function public.prune_gameplay_analytics(timestamptz) to service_role;

comment on table private.gameplay_analytics_batches is
  'Idempotency ledger for privacy-safe five-minute gameplay aggregate batches.';
comment on table private.gameplay_cell_aggregates is
  'Coarse 8m cells and fixed counters only; never player ids, room codes, fingerprints, or raw movement paths.';
comment on table private.gameplay_experiments is
  'Versioned room-scoped experiment definitions; room assignments are deterministic and are never persisted.';
