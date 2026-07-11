-- Run only against a temporary project restored from a production backup.
-- psql -v restore_drill_user_id='<auth.users uuid>' -f tools/supabase-restore-drill.sql "$RESTORED_DATABASE_URL"
\set ON_ERROR_STOP on
begin;
select set_config('app.restore_drill_user_id', :'restore_drill_user_id', false);

do $$
declare
  drill_user uuid := current_setting('app.restore_drill_user_id')::uuid;
  drill_band uuid;
  drill_mission uuid := gen_random_uuid();
  first_grant boolean;
  duplicate_grant boolean;
begin
  insert into public.merry_bands (name, banner_id, created_by)
  values ('Restore Drill Band', 'oak', drill_user)
  returning id into drill_band;

  insert into public.merry_band_members (band_id, user_id, membership_role, hero_role)
  values (drill_band, drill_user, 'leader', 'robin');

  select public.apply_band_mission_reward(
    drill_band,
    drill_mission,
    'tax-cart',
    12345,
    '{"score":8000,"grade":"A"}'::jsonb,
    'granary',
    100
  ) into first_grant;

  select public.apply_band_mission_reward(
    drill_band,
    drill_mission,
    'tax-cart',
    12345,
    '{"score":8000,"grade":"A"}'::jsonb,
    'granary',
    100
  ) into duplicate_grant;

  if first_grant is not true or duplicate_grant is not false then
    raise exception 'Restore drill idempotency assertion failed';
  end if;
  if (select count(*) from public.band_audit_log where band_id = drill_band) < 3 then
    raise exception 'Restore drill audit continuity assertion failed';
  end if;
end;
$$;

rollback;
