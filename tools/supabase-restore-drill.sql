-- Run only against a temporary project restored from a production backup.
-- psql -f tools/supabase-restore-drill.sql "$RESTORED_DATABASE_URL"
\set ON_ERROR_STOP on
begin;

do $$
declare
  drill_user uuid := gen_random_uuid();
  drill_band uuid;
  drill_mission uuid := gen_random_uuid();
  failed_mission uuid := gen_random_uuid();
  restored_band jsonb;
  first_write jsonb;
  duplicate_write jsonb;
  failed_write jsonb;
begin
  insert into auth.users(id) values(drill_user);

  restored_band := public.ensure_merry_band(drill_user,'Restore Drill','robin');
  drill_band := (restored_band ->> 'id')::uuid;

  select public.record_band_mission_outcome(
    drill_band,
    drill_user,
    drill_mission,
    'peoples-purse',
    12345,
    'succeeded',
    '{"score":8000,"grade":"A"}'::jsonb,
    'granary',
    100
  ) into first_write;

  select public.record_band_mission_outcome(
    drill_band,
    drill_user,
    drill_mission,
    'peoples-purse',
    12345,
    'succeeded',
    '{"score":8000,"grade":"A"}'::jsonb,
    'granary',
    100
  ) into duplicate_write;

  select public.record_band_mission_outcome(
    drill_band,
    drill_user,
    failed_mission,
    'prison-wagon',
    54321,
    'failed',
    '{"score":1200,"grade":"C"}'::jsonb,
    null,
    0
  ) into failed_write;

  if (first_write ->> 'recorded')::boolean is not true
    or (first_write ->> 'progressed')::boolean is not true
    or (duplicate_write ->> 'recorded')::boolean is not false
    or (duplicate_write ->> 'progressed')::boolean is not false then
    raise exception 'Restore drill idempotency assertion failed';
  end if;
  if (first_write #>> '{band,village,granary}')::integer <> 1
    or (first_write #>> '{band,camp,workbench}')::integer <> 1
    or (first_write #>> '{band,missionCount}')::integer <> 1 then
    raise exception 'Restore drill projection assertion failed';
  end if;
  if (failed_write ->> 'recorded')::boolean is not true
    or (failed_write ->> 'progressed')::boolean is not false
    or (failed_write #>> '{band,village,granary}')::integer <> 1
    or (failed_write #>> '{band,camp,workbench}')::integer <> 1
    or (failed_write #>> '{band,missionCount}')::integer <> 2 then
    raise exception 'Restore drill failed-mission history assertion failed';
  end if;
  if (select count(*) from public.band_audit_log where band_id = drill_band) < 3 then
    raise exception 'Restore drill audit continuity assertion failed';
  end if;
  if exists(select 1 from public.band_audit_log where band_id = drill_band and actor_user_id is distinct from drill_user) then
    raise exception 'Restore drill audit actor assertion failed';
  end if;
end;
$$;

rollback;
