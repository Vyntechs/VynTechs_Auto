-- Shop OS Phase-0 reconciliation rollback draft — FOR LOCAL REHEARSAL ONLY.
--
-- Valid only before application code writes canonical tickets/jobs. The guard
-- deliberately refuses rollback once any non-legacy ticket or extra job exists.

begin;

do $$
begin
  if to_regclass('public.tickets') is null
     or to_regclass('public.ticket_jobs') is null then
    raise exception 'shop_os_reconciliation:canonical_schema_missing';
  end if;

  if to_regclass('public.repair_orders') is not null
     or to_regclass('public.work_orders') is not null then
    raise exception 'shop_os_reconciliation:predecessor_schema_already_exists';
  end if;

  if exists (select 1 from tickets where source <> 'legacy_repair_order')
     or exists (
       select 1
       from tickets t
       left join ticket_jobs tj on tj.ticket_id = t.id and tj.shop_id = t.shop_id
       where t.source = 'legacy_repair_order'
       group by t.id
       having count(tj.id) <> 1
     )
     or exists (
       select 1
       from ticket_jobs tj
       join tickets t on t.id = tj.ticket_id and t.shop_id = tj.shop_id
       where t.source <> 'legacy_repair_order'
          or tj.kind <> 'diagnostic'
          or tj.session_id is null
     ) then
    raise exception 'shop_os_reconciliation:canonical_writes_present';
  end if;
end $$;

alter table shops add column shop_mgmt_enabled boolean not null default false;
alter table customers add column preferred_channel text default 'sms';
alter table customers add column opt_ins jsonb default '{}'::jsonb;
alter table vehicles add column diesel_context jsonb;

create table repair_orders (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  customer_id uuid not null,
  vehicle_id uuid not null,
  status text not null default 'open',
  opened_by uuid not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint repair_orders_shop_id_shops_id_fk
    foreign key (shop_id) references shops(id) on delete cascade,
  constraint repair_orders_customer_id_customers_id_fk
    foreign key (customer_id) references customers(id) on delete restrict,
  constraint repair_orders_vehicle_id_vehicles_id_fk
    foreign key (vehicle_id) references vehicles(id) on delete restrict,
  constraint repair_orders_opened_by_profiles_id_fk
    foreign key (opened_by) references profiles(id) on delete restrict
);

create index repair_orders_shop_status_idx on repair_orders (shop_id, status);
create index repair_orders_customer_idx on repair_orders (customer_id);
create index repair_orders_vehicle_idx on repair_orders (vehicle_id);

alter table sessions add column repair_order_id uuid;
alter table sessions add column customer_authorized boolean;
alter table sessions
  add constraint sessions_repair_order_id_repair_orders_id_fk
  foreign key (repair_order_id) references repair_orders(id) on delete set null;

create table work_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  vehicle_id uuid not null,
  state text not null default 'draft',
  ticket_type text not null default 'customer-pay',
  promise_date timestamptz,
  priority text not null default 'normal',
  writer_id uuid,
  tech_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_orders_customer_id_customers_id_fk
    foreign key (customer_id) references customers(id) on delete restrict,
  constraint work_orders_vehicle_id_vehicles_id_fk
    foreign key (vehicle_id) references vehicles(id) on delete restrict,
  constraint work_orders_writer_id_profiles_id_fk
    foreign key (writer_id) references profiles(id) on delete set null,
  constraint work_orders_tech_id_profiles_id_fk
    foreign key (tech_id) references profiles(id) on delete set null
);

create index work_orders_state_idx on work_orders (state);
create index work_orders_customer_id_idx on work_orders (customer_id);
create index work_orders_vehicle_id_idx on work_orders (vehicle_id);

create table concerns (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null,
  complaint text not null,
  cause text,
  correction text,
  state text not null default 'open',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint concerns_work_order_id_work_orders_id_fk
    foreign key (work_order_id) references work_orders(id) on delete cascade
);

create index concerns_work_order_id_idx on concerns (work_order_id);

create table line_items (
  id uuid primary key default gen_random_uuid(),
  concern_id uuid not null,
  description text not null,
  qty numeric(10, 3) not null,
  unit_price numeric(12, 2) not null,
  source text not null default 'writer-added',
  purpose text not null default 'repair',
  total numeric(12, 2) not null,
  created_at timestamptz not null default now(),
  constraint line_items_concern_id_concerns_id_fk
    foreign key (concern_id) references concerns(id) on delete cascade
);

create index line_items_concern_id_idx on line_items (concern_id);

create table authorizations (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null,
  auth_type text not null,
  amount_cap numeric(12, 2),
  time_cap_hours numeric(6, 2),
  method text not null,
  captured_at timestamptz not null default now(),
  captured_by text not null,
  signature_image_url text,
  conditions text,
  constraint authorizations_work_order_id_work_orders_id_fk
    foreign key (work_order_id) references work_orders(id) on delete cascade
);

create index authorizations_work_order_id_idx on authorizations (work_order_id);

create table outbound_messages (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null,
  touchpoint text not null,
  channel text not null,
  status text not null default 'scheduled',
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  template_id text,
  body text not null,
  constraint outbound_messages_work_order_id_work_orders_id_fk
    foreign key (work_order_id) references work_orders(id) on delete cascade
);

create index outbound_messages_work_order_id_idx on outbound_messages (work_order_id);

insert into repair_orders (
  id,
  shop_id,
  customer_id,
  vehicle_id,
  status,
  opened_by,
  opened_at,
  closed_at,
  updated_at
)
select
  id,
  shop_id,
  customer_id,
  vehicle_id,
  case when status = 'closed' then 'closed' else 'open' end,
  created_by_profile_id,
  created_at,
  closed_at,
  updated_at
from tickets
where source = 'legacy_repair_order';

update sessions s
set repair_order_id = tj.ticket_id,
    customer_authorized = null
from ticket_jobs tj
join tickets t on t.id = tj.ticket_id and t.shop_id = tj.shop_id
where tj.session_id = s.id
  and t.source = 'legacy_repair_order';

update shops s
set shop_mgmt_enabled = true
where exists (
  select 1 from tickets t
  where t.shop_id = s.id and t.source = 'legacy_repair_order'
);

alter table repair_orders enable row level security;
alter table work_orders enable row level security;
alter table concerns enable row level security;
alter table line_items enable row level security;
alter table authorizations enable row level security;
alter table outbound_messages enable row level security;

revoke select, insert, update, delete
  on repair_orders, work_orders, concerns, line_items, authorizations, outbound_messages
  from anon, authenticated, service_role;

drop table ticket_jobs;
drop table tickets;

drop index sessions_shop_id_id_uq;
drop index vehicles_customer_id_id_uq;
drop index profiles_shop_id_id_uq;
drop index customers_shop_id_id_uq;

alter table profiles drop column skill_tier;
alter table shops drop column next_ticket_number;

commit;
