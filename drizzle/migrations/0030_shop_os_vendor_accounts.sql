create table vendor_accounts (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  vendor text not null,
  display_name text not null,
  mode text not null,
  non_secret_config jsonb not null default '{}'::jsonb,
  secret_ref text,
  enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_accounts_shop_fk
    foreign key (shop_id) references shops(id) on delete cascade,
  constraint vendor_accounts_vendor_slug_valid
    check (
      char_length(vendor) between 2 and 64
      and vendor ~ '^[a-z][a-z0-9_]*[a-z0-9]$'
    ),
  constraint vendor_accounts_display_name_valid
    check (
      display_name = btrim(display_name)
      and char_length(display_name) between 1 and 120
    ),
  constraint vendor_accounts_mode_valid
    check (mode in ('manual', 'api', 'punchout')),
  constraint vendor_accounts_non_secret_config_object
    check (jsonb_typeof(non_secret_config) = 'object'),
  constraint vendor_accounts_non_secret_config_size
    check (octet_length(non_secret_config::text) <= 4096),
  constraint vendor_accounts_secret_ref_valid
    check (
      secret_ref is null
      or secret_ref ~ '^(env:[A-Z][A-Z0-9_]{2,127}|vault:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
    ),
  constraint vendor_accounts_mode_secret_ref_valid
    check (
      (mode = 'manual' and secret_ref is null)
      or (mode in ('api', 'punchout') and secret_ref is not null)
    )
);
--> statement-breakpoint

create unique index vendor_accounts_shop_id_id_uq
  on vendor_accounts (shop_id, id);
--> statement-breakpoint
create index vendor_accounts_shop_enabled_vendor_idx
  on vendor_accounts (shop_id, enabled, vendor);
--> statement-breakpoint

alter table job_lines
  add constraint job_lines_shop_vendor_account_fk
  foreign key (shop_id, vendor_account_id)
  references vendor_accounts(shop_id, id)
  on delete restrict;
--> statement-breakpoint

alter table vendor_accounts enable row level security;
--> statement-breakpoint

revoke select, insert, update, delete on vendor_accounts from anon, authenticated;
--> statement-breakpoint
grant select, insert, update, delete on vendor_accounts to service_role;
--> statement-breakpoint

create policy vendor_accounts_server_only_deny_direct
  on vendor_accounts for all to anon, authenticated
  using (false) with check (false);
