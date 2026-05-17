-- drizzle/migrations/0014_knowledge_platform.sql
--
-- Vehicle knowledge platform — schema + migration. Adds three tables:
--
--   knowledge_items          — every vetted shop-owner-curated reference
--                              card (pinouts, theory, cause/fix, etc.).
--                              The `type` field discriminates; the
--                              `structured_data` JSONB column holds
--                              type-specific structure. Shop-scoped.
--   knowledge_item_vehicles  — vehicle-scope rows per item (many-to-one
--                              against knowledge_items). Year range
--                              required; model/engine/trim/drivetrain
--                              optional (NULL = wildcard).
--   symptoms                 — autocomplete-backed lookup of symptom
--                              tags Brandon picks during contribution.
--                              Global (no shop_id) for v1.
--
-- Sits alongside corpus_entries (session-derived) and founder_notes_queue
-- (founder note triage). Separate concerns. See spec:
-- docs/superpowers/specs/2026-05-16-vehicle-knowledge-platform-design.md.
--
-- Hand-written because drizzle-kit's meta state has a pre-existing
-- snapshot inconsistency (orphaned 0011a/0011b — same blocker that
-- forced 0012 + 0013 to be hand-written). This file follows the
-- drizzle-generated SQL style for compatibility with the pglite test
-- migrator and the production drizzle-orm migrator.

CREATE TABLE "knowledge_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"structured_data" jsonb,
	"dtc_list" text[] DEFAULT '{}'::text[] NOT NULL,
	"system_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"symptoms" text[] DEFAULT '{}'::text[] NOT NULL,
	"related_item_ids" jsonb,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired" boolean DEFAULT false NOT NULL,
	"retired_at" timestamp with time zone,
	"retired_by_user_id" uuid,
	"fire_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "knowledge_items_type_check" CHECK (
		"type" IN ('cause_fix', 'reference_doc', 'bulletin', 'note', 'pinout', 'connector', 'wiring_diagram', 'theory_of_operation')
	)
);
--> statement-breakpoint
CREATE TABLE "knowledge_item_vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"knowledge_item_id" uuid NOT NULL,
	"year_start" integer NOT NULL,
	"year_end" integer NOT NULL,
	"make" text NOT NULL,
	"model" text,
	"engine" text,
	"trim" text,
	"drivetrain" text,
	"build_date_after" timestamp with time zone,
	"build_date_before" timestamp with time zone,
	"extra_qualifiers" jsonb,
	CONSTRAINT "knowledge_item_vehicles_year_start_check" CHECK ("year_start" BETWEEN 1980 AND 2100),
	CONSTRAINT "knowledge_item_vehicles_year_end_check" CHECK ("year_end" BETWEEN "year_start" AND 2100)
);
--> statement-breakpoint
CREATE TABLE "symptoms" (
	"name" text PRIMARY KEY NOT NULL,
	"display_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"usage_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_created_by_user_id_profiles_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_retired_by_user_id_profiles_id_fk" FOREIGN KEY ("retired_by_user_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_item_vehicles" ADD CONSTRAINT "knowledge_item_vehicles_knowledge_item_id_knowledge_items_id_fk" FOREIGN KEY ("knowledge_item_id") REFERENCES "public"."knowledge_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_items_shop_id_idx" ON "knowledge_items" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "knowledge_items_type_idx" ON "knowledge_items" USING btree ("type");--> statement-breakpoint
CREATE INDEX "knowledge_items_dtc_list_idx" ON "knowledge_items" USING gin ("dtc_list");--> statement-breakpoint
CREATE INDEX "knowledge_items_system_codes_idx" ON "knowledge_items" USING gin ("system_codes");--> statement-breakpoint
CREATE INDEX "knowledge_items_symptoms_idx" ON "knowledge_items" USING gin ("symptoms");--> statement-breakpoint
CREATE INDEX "knowledge_items_active_idx" ON "knowledge_items" USING btree ("retired") WHERE "retired" = false;--> statement-breakpoint
CREATE INDEX "knowledge_item_vehicles_lookup_idx" ON "knowledge_item_vehicles" USING btree ("make","model","year_start","year_end");--> statement-breakpoint
CREATE INDEX "knowledge_item_vehicles_item_idx" ON "knowledge_item_vehicles" USING btree ("knowledge_item_id");--> statement-breakpoint
ALTER TABLE "knowledge_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "knowledge_item_vehicles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "knowledge_items_shop_scoped" ON "knowledge_items"
	FOR ALL USING (
		EXISTS (
			SELECT 1 FROM profiles
			WHERE profiles.user_id = auth.uid()
			AND profiles.shop_id = knowledge_items.shop_id
		)
	);--> statement-breakpoint
CREATE POLICY "knowledge_item_vehicles_via_item" ON "knowledge_item_vehicles"
	FOR ALL USING (
		EXISTS (
			SELECT 1 FROM knowledge_items ki
			JOIN profiles p ON p.shop_id = ki.shop_id
			WHERE ki.id = knowledge_item_vehicles.knowledge_item_id
			AND p.user_id = auth.uid()
		)
	);
