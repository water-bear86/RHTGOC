create table public.player_social_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 20 and display_name ~ '^[A-Za-z0-9 _-]+$'),
  friend_code text not null unique check (friend_code ~ '^[A-Z2-9]{8}$'),
  presence_enabled boolean not null default false,
  presence_status text not null default 'offline' check (presence_status in ('offline', 'available', 'in-band')),
  active_room_code text check (active_room_code is null or active_room_code ~ '^[A-Z2-9]{6}$'),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.player_friendships (
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (user_low, user_high),
  check (user_low < user_high),
  check (requested_by in (user_low, user_high))
);

create table public.player_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.direct_band_invites (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  room_code text not null check (room_code ~ '^[A-Z2-9]{6}$'),
  character_hint text check (character_hint is null or character_hint in ('robin', 'marian', 'little-john', 'much')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'expired', 'revoked')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  responded_at timestamptz,
  check (sender_id <> recipient_id),
  check (expires_at > created_at)
);

create unique index direct_band_invites_pending_idx on public.direct_band_invites (sender_id, recipient_id, room_code) where status = 'pending';
create index direct_band_invites_recipient_idx on public.direct_band_invites (recipient_id, created_at desc) where status = 'pending';

create table public.social_rate_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('friend-request', 'band-invite')),
  created_at timestamptz not null default now()
);
create index social_rate_events_actor_time_idx on public.social_rate_events (actor_id, action, created_at desc);

alter table public.player_social_profiles enable row level security;
alter table public.player_friendships enable row level security;
alter table public.player_blocks enable row level security;
alter table public.direct_band_invites enable row level security;
alter table public.social_rate_events enable row level security;

revoke all on table public.player_social_profiles, public.player_friendships, public.player_blocks, public.direct_band_invites, public.social_rate_events from public, anon, authenticated;
grant select on table public.player_social_profiles, public.player_friendships, public.player_blocks, public.direct_band_invites to authenticated;
grant all on table public.player_social_profiles, public.player_friendships, public.player_blocks, public.direct_band_invites, public.social_rate_events to service_role;
grant usage, select on sequence public.social_rate_events_id_seq to service_role;

create policy "Own profile and accepted friends are visible" on public.player_social_profiles for select to authenticated using (
  user_id = auth.uid() or exists (
    select 1 from public.player_friendships friendship
    where friendship.status = 'accepted'
      and friendship.user_low in (auth.uid(), player_social_profiles.user_id)
      and friendship.user_high in (auth.uid(), player_social_profiles.user_id)
      and not exists (select 1 from public.player_blocks block where block.blocker_id in (auth.uid(), player_social_profiles.user_id) and block.blocked_id in (auth.uid(), player_social_profiles.user_id))
  )
);
create policy "Participants see friendships" on public.player_friendships for select to authenticated using (auth.uid() in (user_low, user_high));
create policy "Owners see their blocks" on public.player_blocks for select to authenticated using (blocker_id = auth.uid());
create policy "Invite participants see invites" on public.direct_band_invites for select to authenticated using (auth.uid() in (sender_id, recipient_id));

create or replace function public.register_social_profile(p_display_name text)
returns public.player_social_profiles
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  profile public.player_social_profiles;
  code text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_display_name is null or char_length(p_display_name) not between 1 and 20 or p_display_name !~ '^[A-Za-z0-9 _-]+$' then raise exception 'INVALID_DISPLAY_NAME'; end if;
  loop
    code := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 8));
    code := translate(code, '01', '23');
    exit when not exists (select 1 from public.player_social_profiles where friend_code = code);
  end loop;
  insert into public.player_social_profiles (user_id, display_name, friend_code)
  values (auth.uid(), p_display_name, code)
  on conflict (user_id) do update set display_name = excluded.display_name, updated_at = now()
  returning * into profile;
  return profile;
end;
$$;

create or replace function public.send_friend_request(p_friend_code text)
returns boolean language plpgsql security definer set search_path = pg_catalog, public
as $$
declare target_id uuid; low_id uuid; high_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select user_id into target_id from public.player_social_profiles where friend_code = upper(p_friend_code);
  if target_id is null or target_id = auth.uid() then raise exception 'INVALID_FRIEND_CODE'; end if;
  if exists (select 1 from public.player_blocks where (blocker_id=auth.uid() and blocked_id=target_id) or (blocker_id=target_id and blocked_id=auth.uid())) then raise exception 'BLOCKED'; end if;
  if (select count(*) from public.social_rate_events where actor_id=auth.uid() and action='friend-request' and created_at > now()-interval '1 hour') >= 10 then raise exception 'FRIEND_RATE_LIMIT'; end if;
  low_id := least(auth.uid(), target_id); high_id := greatest(auth.uid(), target_id);
  insert into public.player_friendships (user_low,user_high,requested_by,status) values (low_id,high_id,auth.uid(),'pending')
  on conflict (user_low,user_high) do update set requested_by=auth.uid(), status='pending', created_at=now(), responded_at=null
  where public.player_friendships.status='declined';
  insert into public.social_rate_events(actor_id,action) values(auth.uid(),'friend-request');
  return true;
end;
$$;

create or replace function public.respond_friend_request(p_other_user_id uuid, p_accept boolean)
returns boolean language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  update public.player_friendships set status=case when p_accept then 'accepted' else 'declined' end, responded_at=now()
  where user_low=least(auth.uid(),p_other_user_id) and user_high=greatest(auth.uid(),p_other_user_id)
    and status='pending' and requested_by<>auth.uid();
  return found;
end;
$$;

create or replace function public.remove_friend(p_other_user_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  delete from public.player_friendships where user_low=least(auth.uid(),p_other_user_id) and user_high=greatest(auth.uid(),p_other_user_id) and auth.uid() is not null;
  return found;
end;
$$;

create or replace function public.block_player(p_other_user_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or p_other_user_id=auth.uid() then raise exception 'INVALID_BLOCK'; end if;
  insert into public.player_blocks(blocker_id,blocked_id) values(auth.uid(),p_other_user_id) on conflict do nothing;
  delete from public.player_friendships where user_low=least(auth.uid(),p_other_user_id) and user_high=greatest(auth.uid(),p_other_user_id);
  update public.direct_band_invites set status='revoked', responded_at=now() where status='pending' and ((sender_id=auth.uid() and recipient_id=p_other_user_id) or (sender_id=p_other_user_id and recipient_id=auth.uid()));
  return true;
end;
$$;

create or replace function public.update_social_presence(p_enabled boolean, p_status text, p_room_code text default null)
returns boolean language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or p_status not in ('offline','available','in-band') or (p_room_code is not null and p_room_code !~ '^[A-Z2-9]{6}$') then raise exception 'INVALID_PRESENCE'; end if;
  update public.player_social_profiles set presence_enabled=p_enabled, presence_status=case when p_enabled then p_status else 'offline' end, active_room_code=case when p_enabled then p_room_code else null end, last_seen_at=now(), updated_at=now() where user_id=auth.uid();
  return found;
end;
$$;

create or replace function public.send_direct_band_invite(p_recipient_id uuid, p_room_code text, p_character_hint text default null)
returns uuid language plpgsql security definer set search_path = pg_catalog, public
as $$
declare invite_id uuid;
begin
  if auth.uid() is null or p_room_code !~ '^[A-Z2-9]{6}$' or (p_character_hint is not null and p_character_hint not in ('robin','marian','little-john','much')) then raise exception 'INVALID_INVITE'; end if;
  if not exists (select 1 from public.player_friendships where status='accepted' and user_low=least(auth.uid(),p_recipient_id) and user_high=greatest(auth.uid(),p_recipient_id)) then raise exception 'FRIEND_REQUIRED'; end if;
  if exists (select 1 from public.player_blocks where (blocker_id=auth.uid() and blocked_id=p_recipient_id) or (blocker_id=p_recipient_id and blocked_id=auth.uid())) then raise exception 'BLOCKED'; end if;
  if (select count(*) from public.social_rate_events where actor_id=auth.uid() and action='band-invite' and created_at>now()-interval '10 minutes') >= 5 then raise exception 'INVITE_RATE_LIMIT'; end if;
  update public.direct_band_invites set status='expired',responded_at=now() where status='pending' and expires_at<=now();
  insert into public.direct_band_invites(sender_id,recipient_id,room_code,character_hint) values(auth.uid(),p_recipient_id,p_room_code,p_character_hint)
  on conflict (sender_id,recipient_id,room_code) where status='pending' do update set expires_at=greatest(public.direct_band_invites.expires_at,now()+interval '15 minutes')
  returning id into invite_id;
  insert into public.social_rate_events(actor_id,action) values(auth.uid(),'band-invite');
  return invite_id;
end;
$$;

create or replace function public.respond_direct_band_invite(p_invite_id uuid, p_accept boolean)
returns text language plpgsql security definer set search_path = pg_catalog, public
as $$
declare code text;
begin
  update public.direct_band_invites set status=case when p_accept then 'accepted' else 'declined' end,responded_at=now()
  where id=p_invite_id and recipient_id=auth.uid() and status='pending' and expires_at>now()
  returning room_code into code;
  return code;
end;
$$;

do $$ declare signature regprocedure; begin
  for signature in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('register_social_profile','send_friend_request','respond_friend_request','remove_friend','block_player','update_social_presence','send_direct_band_invite','respond_direct_band_invite') loop
    execute format('revoke all on function %s from public, anon', signature);
    execute format('grant execute on function %s to authenticated', signature);
  end loop;
end $$;
