-- Production already received the interruption ledger before advisor review
-- identified that two composite foreign keys lacked covering indexes.
--
-- `0045` was later amended to create the same two indexes, so it now covers
-- them for any database built from an empty schema. That left this file
-- correct only for the databases that had already applied the original `0045`
-- — a rebuild from zero reached here and failed on `relation already exists`.
-- `if not exists` makes the file true for both histories: it still adds the
-- indexes to a database that lacks them, and is a no-op where `0045` supplied
-- them. It is not rewriting applied history; Drizzle decides what to run from
-- the journal timestamp, so a database past this point never revisits it.
create index if not exists ticket_activity_shop_ticket_job_fk_idx
  on public.ticket_activity (shop_id, ticket_id, job_id);

create index if not exists ticket_activity_shop_actor_fk_idx
  on public.ticket_activity (shop_id, actor_profile_id);
