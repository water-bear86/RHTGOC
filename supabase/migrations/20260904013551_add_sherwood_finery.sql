-- Sherwood Finery: server-only cosmetic ownership and equipment.
-- Purchases reuse the Robinhood Chain token payment stack: the same verified
-- ERC-20 transfer to the shared treasury funds an item priced as a multiplier
-- of the base token access amount. Granting a purchase requires an on-chain
-- receipt that was not already used by the token pass or another vanity item.

create table public.player_vanity_owned (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null check (item_id in ('fox-plume', 'sherwood-fireflies', 'kings-ransom-trail')),
  granted_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

create table public.vanity_purchases (
  tx_hash text primary key check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null check (item_id in ('fox-plume', 'sherwood-fireflies', 'kings-ransom-trail')),
  wallet_address text not null check (wallet_address ~ '^0x[0-9A-Fa-f]{40}$'),
  chain_id bigint not null check (chain_id in (4663, 46630)),
  token_contract text not null check (token_contract ~ '^0x[0-9A-Fa-f]{40}$'),
  treasury_address text not null check (treasury_address ~ '^0x[0-9A-Fa-f]{40}$'),
  amount_base_units numeric(78, 0) not null check (amount_base_units > 0),
  paid_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index vanity_purchases_user_paid_idx
  on public.vanity_purchases (user_id, paid_at desc);

create table public.player_vanity_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  equipped_item_ids text[] not null default '{}'::text[] check (cardinality(equipped_item_ids) <= 3),
  updated_at timestamptz not null default now()
);

alter table public.player_vanity_owned enable row level security;
alter table public.vanity_purchases enable row level security;
alter table public.player_vanity_state enable row level security;

revoke all on table public.player_vanity_owned from public, anon, authenticated;
revoke all on table public.vanity_purchases from public, anon, authenticated;
revoke all on table public.player_vanity_state from public, anon, authenticated;
grant select, insert, update, delete on table public.player_vanity_owned to service_role;
grant select, insert on table public.vanity_purchases to service_role;
grant select, insert, update, delete on table public.player_vanity_state to service_role;

-- Records a server-verified vanity purchase. Rejects any transaction hash that
-- was already used by this ledger or by the token access pass ledger, so one
-- ERC-20 transfer can never grant more than one entitlement.
create or replace function public.record_vanity_purchase(
  p_user_id uuid,
  p_item_id text,
  p_tx_hash text,
  p_wallet_address text,
  p_chain_id bigint,
  p_token_contract text,
  p_treasury_address text,
  p_amount_base_units numeric,
  p_paid_at timestamptz
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_newly_granted boolean := false;
begin
  if p_amount_base_units <= 0 then
    raise exception 'VANITY_PAYMENT_INVALID_AMOUNT';
  end if;

  -- Both entitlement ledgers take this same transaction-hash lock before the
  -- cross-ledger replay check. Without it, simultaneous claims by two users
  -- could each observe the other ledger as empty and both commit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.lower(p_tx_hash), 0)
  );

  if exists (select 1 from public.vanity_purchases where tx_hash = p_tx_hash)
     or exists (select 1 from public.token_access_payments where tx_hash = p_tx_hash) then
    raise exception 'VANITY_PAYMENT_REPLAY';
  end if;

  insert into public.vanity_purchases (
    tx_hash, user_id, item_id, wallet_address, chain_id,
    token_contract, treasury_address, amount_base_units, paid_at
  ) values (
    p_tx_hash, p_user_id, p_item_id, p_wallet_address, p_chain_id,
    p_token_contract, p_treasury_address, p_amount_base_units, p_paid_at
  );

  insert into public.player_vanity_owned (user_id, item_id, granted_at)
  values (p_user_id, p_item_id, pg_catalog.now())
  on conflict (user_id, item_id) do nothing;
  v_newly_granted := found;

  return v_newly_granted;
end;
$$;

-- Replaces the equipped set only from items the player actually owns, with no
-- duplicate item and no more than three equipped cosmetics.
create or replace function public.set_vanity_equipped(
  p_user_id uuid,
  p_item_ids text[]
) returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_distinct_count integer;
  v_equipped text[];
begin
  if p_item_ids is null or pg_catalog.cardinality(p_item_ids) > 3 then
    raise exception 'VANITY_EQUIP_INVALID';
  end if;

  select pg_catalog.count(distinct id)
    into v_distinct_count
    from pg_catalog.unnest(p_item_ids) as candidate(id);
  if v_distinct_count <> pg_catalog.cardinality(p_item_ids) then
    raise exception 'VANITY_EQUIP_INVALID';
  end if;

  if exists (
    select 1
      from pg_catalog.unnest(p_item_ids) as candidate(item_id)
      where candidate.item_id not in ('fox-plume', 'sherwood-fireflies', 'kings-ransom-trail')
  ) then
    raise exception 'VANITY_EQUIP_INVALID';
  end if;

  if exists (
    select 1
      from pg_catalog.unnest(p_item_ids) as requested(item_id)
      left join public.player_vanity_owned owned
        on owned.user_id = p_user_id and owned.item_id = requested.item_id
      where owned.item_id is null
  ) then
    raise exception 'VANITY_ITEM_NOT_OWNED';
  end if;

  insert into public.player_vanity_state (user_id, equipped_item_ids, updated_at)
  values (p_user_id, p_item_ids, pg_catalog.now())
  on conflict (user_id) do update
    set equipped_item_ids = excluded.equipped_item_ids,
        updated_at = excluded.updated_at;

  select equipped_item_ids
    into v_equipped
    from public.player_vanity_state
    where user_id = p_user_id;
  return v_equipped;
end;
$$;

-- Harden the token pass claim with the same cross-ledger replay check so a
-- transaction hash claimed by the vanity shop cannot later claim a pass.
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

  -- Serialize this hash across both ledgers, then serialize expiry updates for
  -- the user so concurrent legitimate pass purchases extend deterministically.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.lower(p_tx_hash), 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 1)
  );

  if exists (select 1 from public.token_access_payments where tx_hash = p_tx_hash)
     or exists (select 1 from public.vanity_purchases where tx_hash = p_tx_hash) then
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

revoke execute on function public.record_vanity_purchase(uuid, text, text, text, bigint, text, text, numeric, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_vanity_purchase(uuid, text, text, text, bigint, text, text, numeric, timestamptz)
  to service_role;

revoke execute on function public.set_vanity_equipped(uuid, text[])
  from public, anon, authenticated;
grant execute on function public.set_vanity_equipped(uuid, text[])
  to service_role;

revoke execute on function public.record_token_access_payment(uuid, text, text, bigint, text, text, numeric, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.record_token_access_payment(uuid, text, text, bigint, text, text, numeric, timestamptz, integer)
  to service_role;

comment on table public.player_vanity_owned is
  'Server-only cosmetic ownership grants for Sherwood Finery.';
comment on table public.vanity_purchases is
  'Append-only verified vanity ERC-20 purchases with cross-ledger hash replay protection.';
comment on table public.player_vanity_state is
  'Server-only equipped Sherwood Finery cosmetics per player.';
