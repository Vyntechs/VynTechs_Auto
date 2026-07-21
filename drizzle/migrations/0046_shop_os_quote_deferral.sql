alter table public.ticket_jobs
  drop constraint ticket_jobs_approval_state_valid,
  add constraint ticket_jobs_approval_state_valid
    check (approval_state in ('pending_quote', 'quote_ready', 'sent', 'approved', 'declined', 'deferred'));

alter table public.quote_events
  drop constraint quote_events_kind_valid,
  drop constraint quote_events_decision_job_consistent,
  add constraint quote_events_kind_valid
    check (kind in ('sent', 'delivered', 'viewed', 'approved', 'declined', 'deferred', 'question')),
  add constraint quote_events_decision_job_consistent
    check (kind not in ('approved', 'declined', 'deferred') or job_id is not null),
  add constraint quote_events_deferred_reason_consistent
    check ((kind = 'deferred' and char_length(body) between 1 and 500)
      or kind <> 'deferred');
