create table messaging_consent_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  subject_key uuid not null,
  customer_id uuid not null,
  destination_fingerprint text not null,
  fingerprint_key_version text not null,
  program_version text not null,
  event_type text not null,
  committed_at timestamptz not null default now(),
  occurred_at timestamptz not null,
  capture_method text not null,
  customer_controlled boolean not null,
  disclosure_snapshot jsonb,
  disclosure_hash text,
  evidence_kind text not null,
  evidence_ref text,
  actor_profile_id uuid,
  request_key uuid not null,
  request_fingerprint text not null,
  retain_until timestamptz not null,
  constraint messaging_consent_events_shop_fk foreign key (shop_id) references shops(id) on delete cascade,
  constraint messaging_consent_events_shop_customer_fk foreign key (shop_id, customer_id) references customers(shop_id, id) on delete restrict,
  constraint messaging_consent_events_shop_actor_fk foreign key (shop_id, actor_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint messaging_consent_events_destination_fingerprint_valid check (destination_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint messaging_consent_events_fingerprint_key_version_valid check (fingerprint_key_version ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'),
  constraint messaging_consent_events_program_version_valid check (program_version ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'),
  constraint messaging_consent_events_event_type_valid check (event_type in ('asked', 'declined', 'consented', 'revoked', 'reconsented', 'deleted')),
  constraint messaging_consent_events_capture_method_valid check (capture_method in ('customer_web', 'signed_form', 'provider_webhook', 'staff_request')),
  constraint messaging_consent_events_disclosure_snapshot_object check (disclosure_snapshot is null or jsonb_typeof(disclosure_snapshot) = 'object'),
  constraint messaging_consent_events_disclosure_snapshot_size check (disclosure_snapshot is null or octet_length(disclosure_snapshot::text) <= 4096),
  constraint messaging_consent_events_disclosure_hash_valid check (disclosure_hash is null or disclosure_hash ~ '^[0-9a-f]{64}$'),
  constraint messaging_consent_events_evidence_kind_valid check (evidence_kind in ('customer_checkbox', 'signed_form_reference', 'provider_event', 'staff_request')),
  constraint messaging_consent_events_evidence_ref_valid check (evidence_ref is null or char_length(evidence_ref) between 1 and 256),
  constraint messaging_consent_events_request_fingerprint_valid check (request_fingerprint ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
create unique index messaging_consent_events_shop_id_uq on messaging_consent_events (shop_id, id);
--> statement-breakpoint
create unique index messaging_consent_events_shop_request_uq on messaging_consent_events (shop_id, actor_profile_id, request_key);
--> statement-breakpoint
create index messaging_consent_events_subject_idx on messaging_consent_events (shop_id, subject_key, committed_at);
--> statement-breakpoint

create table messaging_consent_state (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  subject_key uuid not null,
  customer_id uuid not null,
  destination_fingerprint text not null,
  fingerprint_key_version text not null,
  program_version text not null,
  status text not null,
  source_event_id uuid not null,
  consented_at timestamptz,
  revoked_at timestamptz,
  retain_until timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint messaging_consent_state_shop_fk foreign key (shop_id) references shops(id) on delete cascade,
  constraint messaging_consent_state_shop_customer_fk foreign key (shop_id, customer_id) references customers(shop_id, id) on delete cascade,
  constraint messaging_consent_state_shop_source_event_fk foreign key (shop_id, source_event_id) references messaging_consent_events(shop_id, id) on delete restrict,
  constraint messaging_consent_state_destination_fingerprint_valid check (destination_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint messaging_consent_state_fingerprint_key_version_valid check (fingerprint_key_version ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'),
  constraint messaging_consent_state_program_version_valid check (program_version ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'),
  constraint messaging_consent_state_status_valid check (status in ('declined', 'consented', 'revoked')),
  constraint messaging_consent_state_timestamps_consistent check (
    (status = 'declined' and consented_at is null and revoked_at is null)
    or (status = 'consented' and consented_at is not null and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);
--> statement-breakpoint
create unique index messaging_consent_state_shop_id_uq on messaging_consent_state (shop_id, id);
--> statement-breakpoint
create unique index messaging_consent_state_subject_program_uq on messaging_consent_state (shop_id, subject_key, destination_fingerprint, fingerprint_key_version, program_version);
--> statement-breakpoint

create table sms_suppressions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  destination_fingerprint text not null,
  fingerprint_key_version text not null,
  source_event_id uuid,
  reason text not null,
  suppressed_at timestamptz not null default now(),
  lifted_at timestamptz,
  retain_until timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint sms_suppressions_shop_fk foreign key (shop_id) references shops(id) on delete cascade,
  constraint sms_suppressions_shop_source_event_fk foreign key (shop_id, source_event_id) references messaging_consent_events(shop_id, id) on delete restrict,
  constraint sms_suppressions_destination_fingerprint_valid check (destination_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint sms_suppressions_fingerprint_key_version_valid check (fingerprint_key_version ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'),
  constraint sms_suppressions_reason_valid check (reason in ('customer_revocation', 'verified_deletion', 'permanent_failure', 'number_reassigned')),
  constraint sms_suppressions_lifted_at_valid check (lifted_at is null or lifted_at >= suppressed_at)
);
--> statement-breakpoint
create unique index sms_suppressions_shop_id_uq on sms_suppressions (shop_id, id);
--> statement-breakpoint
create unique index sms_suppressions_shop_destination_uq on sms_suppressions (shop_id, destination_fingerprint, fingerprint_key_version);
--> statement-breakpoint

create table messaging_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  request_key uuid not null,
  request_fingerprint text not null,
  shop_id uuid not null,
  subject_key uuid not null,
  customer_id uuid,
  destination_fingerprint text not null,
  fingerprint_key_version text not null,
  state text not null,
  reason_code text not null,
  requesting_actor_profile_id uuid not null,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  latest_relevant_at timestamptz,
  prior_record_counts jsonb,
  proof_summary jsonb,
  retain_until timestamptz,
  constraint messaging_deletion_requests_shop_fk foreign key (shop_id) references shops(id) on delete cascade,
  constraint messaging_deletion_requests_shop_customer_fk foreign key (shop_id, customer_id) references customers(shop_id, id) on delete restrict,
  constraint messaging_deletion_requests_shop_actor_fk foreign key (shop_id, requesting_actor_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint messaging_deletion_requests_request_fingerprint_valid check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint messaging_deletion_requests_destination_fingerprint_valid check (destination_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint messaging_deletion_requests_fingerprint_key_version_valid check (fingerprint_key_version ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'),
  constraint messaging_deletion_requests_state_valid check (state in ('pending', 'completed')),
  constraint messaging_deletion_requests_reason_code_valid check (reason_code ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'),
  constraint messaging_deletion_requests_prior_counts_object check (prior_record_counts is null or jsonb_typeof(prior_record_counts) = 'object'),
  constraint messaging_deletion_requests_prior_counts_size check (prior_record_counts is null or octet_length(prior_record_counts::text) <= 4096),
  constraint messaging_deletion_requests_proof_summary_object check (proof_summary is null or jsonb_typeof(proof_summary) = 'object'),
  constraint messaging_deletion_requests_proof_summary_size check (proof_summary is null or octet_length(proof_summary::text) <= 4096),
  constraint messaging_deletion_requests_state_consistent check (
    (state = 'pending' and customer_id is not null
      and completed_at is null and latest_relevant_at is null and retain_until is null
      and ((prior_record_counts is null and proof_summary is null)
        or (prior_record_counts is not null and proof_summary is not null)))
    or (state = 'completed' and customer_id is null and completed_at is not null and latest_relevant_at is not null and prior_record_counts is not null and proof_summary is not null and retain_until is not null)
  ),
  constraint messaging_deletion_requests_retention_window_exact check (
    state = 'pending'
    or (latest_relevant_at >= completed_at and retain_until = latest_relevant_at + interval '5 years')
  )
);
--> statement-breakpoint
create unique index messaging_deletion_requests_shop_id_uq on messaging_deletion_requests (shop_id, id);
--> statement-breakpoint
create unique index messaging_deletion_requests_shop_actor_request_uq on messaging_deletion_requests (shop_id, requesting_actor_profile_id, request_key);
--> statement-breakpoint
create unique index messaging_deletion_requests_shop_customer_pending_uq
on messaging_deletion_requests (shop_id, customer_id)
where state = 'pending' and customer_id is not null;
--> statement-breakpoint
create index messaging_deletion_requests_pending_idx on messaging_deletion_requests (shop_id, requested_at) where state = 'pending';
--> statement-breakpoint

create table messaging_deletion_work_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  request_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  parent_work_item_id uuid,
  outcome text not null default 'pending',
  retention_basis text,
  counts_toward_proof boolean not null default true,
  detached_suppression_sources integer not null default 0,
  discovered_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint messaging_deletion_work_items_shop_request_fk
    foreign key (shop_id, request_id)
    references messaging_deletion_requests(shop_id, id) on delete cascade,
  constraint messaging_deletion_work_items_parent_fk
    foreign key (parent_work_item_id)
    references messaging_deletion_work_items(id) on delete cascade,
  constraint messaging_deletion_work_items_resource_type_valid check (
    resource_type in ('consent_event','consent_projection','quote_send','sms_log','notification')
  ),
  constraint messaging_deletion_work_items_outcome_valid check (
    outcome in ('pending','deleted','detached','retained')
  ),
  constraint messaging_deletion_work_items_retention_basis_valid check (
    retention_basis is null
    or retention_basis in ('resource_hold','subject_hold','held_dependency')
  ),
  constraint messaging_deletion_work_items_state_consistent check (
    (outcome = 'pending' and retention_basis is null and resolved_at is null)
    or (outcome in ('deleted','detached') and retention_basis is null and resolved_at is not null)
    or (outcome = 'retained' and retention_basis is not null and resolved_at is not null)
  ),
  constraint messaging_deletion_work_items_detached_count_valid check (
    detached_suppression_sources >= 0
    and (resource_type = 'consent_event' or detached_suppression_sources = 0)
  )
);
create unique index messaging_deletion_work_items_request_resource_uq
on messaging_deletion_work_items (request_id, resource_type, resource_id);
create unique index messaging_deletion_work_items_request_id_uq
on messaging_deletion_work_items (request_id, id);
create index messaging_deletion_work_items_pending_idx
on messaging_deletion_work_items (request_id, outcome, resource_type, id);
create index messaging_deletion_work_items_parent_idx
on messaging_deletion_work_items (request_id, parent_work_item_id, outcome);
--> statement-breakpoint

create table messaging_retention_holds (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  resource_type text,
  resource_id uuid,
  subject_key uuid,
  reason_code text not null,
  authorizing_actor_profile_id uuid not null,
  starts_at timestamptz not null default now(),
  review_at timestamptz not null,
  expires_at timestamptz not null,
  released_at timestamptz,
  retain_until timestamptz not null,
  constraint messaging_retention_holds_shop_fk foreign key (shop_id) references shops(id) on delete cascade,
  constraint messaging_retention_holds_shop_actor_fk foreign key (shop_id, authorizing_actor_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint messaging_retention_holds_resource_type_valid check (
    resource_type is null or resource_type in (
      'messaging_consent_event', 'sms_suppression', 'quote_send', 'sms_log',
      'notification', 'messaging_deletion_request'
    )
  ),
  constraint messaging_retention_holds_reason_code_valid check (
    reason_code in ('legal_claim', 'subpoena', 'fraud_review', 'security_investigation')
  ),
  constraint messaging_retention_holds_target_consistent check (
    (subject_key is not null and resource_type is null and resource_id is null)
    or (subject_key is null and resource_type is not null and resource_id is not null)
  ),
  constraint messaging_retention_holds_review_valid check (review_at >= starts_at and review_at <= expires_at),
  constraint messaging_retention_holds_release_valid check (released_at is null or released_at >= starts_at),
  constraint messaging_retention_holds_max_duration check (
    expires_at > starts_at and expires_at <= starts_at + interval '365 days'
  ),
  constraint messaging_retention_holds_retention_window_exact check (
    retain_until = coalesce(released_at, expires_at) + interval '5 years'
  )
);
--> statement-breakpoint
create unique index messaging_retention_holds_shop_id_uq on messaging_retention_holds (shop_id, id);
--> statement-breakpoint
create index messaging_retention_holds_active_subject_idx on messaging_retention_holds (shop_id, subject_key, expires_at) where subject_key is not null and released_at is null;
--> statement-breakpoint
create index messaging_retention_holds_active_resource_idx on messaging_retention_holds (shop_id, resource_type, resource_id, starts_at, expires_at) where resource_id is not null and released_at is null;
--> statement-breakpoint
create index messaging_retention_holds_purge_idx on messaging_retention_holds (retain_until, id);
--> statement-breakpoint

create table quote_sends (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  ticket_id uuid not null,
  quote_version_id uuid not null,
  customer_id uuid,
  subject_key uuid not null,
  destination_fingerprint text not null,
  fingerprint_key_version text not null,
  channel text not null,
  token_hash text,
  token_expires_at timestamptz,
  requesting_actor_profile_id uuid not null,
  request_key uuid not null,
  request_fingerprint text not null,
  state text not null,
  submitting_at timestamptz,
  submitted_at timestamptz,
  terminal_at timestamptz,
  retain_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_sends_shop_fk foreign key (shop_id) references shops(id) on delete cascade,
  constraint quote_sends_shop_ticket_fk foreign key (shop_id, ticket_id) references tickets(shop_id, id) on delete restrict,
  constraint quote_sends_shop_ticket_version_fk foreign key (shop_id, ticket_id, quote_version_id) references quote_versions(shop_id, ticket_id, id) on delete restrict,
  constraint quote_sends_shop_customer_fk foreign key (shop_id, customer_id) references customers(shop_id, id) on delete restrict,
  constraint quote_sends_shop_actor_fk foreign key (shop_id, requesting_actor_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint quote_sends_destination_fingerprint_valid check (destination_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint quote_sends_fingerprint_key_version_valid check (fingerprint_key_version ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'),
  constraint quote_sends_channel_valid check (channel = 'sms'),
  constraint quote_sends_token_hash_valid check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  constraint quote_sends_request_fingerprint_valid check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint quote_sends_state_valid check (
    state in ('queued', 'claimed', 'submitting', 'submitted', 'cancelled', 'delivered', 'failed', 'responded', 'expired')
  ),
  constraint quote_sends_token_action_consistent check (
    (token_hash is null and token_expires_at is null)
    or (token_hash is not null and token_expires_at is not null
      and token_expires_at > created_at
      and state in ('queued', 'claimed', 'submitting', 'submitted', 'delivered'))
  ),
  constraint quote_sends_submission_timestamps_consistent check (
    (state in ('queued', 'claimed', 'cancelled') and submitting_at is null and submitted_at is null)
    or (state = 'submitting' and submitting_at >= created_at and submitted_at is null)
    or (state in ('submitted', 'delivered', 'responded')
      and submitting_at >= created_at and submitted_at is not null and submitted_at >= submitting_at)
    or (state = 'failed' and submitting_at >= created_at
      and (submitted_at is null or submitted_at >= submitting_at))
    or (state = 'expired'
      and ((submitting_at is null and submitted_at is null)
        or (submitting_at >= created_at and submitted_at >= submitting_at)))
  ),
  constraint quote_sends_terminal_timestamps_consistent check (
    (state in ('cancelled', 'failed', 'responded', 'expired') and terminal_at is not null and retain_until is not null)
    or (state not in ('cancelled', 'failed', 'responded', 'expired') and terminal_at is null and retain_until is null)
  ),
  constraint quote_sends_retention_timestamp_valid check (
    retain_until is null
    or (terminal_at >= created_at
      and (submitted_at is null or terminal_at >= submitted_at)
      and retain_until = terminal_at + interval '1 year')
  )
);
--> statement-breakpoint
create unique index quote_sends_shop_id_uq on quote_sends (shop_id, id);
--> statement-breakpoint
create unique index quote_sends_shop_ticket_id_uq on quote_sends (shop_id, ticket_id, id);
--> statement-breakpoint
create unique index quote_sends_shop_ticket_version_id_uq on quote_sends (shop_id, ticket_id, quote_version_id, id);
--> statement-breakpoint
create unique index quote_sends_shop_actor_request_uq on quote_sends (shop_id, requesting_actor_profile_id, request_key);
--> statement-breakpoint
create index quote_sends_destination_idx on quote_sends (shop_id, destination_fingerprint, fingerprint_key_version);
--> statement-breakpoint
create index quote_sends_purge_idx on quote_sends (state, retain_until, id);
--> statement-breakpoint
create index quote_sends_subject_retention_idx on quote_sends (shop_id, subject_key, retain_until, id);
--> statement-breakpoint
create table sms_log (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  quote_send_id uuid not null,
  provider_message_id text,
  provider_event_id text,
  template_key text not null,
  template_version text not null,
  state text not null,
  error_code text,
  provider_occurred_at timestamptz,
  server_received_at timestamptz not null default now(),
  retain_until timestamptz not null,
  constraint sms_log_shop_fk foreign key (shop_id) references shops(id) on delete cascade,
  constraint sms_log_shop_send_fk foreign key (shop_id, quote_send_id) references quote_sends(shop_id, id) on delete cascade,
  constraint sms_log_provider_message_id_valid check (provider_message_id is null or char_length(provider_message_id) between 1 and 256),
  constraint sms_log_provider_event_id_valid check (provider_event_id is null or char_length(provider_event_id) between 1 and 256),
  constraint sms_log_template_key_valid check (template_key ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'),
  constraint sms_log_template_version_valid check (template_version ~ '^[a-z0-9][a-z0-9_.-]{0,62}[a-z0-9]$'),
  constraint sms_log_state_valid check (state in ('accepted', 'queued', 'sent', 'delivered', 'undelivered', 'failed', 'opt_out', 'help', 'start')),
  constraint sms_log_error_code_valid check (error_code is null or char_length(error_code) between 1 and 128),
  constraint sms_log_retention_timestamp_valid check (
    retain_until = server_received_at + interval '1 year'
  )
);
--> statement-breakpoint
create unique index sms_log_shop_id_uq on sms_log (shop_id, id);
--> statement-breakpoint
create unique index sms_log_shop_provider_event_uq on sms_log (shop_id, provider_event_id) where provider_event_id is not null;
--> statement-breakpoint
create index sms_log_send_idx on sms_log (shop_id, quote_send_id);
--> statement-breakpoint
create index sms_log_purge_idx on sms_log (state, retain_until, id);
--> statement-breakpoint

create table notifications (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  recipient_profile_id uuid not null,
  event_type text not null,
  entity_type text not null,
  entity_id uuid not null,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  retain_until timestamptz not null,
  constraint notifications_shop_fk foreign key (shop_id) references shops(id) on delete cascade,
  constraint notifications_shop_recipient_fk foreign key (shop_id, recipient_profile_id) references profiles(shop_id, id) on delete cascade,
  constraint notifications_event_type_valid check (event_type ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'),
  constraint notifications_entity_type_valid check (entity_type ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'),
  constraint notifications_dedupe_key_valid check (char_length(dedupe_key) between 1 and 128),
  constraint notifications_read_at_valid check (read_at is null or read_at >= created_at),
  constraint notifications_retention_timestamp_valid check (retain_until = created_at + interval '90 days')
);
--> statement-breakpoint
create unique index notifications_shop_id_uq on notifications (shop_id, id);
--> statement-breakpoint
create unique index notifications_shop_recipient_dedupe_uq on notifications (shop_id, recipient_profile_id, dedupe_key);
--> statement-breakpoint
create index notifications_purge_idx on notifications (retain_until, id);
--> statement-breakpoint

comment on column notifications.entity_id is
  'Routing reference only; never an authorization or tenant-ownership boundary.';
--> statement-breakpoint

comment on column quote_events.quote_send_id is
  'Immutable historical quote-send identifier. It is validated against an exact live send on insert and may intentionally stop resolving after retention or verified deletion.';
--> statement-breakpoint

create function validate_quote_event_send_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.quote_send_id is null then
    return new;
  end if;

  perform 1
  from public.quote_sends
  where shop_id = new.shop_id
    and ticket_id = new.ticket_id
    and quote_version_id = new.quote_version_id
    and id = new.quote_send_id
  for key share;

  if not found then
    raise exception 'quote event send reference must match an exact live quote send';
  end if;

  return new;
end;
$$;
--> statement-breakpoint
create trigger quote_events_send_reference_validator
before insert on quote_events
for each row execute function validate_quote_event_send_reference();
--> statement-breakpoint

create function guard_quote_send_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  customer_detached boolean := old.customer_id is not null and new.customer_id is null;
  token_revoked boolean := old.token_hash is not null
    and old.token_expires_at is not null
    and new.token_hash is null
    and new.token_expires_at is null;
  deletion_authorized boolean := false;
  locked_request_id uuid;
  locked_request_requested_at timestamptz;
  approved_deletion_barrier timestamptz;
  locked_suppression_id uuid;
begin
  if new.subject_key is distinct from old.subject_key then
    raise exception 'quote send subject identity is immutable';
  end if;

  if old.customer_id is null and new.customer_id is not null
    or (old.customer_id is not null and new.customer_id is not null
      and new.customer_id is distinct from old.customer_id) then
    raise exception 'detached quote send customer cannot be restored or reassigned';
  end if;

  if old.state in ('cancelled', 'failed', 'responded', 'expired')
    and not customer_detached then
    raise exception 'terminal quote sends are immutable';
  end if;

  if old.token_hash is null and new.token_hash is not null
    or old.token_expires_at is null and new.token_expires_at is not null
    or (old.token_hash is not null and new.token_hash is not null
      and new.token_hash is distinct from old.token_hash)
    or (old.token_expires_at is not null and new.token_expires_at is not null
      and new.token_expires_at is distinct from old.token_expires_at) then
    raise exception 'revoked quote send token cannot be restored or reassigned';
  end if;

  if customer_detached or (new.state = old.state and token_revoked) then
    select deletion_request.id, deletion_request.requested_at
    into locked_request_id, locked_request_requested_at
    from public.messaging_deletion_requests deletion_request
    where deletion_request.shop_id = old.shop_id
      and deletion_request.customer_id = old.customer_id
      and deletion_request.state = 'pending'
    for share;

    if found then
      approved_deletion_barrier := locked_request_requested_at + interval '5 years';
    end if;

    if approved_deletion_barrier is not null then
      for locked_suppression_id in
        select suppression.id
        from public.sms_suppressions suppression
        where suppression.shop_id = old.shop_id
          and suppression.destination_fingerprint = old.destination_fingerprint
          and suppression.fingerprint_key_version = old.fingerprint_key_version
          and suppression.reason in ('verified_deletion', 'permanent_failure', 'number_reassigned')
          and suppression.lifted_at is null
          and suppression.retain_until >= approved_deletion_barrier
        order by suppression.id
        for share
      loop
        deletion_authorized := true;
      end loop;
    end if;

    if not deletion_authorized then
      raise exception 'quote send detachment requires a matching pending messaging deletion request';
    end if;
  end if;

  if old.state in ('cancelled', 'failed', 'responded', 'expired') then
    if customer_detached
      and (new.id, new.shop_id, new.ticket_id, new.quote_version_id,
           new.destination_fingerprint, new.fingerprint_key_version, new.channel,
           new.token_hash, new.token_expires_at, new.requesting_actor_profile_id,
           new.request_key, new.request_fingerprint, new.state, new.submitting_at,
           new.submitted_at, new.terminal_at, new.retain_until, new.created_at)
        is not distinct from
          (old.id, old.shop_id, old.ticket_id, old.quote_version_id,
           old.destination_fingerprint, old.fingerprint_key_version, old.channel,
           old.token_hash, old.token_expires_at, old.requesting_actor_profile_id,
           old.request_key, old.request_fingerprint, old.state, old.submitting_at,
           old.submitted_at, old.terminal_at, old.retain_until, old.created_at) then
      return new;
    end if;
    raise exception 'terminal quote sends are immutable';
  end if;

  if new.state = old.state then
    if token_revoked and old.state not in ('submitting', 'submitted', 'delivered') then
      raise exception 'active quote send token material is immutable';
    end if;

    if (customer_detached or token_revoked)
      and (new.id, new.shop_id, new.ticket_id, new.quote_version_id,
           new.destination_fingerprint, new.fingerprint_key_version, new.channel,
           new.requesting_actor_profile_id, new.request_key, new.request_fingerprint,
           new.state, new.submitting_at, new.submitted_at, new.terminal_at,
           new.retain_until, new.created_at)
        is not distinct from
          (old.id, old.shop_id, old.ticket_id, old.quote_version_id,
           old.destination_fingerprint, old.fingerprint_key_version, old.channel,
           old.requesting_actor_profile_id, old.request_key, old.request_fingerprint,
           old.state, old.submitting_at, old.submitted_at, old.terminal_at,
           old.retain_until, old.created_at) then
      return new;
    end if;

    if (new.id, new.shop_id, new.ticket_id, new.quote_version_id, new.customer_id,
        new.destination_fingerprint, new.fingerprint_key_version, new.channel,
        new.token_hash, new.token_expires_at, new.requesting_actor_profile_id,
        new.request_key, new.request_fingerprint, new.state, new.submitting_at,
        new.submitted_at, new.terminal_at, new.retain_until, new.created_at)
      is distinct from
       (old.id, old.shop_id, old.ticket_id, old.quote_version_id, old.customer_id,
        old.destination_fingerprint, old.fingerprint_key_version, old.channel,
        old.token_hash, old.token_expires_at, old.requesting_actor_profile_id,
        old.request_key, old.request_fingerprint, old.state, old.submitting_at,
        old.submitted_at, old.terminal_at, old.retain_until, old.created_at) then
      raise exception 'same-state quote send updates may only change updated_at';
    end if;
    return new;
  end if;

  if (new.id, new.shop_id, new.ticket_id, new.quote_version_id,
      new.destination_fingerprint, new.fingerprint_key_version, new.channel,
      new.requesting_actor_profile_id, new.request_key, new.request_fingerprint,
      new.created_at)
    is distinct from
     (old.id, old.shop_id, old.ticket_id, old.quote_version_id,
      old.destination_fingerprint, old.fingerprint_key_version, old.channel,
      old.requesting_actor_profile_id, old.request_key, old.request_fingerprint,
      old.created_at) then
    raise exception 'quote send identity is immutable';
  end if;

  if new.customer_id is distinct from old.customer_id and not customer_detached then
    raise exception 'quote send identity is immutable';
  end if;

  if not (
    (old.state = 'queued' and new.state in ('claimed', 'cancelled', 'expired'))
    or (old.state = 'claimed' and new.state in ('submitting', 'cancelled', 'expired'))
    or (old.state = 'submitting' and new.state in ('submitted', 'failed'))
    or (old.state = 'submitted' and new.state in ('delivered', 'failed', 'responded', 'expired'))
    or (old.state = 'delivered' and new.state in ('responded', 'expired'))
  ) then
    raise exception 'invalid quote send state transition';
  end if;

  if new.state in ('cancelled', 'failed', 'responded', 'expired') then
    if new.token_hash is not null or new.token_expires_at is not null then
      raise exception 'terminal quote sends cannot retain token material';
    end if;
  elsif new.token_hash is distinct from old.token_hash
    or new.token_expires_at is distinct from old.token_expires_at then
    raise exception 'active quote send token material is immutable';
  end if;

  if old.state in ('queued', 'claimed')
    and new.state in ('cancelled', 'expired')
    and (new.submitting_at is not null or new.submitted_at is not null) then
    raise exception 'quote send transition cannot manufacture submission anchors';
  end if;

  if old.state = 'submitting' and new.state = 'failed' and new.submitted_at is not null then
    raise exception 'quote send transition cannot manufacture submission anchors';
  end if;

  if (old.submitting_at is not null and new.submitting_at is distinct from old.submitting_at)
    or (old.submitted_at is not null and new.submitted_at is distinct from old.submitted_at)
    or (old.terminal_at is not null and new.terminal_at is distinct from old.terminal_at)
    or (old.retain_until is not null and new.retain_until is distinct from old.retain_until) then
    raise exception 'quote send lifecycle anchors are immutable';
  end if;

  return new;
end;
$$;
--> statement-breakpoint
create trigger quote_sends_lifecycle_guard
before update on quote_sends
for each row execute function guard_quote_send_lifecycle();
--> statement-breakpoint

create function serialize_messaging_retention_hold_target()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  request_ids uuid[];
  locked_request_id uuid;
  purge_shop_id uuid;
  purge_hold_ids uuid[];
begin
  if tg_op = 'DELETE' then
    if current_user = pg_catalog.pg_get_userbyid((
      select p.proowner
      from pg_catalog.pg_proc p
      where p.oid = 'public.purge_expired_messaging_retention_hold(uuid,uuid)'::pg_catalog.regprocedure
    )) then
      begin
        purge_shop_id := nullif(current_setting(
          'vyntechs.messaging_retention_hold_purge_shop', true
        ), '')::uuid;
        purge_hold_ids := nullif(current_setting(
          'vyntechs.messaging_retention_hold_purge_ids', true
        ), '')::uuid[];
      exception when others then
        purge_shop_id := null;
        purge_hold_ids := null;
      end;
      if purge_shop_id = old.shop_id and old.id = any(purge_hold_ids) then
        return old;
      end if;
    end if;
    raise exception 'messaging retention holds may only be purged after retention';
  end if;

  if tg_op = 'UPDATE' then
    if new.shop_id is distinct from old.shop_id
      or new.resource_type is distinct from old.resource_type
      or new.resource_id is distinct from old.resource_id
      or new.subject_key is distinct from old.subject_key then
      raise exception 'messaging retention hold target is immutable';
    end if;

    if new.id is distinct from old.id
      or new.reason_code is distinct from old.reason_code
      or new.authorizing_actor_profile_id is distinct from old.authorizing_actor_profile_id
      or new.starts_at is distinct from old.starts_at
      or new.review_at is distinct from old.review_at
      or new.expires_at is distinct from old.expires_at then
      raise exception 'messaging retention hold lifecycle is immutable';
    end if;

    if new.released_at is not distinct from old.released_at then
      if new.retain_until is distinct from old.retain_until then
        raise exception 'messaging retention hold lifecycle is immutable';
      end if;
      return new;
    end if;

    if old.released_at is not null then
      raise exception 'messaging retention hold may only be released once';
    end if;
    if new.released_at is null then
      raise exception 'messaging retention hold lifecycle is immutable';
    end if;
    if new.retain_until is distinct from old.retain_until
      and new.retain_until is distinct from new.released_at + interval '5 years' then
      raise exception 'messaging retention hold lifecycle is immutable';
    end if;
    new.retain_until := new.released_at + interval '5 years';
    return new;
  end if;

  perform 1
  from public.shops locked_shop
  where locked_shop.id = new.shop_id
  for update;

  with targets(shop_id, subject_key, resource_type, resource_id) as (
    values (new.shop_id, new.subject_key, new.resource_type, new.resource_id)
  )
  select array_agg(distinct r.id order by r.id)
  into request_ids
  from public.messaging_deletion_requests r
  join targets t on t.shop_id = r.shop_id
    and (
      (t.subject_key is not null and t.subject_key = r.subject_key)
      or (t.resource_type = 'messaging_deletion_request' and t.resource_id = r.id)
      or (
        t.resource_type = 'messaging_consent_event'
        and r.subject_key = (
          select e.subject_key
          from public.messaging_consent_events e
          where e.shop_id = t.shop_id and e.id = t.resource_id
        )
      )
    );

  foreach locked_request_id in array coalesce(request_ids, array[]::uuid[])
  loop
    perform 1
    from public.messaging_deletion_requests r
    where r.id = locked_request_id
    for update;
  end loop;
  return new;
end;
$$;
--> statement-breakpoint
create trigger messaging_retention_holds_serialize_target
before insert or update or delete
on messaging_retention_holds
for each row execute function serialize_messaging_retention_hold_target();
--> statement-breakpoint

create function reject_messaging_consent_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  compaction_shop_id uuid;
  compaction_event_ids uuid[];
  purge_shop_id uuid;
  purge_event_ids uuid[];
begin
  if tg_op = 'DELETE'
    and current_user = pg_catalog.pg_get_userbyid((
      select p.proowner
      from pg_catalog.pg_proc p
      where p.oid = 'public.compact_messaging_consent_work_items(uuid,uuid,uuid[])'::pg_catalog.regprocedure
    ))
  then
    begin
      compaction_shop_id := nullif(current_setting(
        'vyntechs.messaging_consent_compaction_shop', true
      ), '')::uuid;
      compaction_event_ids := nullif(current_setting(
        'vyntechs.messaging_consent_compaction_events', true
      ), '')::uuid[];
    exception when others then
      compaction_shop_id := null;
      compaction_event_ids := null;
    end;
    if compaction_shop_id = old.shop_id and old.id = any(compaction_event_ids) then
      return old;
    end if;
  end if;

  if tg_op = 'DELETE'
    and current_user = pg_catalog.pg_get_userbyid((
      select p.proowner
      from pg_catalog.pg_proc p
      where p.oid = 'public.purge_expired_messaging_consent_event(uuid,uuid)'::pg_catalog.regprocedure
    ))
  then
    begin
      purge_shop_id := nullif(current_setting(
        'vyntechs.messaging_consent_purge_shop', true
      ), '')::uuid;
      purge_event_ids := nullif(current_setting(
        'vyntechs.messaging_consent_purge_events', true
      ), '')::uuid[];
    exception when others then
      purge_shop_id := null;
      purge_event_ids := null;
    end;
    if purge_shop_id = old.shop_id and old.id = any(purge_event_ids) then
      return old;
    end if;
  end if;
  raise exception 'messaging consent events are append-only';
end;
$$;
--> statement-breakpoint
create trigger messaging_consent_events_append_only
before update or delete on messaging_consent_events
for each row execute function reject_messaging_consent_event_mutation();
--> statement-breakpoint

create function require_messaging_compaction_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  compaction_request_id uuid;
  compaction_shop_id uuid;
  compaction_event_ids uuid[];
  purge_shop_id uuid;
  purge_event_ids uuid[];
begin
  begin
    purge_shop_id := nullif(current_setting(
      'vyntechs.messaging_consent_purge_shop', true
    ), '')::uuid;
    purge_event_ids := nullif(current_setting(
      'vyntechs.messaging_consent_purge_events', true
    ), '')::uuid[];
  exception when others then
    raise exception 'consent event purge requires exact authorization context';
  end;

  if purge_shop_id is not null or purge_event_ids is not null then
    if purge_shop_id is null
      or purge_event_ids is null
      or purge_shop_id is distinct from old.shop_id
      or not (old.id = any(purge_event_ids)) then
      raise exception 'consent event purge requires exact authorization context';
    end if;
    return old;
  end if;

  begin
    compaction_request_id := current_setting(
      'vyntechs.messaging_consent_compaction_request',
      true
    )::uuid;
    compaction_shop_id := current_setting(
      'vyntechs.messaging_consent_compaction_shop',
      true
    )::uuid;
    compaction_event_ids := current_setting(
      'vyntechs.messaging_consent_compaction_events',
      true
    )::uuid[];
  exception when others then
    raise exception 'compaction requires exact canonical request authorization';
  end;

  if compaction_shop_id is distinct from old.shop_id
    or not (old.id = any(compaction_event_ids))
    or not exists (
    select 1
    from public.messaging_deletion_requests r
    where r.id = compaction_request_id
      and r.shop_id = old.shop_id
      and r.state in ('pending', 'completed')
  ) then
    raise exception 'compaction requires exact canonical request authorization';
  end if;
  return old;
end;
$$;
--> statement-breakpoint
create constraint trigger messaging_consent_events_compaction_completion
after delete on messaging_consent_events
deferrable initially deferred
for each row execute function require_messaging_compaction_completion();
--> statement-breakpoint

create function compact_messaging_consent_work_items(
  p_shop_id uuid,
  p_request_id uuid,
  p_work_item_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_customer_id uuid;
  existing_request_text text;
  existing_shop_text text;
  existing_events_text text;
  authorized_event_ids uuid[];
  selected_event_ids uuid[];
  selected_count integer;
  deleted_count integer;
  advanced_count integer;
begin
  if nullif(current_setting('vyntechs.messaging_consent_purge_shop', true), '') is not null
    or nullif(current_setting('vyntechs.messaging_consent_purge_events', true), '') is not null
  then
    raise exception 'compaction transaction cannot mix consent event purge context';
  end if;

  if p_work_item_ids is null
    or cardinality(p_work_item_ids) < 1
    or cardinality(p_work_item_ids) > 256
    or array_position(p_work_item_ids, null) is not null
    or (
      select count(distinct work_item_id)
      from unnest(p_work_item_ids) supplied(work_item_id)
    ) <> cardinality(p_work_item_ids)
  then
    raise exception 'compaction requires between 1 and 256 distinct exact work item IDs';
  end if;

  select r.customer_id
  into request_customer_id
  from public.messaging_deletion_requests r
  where r.id = p_request_id
    and r.shop_id = p_shop_id
    and r.state = 'pending'
    and r.customer_id is not null
  for update;
  if not found then
    raise exception 'matching canonical pending messaging deletion request required';
  end if;

  existing_request_text := nullif(current_setting(
    'vyntechs.messaging_consent_compaction_request', true
  ), '');
  existing_shop_text := nullif(current_setting(
    'vyntechs.messaging_consent_compaction_shop', true
  ), '');
  existing_events_text := nullif(current_setting(
    'vyntechs.messaging_consent_compaction_events', true
  ), '');

  if existing_request_text is not null
    or existing_shop_text is not null
    or existing_events_text is not null
  then
    begin
      if existing_request_text is null
        or existing_shop_text is null
        or existing_events_text is null
        or existing_request_text::uuid is distinct from p_request_id
        or existing_shop_text::uuid is distinct from p_shop_id
      then
        raise exception 'compaction transaction cannot mix deletion requests or shops';
      end if;
      authorized_event_ids := existing_events_text::uuid[];
    exception when invalid_text_representation then
      raise exception 'invalid messaging consent compaction authorization context';
    end;
  else
    authorized_event_ids := array[]::uuid[];
  end if;

  perform 1
  from public.messaging_deletion_work_items work_item
  where work_item.id = any(p_work_item_ids)
  order by work_item.id
  for update;

  select count(*)::integer, array_agg(work_item.resource_id order by work_item.id)
  into selected_count, selected_event_ids
  from public.messaging_deletion_work_items work_item
  where work_item.id = any(p_work_item_ids)
    and work_item.shop_id = p_shop_id
    and work_item.request_id = p_request_id
    and work_item.resource_type = 'consent_event'
    and work_item.outcome in ('pending', 'retained');

  if selected_count is distinct from cardinality(p_work_item_ids) then
    raise exception 'compaction requires exact pending or retained consent-event work items';
  end if;

  perform 1
  from public.messaging_consent_events event
  where event.shop_id = p_shop_id
    and event.id = any(selected_event_ids)
  order by event.id
  for update;

  if (
    select count(*)::integer
    from public.messaging_consent_events event
    where event.shop_id = p_shop_id
      and event.customer_id = request_customer_id
      and event.id = any(selected_event_ids)
  ) is distinct from selected_count
  then
    raise exception 'consent-event work items must match the deletion request customer';
  end if;

  perform 1
  from public.messaging_consent_state projection
  join public.messaging_consent_events event
    on event.shop_id = projection.shop_id
    and event.subject_key = projection.subject_key
    and event.destination_fingerprint = projection.destination_fingerprint
    and event.fingerprint_key_version = projection.fingerprint_key_version
    and event.program_version = projection.program_version
  where event.id = any(selected_event_ids)
  order by projection.id
  for update of projection;

  if exists (
    select 1
    from public.messaging_consent_state projection
    where projection.shop_id = p_shop_id
      and projection.source_event_id = any(selected_event_ids)
  ) then
    raise exception 'consent projection source event must resolve with its parent';
  end if;

  perform 1
  from public.sms_suppressions suppression
  where suppression.shop_id = p_shop_id
    and suppression.source_event_id = any(selected_event_ids)
  order by suppression.id
  for update;

  perform 1
  from public.messaging_retention_holds hold
  where hold.shop_id = p_shop_id
    and hold.released_at is null
    and hold.starts_at <= clock_timestamp()
    and hold.expires_at > clock_timestamp()
    and (
      hold.resource_type = 'messaging_consent_event'
        and hold.resource_id = any(selected_event_ids)
      or hold.subject_key in (
        select event.subject_key
        from public.messaging_consent_events event
        where event.shop_id = p_shop_id
          and event.id = any(selected_event_ids)
      )
    )
  order by hold.id
  for update;
  if found then
    raise exception 'active messaging retention hold blocks compaction';
  end if;

  perform set_config(
    'vyntechs.messaging_consent_compaction_request',
    p_request_id::text,
    true
  );
  perform set_config(
    'vyntechs.messaging_consent_compaction_shop',
    p_shop_id::text,
    true
  );
  select array_agg(distinct event_id order by event_id)
  into authorized_event_ids
  from unnest(authorized_event_ids || selected_event_ids) events(event_id);
  perform set_config(
    'vyntechs.messaging_consent_compaction_events',
    authorized_event_ids::text,
    true
  );
  perform set_config(
    'vyntechs.messaging_deletion_work_item_compaction_request',
    p_request_id::text,
    true
  );

  with
    selected_work_items as materialized (
      select work_item.id, work_item.resource_id
      from public.messaging_deletion_work_items work_item
      where work_item.id = any(p_work_item_ids)
        and work_item.shop_id = p_shop_id
        and work_item.request_id = p_request_id
        and work_item.resource_type = 'consent_event'
        and work_item.outcome in ('pending', 'retained')
    ),
    locked_suppressions as materialized (
      select suppression.id, suppression.source_event_id
      from public.sms_suppressions suppression
      where suppression.shop_id = p_shop_id
        and suppression.source_event_id = any(selected_event_ids)
      order by suppression.id
      for update
    ),
    detached as (
      update public.sms_suppressions suppression
      set source_event_id = null, updated_at = clock_timestamp()
      from locked_suppressions locked
      where suppression.id = locked.id
      returning locked.source_event_id
    ),
    detach_counts as (
      select source_event_id, count(*)::integer as detached_count
      from detached
      group by source_event_id
    )
  update public.messaging_deletion_work_items work_item
  set outcome = 'deleted',
      retention_basis = null,
      detached_suppression_sources = coalesce(detach_counts.detached_count, 0),
      resolved_at = clock_timestamp()
  from selected_work_items selected
  left join detach_counts on detach_counts.source_event_id = selected.resource_id
  where work_item.id = selected.id;
  get diagnostics advanced_count = row_count;
  if advanced_count is distinct from selected_count then
    raise exception 'consent work item outcome advance was incomplete';
  end if;

  delete from public.messaging_consent_events event
  where event.shop_id = p_shop_id
    and event.id = any(selected_event_ids);
  get diagnostics deleted_count = row_count;
  if deleted_count is distinct from selected_count then
    raise exception 'exact consent event deletion was incomplete';
  end if;

  return advanced_count;
end;
$$;
--> statement-breakpoint


create function purge_expired_messaging_consent_event(p_shop_id uuid, p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
  event_subject_key uuid;
  existing_shop_text text;
  existing_events_text text;
  authorized_event_ids uuid[];
begin
  if nullif(current_setting('vyntechs.messaging_consent_compaction_request', true), '') is not null
    or nullif(current_setting('vyntechs.messaging_consent_compaction_shop', true), '') is not null
    or nullif(current_setting('vyntechs.messaging_consent_compaction_events', true), '') is not null
  then
    raise exception 'consent event purge transaction cannot mix compaction context';
  end if;

  existing_shop_text := nullif(current_setting(
    'vyntechs.messaging_consent_purge_shop', true
  ), '');
  existing_events_text := nullif(current_setting(
    'vyntechs.messaging_consent_purge_events', true
  ), '');
  if existing_shop_text is not null or existing_events_text is not null then
    begin
      if existing_shop_text is null
        or existing_events_text is null
        or existing_shop_text::uuid is distinct from p_shop_id then
        raise exception 'consent event purge transaction cannot mix shops';
      end if;
      authorized_event_ids := existing_events_text::uuid[];
    exception when invalid_text_representation then
      raise exception 'invalid consent event purge authorization context';
    end;
  else
    authorized_event_ids := array[]::uuid[];
  end if;

  perform 1
  from public.shops locked_shop
  where locked_shop.id = p_shop_id
  for update;
  if not found then
    return false;
  end if;

  select e.subject_key
  into event_subject_key
  from public.messaging_consent_events e
  where e.shop_id = p_shop_id and e.id = p_event_id
  for update;
  if not found then
    return false;
  end if;

  if not exists (
    select 1
    from public.messaging_consent_events e
    where e.shop_id = p_shop_id
      and e.id = p_event_id
      and e.retain_until <= clock_timestamp()
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.messaging_retention_holds h
    where h.shop_id = p_shop_id
      and h.released_at is null
      and h.starts_at <= clock_timestamp()
      and h.expires_at > clock_timestamp()
      and (
        h.subject_key = event_subject_key
        or (h.resource_type = 'messaging_consent_event' and h.resource_id = p_event_id)
      )
  ) then
    raise exception 'active messaging retention hold blocks consent event purge';
  end if;

  if exists (
    select 1
    from public.messaging_consent_state s
    where s.shop_id = p_shop_id and s.source_event_id = p_event_id
  ) then
    raise exception 'consent projection still references event';
  end if;
  if exists (
    select 1
    from public.sms_suppressions s
    where s.shop_id = p_shop_id and s.source_event_id = p_event_id
  ) then
    raise exception 'suppression still references event';
  end if;

  select array_agg(distinct event_id order by event_id)
  into authorized_event_ids
  from unnest(authorized_event_ids || p_event_id) as events(event_id);
  perform set_config('vyntechs.messaging_consent_purge_shop', p_shop_id::text, true);
  perform set_config(
    'vyntechs.messaging_consent_purge_events', authorized_event_ids::text, true
  );

  delete from public.messaging_consent_events e
  where e.shop_id = p_shop_id
    and e.id = p_event_id
    and e.retain_until <= clock_timestamp();
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;
--> statement-breakpoint

create function purge_expired_messaging_retention_hold(p_shop_id uuid, p_hold_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
  existing_shop_text text;
  existing_ids_text text;
  authorized_hold_ids uuid[];
begin
  existing_shop_text := nullif(current_setting(
    'vyntechs.messaging_retention_hold_purge_shop', true
  ), '');
  existing_ids_text := nullif(current_setting(
    'vyntechs.messaging_retention_hold_purge_ids', true
  ), '');
  if existing_shop_text is not null or existing_ids_text is not null then
    begin
      if existing_shop_text is null
        or existing_ids_text is null
        or existing_shop_text::uuid is distinct from p_shop_id then
        raise exception 'retention hold purge transaction cannot mix shops';
      end if;
      authorized_hold_ids := existing_ids_text::uuid[];
    exception when invalid_text_representation then
      raise exception 'invalid retention hold purge authorization context';
    end;
  else
    authorized_hold_ids := array[]::uuid[];
  end if;

  perform 1
  from public.shops locked_shop
  where locked_shop.id = p_shop_id
  for update;
  if not found then
    return false;
  end if;

  perform 1
  from public.messaging_retention_holds h
  where h.shop_id = p_shop_id and h.id = p_hold_id
  for update;
  if not found then
    return false;
  end if;

  if not exists (
    select 1
    from public.messaging_retention_holds h
    where h.shop_id = p_shop_id
      and h.id = p_hold_id
      and h.retain_until <= clock_timestamp()
  ) then
    return false;
  end if;

  select array_agg(distinct hold_id order by hold_id)
  into authorized_hold_ids
  from unnest(authorized_hold_ids || p_hold_id) as holds(hold_id);
  perform set_config(
    'vyntechs.messaging_retention_hold_purge_shop', p_shop_id::text, true
  );
  perform set_config(
    'vyntechs.messaging_retention_hold_purge_ids', authorized_hold_ids::text, true
  );

  delete from public.messaging_retention_holds h
  where h.shop_id = p_shop_id
    and h.id = p_hold_id
    and h.retain_until <= clock_timestamp();
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;
--> statement-breakpoint

create function guard_messaging_deletion_work_item_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  request_customer_id uuid;
  parent_request_id uuid;
  parent_resource_type text;
  parent_resource_id uuid;
  expected_counts_toward_proof boolean;
  matching_projection_id uuid;
  notification_entity_type text;
  notification_entity_id uuid;
begin
  if tg_op = 'UPDATE' then
    if (new.id, new.shop_id, new.request_id, new.resource_type, new.resource_id,
        new.parent_work_item_id, new.counts_toward_proof, new.discovered_at)
      is distinct from
       (old.id, old.shop_id, old.request_id, old.resource_type, old.resource_id,
        old.parent_work_item_id, old.counts_toward_proof, old.discovered_at)
    then
      raise exception 'deletion work item resource identity is immutable';
    end if;

    if not (
      (old.outcome = 'pending' and new.outcome in ('deleted', 'detached', 'retained'))
      or (old.outcome = 'retained' and new.outcome in ('deleted', 'detached'))
      or (old.outcome = 'retained' and new.outcome = 'retained'
        and ((old.retention_basis in ('resource_hold', 'subject_hold')
            and new.retention_basis = 'held_dependency')
          or (old.retention_basis = 'held_dependency'
            and new.retention_basis in ('resource_hold', 'subject_hold')))
        and new.detached_suppression_sources = old.detached_suppression_sources
        and new.resolved_at is not distinct from old.resolved_at)
    ) then
      raise exception 'invalid deletion work item outcome transition';
    end if;

    if new.detached_suppression_sources <> 0
      and current_setting(
        'vyntechs.messaging_deletion_work_item_compaction_request', true
      ) is distinct from new.request_id::text
    then
      raise exception 'deletion work item detached count requires controlled compaction';
    end if;
    return new;
  end if;

  if new.outcome <> 'pending'
    or new.retention_basis is not null
    or new.resolved_at is not null
    or new.detached_suppression_sources <> 0
  then
    raise exception 'deletion work items must be inserted pending';
  end if;

  if new.resource_type <> 'consent_event' and not new.counts_toward_proof then
    raise exception 'non-consent work item counts_toward_proof must be true';
  end if;

  select customer_id
  into request_customer_id
  from public.messaging_deletion_requests
  where shop_id = new.shop_id
    and id = new.request_id
    and state = 'pending'
    and customer_id is not null
  for update;
  if not found then
    raise exception 'deletion work item requires a canonical pending deletion request';
  end if;

  if new.parent_work_item_id is not null then
    select request_id, resource_type, resource_id
    into parent_request_id, parent_resource_type, parent_resource_id
    from public.messaging_deletion_work_items
    where id = new.parent_work_item_id
    for key share;
    if not found or parent_request_id <> new.request_id then
      raise exception 'deletion parent work item must belong to the same request';
    end if;
  end if;

  if new.resource_type = 'quote_send' then
    if new.parent_work_item_id is not null or not exists (
      select 1 from public.quote_sends q
      where q.id = new.resource_id
        and q.shop_id = new.shop_id
        and q.customer_id = request_customer_id
    ) then
      raise exception 'quote-send work item must match the pending request customer';
    end if;
  elsif new.resource_type = 'consent_projection' then
    if new.parent_work_item_id is not null or not exists (
      select 1 from public.messaging_consent_state s
      where s.id = new.resource_id
        and s.shop_id = new.shop_id
        and s.customer_id = request_customer_id
    ) then
      raise exception 'consent projection work item must match the pending request customer';
    end if;
  elsif new.resource_type = 'consent_event' then
    select not (e.event_type = 'deleted' and e.program_version = 'internal_deletion_v1')
    into expected_counts_toward_proof
    from public.messaging_consent_events e
    where e.id = new.resource_id
      and e.shop_id = new.shop_id
      and e.customer_id = request_customer_id;
    if not found then
      raise exception 'consent-event work item must match the pending request customer';
    end if;
    if new.counts_toward_proof is distinct from expected_counts_toward_proof then
      raise exception 'consent-event work item counts_toward_proof is derived from its source';
    end if;

    select s.id into matching_projection_id
    from public.messaging_consent_events e
    join public.messaging_consent_state s
      on s.shop_id = e.shop_id
      and s.subject_key = e.subject_key
      and s.destination_fingerprint = e.destination_fingerprint
      and s.fingerprint_key_version = e.fingerprint_key_version
      and s.program_version = e.program_version
    where e.id = new.resource_id and e.shop_id = new.shop_id;
    if found and (
      new.parent_work_item_id is null
      or parent_resource_type <> 'consent_projection'
      or parent_resource_id <> matching_projection_id
    ) then
      raise exception 'consent-event work item requires its exact projection parent';
    elsif not found and new.parent_work_item_id is not null then
      raise exception 'consent-event work item has no matching projection parent';
    end if;
  elsif new.resource_type = 'sms_log' then
    if new.parent_work_item_id is null
      or parent_resource_type <> 'quote_send'
      or not exists (
        select 1 from public.sms_log l
        where l.id = new.resource_id
          and l.shop_id = new.shop_id
          and l.quote_send_id = parent_resource_id
      )
    then
      raise exception 'SMS-log work item requires its exact quote-send parent';
    end if;
  elsif new.resource_type = 'notification' then
    select n.entity_type, n.entity_id
    into notification_entity_type, notification_entity_id
    from public.notifications n
    where n.id = new.resource_id and n.shop_id = new.shop_id;
    if not found then
      raise exception 'notification work item must match a live source';
    end if;
    if notification_entity_type = 'customer'
      and notification_entity_id = request_customer_id
    then
      if new.parent_work_item_id is not null then
        raise exception 'customer notification work item cannot have a parent';
      end if;
    elsif notification_entity_type = 'quote_send'
      and new.parent_work_item_id is not null
      and parent_resource_type = 'quote_send'
      and parent_resource_id = notification_entity_id
    then
      null;
    else
      raise exception 'quote-send notification work item requires its exact quote-send parent';
    end if;
  end if;

  return new;
end;
$$;
--> statement-breakpoint
create trigger messaging_deletion_work_items_guard
before insert or update on messaging_deletion_work_items
for each row execute function guard_messaging_deletion_work_item_mutation();
--> statement-breakpoint

create function finalize_messaging_deletion_request(p_shop_id uuid, p_request_id uuid)
returns table(state text, prior_record_counts jsonb, proof_summary jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row public.messaging_deletion_requests%rowtype;
  completed_at_value timestamptz;
  customer_binding_value text;
  result_counts jsonb;
  retained_counts jsonb;
  detached_count bigint;
  updated_count integer;
begin
  perform 1
  from public.shops locked_shop
  where locked_shop.id = p_shop_id
  for update;
  if not found then
    raise exception 'messaging deletion finalizer requires an exact shop';
  end if;

  select request.* into request_row
  from public.messaging_deletion_requests request
  where request.id = p_request_id
  for update;
  if not found or request_row.shop_id <> p_shop_id then
    raise exception 'messaging deletion finalizer request/shop mismatch';
  end if;

  if request_row.state = 'completed' then
    if exists (
      select 1 from public.messaging_deletion_work_items work
      where work.request_id = p_request_id
    ) then
      raise exception 'completed messaging deletion request cannot retain journal work';
    end if;
    state := request_row.state;
    prior_record_counts := request_row.prior_record_counts;
    proof_summary := request_row.proof_summary;
    return next;
    return;
  end if;

  if request_row.state <> 'pending' or request_row.customer_id is null then
    raise exception 'messaging deletion finalizer requires a canonical pending request';
  end if;
  if not exists (
    select 1
    from public.sms_suppressions suppression
    where suppression.shop_id = request_row.shop_id
      and suppression.destination_fingerprint = request_row.destination_fingerprint
      and suppression.fingerprint_key_version = request_row.fingerprint_key_version
      and suppression.reason in ('verified_deletion', 'permanent_failure', 'number_reassigned')
      and suppression.lifted_at is null
      and suppression.retain_until >= request_row.requested_at + interval '5 years'
  ) then
    raise exception 'messaging deletion finalizer requires an active suppression barrier';
  end if;

  if exists (
    select 1 from public.quote_sends source
    where source.shop_id = request_row.shop_id
      and source.customer_id = request_row.customer_id
      and not exists (
        select 1 from public.messaging_deletion_work_items work
        where work.request_id = request_row.id
          and work.resource_type = 'quote_send' and work.resource_id = source.id
      )
    union all
    select 1 from public.messaging_consent_state source
    where source.shop_id = request_row.shop_id
      and source.customer_id = request_row.customer_id
      and not exists (
        select 1 from public.messaging_deletion_work_items work
        where work.request_id = request_row.id
          and work.resource_type = 'consent_projection' and work.resource_id = source.id
      )
    union all
    select 1 from public.messaging_consent_events source
    where source.shop_id = request_row.shop_id
      and source.customer_id = request_row.customer_id
      and not exists (
        select 1 from public.messaging_deletion_work_items work
        where work.request_id = request_row.id
          and work.resource_type = 'consent_event' and work.resource_id = source.id
      )
    union all
    select 1
    from public.sms_log source
    join public.messaging_deletion_work_items parent
      on parent.request_id = request_row.id
      and parent.resource_type = 'quote_send'
      and parent.resource_id = source.quote_send_id
    where source.shop_id = request_row.shop_id
      and not exists (
        select 1 from public.messaging_deletion_work_items work
        where work.request_id = request_row.id
          and work.resource_type = 'sms_log' and work.resource_id = source.id
      )
    union all
    select 1
    from public.notifications source
    left join public.messaging_deletion_work_items parent
      on source.entity_type = 'quote_send'
      and parent.request_id = request_row.id
      and parent.resource_type = 'quote_send'
      and parent.resource_id = source.entity_id
    where source.shop_id = request_row.shop_id
      and ((source.entity_type = 'customer' and source.entity_id = request_row.customer_id)
        or (source.entity_type = 'quote_send' and parent.id is not null))
      and not exists (
        select 1 from public.messaging_deletion_work_items work
        where work.request_id = request_row.id
          and work.resource_type = 'notification' and work.resource_id = source.id
      )
  ) then
    state := 'pending';
    prior_record_counts := null;
    proof_summary := null;
    return next;
    return;
  end if;

  if exists (
    select 1 from public.messaging_deletion_work_items work
    where work.request_id = request_row.id and work.outcome = 'pending'
  ) then
    state := 'pending';
    prior_record_counts := null;
    proof_summary := null;
    return next;
    return;
  end if;

  if exists (
    select 1
    from public.messaging_deletion_work_items work
    where work.request_id = request_row.id and work.outcome = 'retained'
      and not (
        (work.resource_type = 'consent_event' and exists (
          select 1 from public.messaging_consent_events source
          where source.shop_id = work.shop_id and source.id = work.resource_id
        ))
        or (work.resource_type = 'consent_projection' and exists (
          select 1 from public.messaging_consent_state source
          where source.shop_id = work.shop_id and source.id = work.resource_id
        ))
        or (work.resource_type = 'quote_send' and exists (
          select 1 from public.quote_sends source
          where source.shop_id = work.shop_id and source.id = work.resource_id
        ))
        or (work.resource_type = 'sms_log' and exists (
          select 1 from public.sms_log source
          where source.shop_id = work.shop_id and source.id = work.resource_id
        ))
        or (work.resource_type = 'notification' and exists (
          select 1 from public.notifications source
          where source.shop_id = work.shop_id and source.id = work.resource_id
        ))
      )
  ) then
    raise exception 'retained deletion work item source disappeared';
  end if;

  if exists (
    select 1
    from public.messaging_deletion_work_items child
    join public.messaging_deletion_work_items parent
      on parent.request_id = child.request_id
      and parent.id = child.parent_work_item_id
    where child.request_id = request_row.id
      and child.outcome = 'retained'
      and child.resource_type in ('consent_event', 'sms_log', 'notification')
      and child.parent_work_item_id is not null
      and (parent.resource_type <> case child.resource_type
          when 'consent_event' then 'consent_projection' else 'quote_send' end
        or parent.outcome <> 'retained'
        or parent.retention_basis <> 'held_dependency')
  ) then
    state := 'pending';
    prior_record_counts := null;
    proof_summary := null;
    return next;
    return;
  end if;

  if exists (
    select 1
    from public.messaging_deletion_work_items work
    where work.request_id = request_row.id and work.outcome = 'retained'
      and not case work.retention_basis
        when 'resource_hold' then exists (
          select 1 from public.messaging_retention_holds hold
          where hold.shop_id = work.shop_id
            and hold.resource_id = work.resource_id
            and hold.resource_type = case work.resource_type
              when 'consent_event' then 'messaging_consent_event'
              else work.resource_type
            end
            and hold.released_at is null
            and hold.starts_at <= clock_timestamp()
            and hold.expires_at > clock_timestamp()
        )
        when 'subject_hold' then exists (
          select 1 from public.messaging_retention_holds hold
          where hold.shop_id = work.shop_id
            and hold.subject_key = case
              when work.resource_type = 'consent_event' then (
                select source.subject_key from public.messaging_consent_events source
                where source.shop_id = work.shop_id and source.id = work.resource_id
              )
              when work.resource_type = 'consent_projection' then (
                select source.subject_key from public.messaging_consent_state source
                where source.shop_id = work.shop_id and source.id = work.resource_id
              )
              when work.resource_type = 'quote_send' then (
                select source.subject_key from public.quote_sends source
                where source.shop_id = work.shop_id and source.id = work.resource_id
              )
              when work.resource_type = 'sms_log' then (
                select parent_source.subject_key
                from public.sms_log source
                join public.quote_sends parent_source
                  on parent_source.shop_id = source.shop_id
                  and parent_source.id = source.quote_send_id
                where source.shop_id = work.shop_id and source.id = work.resource_id
              )
              when work.resource_type = 'notification' then coalesce((
                select parent_source.subject_key
                from public.notifications source
                join public.quote_sends parent_source
                  on source.entity_type = 'quote_send'
                  and parent_source.shop_id = source.shop_id
                  and parent_source.id = source.entity_id
                where source.shop_id = work.shop_id and source.id = work.resource_id
              ), request_row.subject_key)
            end
            and hold.released_at is null
            and hold.starts_at <= clock_timestamp()
            and hold.expires_at > clock_timestamp()
        )
        when 'held_dependency' then (
          (work.resource_type in ('quote_send', 'consent_projection') and exists (
            select 1 from public.messaging_deletion_work_items child
            where child.request_id = work.request_id
              and child.parent_work_item_id = work.id
              and child.outcome = 'retained'
              and child.retention_basis in ('resource_hold', 'subject_hold')
          ))
          or (work.resource_type = 'consent_event' and exists (
            select 1
            from public.messaging_deletion_work_items parent
            join public.messaging_consent_state projection
              on projection.shop_id = parent.shop_id
              and projection.id = parent.resource_id
            where parent.id = work.parent_work_item_id
              and parent.request_id = work.request_id
              and parent.outcome = 'retained'
              and parent.retention_basis = 'held_dependency'
              and projection.source_event_id = work.resource_id
              and exists (
                select 1
                from public.messaging_deletion_work_items held_sibling
                where held_sibling.request_id = work.request_id
                  and held_sibling.parent_work_item_id = parent.id
                  and held_sibling.id <> work.id
                  and held_sibling.outcome = 'retained'
                  and held_sibling.retention_basis in ('resource_hold', 'subject_hold')
              )
          ))
        )
        else false
      end
  ) then
    state := 'pending';
    prior_record_counts := null;
    proof_summary := null;
    return next;
    return;
  end if;

  select jsonb_build_object(
    'consentEvents', count(*) filter (
      where resource_type = 'consent_event' and counts_toward_proof),
    'consentProjections', count(*) filter (where resource_type = 'consent_projection'),
    'notifications', count(*) filter (where resource_type = 'notification'),
    'quoteSends', count(*) filter (where resource_type = 'quote_send'),
    'smsLogs', count(*) filter (where resource_type = 'sms_log')
  ), jsonb_build_object(
    'consentEventsDeleted', count(*) filter (
      where resource_type = 'consent_event' and counts_toward_proof and outcome = 'deleted'),
    'notificationsDeleted', count(*) filter (
      where resource_type = 'notification' and outcome = 'deleted'),
    'smsLogsDeleted', count(*) filter (
      where resource_type = 'sms_log' and outcome = 'deleted'),
    'quoteSendsDeleted', count(*) filter (
      where resource_type = 'quote_send' and outcome = 'deleted'),
    'quoteSendsRetained', count(*) filter (
      where resource_type = 'quote_send' and outcome = 'retained')
  ), jsonb_build_object(
    'heldConsentEvents', count(*) filter (
      where resource_type = 'consent_event' and counts_toward_proof and outcome = 'retained'),
    'heldConsentProjections', count(*) filter (
      where resource_type = 'consent_projection' and outcome = 'retained'),
    'heldQuoteSends', count(*) filter (
      where resource_type = 'quote_send' and outcome = 'retained'),
    'heldSmsLogs', count(*) filter (
      where resource_type = 'sms_log' and outcome = 'retained'),
    'heldNotifications', count(*) filter (
      where resource_type = 'notification' and outcome = 'retained'),
    'total', count(*) filter (
      where outcome = 'retained'
        and (resource_type <> 'consent_event' or counts_toward_proof))
  ), coalesce(sum(detached_suppression_sources), 0)
  into prior_record_counts, result_counts, retained_counts, detached_count
  from public.messaging_deletion_work_items
  where request_id = request_row.id;

  select greatest(clock_timestamp(), coalesce(max(barrier.at) + interval '1 millisecond', '-infinity'))
  into completed_at_value
  from (
    select requested_at as at from public.messaging_deletion_requests
      where shop_id = request_row.shop_id
    union all select completed_at from public.messaging_deletion_requests
      where shop_id = request_row.shop_id
    union all select committed_at from public.messaging_consent_events
      where shop_id = request_row.shop_id
    union all select updated_at from public.quote_sends where shop_id = request_row.shop_id
    union all select updated_at from public.sms_suppressions where shop_id = request_row.shop_id
  ) barrier;
  customer_binding_value := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    '[' || pg_catalog.to_json('vyntechs:messaging-deletion-customer:v1'::text)::text || ','
      || pg_catalog.to_json(request_row.shop_id::text)::text || ','
      || pg_catalog.to_json(request_row.customer_id::text)::text || ','
      || pg_catalog.to_json(request_row.request_key::text)::text || ','
      || pg_catalog.to_json(request_row.request_fingerprint)::text || ','
      || pg_catalog.to_json(request_row.reason_code)::text || ','
      || pg_catalog.to_json(request_row.requesting_actor_profile_id::text)::text || ']',
    'UTF8'
  )), 'hex');
  proof_summary := jsonb_build_object(
    'version', 2,
    'customerBinding', customer_binding_value,
    'suppressionActive', 1,
    'deletedBarrier', 1,
    'suppressionSourceReferencesDetached', detached_count,
    'suppressionSourcesDetached', detached_count > 0,
    'retained', retained_counts,
    'resultCounts', result_counts
  );

  perform set_config(
    'vyntechs.messaging_deletion_finalizer_shop', request_row.shop_id::text, true
  );
  perform set_config(
    'vyntechs.messaging_deletion_finalizer_request', request_row.id::text, true
  );
  delete from public.messaging_deletion_work_items work
  where work.request_id = request_row.id;
  update public.messaging_deletion_requests request set
    customer_id = null,
    state = 'completed',
    completed_at = completed_at_value,
    latest_relevant_at = completed_at_value,
    prior_record_counts = finalize_messaging_deletion_request.prior_record_counts,
    proof_summary = finalize_messaging_deletion_request.proof_summary,
    retain_until = completed_at_value + interval '5 years'
  where request.id = request_row.id and request.state = 'pending';
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'messaging deletion finalizer transition failed';
  end if;
  state := 'completed';
  return next;
end;
$$;
--> statement-breakpoint

create function guard_messaging_deletion_request_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  finalizer_shop text;
  finalizer_request text;
begin
  if tg_op = 'DELETE' then
    if current_setting('vyntechs.messaging_retention_purge', true) = 'on'
      and current_user = pg_catalog.pg_get_userbyid((
        select p.proowner
        from pg_catalog.pg_proc p
        where p.oid = 'public.purge_expired_messaging_deletion_request(uuid,uuid)'::pg_catalog.regprocedure
      ))
      and old.state = 'completed'
      and old.retain_until <= now()
    then
      return old;
    end if;
    raise exception 'messaging deletion requests may only be purged after retention';
  end if;

  if old.state = 'completed' then
    raise exception 'completed messaging deletion tombstones are immutable';
  end if;

  if old.state = 'pending' and new.state = 'pending' then
    if (new.id, new.request_key, new.request_fingerprint, new.shop_id,
        new.subject_key, new.customer_id, new.destination_fingerprint,
        new.fingerprint_key_version, new.state, new.reason_code,
        new.requesting_actor_profile_id, new.requested_at, new.completed_at,
        new.latest_relevant_at, new.prior_record_counts, new.proof_summary, new.retain_until)
      is distinct from
       (old.id, old.request_key, old.request_fingerprint, old.shop_id,
        old.subject_key, old.customer_id, old.destination_fingerprint,
        old.fingerprint_key_version, old.state, old.reason_code,
        old.requesting_actor_profile_id, old.requested_at, old.completed_at,
        old.latest_relevant_at, old.prior_record_counts, old.proof_summary, old.retain_until)
    then
      raise exception 'messaging deletion request identity is immutable';
    end if;
    return new;
  end if;

  finalizer_shop := nullif(current_setting(
    'vyntechs.messaging_deletion_finalizer_shop', true
  ), '');
  finalizer_request := nullif(current_setting(
    'vyntechs.messaging_deletion_finalizer_request', true
  ), '');

  if old.state <> 'pending' or new.state <> 'completed'
    or new.id is distinct from old.id
    or new.request_key is distinct from old.request_key
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.shop_id is distinct from old.shop_id
    or new.subject_key is distinct from old.subject_key
    or new.destination_fingerprint is distinct from old.destination_fingerprint
    or new.fingerprint_key_version is distinct from old.fingerprint_key_version
    or new.reason_code is distinct from old.reason_code
    or new.requesting_actor_profile_id is distinct from old.requesting_actor_profile_id
    or new.requested_at is distinct from old.requested_at
    or finalizer_shop is distinct from old.shop_id::text
    or finalizer_request is distinct from old.id::text
    or current_user <> pg_catalog.pg_get_userbyid((
      select p.proowner from pg_catalog.pg_proc p
      where p.oid = 'public.finalize_messaging_deletion_request(uuid,uuid)'::pg_catalog.regprocedure
    ))
    or exists (
      select 1 from public.messaging_deletion_work_items work
      where work.request_id = old.id
    )
  then
    raise exception 'messaging deletion requests permit finalizer completion exactly once';
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger messaging_deletion_requests_guard
before update or delete on messaging_deletion_requests
for each row execute function guard_messaging_deletion_request_mutation();
--> statement-breakpoint

create function purge_expired_messaging_deletion_request(p_shop_id uuid, p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
  request_subject_key uuid;
begin
  perform 1
  from public.shops locked_shop
  where locked_shop.id = p_shop_id
  for update;
  if not found then
    return false;
  end if;

  select subject_key
  into request_subject_key
  from public.messaging_deletion_requests
  where shop_id = p_shop_id and id = p_request_id
  for update;
  if not found then
    return false;
  end if;

  if not exists (
    select 1
    from public.messaging_deletion_requests
    where shop_id = p_shop_id
      and id = p_request_id
      and state = 'completed'
      and retain_until <= clock_timestamp()
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.messaging_retention_holds h
    where h.shop_id = p_shop_id
      and h.released_at is null
      and h.starts_at <= clock_timestamp()
      and h.expires_at > clock_timestamp()
      and (
        h.subject_key = request_subject_key
        or (h.resource_type = 'messaging_deletion_request' and h.resource_id = p_request_id)
      )
  ) then
    raise exception 'active messaging retention hold blocks purge';
  end if;

  perform set_config('vyntechs.messaging_retention_purge', 'on', true);
  delete from public.messaging_deletion_requests
    where shop_id = p_shop_id
      and id = p_request_id
      and state = 'completed'
      and retain_until <= clock_timestamp();
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;
--> statement-breakpoint

alter table messaging_consent_events enable row level security;
alter table messaging_consent_state enable row level security;
alter table sms_suppressions enable row level security;
alter table messaging_deletion_requests enable row level security;
alter table messaging_deletion_work_items enable row level security;
alter table messaging_retention_holds enable row level security;
alter table quote_sends enable row level security;
alter table sms_log enable row level security;
alter table notifications enable row level security;
--> statement-breakpoint

revoke all privileges on table
  messaging_consent_events, messaging_consent_state, sms_suppressions,
  messaging_deletion_requests, messaging_deletion_work_items, messaging_retention_holds,
  quote_sends, sms_log, notifications
from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on table
  messaging_consent_events, messaging_consent_state, sms_suppressions,
  messaging_deletion_requests, messaging_deletion_work_items, messaging_retention_holds,
  quote_sends, sms_log, notifications
to service_role;
--> statement-breakpoint

create policy messaging_consent_events_server_only_deny_direct on messaging_consent_events
  for all to anon, authenticated using (false) with check (false);
create policy messaging_consent_state_server_only_deny_direct on messaging_consent_state
  for all to anon, authenticated using (false) with check (false);
create policy sms_suppressions_server_only_deny_direct on sms_suppressions
  for all to anon, authenticated using (false) with check (false);
create policy messaging_deletion_requests_server_only_deny_direct on messaging_deletion_requests
  for all to anon, authenticated using (false) with check (false);
create policy messaging_deletion_work_items_server_only_deny_direct on messaging_deletion_work_items
  for all to anon, authenticated using (false) with check (false);
create policy messaging_retention_holds_server_only_deny_direct on messaging_retention_holds
  for all to anon, authenticated using (false) with check (false);
create policy quote_sends_server_only_deny_direct on quote_sends
  for all to anon, authenticated using (false) with check (false);
create policy sms_log_server_only_deny_direct on sms_log
  for all to anon, authenticated using (false) with check (false);
create policy notifications_server_only_deny_direct on notifications
  for all to anon, authenticated using (false) with check (false);
--> statement-breakpoint

revoke all on function reject_messaging_consent_event_mutation() from public, anon, authenticated, service_role;
revoke all on function validate_quote_event_send_reference() from public, anon, authenticated, service_role;
revoke all on function guard_quote_send_lifecycle() from public, anon, authenticated, service_role;
revoke all on function serialize_messaging_retention_hold_target() from public, anon, authenticated, service_role;
revoke all on function require_messaging_compaction_completion() from public, anon, authenticated, service_role;
revoke all on function guard_messaging_deletion_work_item_mutation() from public, anon, authenticated, service_role;
revoke all on function guard_messaging_deletion_request_mutation() from public, anon, authenticated, service_role;
revoke all on function compact_messaging_consent_work_items(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function finalize_messaging_deletion_request(uuid, uuid) from public, anon, authenticated;
revoke all on function purge_expired_messaging_deletion_request(uuid, uuid) from public, anon, authenticated;
revoke all on function purge_expired_messaging_consent_event(uuid, uuid) from public, anon, authenticated;
revoke all on function purge_expired_messaging_retention_hold(uuid, uuid) from public, anon, authenticated;
grant execute on function compact_messaging_consent_work_items(uuid, uuid, uuid[]) to service_role;
grant execute on function finalize_messaging_deletion_request(uuid, uuid) to service_role;
grant execute on function purge_expired_messaging_deletion_request(uuid, uuid) to service_role;
grant execute on function purge_expired_messaging_consent_event(uuid, uuid) to service_role;
grant execute on function purge_expired_messaging_retention_hold(uuid, uuid) to service_role;
