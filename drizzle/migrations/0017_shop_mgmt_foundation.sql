-- drizzle/migrations/0017_shop_mgmt_foundation.sql
--
-- Shop-management foundation — sub-project 1 of 8. Adds the opt-in toggle
-- on shops, a minimal repair_orders table, and two new columns on sessions
-- (one nullable FK to repair_orders, one nullable boolean for the intake
-- form's customer-authorized answer that was previously dropped on the
-- floor by createSessionFromIntake).
--
-- Additive only: one new column on shops (NOT NULL with default false →
-- every existing row auto-backfills), one new table, two new nullable
-- columns on sessions. No existing column altered, no data modified.
-- Rollback = revert this migration; columns + table stay (harmless).
--
-- The shops.shop_mgmt_enabled flag is what gates the new code path in
-- lib/intake/session.ts. Default false means every existing shop keeps
-- today's diagnostic-only behavior; flipping to true at the row level
-- turns the RO creation on for that shop only.

ALTER TABLE "shops"
  ADD COLUMN "shop_mgmt_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repair_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shop_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "vehicle_id" uuid NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "opened_by" uuid NOT NULL,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "repair_orders_shop_id_shops_id_fk"
    FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE,
  CONSTRAINT "repair_orders_customer_id_customers_id_fk"
    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT,
  CONSTRAINT "repair_orders_vehicle_id_vehicles_id_fk"
    FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE RESTRICT,
  CONSTRAINT "repair_orders_opened_by_profiles_id_fk"
    FOREIGN KEY ("opened_by") REFERENCES "profiles"("id") ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_orders_shop_status_idx"
  ON "repair_orders" ("shop_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_orders_customer_idx"
  ON "repair_orders" ("customer_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_orders_vehicle_idx"
  ON "repair_orders" ("vehicle_id");
--> statement-breakpoint
ALTER TABLE "sessions"
  ADD COLUMN "repair_order_id" uuid;
--> statement-breakpoint
ALTER TABLE "sessions"
  ADD COLUMN "customer_authorized" boolean;
--> statement-breakpoint
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_repair_order_id_repair_orders_id_fk"
    FOREIGN KEY ("repair_order_id") REFERENCES "repair_orders"("id") ON DELETE SET NULL;
