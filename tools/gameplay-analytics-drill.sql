-- Transactional assertion for the service-only gameplay analytics and experiment
-- RPC boundary. Every fixture and retention delete is rolled back.
begin;

do $privileges$
declare
  function_signature text;
  database_role text;
  private_table text;
begin
  foreach function_signature in array array[
    'public.ingest_gameplay_analytics_batch(text,smallint,timestamptz,jsonb)',
    'public.upsert_gameplay_experiment(jsonb,text,timestamptz,timestamptz)',
    'public.get_active_gameplay_experiments(timestamptz)',
    'public.get_gameplay_analytics_report(timestamptz,timestamptz,integer)',
    'public.prune_gameplay_analytics(timestamptz)'
  ] loop
    if pg_catalog.has_function_privilege('anon', function_signature, 'execute') then
      raise exception 'anon can execute service-only RPC: %', function_signature;
    end if;
    if pg_catalog.has_function_privilege('authenticated', function_signature, 'execute') then
      raise exception 'authenticated can execute service-only RPC: %', function_signature;
    end if;
    if not pg_catalog.has_function_privilege('service_role', function_signature, 'execute') then
      raise exception 'service_role cannot execute required RPC: %', function_signature;
    end if;
  end loop;

  foreach database_role in array array['anon', 'authenticated', 'service_role'] loop
    if pg_catalog.has_schema_privilege(database_role, 'private', 'usage') then
      raise exception '% has direct usage on the private analytics schema', database_role;
    end if;
    foreach private_table in array array[
      'private.gameplay_analytics_batches',
      'private.gameplay_cell_aggregates',
      'private.gameplay_experiments'
    ] loop
      if pg_catalog.has_table_privilege(database_role, private_table, 'select') then
        raise exception '% can directly select private analytics table: %', database_role, private_table;
      end if;
    end loop;
  end loop;
end;
$privileges$;

select pg_catalog.set_config(
  'sherwood.drill.analytics_suffix',
  pg_catalog.substr(pg_catalog.md5(pg_catalog.gen_random_uuid()::text), 1, 16),
  true
);
select pg_catalog.set_config(
  'sherwood.drill.analytics_batch_id',
  'ga_' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text),
  true
);
select pg_catalog.set_config(
  'sherwood.drill.analytics_invalid_batch_id',
  'ga_' || pg_catalog.md5(pg_catalog.gen_random_uuid()::text),
  true
);

set local role service_role;

do $drill$
declare
  suffix text := current_setting('sherwood.drill.analytics_suffix');
  experiment_id text := 'drill-' || suffix;
  batch_id text := current_setting('sherwood.drill.analytics_batch_id');
  invalid_batch_id text := current_setting('sherwood.drill.analytics_invalid_batch_id');
  window_start timestamptz := timestamptz '2099-01-01 00:00:00+00';
  created_at timestamptz := timestamptz '2099-01-01 00:01:00+00';
  definition jsonb;
  aggregate_row jsonb;
  aggregates jsonb;
  first_ingest jsonb;
  replay_ingest jsonb;
  active_experiments jsonb;
  report jsonb;
  report_row jsonb;
  pruned integer;
begin
  definition := pg_catalog.jsonb_build_object(
    'id', experiment_id,
    'revision', 1,
    'salt', 'drill-' || suffix,
    'allocationBps', 10000,
    'variants', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'id', 'control',
        'weightBps', 5000,
        'config', pg_catalog.jsonb_build_object('guardPressure', 1)
      ),
      pg_catalog.jsonb_build_object(
        'id', 'treatment',
        'weightBps', 5000,
        'config', pg_catalog.jsonb_build_object('guardPressure', 2)
      )
    )
  );

  if public.upsert_gameplay_experiment(
    definition,
    'active',
    timestamptz '2098-12-31 00:00:00+00',
    timestamptz '2099-01-02 00:00:00+00'
  ) <> definition then
    raise exception 'experiment upsert did not return the validated definition';
  end if;

  active_experiments := public.get_active_gameplay_experiments(window_start);
  if not exists (
    select 1
    from pg_catalog.jsonb_array_elements(active_experiments) as experiments(value)
    where experiments.value = definition
  ) then
    raise exception 'active experiment read did not contain the drill definition';
  end if;

  begin
    perform public.upsert_gameplay_experiment(
      definition || pg_catalog.jsonb_build_object('salt', 'changed-' || suffix),
      'active',
      timestamptz '2098-12-31 00:00:00+00',
      timestamptz '2099-01-02 00:00:00+00'
    );
    raise exception 'experiment upsert changed an existing revision definition';
  exception when others then
    if sqlerrm <> 'EXPERIMENT_REVISION_IMMUTABLE' then raise; end if;
  end;

  aggregate_row := pg_catalog.jsonb_build_object(
    'windowStart', pg_catalog.to_char(window_start at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'missionSlug', 'drill-mission',
    'mapVersion', 'drill-map:1',
    'buildId', 'drill-' || suffix,
    'phase', 'escape',
    'experimentId', experiment_id,
    'experimentRevision', 1,
    'variantId', 'treatment',
    'cellX', 3,
    'cellZ', -2,
    'sampleCount', 4,
    'entryCount', 1,
    'dangerSampleCount', 1,
    'objectiveInteractionCount', 2,
    'downedCount', 1,
    'stuckRecoveryCount', 1,
    'clientErrorCount', 2,
    'webglContextLostCount', 1,
    'assetLoadFailedCount', 0,
    'uncaughtErrorCount', 0,
    'unhandledRejectionCount', 0,
    'frameStallCount', 0,
    'snapshotDesyncCount', 1,
    'missionStartCount', 1,
    'missionSuccessCount', 1,
    'missionFailureCount', 0
  );
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(aggregate_row)) <> 26 then
    raise exception 'drill fixture is not the exact 26-key aggregate contract';
  end if;
  aggregates := pg_catalog.jsonb_build_array(aggregate_row);

  first_ingest := public.ingest_gameplay_analytics_batch(
    batch_id,
    1::smallint,
    created_at,
    aggregates
  );
  if first_ingest <> '{"inserted":true,"rows":1}'::jsonb then
    raise exception 'first analytics ingest returned an unexpected result: %', first_ingest;
  end if;

  replay_ingest := public.ingest_gameplay_analytics_batch(
    batch_id,
    1::smallint,
    created_at,
    aggregates
  );
  if replay_ingest <> '{"inserted":false,"rows":1}'::jsonb then
    raise exception 'analytics replay was not idempotent: %', replay_ingest;
  end if;

  begin
    perform public.ingest_gameplay_analytics_batch(
      invalid_batch_id,
      1::smallint,
      created_at,
      pg_catalog.jsonb_build_array(
        aggregate_row || pg_catalog.jsonb_build_object('playerId', pg_catalog.gen_random_uuid()::text)
      )
    );
    raise exception 'analytics ingest accepted a forbidden playerId field';
  exception when others then
    if sqlerrm <> 'INVALID_GAMEPLAY_ANALYTICS_FIELDS' then raise; end if;
  end;

  report := public.get_gameplay_analytics_report(
    window_start,
    window_start + interval '5 minutes',
    5000
  );
  select rows.value
    into report_row
    from pg_catalog.jsonb_array_elements(report -> 'rows') as rows(value)
    where rows.value ->> 'buildId' = 'drill-' || suffix
      and rows.value ->> 'experimentId' = experiment_id
      and rows.value ->> 'variantId' = 'treatment'
    limit 1;
  if report_row is null then
    raise exception 'analytics report did not contain the drill aggregate';
  end if;
  if (report_row ->> 'sampleCount')::bigint <> 4
    or (report_row ->> 'objectiveInteractionCount')::bigint <> 2
    or (report_row ->> 'snapshotDesyncCount')::bigint <> 1
    or (report_row ->> 'missionSuccessCount')::bigint <> 1
    or report_row ? 'playerId'
  then
    raise exception 'analytics report changed counters or exposed identity: %', report_row;
  end if;

  -- A boundary far before any realistic analytics row proves the retention RPC
  -- is callable without selecting rows for deletion. The outer transaction would
  -- roll back any deletion in every case.
  pruned := public.prune_gameplay_analytics(timestamptz '1900-01-01 00:00:00+00');
  if pruned < 0 then raise exception 'retention RPC returned an invalid row count'; end if;

  raise notice 'gameplay analytics drill passed';
end;
$drill$;

reset role;
rollback;
