-- Production already received the interruption ledger before advisor review
-- identified that two composite foreign keys lacked covering indexes.
create index ticket_activity_shop_ticket_job_fk_idx
  on public.ticket_activity (shop_id, ticket_id, job_id);

create index ticket_activity_shop_actor_fk_idx
  on public.ticket_activity (shop_id, actor_profile_id);
