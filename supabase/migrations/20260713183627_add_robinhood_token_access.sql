create table public.player_token_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  access_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.token_access_payments (
  tx_hash text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_address text not null check (wallet_address ~ '^0x[0-9A-Fa-f]{40}$'),
  chain_id bigint not null check (chain_id in (4663, 46630)),
  token_contract text not null check (token_contract ~ '^0x[0-9A-Fa-f]{40}$'),
  treasury_address text not null check (treasury_address ~ '^0x[0-9A-Fa-f]{40}$'),
  amount_base_units numeric(78, 0) not null check (amount_base_units > 0),
  paid_at timestamptz not null,
  access_expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index token_access_payments_user_paid_idx
  on public.token_access_payments (user_id, paid_at desc);

alter table public.player_token_access enable row level security;
alter table public.token_access_payments enable row level security;

revoke all on table public.player_token_access from public, anon, authenticated;
revoke all on table public.token_access_payments from public, anon, authenticated;
grant select, insert, update on table public.player_token_access to service_role;
grant select, insert on table public.token_access_payments to service_role;

create or replace function public.record_token_access_payment(
  p_user_id uuid,
  p_tx_hash text,
  p_wallet_address text,
  p_chain_id bigint,
  p_token_contract text,
  p_treasury_address text,
  p_amount_base_units numeric,
  p_paid_at timestamptz,
  p_pass_days integer
) returns timestamptz
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current_expires_at timestamptz;
  v_access_expires_at timestamptz;
begin
  if p_pass_days < 1 or p_pass_days > 365 then
    raise exception 'TOKEN_PAYMENT_INVALID_PASS_DAYS';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text, 0));

  if exists (select 1 from public.token_access_payments where tx_hash = p_tx_hash) then
    raise exception 'TOKEN_PAYMENT_REPLAY';
  end if;

  select access_expires_at
    into v_current_expires_at
    from public.player_token_access
    where user_id = p_user_id
    for update;

  v_access_expires_at := greatest(
    pg_catalog.now(),
    coalesce(v_current_expires_at, pg_catalog.now())
  ) + pg_catalog.make_interval(days => p_pass_days);

  insert into public.token_access_payments (
    tx_hash, user_id, wallet_address, chain_id, token_contract,
    treasury_address, amount_base_units, paid_at, access_expires_at
  ) values (
    p_tx_hash, p_user_id, p_wallet_address, p_chain_id, p_token_contract,
    p_treasury_address, p_amount_base_units, p_paid_at, v_access_expires_at
  );

  insert into public.player_token_access (user_id, access_expires_at, updated_at)
  values (p_user_id, v_access_expires_at, pg_catalog.now())
  on conflict (user_id) do update
    set access_expires_at = excluded.access_expires_at,
        updated_at = excluded.updated_at;

  return v_access_expires_at;
end;
$$;

revoke execute on function public.record_token_access_payment(uuid, text, text, bigint, text, text, numeric, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.record_token_access_payment(uuid, text, text, bigint, text, text, numeric, timestamptz, integer)
  to service_role;

comment on table public.player_token_access is
  'Server-only current Robinhood Chain token-pass entitlement.';
comment on table public.token_access_payments is
  'Append-only verified ERC-20 payment ledger with transaction-hash replay protection.';
