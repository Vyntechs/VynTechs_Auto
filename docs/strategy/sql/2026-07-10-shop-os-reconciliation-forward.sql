-- Shop OS Phase-0 reconciliation draft — FOR LOCAL REHEARSAL ONLY.
--
-- This file is not a Drizzle migration and must not be applied to production.
-- It targets the exact live predecessor state inspected on 2026-07-10:
--   20260517134921 shop_mgmt_foundation
--   20260610181258 shop_os_v2_foundation
--
-- Phase 1 row 5 promotes the reviewed SQL into lib/db/schema.ts + a real
-- drizzle migration. Phase 1 row 6 remains the production owner gate.

begin;

do $$
begin
  if to_regclass('public.tickets') is not null
     or to_regclass('public.ticket_jobs') is not null then
    raise exception 'shop_os_reconciliation:canonical_tables_already_exist';
  end if;

  if to_regclass('public.repair_orders') is null
     or to_regclass('public.work_orders') is null
     or to_regclass('public.concerns') is null
     or to_regclass('public.line_items') is null
     or to_regclass('public.authorizations') is null
     or to_regclass('public.outbound_messages') is null then
    raise exception 'shop_os_reconciliation:predecessor_schema_missing';
  end if;

  if exists (select 1 from work_orders)
     or exists (select 1 from concerns)
     or exists (select 1 from line_items)
     or exists (select 1 from authorizations)
     or exists (select 1 from outbound_messages) then
    raise exception 'shop_os_reconciliation:v2_tables_not_empty';
  end if;

  if exists (
    select 1
    from customers
    where preferred_channel is distinct from 'sms'
       or opt_ins is distinct from '{}'::jsonb
  ) then
    raise exception 'shop_os_reconciliation:customer_fields_not_default';
  end if;

  if exists (select 1 from vehicles where diesel_context is not null)
     or exists (select 1 from sessions where customer_authorized is not null) then
    raise exception 'shop_os_reconciliation:legacy_fields_not_empty';
  end if;

  if exists (select 1 from repair_orders where status not in ('open', 'closed')) then
    raise exception 'shop_os_reconciliation:unsupported_repair_order_status';
  end if;

  if exists (
    select 1
    from repair_orders ro
    join customers c on c.id = ro.customer_id
    join vehicles v on v.id = ro.vehicle_id
    join profiles opener on opener.id = ro.opened_by
    where c.shop_id <> ro.shop_id
       or v.customer_id <> ro.customer_id
       or opener.shop_id is distinct from ro.shop_id
       or not exists (
         select 1
         from shops s
         where s.id = ro.shop_id and s.shop_mgmt_enabled = true
       )
  ) or exists (
    select 1
    from sessions s
    join repair_orders ro on ro.id = s.repair_order_id
    join profiles tech on tech.id = s.tech_id
    where s.shop_id <> ro.shop_id
       or s.vehicle_id is distinct from ro.vehicle_id
       or tech.shop_id is distinct from ro.shop_id
  ) then
    raise exception 'shop_os_reconciliation:invalid_legacy_links';
  end if;

  if exists (
    select 1
    from shops s
    where s.shop_mgmt_enabled is distinct from exists (
      select 1 from repair_orders ro where ro.shop_id = s.id
    )
  ) then
    raise exception 'shop_os_reconciliation:shop_flag_mapping';
  end if;

  if exists (
    select 1
    from repair_orders ro
    left join sessions s on s.repair_order_id = ro.id
    group by ro.id
    having count(s.id) <> 1
  ) then
    raise exception 'shop_os_reconciliation:repair_order_session_count';
  end if;
end $$;

alter table shops
  add column next_ticket_number bigint not null default 1,
  add constraint shops_next_ticket_number_positive check (next_ticket_number > 0);

alter table profiles
  add column skill_tier integer,
  add constraint profiles_skill_tier_range check (skill_tier is null or skill_tier between 1 and 3);

update profiles
set skill_tier = 1
where role = 'tech' and deactivated_at is null;

create unique index customers_shop_id_id_uq on customers (shop_id, id);
create unique index profiles_shop_id_id_uq on profiles (shop_id, id);
create unique index vehicles_customer_id_id_uq on vehicles (customer_id, id);
create unique index sessions_shop_id_id_uq on sessions (shop_id, id);

create table tickets (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  ticket_number bigint not null,
  source text not null,
  customer_id uuid,
  vehicle_id uuid,
  concern text not null,
  when_started text,
  how_often text,
  diagnostic_authorized_cents bigint,
  diagnostic_authorization_note text,
  status text not null default 'open',
  created_by_profile_id uuid not null,
  canceled_at timestamptz,
  canceled_by_profile_id uuid,
  canceled_reason text,
  delivered_at timestamptz,
  delivered_by_profile_id uuid,
  closed_at timestamptz,
  closed_by_profile_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tickets_shop_id_shops_id_fk
    foreign key (shop_id) references shops(id) on delete restrict,
  constraint tickets_shop_customer_fk
    foreign key (shop_id, customer_id) references customers(shop_id, id) on delete restrict,
  constraint tickets_customer_vehicle_fk
    foreign key (customer_id, vehicle_id) references vehicles(customer_id, id) on delete restrict,
  constraint tickets_shop_creator_fk
    foreign key (shop_id, created_by_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint tickets_shop_canceler_fk
    foreign key (shop_id, canceled_by_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint tickets_shop_deliverer_fk
    foreign key (shop_id, delivered_by_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint tickets_shop_closer_fk
    foreign key (shop_id, closed_by_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint tickets_number_positive check (ticket_number > 0),
  constraint tickets_source_valid check (
    source in ('counter', 'tech_quick', 'quick_quote', 'legacy_repair_order')
  ),
  constraint tickets_status_valid check (status in ('open', 'closed', 'canceled')),
  constraint tickets_customer_vehicle_pair check (
    (customer_id is not null and vehicle_id is not null)
    or (source = 'tech_quick' and customer_id is null and vehicle_id is null)
  ),
  constraint tickets_diagnostic_authorized_cents_nonnegative check (
    diagnostic_authorized_cents is null or diagnostic_authorized_cents >= 0
  )
);

create unique index tickets_shop_ticket_number_uq on tickets (shop_id, ticket_number);
create unique index tickets_shop_id_id_uq on tickets (shop_id, id);
create index tickets_shop_status_idx on tickets (shop_id, status);
create index tickets_customer_idx on tickets (customer_id);
create index tickets_vehicle_idx on tickets (vehicle_id);

create table ticket_jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  ticket_id uuid not null,
  title text not null,
  kind text not null,
  required_skill_tier integer not null,
  assigned_tech_id uuid,
  claimed_at timestamptz,
  session_id uuid,
  work_status text not null default 'open',
  approval_state text not null default 'pending_quote',
  work_notes text,
  diagnostic_start_state text not null default 'idle',
  diagnostic_start_attempt_key text,
  diagnostic_start_lease_until timestamptz,
  diagnostic_start_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_jobs_shop_id_shops_id_fk
    foreign key (shop_id) references shops(id) on delete restrict,
  constraint ticket_jobs_shop_ticket_fk
    foreign key (shop_id, ticket_id) references tickets(shop_id, id) on delete cascade,
  constraint ticket_jobs_shop_assignee_fk
    foreign key (shop_id, assigned_tech_id) references profiles(shop_id, id) on delete restrict,
  constraint ticket_jobs_shop_session_fk
    foreign key (shop_id, session_id) references sessions(shop_id, id) on delete restrict,
  constraint ticket_jobs_kind_valid check (kind in ('diagnostic', 'repair', 'maintenance')),
  constraint ticket_jobs_skill_tier_range check (required_skill_tier between 1 and 3),
  constraint ticket_jobs_work_status_valid check (
    work_status in ('open', 'in_progress', 'blocked', 'done', 'canceled')
  ),
  constraint ticket_jobs_approval_state_valid check (
    approval_state in ('pending_quote', 'quote_ready', 'sent', 'approved', 'declined')
  ),
  constraint ticket_jobs_diagnostic_start_state_valid check (
    diagnostic_start_state in ('idle', 'initializing', 'ready', 'failed', 'ambiguous')
  ),
  constraint ticket_jobs_session_only_for_diagnostic check (
    session_id is null or kind = 'diagnostic'
  )
);

create unique index ticket_jobs_session_id_uq
  on ticket_jobs (session_id) where session_id is not null;
create unique index ticket_jobs_shop_start_attempt_uq
  on ticket_jobs (shop_id, diagnostic_start_attempt_key)
  where diagnostic_start_attempt_key is not null;
create index ticket_jobs_shop_assignee_status_idx
  on ticket_jobs (shop_id, assigned_tech_id, work_status);
create index ticket_jobs_shop_open_tier_idx
  on ticket_jobs (shop_id, required_skill_tier, work_status)
  where assigned_tech_id is null;
create index ticket_jobs_ticket_idx on ticket_jobs (ticket_id);

with ranked as (
  select
    ro.*,
    s.id as session_id,
    coalesce(nullif(btrim(s.intake ->> 'customerComplaint'), ''), 'Legacy repair order') as concern,
    row_number() over (partition by ro.shop_id order by ro.opened_at, ro.id) as ticket_offset
  from repair_orders ro
  join sessions s on s.repair_order_id = ro.id
)
insert into tickets (
  id,
  shop_id,
  ticket_number,
  source,
  customer_id,
  vehicle_id,
  concern,
  status,
  created_by_profile_id,
  closed_at,
  created_at,
  updated_at
)
select
  ranked.id,
  ranked.shop_id,
  shops.next_ticket_number + ranked.ticket_offset - 1,
  'legacy_repair_order',
  ranked.customer_id,
  ranked.vehicle_id,
  ranked.concern,
  case when ranked.status = 'closed' then 'closed' else 'open' end,
  ranked.opened_by,
  ranked.closed_at,
  ranked.opened_at,
  ranked.updated_at
from ranked
join shops on shops.id = ranked.shop_id;

insert into ticket_jobs (
  shop_id,
  ticket_id,
  title,
  kind,
  required_skill_tier,
  assigned_tech_id,
  session_id,
  work_status,
  approval_state,
  diagnostic_start_state,
  created_at,
  updated_at
)
select
  t.shop_id,
  t.id,
  'Diagnostic — ' || left(t.concern, 120),
  'diagnostic',
  3,
  s.tech_id,
  s.id,
  case
    when s.status = 'closed' then 'done'
    when s.status in ('declined', 'deferred') then 'canceled'
    else 'in_progress'
  end,
  'pending_quote',
  'ready',
  s.created_at,
  coalesce(s.closed_at, s.created_at)
from tickets t
join sessions s on s.repair_order_id = t.id
where t.source = 'legacy_repair_order';

update shops
set next_ticket_number = imported.next_number
from (
  select shop_id, max(ticket_number) + 1 as next_number
  from tickets
  group by shop_id
) imported
where shops.id = imported.shop_id
  and shops.next_ticket_number < imported.next_number;

alter table tickets enable row level security;
alter table ticket_jobs enable row level security;

revoke select, insert, update, delete on tickets, ticket_jobs from anon, authenticated;
grant select, insert, update, delete on tickets, ticket_jobs to service_role;

create policy tickets_server_only_deny_direct
  on tickets for all to anon, authenticated
  using (false) with check (false);
create policy ticket_jobs_server_only_deny_direct
  on ticket_jobs for all to anon, authenticated
  using (false) with check (false);

alter table sessions drop constraint sessions_repair_order_id_repair_orders_id_fk;
alter table sessions drop column repair_order_id;
alter table sessions drop column customer_authorized;

drop table repair_orders;
drop table outbound_messages;
drop table authorizations;
drop table line_items;
drop table concerns;
drop table work_orders;

alter table customers drop column preferred_channel;
alter table customers drop column opt_ins;
alter table vehicles drop column diesel_context;
alter table shops drop column shop_mgmt_enabled;

commit;
