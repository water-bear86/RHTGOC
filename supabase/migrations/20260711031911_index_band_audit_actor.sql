create index band_audit_log_actor_idx
  on public.band_audit_log (actor_user_id, created_at desc)
  where actor_user_id is not null;
