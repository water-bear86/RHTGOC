create or replace function public.load_current_sherwood_campaign()
returns jsonb
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'snapshot', campaign.state,
    'processedEventIds', coalesce((
      select jsonb_agg(events.event_id order by events.sequence)
      from public.sherwood_campaign_events events
      where events.campaign_id = campaign.id
        and events.event_type in ('mission', 'contribution')
    ), '[]'::jsonb)
  )
  from public.sherwood_campaigns campaign
  where campaign.phase <> 'archived'
  order by campaign.updated_at desc
  limit 1;
$$;

revoke all on function public.load_current_sherwood_campaign() from public, anon, authenticated;
grant execute on function public.load_current_sherwood_campaign() to service_role;
