-- drizzle/migrations/0041_shop_os_job_part_requests.sql
--
-- job_part_requests — a tech's "I need this part" flag, relayed to the parts
-- person. The tech says WHAT the part is ("water pump"), an optional brand/source
-- preference ("Motorcraft", "AC Delco", "from the dealer", a supplier), and HOW
-- MANY — with ZERO money on the tech's side. The parts person logs into
-- RepairLink / First Call on their own, gets the real part and price, and marks
-- the request handled.
--
-- Deliberately SEPARATE from job_lines (the quote/money rows): a request carries
-- no cost, no price, and does not touch the approved quote or its approval — it is
-- purely a relay/to-do. When live supplier pricing (PartsTech) is wired later,
-- this same flag can resolve to a priced pick with no rework.
--
-- Server-only, like the other Shop OS write tables: browser roles get no direct
-- access; all reads/writes go through server code as service_role. RLS deny is
-- belt-and-suspenders on top of the privilege revoke (mirrors 0038 / 0036).

create table job_part_requests (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  ticket_id uuid not null,
  job_id uuid not null,
  requested_by_profile_id uuid not null,
  description text not null,
  preference text,
  quantity integer not null default 1,
  status text not null default 'requested',
  request_key uuid not null,
  created_at timestamptz not null default now(),
  resolved_by_profile_id uuid,
  resolved_at timestamptz,
  constraint job_part_requests_shop_job_fk
    foreign key (shop_id, ticket_id, job_id)
    references ticket_jobs(shop_id, ticket_id, id) on delete cascade,
  constraint job_part_requests_shop_requester_fk
    foreign key (shop_id, requested_by_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint job_part_requests_shop_resolver_fk
    foreign key (shop_id, resolved_by_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint job_part_requests_quantity_range check (quantity between 1 and 99),
  constraint job_part_requests_status_valid check (status in ('requested', 'sourced', 'dismissed')),
  constraint job_part_requests_description_length check (char_length(description) between 1 and 200),
  constraint job_part_requests_preference_length check (preference is null or char_length(preference) between 1 and 200),
  constraint job_part_requests_resolved_consistent
    check ((status = 'requested') = (resolved_at is null) and (resolved_at is null) = (resolved_by_profile_id is null))
);
--> statement-breakpoint
create unique index job_part_requests_shop_id_uq on job_part_requests (shop_id, id);
--> statement-breakpoint
create unique index job_part_requests_shop_request_key_uq on job_part_requests (shop_id, request_key);
--> statement-breakpoint
create index job_part_requests_ticket_status_idx on job_part_requests (shop_id, ticket_id, status);
--> statement-breakpoint
create index job_part_requests_job_idx on job_part_requests (shop_id, job_id);
--> statement-breakpoint

alter table job_part_requests enable row level security;
--> statement-breakpoint
revoke all privileges on table public.job_part_requests from anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on job_part_requests to service_role;
--> statement-breakpoint
create policy job_part_requests_server_only_deny_direct
  on job_part_requests for all to anon, authenticated
  using (false) with check (false);
