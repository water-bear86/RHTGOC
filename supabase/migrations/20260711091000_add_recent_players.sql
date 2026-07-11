create table public.recent_band_players (
  owner_id uuid not null references auth.users(id) on delete cascade,
  other_id uuid not null references auth.users(id) on delete cascade,
  last_played_at timestamptz not null default now(),
  missions_together integer not null default 1 check (missions_together > 0),
  primary key (owner_id, other_id),
  check (owner_id <> other_id)
);

create table public.social_mission_events (
  mission_id uuid primary key,
  recorded_at timestamptz not null default now(),
  participant_count integer not null check (participant_count between 2 and 4)
);

alter table public.recent_band_players enable row level security;
alter table public.social_mission_events enable row level security;
revoke all on table public.recent_band_players, public.social_mission_events from public, anon, authenticated;
grant select on table public.recent_band_players to authenticated;
grant all on table public.recent_band_players, public.social_mission_events to service_role;
create policy "Players see their recent bandmates" on public.recent_band_players for select to authenticated using (owner_id=auth.uid());

drop policy "Own profile and accepted friends are visible" on public.player_social_profiles;
create policy "Trusted social profiles are visible" on public.player_social_profiles for select to authenticated using (
  user_id=auth.uid()
  or exists (select 1 from public.player_friendships friendship where friendship.status='accepted' and friendship.user_low in (auth.uid(),player_social_profiles.user_id) and friendship.user_high in (auth.uid(),player_social_profiles.user_id))
  or exists (select 1 from public.recent_band_players recent where recent.owner_id=auth.uid() and recent.other_id=player_social_profiles.user_id)
);

create or replace function public.record_recent_band_players(p_mission_id uuid, p_user_ids uuid[])
returns boolean language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare owner uuid; other uuid; inserted integer;
begin
  if cardinality(p_user_ids) not between 2 and 4 or cardinality(p_user_ids) <> cardinality(array(select distinct value from unnest(p_user_ids) value)) then raise exception 'INVALID_RECENT_PARTICIPANTS'; end if;
  insert into public.social_mission_events(mission_id,participant_count) values(p_mission_id,cardinality(p_user_ids)) on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted=0 then return false; end if;
  foreach owner in array p_user_ids loop
    foreach other in array p_user_ids loop
      if owner<>other and not exists (select 1 from public.player_blocks where (blocker_id=owner and blocked_id=other) or (blocker_id=other and blocked_id=owner)) then
        insert into public.recent_band_players(owner_id,other_id) values(owner,other)
        on conflict(owner_id,other_id) do update set last_played_at=now(),missions_together=public.recent_band_players.missions_together+1;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

revoke all on function public.record_recent_band_players(uuid,uuid[]) from public, anon, authenticated;
grant execute on function public.record_recent_band_players(uuid,uuid[]) to service_role;
