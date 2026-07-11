create table if not exists public.public_hub_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('harassment','griefing','unsafe-name','cheating')),
  created_at timestamptz not null default now(),
  check (reporter_id <> target_id)
);

alter table public.public_hub_reports enable row level security;
revoke all on table public.public_hub_reports from public, anon, authenticated;
grant all on table public.public_hub_reports to service_role;
create index if not exists public_hub_reports_target_created_idx on public.public_hub_reports(target_id,created_at desc);

create or replace function public.get_public_hub_blocked_ids(p_user_id uuid)
returns uuid[] language sql stable security invoker set search_path = pg_catalog, public
as $$
  select coalesce(array_agg(case when blocker_id=p_user_id then blocked_id else blocker_id end), '{}'::uuid[])
  from public.player_blocks
  where p_user_id in (blocker_id,blocked_id);
$$;
revoke all on function public.get_public_hub_blocked_ids(uuid) from public,anon,authenticated;
grant execute on function public.get_public_hub_blocked_ids(uuid) to service_role;

create or replace function public.record_public_hub_report(p_reporter_id uuid, p_target_id uuid, p_reason text)
returns boolean language plpgsql security invoker set search_path = pg_catalog, public
as $$
begin
  if p_reporter_id=p_target_id or p_reason not in ('harassment','griefing','unsafe-name','cheating')
    or not exists(select 1 from auth.users where id=p_reporter_id)
    or not exists(select 1 from auth.users where id=p_target_id) then
    raise exception 'INVALID_HUB_REPORT';
  end if;
  insert into public.public_hub_reports(reporter_id,target_id,reason) values(p_reporter_id,p_target_id,p_reason);
  return true;
end;
$$;
revoke all on function public.record_public_hub_report(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_public_hub_report(uuid,uuid,text) to service_role;
