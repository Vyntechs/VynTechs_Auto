-- drizzle/migrations/0042_stripe_webhook_ordering.sql
--
-- Durable Stripe webhook ordering and deduplication. The event ledger stores
-- provider metadata only—never signed bodies or subscription/customer payloads.
-- Base billing and optional entitlement projections remain server-owned and are
-- advanced together by one serialized application transaction.

alter table stripe_customers
  add column last_webhook_event_id text,
  add column last_webhook_event_created bigint,
  add constraint stripe_customers_webhook_cursor_paired
    check ((last_webhook_event_id is null) = (last_webhook_event_created is null)),
  add constraint stripe_customers_webhook_event_id_length
    check (last_webhook_event_id is null or char_length(last_webhook_event_id) between 1 and 255),
  add constraint stripe_customers_webhook_event_created_nonnegative
    check (last_webhook_event_created is null or last_webhook_event_created >= 0);
--> statement-breakpoint

create table processed_stripe_events (
  event_id text primary key,
  stripe_customer_id text not null,
  event_created bigint not null,
  event_type text not null,
  disposition text not null,
  processed_at timestamptz not null default now(),
  constraint processed_stripe_events_id_length check (char_length(event_id) between 1 and 255),
  constraint processed_stripe_events_type_length check (char_length(event_type) between 1 and 255),
  constraint processed_stripe_events_created_nonnegative check (event_created >= 0),
  constraint processed_stripe_events_disposition_valid
    check (disposition in ('pending', 'applied', 'stale', 'reconciled')),
  constraint processed_stripe_events_stripe_customer_fk
    foreign key (stripe_customer_id) references stripe_customers(stripe_customer_id) on delete cascade
);
--> statement-breakpoint
create index processed_stripe_events_customer_created_idx
  on processed_stripe_events (stripe_customer_id, event_created);
--> statement-breakpoint

alter table processed_stripe_events enable row level security;
--> statement-breakpoint
revoke all privileges on table public.processed_stripe_events from anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on processed_stripe_events to service_role;
--> statement-breakpoint
create policy processed_stripe_events_server_only_deny_direct
  on processed_stripe_events for all to anon, authenticated
  using (false) with check (false);
