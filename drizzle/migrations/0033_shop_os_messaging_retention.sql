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
    (state = 'pending' and customer_id is not null and completed_at is null and prior_record_counts is null and proof_summary is null and retain_until is null)
    or (state = 'completed' and customer_id is null and completed_at is not null and prior_record_counts is not null and proof_summary is not null and retain_until is not null)
  )
);
--> statement-breakpoint
create unique index messaging_deletion_requests_shop_id_uq on messaging_deletion_requests (shop_id, id);
--> statement-breakpoint
create unique index messaging_deletion_requests_shop_actor_request_uq on messaging_deletion_requests (shop_id, requesting_actor_profile_id, request_key);
--> statement-breakpoint
create index messaging_deletion_requests_pending_idx on messaging_deletion_requests (shop_id, requested_at) where state = 'pending';
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
  constraint messaging_retention_holds_resource_type_valid check (resource_type is null or resource_type ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'),
  constraint messaging_retention_holds_reason_code_valid check (reason_code ~ '^[a-z][a-z0-9_]{0,62}[a-z0-9]$'),
  constraint messaging_retention_holds_target_consistent check (
    (subject_key is not null and resource_type is null and resource_id is null)
    or (subject_key is null and resource_type is not null and resource_id is not null)
  ),
  constraint messaging_retention_holds_review_valid check (review_at >= starts_at and review_at <= expires_at),
  constraint messaging_retention_holds_release_valid check (released_at is null or released_at >= starts_at),
  constraint messaging_retention_holds_max_duration check (
    expires_at > starts_at and expires_at <= starts_at + interval '365 days'
  )
);
--> statement-breakpoint
create unique index messaging_retention_holds_shop_id_uq on messaging_retention_holds (shop_id, id);
--> statement-breakpoint
create index messaging_retention_holds_active_subject_idx on messaging_retention_holds (shop_id, subject_key, expires_at) where subject_key is not null and released_at is null;
--> statement-breakpoint

create function reject_messaging_consent_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('vyntechs.messaging_consent_compaction', true) = 'on'
    and current_user = pg_catalog.pg_get_userbyid((
      select p.proowner
      from pg_catalog.pg_proc p
      where p.oid = 'public.compact_messaging_consent_events(uuid,uuid)'::pg_catalog.regprocedure
    ))
    and tg_op = 'DELETE'
  then
    return old;
  end if;
  raise exception 'messaging consent events are append-only';
end;
$$;
--> statement-breakpoint
create trigger messaging_consent_events_append_only
before update or delete on messaging_consent_events
for each row execute function reject_messaging_consent_event_mutation();
--> statement-breakpoint

create function compact_messaging_consent_events(p_shop_id uuid, p_subject_key uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count integer;
begin
  perform set_config('vyntechs.messaging_consent_compaction', 'on', true);
  delete from public.messaging_consent_events
    where shop_id = p_shop_id and subject_key = p_subject_key;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
--> statement-breakpoint

create function guard_messaging_deletion_request_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
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
  then
    raise exception 'messaging deletion requests permit pending to completed exactly once';
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
begin
  perform set_config('vyntechs.messaging_retention_purge', 'on', true);
  delete from public.messaging_deletion_requests
    where shop_id = p_shop_id
      and id = p_request_id
      and state = 'completed'
      and retain_until <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count = 1;
end;
$$;
--> statement-breakpoint

alter table messaging_consent_events enable row level security;
alter table messaging_consent_state enable row level security;
alter table sms_suppressions enable row level security;
alter table messaging_deletion_requests enable row level security;
alter table messaging_retention_holds enable row level security;
--> statement-breakpoint

revoke all privileges on table
  messaging_consent_events, messaging_consent_state, sms_suppressions,
  messaging_deletion_requests, messaging_retention_holds
from public, anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on table
  messaging_consent_events, messaging_consent_state, sms_suppressions,
  messaging_deletion_requests, messaging_retention_holds
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
create policy messaging_retention_holds_server_only_deny_direct on messaging_retention_holds
  for all to anon, authenticated using (false) with check (false);
--> statement-breakpoint

revoke all on function reject_messaging_consent_event_mutation() from public, anon, authenticated, service_role;
revoke all on function guard_messaging_deletion_request_mutation() from public, anon, authenticated, service_role;
revoke all on function compact_messaging_consent_events(uuid, uuid) from public, anon, authenticated;
revoke all on function purge_expired_messaging_deletion_request(uuid, uuid) from public, anon, authenticated;
grant execute on function compact_messaging_consent_events(uuid, uuid) to service_role;
grant execute on function purge_expired_messaging_deletion_request(uuid, uuid) to service_role;
