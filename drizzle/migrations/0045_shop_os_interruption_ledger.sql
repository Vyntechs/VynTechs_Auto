alter table public.ticket_jobs
  add column hold_kind text,
  add column hold_note text,
  add column hold_resume_status text,
  add column held_at timestamptz,
  add column held_by_profile_id uuid;

alter table public.ticket_jobs
  add constraint ticket_jobs_hold_kind_valid
    check (hold_kind is null or hold_kind in ('parts', 'customer', 'schedule', 'shop')),
  add constraint ticket_jobs_hold_note_bounded
    check (hold_note is null or char_length(hold_note) between 1 and 500),
  add constraint ticket_jobs_hold_resume_status_valid
    check (hold_resume_status is null or hold_resume_status in ('open', 'in_progress')),
  add constraint ticket_jobs_shop_holder_fk
    foreign key (shop_id, held_by_profile_id)
    references public.profiles (shop_id, id)
    on delete restrict;

create table public.ticket_activity (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  ticket_id uuid not null,
  job_id uuid,
  actor_profile_id uuid not null,
  kind text not null,
  request_key uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint ticket_activity_shop_ticket_fk
    foreign key (shop_id, ticket_id)
    references public.tickets (shop_id, id)
    on delete restrict,
  constraint ticket_activity_shop_job_fk
    foreign key (shop_id, ticket_id, job_id)
    references public.ticket_jobs (shop_id, ticket_id, id)
    on delete restrict,
  constraint ticket_activity_shop_actor_fk
    foreign key (shop_id, actor_profile_id)
    references public.profiles (shop_id, id)
    on delete restrict,
  constraint ticket_activity_kind_valid
    check (kind in (
      'work_paused', 'work_resumed', 'job_blocked', 'job_hold_resolved',
      'job_reassigned', 'job_handed_off', 'ticket_canceled', 'ticket_reopened'
    )),
  constraint ticket_activity_payload_object
    check (jsonb_typeof(payload) = 'object'),
  constraint ticket_activity_payload_bounded
    check (octet_length(payload::text) <= 12288),
  constraint ticket_activity_shop_id_uq unique (shop_id, id),
  constraint ticket_activity_shop_request_key_uq unique (shop_id, request_key)
);

create index ticket_activity_shop_ticket_created_idx
  on public.ticket_activity (shop_id, ticket_id, created_at desc, id desc);

create index ticket_activity_shop_job_created_idx
  on public.ticket_activity (shop_id, job_id, created_at desc, id desc)
  where job_id is not null;

-- Cover composite foreign keys so history writes and referenced-row changes
-- do not devolve into full-ledger scans as a shop's activity grows.
create index ticket_activity_shop_ticket_job_fk_idx
  on public.ticket_activity (shop_id, ticket_id, job_id);

create index ticket_activity_shop_actor_fk_idx
  on public.ticket_activity (shop_id, actor_profile_id);

create function public.ticket_activity_reject_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'ticket activity is append-only';
end;
$$;

create trigger ticket_activity_reject_update
  before update on public.ticket_activity
  for each row execute function public.ticket_activity_reject_mutation();

create trigger ticket_activity_reject_delete
  before delete on public.ticket_activity
  for each row execute function public.ticket_activity_reject_mutation();

revoke all privileges on table public.ticket_activity from public, anon, authenticated;
revoke execute on function public.ticket_activity_reject_mutation() from public, anon, authenticated;
