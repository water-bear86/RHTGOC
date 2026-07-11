alter table public.leaderboard_entries
  add column mission_version text not null default 'legacy'
    check (mission_version = 'legacy' or mission_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  add column mission_content_hash text not null default 'legacy'
    check (mission_content_hash = 'legacy' or mission_content_hash ~ '^fnv1a32:[a-f0-9]{8}$');

create or replace function private.hydrate_leaderboard_mission_identity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  new.mission_version := coalesce(nullif(new.score_breakdown ->> 'missionVersion', ''), new.mission_version);
  new.mission_content_hash := coalesce(nullif(new.score_breakdown ->> 'missionContentHash', ''), new.mission_content_hash);
  return new;
end;
$$;

revoke all on function private.hydrate_leaderboard_mission_identity() from public, anon, authenticated;

create trigger hydrate_leaderboard_mission_identity
before insert or update of score_breakdown on public.leaderboard_entries
for each row execute function private.hydrate_leaderboard_mission_identity();

create index leaderboard_entries_mission_version_idx
  on public.leaderboard_entries (mission_slug, mission_version, score desc)
  where verified = true;
