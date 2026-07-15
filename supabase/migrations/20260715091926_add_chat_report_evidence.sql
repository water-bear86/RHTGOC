create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table private.public_hub_chat_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  target_id uuid not null references auth.users(id) on delete cascade,
  message_id uuid not null,
  instance_id uuid not null,
  reason text not null check (reason in ('harassment', 'griefing', 'unsafe-name', 'cheating')),
  message_text text not null check (
    pg_catalog.char_length(message_text) between 1 and 160
  ),
  message_sent_at timestamptz not null,
  context jsonb not null check (pg_catalog.jsonb_typeof(context) = 'object'),
  created_at timestamptz not null default pg_catalog.transaction_timestamp(),
  expires_at timestamptz not null default (pg_catalog.transaction_timestamp() + interval '30 days'),
  check (reporter_id <> target_id),
  check (expires_at > created_at and expires_at <= created_at + interval '30 days'),
  unique (reporter_id, message_id)
);

create index public_hub_chat_reports_target_created_idx
  on private.public_hub_chat_reports (target_id, created_at desc);
create index public_hub_chat_reports_expiry_idx
  on private.public_hub_chat_reports (expires_at);

alter table private.public_hub_chat_reports enable row level security;

revoke all on table private.public_hub_chat_reports from public, anon, authenticated, service_role;
revoke all on sequence private.public_hub_chat_reports_id_seq from public, anon, authenticated, service_role;
grant select, insert, delete on table private.public_hub_chat_reports to service_role;
grant usage, select on sequence private.public_hub_chat_reports_id_seq to service_role;

create or replace function public.record_public_hub_chat_report(
  p_reporter_id uuid,
  p_target_id uuid,
  p_message_id uuid,
  p_instance_id uuid,
  p_reason text,
  p_message_text text,
  p_message_sent_at timestamptz,
  p_context jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted boolean;
  v_surrounding_message jsonb;
begin
  if p_reporter_id is null
    or p_target_id is null
    or p_message_id is null
    or p_instance_id is null
    or p_reporter_id = p_target_id
    or p_reason not in ('harassment', 'griefing', 'unsafe-name', 'cheating')
    or p_message_text is null
    or pg_catalog.char_length(p_message_text) not between 1 and 160
    or p_message_sent_at is null
    or p_message_sent_at < pg_catalog.clock_timestamp() - interval '31 minutes'
    or p_message_sent_at > pg_catalog.clock_timestamp() + interval '1 minute'
    or p_context is null
    or pg_catalog.jsonb_typeof(p_context) <> 'object'
    or pg_catalog.octet_length(p_context::text) > 4096
    or not p_context ?& array['channel', 'senderParticipantId', 'senderDisplayName', 'senderCharacterId', 'surroundingMessages']
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_context)) <> 5
    or p_context ->> 'channel' <> 'camp'
    or p_context ->> 'senderParticipantId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or pg_catalog.char_length(p_context ->> 'senderDisplayName') not between 1 and 32
    or p_context ->> 'senderCharacterId' not in ('robin', 'marian', 'little-john', 'much')
    or pg_catalog.jsonb_typeof(p_context -> 'surroundingMessages') <> 'array'
    or pg_catalog.jsonb_array_length(p_context -> 'surroundingMessages') > 4
    or not exists (select 1 from auth.users where id = p_reporter_id)
    or not exists (select 1 from auth.users where id = p_target_id)
  then
    raise exception 'INVALID_HUB_CHAT_REPORT';
  end if;

  for v_surrounding_message in
    select value from pg_catalog.jsonb_array_elements(p_context -> 'surroundingMessages')
  loop
    if pg_catalog.jsonb_typeof(v_surrounding_message) <> 'object'
      or not v_surrounding_message ?& array['messageId', 'senderParticipantId', 'senderDisplayName', 'senderCharacterId', 'text', 'sentAt']
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(v_surrounding_message)) <> 6
      or v_surrounding_message ->> 'messageId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or v_surrounding_message ->> 'senderParticipantId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or pg_catalog.char_length(v_surrounding_message ->> 'senderDisplayName') not between 1 and 32
      or v_surrounding_message ->> 'senderCharacterId' not in ('robin', 'marian', 'little-john', 'much')
      or pg_catalog.char_length(v_surrounding_message ->> 'text') not between 1 and 160
      or v_surrounding_message ->> 'sentAt' !~ '^[0-9]{13}$'
    then
      raise exception 'INVALID_HUB_CHAT_REPORT_CONTEXT';
    end if;
  end loop;

  delete from private.public_hub_chat_reports
    where expires_at <= pg_catalog.clock_timestamp();

  insert into private.public_hub_chat_reports (
    reporter_id,
    target_id,
    message_id,
    instance_id,
    reason,
    message_text,
    message_sent_at,
    context
  ) values (
    p_reporter_id,
    p_target_id,
    p_message_id,
    p_instance_id,
    p_reason,
    p_message_text,
    p_message_sent_at,
    p_context
  ) on conflict (reporter_id, message_id) do nothing
  returning true into v_inserted;

  return pg_catalog.coalesce(v_inserted, false);
end;
$$;

create or replace function public.prune_public_hub_chat_reports(
  p_before timestamptz default pg_catalog.clock_timestamp()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from private.public_hub_chat_reports
    where expires_at <= pg_catalog.least(
      pg_catalog.coalesce(p_before, pg_catalog.clock_timestamp()),
      pg_catalog.clock_timestamp()
    );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.record_public_hub_chat_report(uuid, uuid, uuid, uuid, text, text, timestamptz, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.prune_public_hub_chat_reports(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_public_hub_chat_report(uuid, uuid, uuid, uuid, text, text, timestamptz, jsonb)
  to service_role;
grant execute on function public.prune_public_hub_chat_reports(timestamptz)
  to service_role;
