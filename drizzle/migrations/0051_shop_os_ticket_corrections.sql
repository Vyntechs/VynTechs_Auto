set local lock_timeout = '5s';
--> statement-breakpoint
set local statement_timeout = '15s';
--> statement-breakpoint
lock table public.ticket_activity in access exclusive mode;
--> statement-breakpoint
do $$
declare
  current_definition text;
  current_type "char";
  current_validated boolean;
  current_no_inherit boolean;
  expected_old constant text := 'CHECK ((kind = ANY (ARRAY[''work_paused''::text, ''work_resumed''::text, ''job_blocked''::text, ''job_hold_resolved''::text, ''job_reassigned''::text, ''job_handed_off''::text, ''ticket_canceled''::text, ''ticket_reopened''::text])))';
  expected_complete constant text := 'CHECK ((kind = ANY (ARRAY[''work_paused''::text, ''work_resumed''::text, ''job_blocked''::text, ''job_hold_resolved''::text, ''job_reassigned''::text, ''job_handed_off''::text, ''ticket_canceled''::text, ''ticket_reopened''::text, ''ticket_corrected''::text])))';
begin
  select
    constraint_row.contype,
    constraint_row.convalidated,
    constraint_row.connoinherit,
    pg_get_constraintdef(constraint_row.oid)
  into current_type, current_validated, current_no_inherit, current_definition
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.ticket_activity'::regclass
    and constraint_row.conname = 'ticket_activity_kind_valid';

  if current_type is distinct from 'c'
    or current_validated is distinct from true
    or current_no_inherit is distinct from false
    or current_definition is distinct from expected_old then
    raise exception 'ticket_activity_kind_valid is not in the exact pre-0051 state'
      using errcode = '55000';
  end if;

  alter table public.ticket_activity
    drop constraint ticket_activity_kind_valid;
  alter table public.ticket_activity
    add constraint ticket_activity_kind_valid check (kind in (
      'work_paused', 'work_resumed', 'job_blocked', 'job_hold_resolved',
      'job_reassigned', 'job_handed_off', 'ticket_canceled', 'ticket_reopened',
      'ticket_corrected'
    ));

  select
    constraint_row.contype,
    constraint_row.convalidated,
    constraint_row.connoinherit,
    pg_get_constraintdef(constraint_row.oid)
  into current_type, current_validated, current_no_inherit, current_definition
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.ticket_activity'::regclass
    and constraint_row.conname = 'ticket_activity_kind_valid';

  if current_type is distinct from 'c'
    or current_validated is distinct from true
    or current_no_inherit is distinct from false
    or current_definition is distinct from expected_complete then
    raise exception 'ticket_activity_kind_valid did not reach the exact post-0051 state'
      using errcode = '55000';
  end if;
end
$$;
