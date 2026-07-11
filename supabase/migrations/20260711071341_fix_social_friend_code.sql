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

revoke all on function public.register_social_profile(text) from public, anon;
grant execute on function public.register_social_profile(text) to authenticated;
