alter table public.tickets
  add column projection_revision bigint not null default 0,
  add column continuity_revision bigint not null default 0,
  add column separate_from_ticket_id uuid,
  add column separate_reason text,
  add column separate_reason_note text,
  add column close_disposition text,
  add column close_note text,
  add column cancel_reason_code text;
--> statement-breakpoint

alter table public.ticket_jobs
  add column sequence_number integer,
  add column work_statement text,
  add column statement_source text,
  add column statement_review_state text,
  add column statement_confirmed_by_profile_id uuid,
  add column statement_confirmed_at timestamptz,
  add column when_started text,
  add column how_often text,
  add column diagnostic_authorized_cents bigint,
  add column diagnostic_authorization_note text,
  add column created_by_profile_id uuid,
  add column creator_provenance text,
  add column created_from_job_id uuid,
  add column revision bigint not null default 0,
  add column approved_authorization_fingerprint text,
  add column approved_approval_event_id uuid;
--> statement-breakpoint

alter table public.tickets
  add constraint tickets_projection_revision_nonnegative
    check (projection_revision >= 0) not valid,
  add constraint tickets_continuity_revision_nonnegative
    check (continuity_revision >= 0) not valid,
  add constraint tickets_separate_reason_valid
    check (
      separate_reason is null
      or separate_reason in (
        'warranty',
        'comeback',
        'different_payer',
        'internal_work',
        'future_or_scheduled_work',
        'fleet_split',
        'other'
      )
    ) not valid,
  add constraint tickets_separate_evidence_consistent
    check (
      (
        separate_from_ticket_id is null
        and separate_reason is null
        and separate_reason_note is null
      )
      or (
        separate_from_ticket_id is not null
        and separate_reason is not null
        and (
          separate_reason_note is null
          or (
            separate_reason_note = btrim(separate_reason_note)
            and char_length(separate_reason_note) between 1 and 2000
          )
        )
        and (separate_reason <> 'other' or separate_reason_note is not null)
      )
    ) not valid,
  add constraint tickets_separate_from_not_self
    check (separate_from_ticket_id is null or separate_from_ticket_id <> id) not valid,
  add constraint tickets_close_disposition_valid
    check (
      close_disposition is null
      or close_disposition in (
        'delivered',
        'customer_declined',
        'no_repair',
        'remote_quote_not_proceeding'
      )
    ) not valid,
  add constraint tickets_cancel_reason_code_valid
    check (
      cancel_reason_code is null
      or cancel_reason_code in (
        'duplicate_created',
        'customer_canceled_before_authorization',
        'administrative_error',
        'other'
      )
    ) not valid,
  add constraint tickets_canceled_reason_bounded
    check (
      cancel_reason_code is null
      or (
        (
          canceled_reason is null
          or (
            canceled_reason = btrim(canceled_reason)
            and char_length(canceled_reason) between 1 and 2000
          )
        )
        and (cancel_reason_code is distinct from 'other' or canceled_reason is not null)
      )
    ) not valid,
  add constraint tickets_close_note_bounded
    check (
      (
        close_note is null
        or (
          close_note = btrim(close_note)
          and char_length(close_note) between 1 and 2000
        )
      )
      and (close_disposition is distinct from 'no_repair' or close_note is not null)
    ) not valid,
  add constraint tickets_shop_separate_from_fk
    foreign key (shop_id, separate_from_ticket_id)
    references public.tickets (shop_id, id)
    on delete restrict
    not valid;
--> statement-breakpoint

create index tickets_shop_vehicle_status_idx
  on public.tickets (shop_id, vehicle_id, status);
create index tickets_shop_separate_from_idx
  on public.tickets (shop_id, separate_from_ticket_id)
  where separate_from_ticket_id is not null;
--> statement-breakpoint

alter table public.ticket_jobs
  add constraint ticket_jobs_sequence_positive
    check (sequence_number is null or sequence_number > 0) not valid,
  add constraint ticket_jobs_work_statement_bounded
    check (
      work_statement is null
      or (
        work_statement = btrim(work_statement)
        and char_length(work_statement) between 1 and 5000
      )
    ) not valid,
  add constraint ticket_jobs_statement_source_valid
    check (
      statement_source is null
      or statement_source in (
        'customer_concern',
        'customer_request',
        'technician_found',
        'advisor_added',
        'shop_internal',
        'legacy_migrated'
      )
    ) not valid,
  add constraint ticket_jobs_statement_review_state_valid
    check (
      statement_review_state is null
      or statement_review_state in ('confirmed', 'review_required')
    ) not valid,
  add constraint ticket_jobs_statement_truth_consistent
    check (
      (
        work_statement is null
        and statement_source is null
        and statement_review_state is null
      )
      or (
        work_statement is not null
        and statement_source is not null
        and statement_review_state is not null
      )
    ) not valid,
  add constraint ticket_jobs_statement_confirmation_consistent
    check (
      (
        work_statement is null
        and statement_source is null
        and statement_review_state is null
        and statement_confirmed_by_profile_id is null
        and statement_confirmed_at is null
      )
      or (
        work_statement is not null
        and statement_source = 'legacy_migrated'
        and statement_review_state in ('confirmed', 'review_required')
        and statement_confirmed_by_profile_id is null
        and statement_confirmed_at is null
      )
      or (
        work_statement is not null
        and statement_source <> 'legacy_migrated'
        and statement_review_state = 'confirmed'
        and (
          (
            statement_confirmed_by_profile_id is null
            and statement_confirmed_at is null
          )
          or (
            statement_confirmed_by_profile_id is not null
            and statement_confirmed_at is not null
          )
        )
      )
    ) not valid,
  add constraint ticket_jobs_context_bounded
    check (
      (
        when_started is null
        or (
          when_started = btrim(when_started)
          and char_length(when_started) between 1 and 1000
        )
      )
      and (
        how_often is null
        or (
          how_often = btrim(how_often)
          and char_length(how_often) between 1 and 1000
        )
      )
    ) not valid,
  add constraint ticket_jobs_diagnostic_authorization_consistent
    check (
      (diagnostic_authorized_cents is null or diagnostic_authorized_cents >= 0)
      and (
        diagnostic_authorization_note is null
        or (
          diagnostic_authorization_note = btrim(diagnostic_authorization_note)
          and char_length(diagnostic_authorization_note) between 1 and 2000
        )
      )
    ) not valid,
  add constraint ticket_jobs_creator_provenance_consistent
    check (
      (created_by_profile_id is null and creator_provenance is null)
      or (created_by_profile_id is not null and creator_provenance is not null)
    ) not valid,
  add constraint ticket_jobs_approved_fingerprint_valid
    check (
      approved_authorization_fingerprint is null
      or approved_authorization_fingerprint ~ '^v1:[0-9a-f]{64}$'
    ) not valid,
  add constraint ticket_jobs_revision_nonnegative
    check (revision >= 0) not valid,
  add constraint ticket_jobs_shop_creator_fk
    foreign key (shop_id, created_by_profile_id)
    references public.profiles (shop_id, id)
    on delete restrict
    not valid,
  add constraint ticket_jobs_shop_confirmer_fk
    foreign key (shop_id, statement_confirmed_by_profile_id)
    references public.profiles (shop_id, id)
    on delete restrict
    not valid,
  add constraint ticket_jobs_shop_ticket_created_from_fk
    foreign key (shop_id, ticket_id, created_from_job_id)
    references public.ticket_jobs (shop_id, ticket_id, id)
    on delete restrict
    not valid;
--> statement-breakpoint

create unique index ticket_jobs_shop_ticket_sequence_uq
  on public.ticket_jobs (shop_id, ticket_id, sequence_number)
  where sequence_number is not null;
create index ticket_jobs_shop_created_by_idx
  on public.ticket_jobs (shop_id, created_by_profile_id)
  where created_by_profile_id is not null;
create index ticket_jobs_shop_confirmed_by_idx
  on public.ticket_jobs (shop_id, statement_confirmed_by_profile_id)
  where statement_confirmed_by_profile_id is not null;
create index ticket_jobs_shop_ticket_created_from_idx
  on public.ticket_jobs (shop_id, ticket_id, created_from_job_id)
  where created_from_job_id is not null;
--> statement-breakpoint

create unique index quote_events_shop_ticket_job_id_uq
  on public.quote_events (shop_id, ticket_id, job_id, id);
--> statement-breakpoint

alter table public.ticket_jobs
  add constraint ticket_jobs_approved_approval_event_fk
    foreign key (shop_id, ticket_id, id, approved_approval_event_id)
    references public.quote_events (shop_id, ticket_id, job_id, id)
    on delete restrict
    not valid;
create index ticket_jobs_shop_ticket_approval_event_idx
  on public.ticket_jobs (shop_id, ticket_id, id, approved_approval_event_id)
  where approved_approval_event_id is not null;
--> statement-breakpoint

create or replace function public.guard_ticket_terminal_shape()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('closed', 'canceled') then
    if row(
      old.status,
      old.canceled_at,
      old.canceled_by_profile_id,
      old.canceled_reason,
      old.cancel_reason_code,
      old.delivered_at,
      old.delivered_by_profile_id,
      old.closed_at,
      old.closed_by_profile_id,
      old.close_disposition,
      old.close_note
    ) is distinct from row(
      new.status,
      new.canceled_at,
      new.canceled_by_profile_id,
      new.canceled_reason,
      new.cancel_reason_code,
      new.delivered_at,
      new.delivered_by_profile_id,
      new.closed_at,
      new.closed_by_profile_id,
      new.close_disposition,
      new.close_note
    ) then
      raise exception 'immutable_terminal_ticket' using errcode = '23514';
    end if;
  end if;

  if new.status = 'open' then
    if new.canceled_at is not null
      or new.canceled_by_profile_id is not null
      or new.canceled_reason is not null
      or new.cancel_reason_code is not null
      or new.delivered_at is not null
      or new.delivered_by_profile_id is not null
      or new.closed_at is not null
      or new.closed_by_profile_id is not null
      or new.close_disposition is not null
      or new.close_note is not null then
      raise exception 'invalid_ticket_terminal_shape' using errcode = '23514';
    end if;
  elsif new.status = 'closed' then
    if new.canceled_at is not null
      or new.canceled_by_profile_id is not null
      or new.canceled_reason is not null
      or new.cancel_reason_code is not null
      or new.closed_at is null
      or new.closed_by_profile_id is null
      or new.close_disposition is null
      or (
        new.close_disposition = 'delivered'
        and (new.delivered_at is null or new.delivered_by_profile_id is null)
      )
      or (
        new.close_disposition <> 'delivered'
        and (new.delivered_at is not null or new.delivered_by_profile_id is not null)
      ) then
      raise exception 'invalid_ticket_terminal_shape' using errcode = '23514';
    end if;
  elsif new.status = 'canceled' then
    if new.canceled_at is null
      or new.canceled_by_profile_id is null
      or new.cancel_reason_code is null
      or new.delivered_at is not null
      or new.delivered_by_profile_id is not null
      or new.closed_at is not null
      or new.closed_by_profile_id is not null
      or new.close_disposition is not null
      or new.close_note is not null then
      raise exception 'invalid_ticket_terminal_shape' using errcode = '23514';
    end if;
  else
    raise exception 'invalid_ticket_terminal_shape' using errcode = '23514';
  end if;

  return new;
end;
$$;
--> statement-breakpoint

create trigger tickets_terminal_shape_write
before insert or update of status, canceled_at, canceled_by_profile_id, canceled_reason, cancel_reason_code, delivered_at, delivered_by_profile_id, closed_at, closed_by_profile_id, close_disposition, close_note
on public.tickets
for each row execute function public.guard_ticket_terminal_shape();
--> statement-breakpoint

create or replace function public.guard_ticket_immutable_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.shop_id is distinct from new.shop_id
    or old.ticket_number is distinct from new.ticket_number
    or old.source is distinct from new.source
    or old.created_by_profile_id is distinct from new.created_by_profile_id
    or old.created_at is distinct from new.created_at
    or old.concern is distinct from new.concern
    or old.when_started is distinct from new.when_started
    or old.how_often is distinct from new.how_often
    or old.diagnostic_authorized_cents is distinct from new.diagnostic_authorized_cents
    or old.diagnostic_authorization_note is distinct from new.diagnostic_authorization_note
    or old.separate_from_ticket_id is distinct from new.separate_from_ticket_id
    or old.separate_reason is distinct from new.separate_reason
    or old.separate_reason_note is distinct from new.separate_reason_note then
    raise exception 'immutable_ticket_identity' using errcode = '23514';
  end if;

  if (new.customer_id is null) <> (new.vehicle_id is null) then
    raise exception 'immutable_ticket_identity' using errcode = '23514';
  end if;

  if row(old.customer_id, old.vehicle_id)
    is distinct from row(new.customer_id, new.vehicle_id) then
    if not (
      old.source = 'tech_quick'
      and old.customer_id is null
      and old.vehicle_id is null
      and new.customer_id is not null
      and new.vehicle_id is not null
    ) then
      raise exception 'immutable_ticket_identity' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
--> statement-breakpoint

create trigger tickets_immutable_identity_update
before update on public.tickets
for each row execute function public.guard_ticket_immutable_identity();
--> statement-breakpoint

create or replace function public.guard_ticket_job_immutable_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_creator_id uuid;
begin
  if tg_op = 'INSERT' then
    if (new.created_by_profile_id is null) <> (new.creator_provenance is null) then
      raise exception 'invalid_ticket_job_creator_provenance' using errcode = '23514';
    end if;
    if new.created_by_profile_id is not null and new.creator_provenance <> 'direct' then
      raise exception 'invalid_ticket_job_creator_provenance' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.id is distinct from new.id
    or old.shop_id is distinct from new.shop_id
    or old.ticket_id is distinct from new.ticket_id
    or old.created_at is distinct from new.created_at
    or old.created_from_job_id is distinct from new.created_from_job_id then
    raise exception 'immutable_ticket_job_identity' using errcode = '23514';
  end if;

  if old.sequence_number is distinct from new.sequence_number then
    if not (
      old.sequence_number is null
      and new.sequence_number is not null
      and new.sequence_number > 0
    ) then
      raise exception 'immutable_ticket_job_sequence' using errcode = '23514';
    end if;
  end if;

  if row(old.created_by_profile_id, old.creator_provenance)
    is distinct from row(new.created_by_profile_id, new.creator_provenance) then
    if old.created_by_profile_id is not null or old.creator_provenance is not null then
      raise exception 'immutable_ticket_job_creator' using errcode = '23514';
    end if;

    if new.created_by_profile_id is null
      or new.creator_provenance is distinct from 'ticket_creator_backfill' then
      raise exception 'invalid_ticket_job_creator_adoption' using errcode = '23514';
    end if;

    select t.created_by_profile_id
      into parent_creator_id
      from public.tickets t
      where t.shop_id = new.shop_id
        and t.id = new.ticket_id;

    if parent_creator_id is null
      or parent_creator_id is distinct from new.created_by_profile_id then
      raise exception 'invalid_ticket_job_creator_adoption' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;
--> statement-breakpoint

create trigger ticket_jobs_immutable_identity_update
before insert or update on public.ticket_jobs
for each row execute function public.guard_ticket_job_immutable_identity();
--> statement-breakpoint

create table public.ticket_mutation_receipts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  request_key uuid not null,
  mutation_schema_version integer not null,
  fingerprint_key_version integer not null,
  mutation_kind text not null,
  actor_profile_id uuid not null,
  target_ticket_id uuid,
  target_binding_fingerprint text not null,
  request_fingerprint text not null,
  result_ticket_id uuid not null,
  result_job_count integer not null,
  created_at timestamptz not null default now(),
  constraint ticket_mutation_receipts_shop_actor_fk
    foreign key (shop_id, actor_profile_id)
    references public.profiles (shop_id, id)
    on delete restrict,
  constraint ticket_mutation_receipts_shop_target_ticket_fk
    foreign key (shop_id, target_ticket_id)
    references public.tickets (shop_id, id)
    on delete restrict,
  constraint ticket_mutation_receipts_shop_result_ticket_fk
    foreign key (shop_id, result_ticket_id)
    references public.tickets (shop_id, id)
    on delete restrict,
  constraint ticket_mutation_receipts_schema_version_v1
    check (mutation_schema_version = 1),
  constraint ticket_mutation_receipts_key_version_positive
    check (fingerprint_key_version > 0),
  constraint ticket_mutation_receipts_kind_valid
    check (mutation_kind in (
      'create_repair_order',
      'append_work_items',
      'create_separate_repair_order',
      'confirm_legacy_work_statement',
      'deliver_repair_order',
      'close_repair_order',
      'cancel_repair_order',
      'return_job_to_open_queue'
    )),
  constraint ticket_mutation_receipts_target_fingerprint_valid
    check (target_binding_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint ticket_mutation_receipts_request_fingerprint_valid
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint ticket_mutation_receipts_result_count_valid
    check (result_job_count between 0 and 25)
);
--> statement-breakpoint

create unique index ticket_mutation_receipts_shop_request_key_uq
  on public.ticket_mutation_receipts (shop_id, request_key);
create unique index ticket_mutation_receipts_shop_id_uq
  on public.ticket_mutation_receipts (shop_id, id);
create unique index ticket_mutation_receipts_shop_id_result_ticket_count_uq
  on public.ticket_mutation_receipts (shop_id, id, result_ticket_id, result_job_count);
create index ticket_mutation_receipts_shop_result_created_idx
  on public.ticket_mutation_receipts (shop_id, result_ticket_id, created_at);
create index ticket_mutation_receipts_shop_target_idx
  on public.ticket_mutation_receipts (shop_id, target_ticket_id);
create index ticket_mutation_receipts_shop_actor_created_idx
  on public.ticket_mutation_receipts (shop_id, actor_profile_id, created_at);
--> statement-breakpoint

create table public.ticket_mutation_receipt_jobs (
  shop_id uuid not null,
  receipt_id uuid not null,
  result_ticket_id uuid not null,
  result_job_count integer not null,
  ordinal integer not null,
  job_id uuid not null,
  constraint ticket_mutation_receipt_jobs_pk
    primary key (shop_id, receipt_id, ordinal),
  constraint ticket_mutation_receipt_jobs_receipt_ticket_fk
    foreign key (shop_id, receipt_id, result_ticket_id, result_job_count)
    references public.ticket_mutation_receipts
      (shop_id, id, result_ticket_id, result_job_count)
    on delete restrict,
  constraint ticket_mutation_receipt_jobs_job_fk
    foreign key (shop_id, result_ticket_id, job_id)
    references public.ticket_jobs (shop_id, ticket_id, id)
    on delete restrict,
  constraint ticket_mutation_receipt_jobs_ordinal_range
    check (
      ordinal >= 0
      and ordinal < result_job_count
      and result_job_count between 0 and 25
    )
);
--> statement-breakpoint

create unique index ticket_mutation_receipt_jobs_shop_receipt_job_uq
  on public.ticket_mutation_receipt_jobs (shop_id, receipt_id, job_id);
create index ticket_mutation_receipt_jobs_shop_job_idx
  on public.ticket_mutation_receipt_jobs (shop_id, result_ticket_id, job_id);
create index ticket_mutation_receipt_jobs_header_idx
  on public.ticket_mutation_receipt_jobs
    (shop_id, receipt_id, result_ticket_id, result_job_count);
--> statement-breakpoint

create or replace function public.reject_ticket_mutation_receipt_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'immutable_ticket_mutation_receipt' using errcode = '23514';
end;
$$;
--> statement-breakpoint

create trigger ticket_mutation_receipts_immutable_write
before update or delete on public.ticket_mutation_receipts
for each row execute function public.reject_ticket_mutation_receipt_mutation();
create trigger ticket_mutation_receipt_jobs_immutable_write
before update or delete on public.ticket_mutation_receipt_jobs
for each row execute function public.reject_ticket_mutation_receipt_mutation();
--> statement-breakpoint

create or replace function public.enforce_ticket_mutation_receipt_complete()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  receipt_shop_id uuid;
  receipt_id_value uuid;
  expected_count integer;
  actual_count integer;
begin
  if tg_table_name = 'ticket_mutation_receipts' then
    receipt_shop_id := new.shop_id;
    receipt_id_value := new.id;
    expected_count := new.result_job_count;
  else
    receipt_shop_id := new.shop_id;
    receipt_id_value := new.receipt_id;
    select r.result_job_count
      into expected_count
      from public.ticket_mutation_receipts r
      where r.shop_id = receipt_shop_id
        and r.id = receipt_id_value;
  end if;

  select count(*)::integer
    into actual_count
    from public.ticket_mutation_receipt_jobs j
    where j.shop_id = receipt_shop_id
      and j.receipt_id = receipt_id_value;

  if actual_count is distinct from expected_count
    or exists (
      select 1
      from generate_series(0, expected_count - 1) expected(ordinal)
      left join public.ticket_mutation_receipt_jobs j
        on j.shop_id = receipt_shop_id
       and j.receipt_id = receipt_id_value
       and j.ordinal = expected.ordinal
      where j.ordinal is null
    ) then
    raise exception 'incomplete_ticket_mutation_receipt' using errcode = '23514';
  end if;

  return null;
end;
$$;
--> statement-breakpoint

create constraint trigger ticket_mutation_receipts_complete_deferred
after insert on public.ticket_mutation_receipts
deferrable initially deferred
for each row execute function public.enforce_ticket_mutation_receipt_complete();
create constraint trigger ticket_mutation_receipt_jobs_complete_deferred
after insert on public.ticket_mutation_receipt_jobs
deferrable initially deferred
for each row execute function public.enforce_ticket_mutation_receipt_complete();
--> statement-breakpoint

alter table public.ticket_mutation_receipts enable row level security;
alter table public.ticket_mutation_receipt_jobs enable row level security;
--> statement-breakpoint

revoke all privileges on table public.ticket_mutation_receipts
  from public, anon, authenticated, service_role;
revoke all privileges on table public.ticket_mutation_receipt_jobs
  from public, anon, authenticated, service_role;
grant select, insert on table public.ticket_mutation_receipts to service_role;
grant select, insert on table public.ticket_mutation_receipt_jobs to service_role;
--> statement-breakpoint

create policy ticket_mutation_receipts_server_only_deny_direct
  on public.ticket_mutation_receipts
  for all to anon, authenticated
  using (false) with check (false);
create policy ticket_mutation_receipt_jobs_server_only_deny_direct
  on public.ticket_mutation_receipt_jobs
  for all to anon, authenticated
  using (false) with check (false);
--> statement-breakpoint

revoke all on function public.guard_ticket_terminal_shape()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_ticket_immutable_identity()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_ticket_job_immutable_identity()
  from public, anon, authenticated, service_role;
revoke all on function public.reject_ticket_mutation_receipt_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_ticket_mutation_receipt_complete()
  from public, anon, authenticated, service_role;
