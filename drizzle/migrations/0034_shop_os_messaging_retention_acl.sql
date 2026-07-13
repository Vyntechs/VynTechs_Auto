revoke all privileges
on table
  public.messaging_consent_events,
  public.messaging_consent_state,
  public.sms_suppressions,
  public.quote_sends,
  public.sms_log,
  public.notifications,
  public.messaging_deletion_requests,
  public.messaging_retention_holds
from public, anon, authenticated, service_role;
--> statement-breakpoint

grant select, insert, update, delete
on table
  public.messaging_consent_events,
  public.messaging_consent_state,
  public.sms_suppressions,
  public.quote_sends,
  public.sms_log,
  public.notifications,
  public.messaging_deletion_requests,
  public.messaging_retention_holds
to service_role;
--> statement-breakpoint

revoke all on function public.guard_quote_send_lifecycle()
  from public, anon, authenticated, service_role;
revoke all on function public.validate_quote_event_send_reference()
  from public, anon, authenticated, service_role;
revoke all on function public.reject_messaging_consent_event_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.require_messaging_compaction_completion()
  from public, anon, authenticated, service_role;
revoke all on function public.compact_messaging_consent_work_items(uuid, uuid, uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.guard_messaging_deletion_request_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.purge_expired_messaging_deletion_request(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.purge_expired_messaging_consent_event(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.purge_expired_messaging_retention_hold(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.serialize_messaging_retention_hold_target()
  from public, anon, authenticated, service_role;
--> statement-breakpoint

grant execute on function public.compact_messaging_consent_work_items(uuid, uuid, uuid[])
  to service_role;
grant execute on function public.purge_expired_messaging_deletion_request(uuid, uuid)
  to service_role;
grant execute on function public.purge_expired_messaging_consent_event(uuid, uuid)
  to service_role;
grant execute on function public.purge_expired_messaging_retention_hold(uuid, uuid)
  to service_role;
