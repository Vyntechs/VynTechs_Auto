-- drizzle/migrations/0012_customers_vehicles.sql
--
-- Shop management PR 1 — Counter Intake Persistence.
-- Adds two new tables (customers, vehicles) and one nullable column
-- (sessions.vehicle_id). Customers belong to a shop (multi-tenant);
-- vehicles belong to a customer (1-to-many). Existing sessions stay
-- un-attached (vehicle_id NULL); no backfill — see spec
-- docs/superpowers/specs/2026-05-07-counter-intake-persistence-design.md.
--
-- Hand-written because drizzle-kit's meta state has a pre-existing
-- snapshot inconsistency (orphaned 0011a/0011b). This file follows the
-- drizzle-generated SQL style for compatibility with the pglite test
-- migrator and the production drizzle-orm migrator.

CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"engine" text,
	"vin" text,
	"mileage" integer,
	"plate" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customers_shop_id_phone_idx" ON "customers" USING btree ("shop_id","phone");--> statement-breakpoint
CREATE INDEX "vehicles_customer_id_idx" ON "vehicles" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "vehicles_customer_id_vin_idx" ON "vehicles" USING btree ("customer_id","vin");
