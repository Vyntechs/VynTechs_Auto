alter table ticket_jobs
  add column customer_supplied_parts_note text;
--> statement-breakpoint

alter table ticket_jobs
  add constraint ticket_jobs_customer_supplied_parts_note_valid check (
    customer_supplied_parts_note is null
    or (
      kind in ('repair', 'maintenance')
      and customer_supplied_parts_note = btrim(customer_supplied_parts_note)
      and length(customer_supplied_parts_note) between 1 and 500
    )
  );
--> statement-breakpoint

alter table canned_jobs drop constraint canned_jobs_kind_valid;
--> statement-breakpoint

alter table canned_jobs
  add constraint canned_jobs_kind_valid check (
    kind in ('diagnostic', 'repair', 'maintenance')
  );
