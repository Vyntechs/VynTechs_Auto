-- drizzle/migrations/0038_shop_os_ticket_payments.sql
--
-- ticket_payments — money the shop has actually collected against a repair
-- order. Each row is one payment (a deposit, a partial, or paying the whole
-- thing). The amount owed is derived from the ticket's approved quote jobs;
-- the balance is owed minus the sum of these rows. Recording money is an
-- advisor/owner action — techs never write here.
--
-- Server-only, like every other Shop OS money table: browser roles (anon,
-- authenticated) get no direct access; all reads/writes go through server
-- code running as service_role. RLS deny policy is belt-and-suspenders on top
-- of the privilege revoke, matching drizzle/migrations/0036_shop_entitlements.
--
-- Additive only: one new table, no backfill, no existing data path changes.

create table ticket_payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  ticket_id uuid not null,
  amount_cents bigint not null,
  method text not null,
  note text,
  recorded_by_profile_id uuid not null,
  request_key uuid not null,
  recorded_at timestamptz not null default now(),
  constraint ticket_payments_shop_ticket_fk
    foreign key (shop_id, ticket_id) references tickets(shop_id, id) on delete restrict,
  constraint ticket_payments_shop_actor_fk
    foreign key (shop_id, recorded_by_profile_id) references profiles(shop_id, id) on delete restrict,
  constraint ticket_payments_amount_positive check (amount_cents > 0),
  constraint ticket_payments_method_valid check (method in ('cash', 'card', 'check', 'other')),
  constraint ticket_payments_note_length check (note is null or char_length(note) between 1 and 500)
);
--> statement-breakpoint
create unique index ticket_payments_shop_id_uq on ticket_payments (shop_id, id);
--> statement-breakpoint
create unique index ticket_payments_shop_request_key_uq on ticket_payments (shop_id, request_key);
--> statement-breakpoint
create index ticket_payments_ticket_idx on ticket_payments (shop_id, ticket_id, recorded_at);
--> statement-breakpoint

alter table ticket_payments enable row level security;
--> statement-breakpoint
revoke all privileges on table public.ticket_payments from anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on ticket_payments to service_role;
--> statement-breakpoint
create policy ticket_payments_server_only_deny_direct
  on ticket_payments for all to anon, authenticated
  using (false) with check (false);
