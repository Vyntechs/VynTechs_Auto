alter table "profiles" add column "membership_status" text default 'active' not null;
--> statement-breakpoint
alter table "profiles" add column "membership_activated_at" timestamp with time zone;
--> statement-breakpoint
update "profiles"
set "membership_activated_at" = "created_at";
--> statement-breakpoint
alter table "profiles"
alter column "membership_activated_at" set default now();
--> statement-breakpoint
alter table "profiles"
add constraint "profiles_membership_status_valid"
check ("membership_status" in ('pending', 'active'));
--> statement-breakpoint
alter table "profiles"
add constraint "profiles_membership_activation_consistent"
check (
  ("membership_status" = 'pending' and "membership_activated_at" is null)
  or ("membership_status" = 'active' and "membership_activated_at" is not null)
);
