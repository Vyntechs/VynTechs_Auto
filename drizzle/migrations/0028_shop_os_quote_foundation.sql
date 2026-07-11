-- Shop OS Phase 3: source-only quote, story, canned-work, and attachment foundation.
-- Production application remains a separate owner gate.

alter table shops
  add column labor_rate_cents bigint,
  add column tax_rate_bps integer,
  add constraint shops_labor_rate_cents_range check (
    labor_rate_cents is null or labor_rate_cents between 0 and 9007199254740991
  ),
  add constraint shops_tax_rate_bps_range check (
    tax_rate_bps is null or tax_rate_bps between 0 and 10000
  );
--> statement-breakpoint

alter table ticket_jobs
  add column customer_story jsonb,
  add column story_meta jsonb,
  add constraint ticket_jobs_story_json_objects check (
    (customer_story is null or jsonb_typeof(customer_story) = 'object')
    and (story_meta is null or jsonb_typeof(story_meta) = 'object')
  );
--> statement-breakpoint

create unique index ticket_jobs_shop_id_uq on ticket_jobs (shop_id, id);
--> statement-breakpoint
create unique index ticket_jobs_shop_ticket_id_uq on ticket_jobs (shop_id, ticket_id, id);
--> statement-breakpoint

create table quote_versions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  ticket_id uuid not null,
  version_number integer not null,
  snapshot jsonb not null,
  created_by_profile_id uuid not null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  constraint quote_versions_shop_ticket_fk
    foreign key (shop_id, ticket_id) references tickets(shop_id, id) on delete restrict,
  constraint quote_versions_shop_creator_fk
    foreign key (shop_id, created_by_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint quote_versions_number_positive check (version_number > 0),
  constraint quote_versions_snapshot_object check (jsonb_typeof(snapshot) = 'object')
);
--> statement-breakpoint

create unique index quote_versions_shop_ticket_version_uq
  on quote_versions (shop_id, ticket_id, version_number);
--> statement-breakpoint
create unique index quote_versions_shop_ticket_id_uq
  on quote_versions (shop_id, ticket_id, id);
--> statement-breakpoint
create index quote_versions_ticket_created_idx
  on quote_versions (ticket_id, created_at);
--> statement-breakpoint
create index quote_versions_shop_creator_idx
  on quote_versions (shop_id, created_by_profile_id);
--> statement-breakpoint

alter table ticket_jobs
  add column approved_quote_version_id uuid,
  add constraint ticket_jobs_approved_quote_version_fk
    foreign key (shop_id, ticket_id, approved_quote_version_id)
    references quote_versions(shop_id, ticket_id, id) on delete restrict;
--> statement-breakpoint

create index ticket_jobs_approved_quote_version_idx
  on ticket_jobs (shop_id, ticket_id, approved_quote_version_id)
  where approved_quote_version_id is not null;
--> statement-breakpoint

create table job_attachments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  job_id uuid not null,
  storage_key text not null,
  kind text not null,
  mime_type text not null,
  byte_size bigint not null,
  uploaded_by_profile_id uuid not null,
  created_at timestamptz not null default now(),
  constraint job_attachments_shop_job_fk
    foreign key (shop_id, job_id) references ticket_jobs(shop_id, id) on delete restrict,
  constraint job_attachments_shop_uploader_fk
    foreign key (shop_id, uploaded_by_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint job_attachments_kind_valid check (kind in ('photo', 'video', 'document')),
  constraint job_attachments_byte_size_range check (
    byte_size between 0 and 9007199254740991
  )
);
--> statement-breakpoint

create unique index job_attachments_shop_storage_key_uq
  on job_attachments (shop_id, storage_key);
--> statement-breakpoint
create index job_attachments_job_created_idx
  on job_attachments (shop_id, job_id, created_at);
--> statement-breakpoint
create index job_attachments_uploader_created_idx
  on job_attachments (shop_id, uploaded_by_profile_id, created_at);
--> statement-breakpoint

create table job_lines (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  job_id uuid not null,
  kind text not null,
  description text not null,
  sort integer not null default 0,
  quantity numeric(12,3) not null default 1,
  price_cents bigint not null,
  taxable boolean not null default true,
  part_number text,
  brand text,
  unit_cost_cents bigint,
  core_charge_cents bigint,
  fitment text,
  vendor_account_id uuid,
  external_offer_id text,
  vendor_snapshot jsonb,
  part_status text not null default 'proposed',
  ordered_at timestamptz,
  ordered_by_profile_id uuid,
  received_at timestamptz,
  received_by_profile_id uuid,
  labor_hours numeric(8,2),
  labor_rate_cents bigint,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint job_lines_shop_job_fk
    foreign key (shop_id, job_id) references ticket_jobs(shop_id, id) on delete restrict,
  constraint job_lines_shop_ordered_by_fk
    foreign key (shop_id, ordered_by_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint job_lines_shop_received_by_fk
    foreign key (shop_id, received_by_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint job_lines_kind_valid check (kind in ('part', 'labor', 'fee')),
  constraint job_lines_sort_nonnegative check (sort >= 0),
  constraint job_lines_quantity_positive check (quantity > 0),
  constraint job_lines_money_nonnegative check (
    price_cents >= 0
    and (unit_cost_cents is null or unit_cost_cents >= 0)
    and (core_charge_cents is null or core_charge_cents >= 0)
    and (labor_rate_cents is null or labor_rate_cents >= 0)
  ),
  constraint job_lines_money_safe_integer check (
    price_cents <= 9007199254740991
    and (unit_cost_cents is null or unit_cost_cents <= 9007199254740991)
    and (core_charge_cents is null or core_charge_cents <= 9007199254740991)
    and (labor_rate_cents is null or labor_rate_cents <= 9007199254740991)
  ),
  constraint job_lines_labor_hours_nonnegative check (
    labor_hours is null or labor_hours >= 0
  ),
  constraint job_lines_part_status_valid check (
    part_status in ('proposed', 'needs_order', 'ordered', 'received', 'installed', 'returned')
  ),
  constraint job_lines_source_valid check (
    source in ('manual', 'vendor_offer', 'diagnosis_seed', 'guide')
  ),
  constraint job_lines_json_objects check (
    vendor_snapshot is null or jsonb_typeof(vendor_snapshot) = 'object'
  )
);
--> statement-breakpoint

create index job_lines_job_sort_idx on job_lines (shop_id, job_id, sort);
--> statement-breakpoint
create index job_lines_ordered_by_idx
  on job_lines (shop_id, ordered_by_profile_id)
  where ordered_by_profile_id is not null;
--> statement-breakpoint
create index job_lines_received_by_idx
  on job_lines (shop_id, received_by_profile_id)
  where received_by_profile_id is not null;
--> statement-breakpoint
create index job_lines_shop_vendor_account_idx
  on job_lines (shop_id, vendor_account_id)
  where vendor_account_id is not null;
--> statement-breakpoint

create table canned_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  title text not null,
  kind text not null,
  default_required_skill_tier integer not null,
  default_lines jsonb not null default '[]'::jsonb,
  sort integer not null default 0,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canned_jobs_shop_id_shops_id_fk
    foreign key (shop_id) references shops(id) on delete cascade,
  constraint canned_jobs_kind_valid check (kind in ('repair', 'maintenance')),
  constraint canned_jobs_skill_tier_range check (default_required_skill_tier between 1 and 3),
  constraint canned_jobs_sort_nonnegative check (sort >= 0),
  constraint canned_jobs_default_lines_array check (jsonb_typeof(default_lines) = 'array')
);
--> statement-breakpoint

create index canned_jobs_shop_sort_idx on canned_jobs (shop_id, retired_at, sort);
--> statement-breakpoint

create table quote_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  ticket_id uuid not null,
  job_id uuid,
  quote_version_id uuid not null,
  quote_send_id uuid,
  kind text not null,
  actor_profile_id uuid,
  approved_via text,
  request_key text not null,
  provider_event_id text,
  body text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint quote_events_shop_ticket_fk
    foreign key (shop_id, ticket_id) references tickets(shop_id, id) on delete restrict,
  constraint quote_events_shop_ticket_job_fk
    foreign key (shop_id, ticket_id, job_id)
    references ticket_jobs(shop_id, ticket_id, id) on delete restrict,
  constraint quote_events_shop_ticket_version_fk
    foreign key (shop_id, ticket_id, quote_version_id)
    references quote_versions(shop_id, ticket_id, id) on delete restrict,
  constraint quote_events_shop_actor_fk
    foreign key (shop_id, actor_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint quote_events_kind_valid check (
    kind in ('sent', 'delivered', 'viewed', 'approved', 'declined', 'question')
  ),
  constraint quote_events_approved_via_valid check (
    approved_via is null or approved_via in ('page', 'phone', 'in_person')
  ),
  constraint quote_events_approval_channel_consistent check (
    (kind = 'approved' and approved_via is not null)
    or (kind <> 'approved' and approved_via is null)
  ),
  constraint quote_events_decision_job_consistent check (
    kind not in ('approved', 'declined') or job_id is not null
  ),
  constraint quote_events_offline_approval_actor_consistent check (
    kind <> 'approved'
    or approved_via not in ('phone', 'in_person')
    or actor_profile_id is not null
  )
);
--> statement-breakpoint

create unique index quote_events_shop_request_key_uq
  on quote_events (shop_id, request_key);
--> statement-breakpoint
create unique index quote_events_shop_provider_event_uq
  on quote_events (shop_id, provider_event_id)
  where provider_event_id is not null;
--> statement-breakpoint
create index quote_events_ticket_created_idx
  on quote_events (shop_id, ticket_id, created_at);
--> statement-breakpoint
create index quote_events_job_idx
  on quote_events (shop_id, ticket_id, job_id)
  where job_id is not null;
--> statement-breakpoint
create index quote_events_version_idx
  on quote_events (shop_id, ticket_id, quote_version_id);
--> statement-breakpoint
create index quote_events_actor_idx
  on quote_events (shop_id, actor_profile_id)
  where actor_profile_id is not null;
--> statement-breakpoint
create index quote_events_quote_send_idx
  on quote_events (quote_send_id)
  where quote_send_id is not null;
--> statement-breakpoint

create or replace function reject_quote_events_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'quote_events_append_only' using errcode = '23514';
end;
$$;
--> statement-breakpoint

create trigger quote_events_append_only_update
before update on quote_events
for each row execute function reject_quote_events_mutation();
--> statement-breakpoint
create trigger quote_events_append_only_delete
before delete on quote_events
for each row execute function reject_quote_events_mutation();
--> statement-breakpoint

create or replace function guard_quote_versions_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'quote_versions_immutable' using errcode = '23514';
  end if;

  if old.superseded_at is not null
     or new.superseded_at is null
     or new.id is distinct from old.id
     or new.shop_id is distinct from old.shop_id
     or new.ticket_id is distinct from old.ticket_id
     or new.version_number is distinct from old.version_number
     or new.snapshot is distinct from old.snapshot
     or new.created_by_profile_id is distinct from old.created_by_profile_id
     or new.created_at is distinct from old.created_at then
    raise exception 'quote_versions_immutable' using errcode = '23514';
  end if;

  return new;
end;
$$;
--> statement-breakpoint

create trigger quote_versions_immutable_update
before update on quote_versions
for each row execute function guard_quote_versions_immutable();
--> statement-breakpoint
create trigger quote_versions_immutable_delete
before delete on quote_versions
for each row execute function guard_quote_versions_immutable();
--> statement-breakpoint

alter table job_attachments enable row level security;
--> statement-breakpoint
alter table job_lines enable row level security;
--> statement-breakpoint
alter table canned_jobs enable row level security;
--> statement-breakpoint
alter table quote_versions enable row level security;
--> statement-breakpoint
alter table quote_events enable row level security;
--> statement-breakpoint

revoke select, insert, update, delete
  on job_attachments, job_lines, canned_jobs, quote_versions, quote_events
  from anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete
  on job_attachments, job_lines, canned_jobs, quote_versions, quote_events
  to service_role;
--> statement-breakpoint

create policy job_attachments_server_only_deny_direct
  on job_attachments for all to anon, authenticated
  using (false) with check (false);
--> statement-breakpoint
create policy job_lines_server_only_deny_direct
  on job_lines for all to anon, authenticated
  using (false) with check (false);
--> statement-breakpoint
create policy canned_jobs_server_only_deny_direct
  on canned_jobs for all to anon, authenticated
  using (false) with check (false);
--> statement-breakpoint
create policy quote_versions_server_only_deny_direct
  on quote_versions for all to anon, authenticated
  using (false) with check (false);
--> statement-breakpoint
create policy quote_events_server_only_deny_direct
  on quote_events for all to anon, authenticated
  using (false) with check (false);
