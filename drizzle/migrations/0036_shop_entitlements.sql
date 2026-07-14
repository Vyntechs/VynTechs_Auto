create table shop_entitlements (
  shop_id uuid primary key references shops(id) on delete cascade,
  diagnostics boolean not null default false,
  stripe_price_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
--> statement-breakpoint

alter table shop_entitlements enable row level security;
--> statement-breakpoint

revoke all privileges on table public.shop_entitlements from anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on shop_entitlements to service_role;
--> statement-breakpoint

create policy shop_entitlements_server_only_deny_direct
  on shop_entitlements for all to anon, authenticated
  using (false) with check (false);
--> statement-breakpoint

-- Grandfathering backfill (hard requirement: shipping this changes nothing
-- for any existing customer). Every shop that currently has paid access —
-- active/trialing subscription, canceled but still inside its paid period —
-- or at least one comp profile keeps diagnostics exactly as it works today.
insert into shop_entitlements (shop_id, diagnostics)
select s.id, true
from shops s
where
  exists (
    select 1
    from stripe_customers sc
    where sc.shop_id = s.id
      and (
        sc.subscription_status in ('active', 'trialing')
        or (
          sc.subscription_status = 'canceled'
          and sc.current_period_end is not null
          and sc.current_period_end > now()
        )
      )
  )
  or exists (
    select 1
    from profiles p
    where p.shop_id = s.id
      and p.is_comp = true
  )
on conflict (shop_id) do nothing;
