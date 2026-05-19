-- drizzle/migrations/0017_diagnostic_orchestration.sql
--
-- Diagnostic Orchestration Schema — Phase 1.
-- Adds 12 new tables (platforms, architecture_facts, components,
-- observable_properties, symptoms, test_actions, branch_logic,
-- tech_outcomes, diagnostic_sessions, component_connections,
-- symptom_test_implications, platform_equivalents) plus one nullable
-- column (vehicles.platform_id).
--
-- Hand-written because drizzle-kit's meta state has a pre-existing
-- snapshot inconsistency (orphaned 0011a/0011b; see migrations 0012–0016).
-- This file follows the drizzle-generated SQL style for compatibility with
-- the pglite test migrator and the production drizzle-orm migrator.
--
-- Spec: docs/superpowers/specs/2026-05-19-orchestration-schema-design.md

-- Ensure the `authenticated` role exists. Supabase installs this role by default;
-- on bare local Postgres (e.g., vyntechs_rehearsal) it's absent and would cause
-- `CREATE POLICY ... TO authenticated` to fail. No-op on Supabase.
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $do$;
--> statement-breakpoint

-- Drop legacy `symptoms` table (orphan scaffolding: 0 rows on prod, no FK references,
-- no app/code references). The orchestration schema redefines `symptoms` with a
-- different shape (id UUID PK, slug, description, category) supplanting the
-- legacy shape (name TEXT PK, display_label, usage_count). Verified empty on
-- prod 2026-05-19 prior to this drop.
DROP TABLE IF EXISTS "symptoms" CASCADE;
--> statement-breakpoint
CREATE TABLE "platforms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"year_range" text NOT NULL,
	"parent_make" text NOT NULL,
	"parent_model_family" text NOT NULL,
	"generation" text,
	"parent_platform_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platforms_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "architecture_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"platform_id" uuid NOT NULL,
	"description" text NOT NULL,
	"field_verify_required" boolean DEFAULT false NOT NULL,
	"source_provenance" text NOT NULL,
	"inference_class" text,
	"is_retired" boolean DEFAULT false NOT NULL,
	"replaced_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"platform_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"electrical_contract" text,
	"location" text,
	"function" text,
	"source_provenance" text NOT NULL,
	"inference_class" text,
	"is_retired" boolean DEFAULT false NOT NULL,
	"replaced_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observable_properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"component_id" uuid NOT NULL,
	"description" text NOT NULL,
	"observation_method" text NOT NULL,
	"housing_opacity_status" text,
	"source_provenance" text NOT NULL,
	"inference_class" text,
	"is_retired" boolean DEFAULT false NOT NULL,
	"replaced_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symptoms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "symptoms_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "test_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"component_id" uuid NOT NULL,
	"description" text NOT NULL,
	"scenario_required" text NOT NULL,
	"observation_method" text NOT NULL,
	"meter_mode" text,
	"expected_value" real,
	"expected_unit" text,
	"expected_tolerance" real,
	"expected_observation" text,
	"invasiveness" integer NOT NULL,
	"confidence_boost" real DEFAULT 0 NOT NULL,
	"source_citation" text,
	"source_provenance" text NOT NULL,
	"inference_class" text,
	"is_retired" boolean DEFAULT false NOT NULL,
	"replaced_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch_logic" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"test_action_id" uuid NOT NULL,
	"condition" text NOT NULL,
	"verdict" text NOT NULL,
	"next_action" text NOT NULL,
	"routes_to_test_action_id" uuid,
	"reasoning" text,
	"source_provenance" text NOT NULL,
	"inference_class" text,
	"is_retired" boolean DEFAULT false NOT NULL,
	"replaced_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "diagnostic_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"symptom_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"tech_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"final_verdict" text,
	"resolved_component_id" uuid,
	"cumulative_confidence" real DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_action_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"tech_id" uuid NOT NULL,
	"measured_value" real,
	"measured_unit" text,
	"measured_observation" text,
	"verdict" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "component_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_component_id" uuid NOT NULL,
	"to_component_id" uuid NOT NULL,
	"connection_kind" text NOT NULL,
	"direction" text DEFAULT 'unidirectional' NOT NULL,
	"description" text,
	"source_provenance" text NOT NULL,
	"inference_class" text,
	"is_retired" boolean DEFAULT false NOT NULL,
	"replaced_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symptom_test_implications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symptom_id" uuid NOT NULL,
	"test_action_id" uuid NOT NULL,
	"priority" integer NOT NULL,
	"source_provenance" text NOT NULL,
	"inference_class" text,
	"is_retired" boolean DEFAULT false NOT NULL,
	"replaced_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_equivalents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform_a_id" uuid NOT NULL,
	"platform_b_id" uuid NOT NULL,
	"system" text NOT NULL,
	"verdict" text NOT NULL,
	"verdict_reasoning" text,
	"source_provenance" text NOT NULL,
	"is_retired" boolean DEFAULT false NOT NULL,
	"replaced_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "platform_id" uuid;
--> statement-breakpoint
ALTER TABLE "platforms" ADD CONSTRAINT "platforms_parent_platform_id_platforms_id_fk" FOREIGN KEY ("parent_platform_id") REFERENCES "public"."platforms"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "architecture_facts" ADD CONSTRAINT "architecture_facts_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "architecture_facts" ADD CONSTRAINT "architecture_facts_replaced_by_id_architecture_facts_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."architecture_facts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_replaced_by_id_components_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."components"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "observable_properties" ADD CONSTRAINT "observable_properties_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."components"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "observable_properties" ADD CONSTRAINT "observable_properties_replaced_by_id_observable_properties_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."observable_properties"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "test_actions" ADD CONSTRAINT "test_actions_component_id_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."components"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "test_actions" ADD CONSTRAINT "test_actions_replaced_by_id_test_actions_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."test_actions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "branch_logic" ADD CONSTRAINT "branch_logic_test_action_id_test_actions_id_fk" FOREIGN KEY ("test_action_id") REFERENCES "public"."test_actions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "branch_logic" ADD CONSTRAINT "branch_logic_routes_to_test_action_id_test_actions_id_fk" FOREIGN KEY ("routes_to_test_action_id") REFERENCES "public"."test_actions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "branch_logic" ADD CONSTRAINT "branch_logic_replaced_by_id_branch_logic_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."branch_logic"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_sessions_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_sessions_symptom_id_symptoms_id_fk" FOREIGN KEY ("symptom_id") REFERENCES "public"."symptoms"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_sessions_tech_id_profiles_id_fk" FOREIGN KEY ("tech_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "diagnostic_sessions" ADD CONSTRAINT "diagnostic_sessions_resolved_component_id_components_id_fk" FOREIGN KEY ("resolved_component_id") REFERENCES "public"."components"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tech_outcomes" ADD CONSTRAINT "tech_outcomes_test_action_id_test_actions_id_fk" FOREIGN KEY ("test_action_id") REFERENCES "public"."test_actions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tech_outcomes" ADD CONSTRAINT "tech_outcomes_session_id_diagnostic_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."diagnostic_sessions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tech_outcomes" ADD CONSTRAINT "tech_outcomes_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "tech_outcomes" ADD CONSTRAINT "tech_outcomes_tech_id_profiles_id_fk" FOREIGN KEY ("tech_id") REFERENCES "public"."profiles"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "component_connections" ADD CONSTRAINT "component_connections_from_component_id_components_id_fk" FOREIGN KEY ("from_component_id") REFERENCES "public"."components"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "component_connections" ADD CONSTRAINT "component_connections_to_component_id_components_id_fk" FOREIGN KEY ("to_component_id") REFERENCES "public"."components"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "component_connections" ADD CONSTRAINT "component_connections_replaced_by_id_component_connections_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."component_connections"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "symptom_test_implications" ADD CONSTRAINT "symptom_test_implications_symptom_id_symptoms_id_fk" FOREIGN KEY ("symptom_id") REFERENCES "public"."symptoms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "symptom_test_implications" ADD CONSTRAINT "symptom_test_implications_test_action_id_test_actions_id_fk" FOREIGN KEY ("test_action_id") REFERENCES "public"."test_actions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "symptom_test_implications" ADD CONSTRAINT "symptom_test_implications_replaced_by_id_symptom_test_implications_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."symptom_test_implications"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_equivalents" ADD CONSTRAINT "platform_equivalents_platform_a_id_platforms_id_fk" FOREIGN KEY ("platform_a_id") REFERENCES "public"."platforms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_equivalents" ADD CONSTRAINT "platform_equivalents_platform_b_id_platforms_id_fk" FOREIGN KEY ("platform_b_id") REFERENCES "public"."platforms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "platform_equivalents" ADD CONSTRAINT "platform_equivalents_replaced_by_id_platform_equivalents_id_fk" FOREIGN KEY ("replaced_by_id") REFERENCES "public"."platform_equivalents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_platform_id_platforms_id_fk" FOREIGN KEY ("platform_id") REFERENCES "public"."platforms"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "platforms_parent_platform_id_idx" ON "platforms" USING btree ("parent_platform_id");
--> statement-breakpoint
CREATE INDEX "vehicles_platform_id_idx" ON "vehicles" USING btree ("platform_id");
--> statement-breakpoint
CREATE INDEX "architecture_facts_platform_id_idx" ON "architecture_facts" USING btree ("platform_id");
--> statement-breakpoint
CREATE INDEX "components_platform_id_idx" ON "components" USING btree ("platform_id");
--> statement-breakpoint
CREATE INDEX "observable_properties_component_id_idx" ON "observable_properties" USING btree ("component_id");
--> statement-breakpoint
CREATE INDEX "symptoms_category_idx" ON "symptoms" USING btree ("category");
--> statement-breakpoint
CREATE INDEX "test_actions_component_id_idx" ON "test_actions" USING btree ("component_id");
--> statement-breakpoint
CREATE INDEX "branch_logic_test_action_id_idx" ON "branch_logic" USING btree ("test_action_id");
--> statement-breakpoint
CREATE INDEX "branch_logic_routes_to_idx" ON "branch_logic" USING btree ("routes_to_test_action_id");
--> statement-breakpoint
CREATE INDEX "diagnostic_sessions_vehicle_id_idx" ON "diagnostic_sessions" USING btree ("vehicle_id");
--> statement-breakpoint
CREATE INDEX "diagnostic_sessions_symptom_id_idx" ON "diagnostic_sessions" USING btree ("symptom_id");
--> statement-breakpoint
CREATE INDEX "diagnostic_sessions_shop_id_idx" ON "diagnostic_sessions" USING btree ("shop_id");
--> statement-breakpoint
CREATE INDEX "diagnostic_sessions_started_at_idx" ON "diagnostic_sessions" USING btree ("started_at");
--> statement-breakpoint
CREATE INDEX "tech_outcomes_test_action_id_idx" ON "tech_outcomes" USING btree ("test_action_id");
--> statement-breakpoint
CREATE INDEX "tech_outcomes_session_id_idx" ON "tech_outcomes" USING btree ("session_id");
--> statement-breakpoint
CREATE INDEX "tech_outcomes_shop_id_idx" ON "tech_outcomes" USING btree ("shop_id");
--> statement-breakpoint
CREATE INDEX "tech_outcomes_recorded_at_idx" ON "tech_outcomes" USING btree ("recorded_at");
--> statement-breakpoint
CREATE INDEX "component_connections_from_idx" ON "component_connections" USING btree ("from_component_id");
--> statement-breakpoint
CREATE INDEX "component_connections_to_idx" ON "component_connections" USING btree ("to_component_id");
--> statement-breakpoint
CREATE INDEX "component_connections_kind_idx" ON "component_connections" USING btree ("connection_kind");
--> statement-breakpoint
CREATE INDEX "symptom_test_implications_symptom_priority_idx" ON "symptom_test_implications" USING btree ("symptom_id","priority");
--> statement-breakpoint
CREATE INDEX "symptom_test_implications_test_action_id_idx" ON "symptom_test_implications" USING btree ("test_action_id");
--> statement-breakpoint
CREATE INDEX "platform_equivalents_a_system_idx" ON "platform_equivalents" USING btree ("platform_a_id","system");
--> statement-breakpoint
CREATE INDEX "platform_equivalents_b_system_idx" ON "platform_equivalents" USING btree ("platform_b_id","system");

-- =========================================================================
-- HAND-WRITTEN DDL (not generated by drizzle-kit)
-- =========================================================================

-- RLS: tech_outcomes
ALTER TABLE tech_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY tech_outcomes_insert_own_shop
  ON tech_outcomes FOR INSERT
  TO authenticated
  WITH CHECK (shop_id = (SELECT shop_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY tech_outcomes_update_own_shop
  ON tech_outcomes FOR UPDATE
  TO authenticated
  USING (shop_id = (SELECT shop_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY tech_outcomes_delete_own_shop
  ON tech_outcomes FOR DELETE
  TO authenticated
  USING (shop_id = (SELECT shop_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY tech_outcomes_select_all
  ON tech_outcomes FOR SELECT
  TO authenticated
  USING (true);

-- RLS: diagnostic_sessions
ALTER TABLE diagnostic_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY diagnostic_sessions_insert_own_shop
  ON diagnostic_sessions FOR INSERT
  TO authenticated
  WITH CHECK (shop_id = (SELECT shop_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY diagnostic_sessions_update_own_shop
  ON diagnostic_sessions FOR UPDATE
  TO authenticated
  USING (shop_id = (SELECT shop_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY diagnostic_sessions_delete_own_shop
  ON diagnostic_sessions FOR DELETE
  TO authenticated
  USING (shop_id = (SELECT shop_id FROM profiles WHERE user_id = auth.uid()));

CREATE POLICY diagnostic_sessions_select_all
  ON diagnostic_sessions FOR SELECT
  TO authenticated
  USING (true);

-- Partial unique indexes on slug (active rows only) for fact-bearing node tables
CREATE UNIQUE INDEX architecture_facts_slug_active_unique
  ON architecture_facts (slug) WHERE is_retired = false;

CREATE UNIQUE INDEX components_slug_active_unique
  ON components (slug) WHERE is_retired = false;

CREATE UNIQUE INDEX observable_properties_slug_active_unique
  ON observable_properties (slug) WHERE is_retired = false;

CREATE UNIQUE INDEX test_actions_slug_active_unique
  ON test_actions (slug) WHERE is_retired = false;

CREATE UNIQUE INDEX branch_logic_slug_active_unique
  ON branch_logic (slug) WHERE is_retired = false;

-- Partial unique indexes on natural-identity tuples for junction tables
CREATE UNIQUE INDEX component_connections_from_to_kind_active_unique
  ON component_connections (from_component_id, to_component_id, connection_kind)
  WHERE is_retired = false;

CREATE UNIQUE INDEX symptom_test_implications_symptom_test_active_unique
  ON symptom_test_implications (symptom_id, test_action_id)
  WHERE is_retired = false;

CREATE UNIQUE INDEX platform_equivalents_a_b_system_active_unique
  ON platform_equivalents (platform_a_id, platform_b_id, system)
  WHERE is_retired = false;

-- Partial indexes for fast active-row scans (filtered by is_retired = false)
CREATE INDEX architecture_facts_active_idx
  ON architecture_facts (platform_id) WHERE is_retired = false;

CREATE INDEX components_active_idx
  ON components (platform_id) WHERE is_retired = false;

CREATE INDEX observable_properties_active_idx
  ON observable_properties (component_id) WHERE is_retired = false;

CREATE INDEX test_actions_active_idx
  ON test_actions (component_id) WHERE is_retired = false;

CREATE INDEX branch_logic_active_idx
  ON branch_logic (test_action_id) WHERE is_retired = false;

-- Retirement invariant: a row with replaced_by_id set must be retired
ALTER TABLE architecture_facts
  ADD CONSTRAINT architecture_facts_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE components
  ADD CONSTRAINT components_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE observable_properties
  ADD CONSTRAINT observable_properties_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE test_actions
  ADD CONSTRAINT test_actions_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE branch_logic
  ADD CONSTRAINT branch_logic_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE component_connections
  ADD CONSTRAINT component_connections_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE symptom_test_implications
  ADD CONSTRAINT symptom_test_implications_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

ALTER TABLE platform_equivalents
  ADD CONSTRAINT platform_equivalents_retirement_invariant
  CHECK (replaced_by_id IS NULL OR is_retired = true);

-- Numeric range constraints
ALTER TABLE test_actions
  ADD CONSTRAINT test_actions_invasiveness_range
  CHECK (invasiveness BETWEEN 1 AND 5);

ALTER TABLE test_actions
  ADD CONSTRAINT test_actions_confidence_boost_range
  CHECK (confidence_boost BETWEEN 0 AND 100);

ALTER TABLE diagnostic_sessions
  ADD CONSTRAINT diagnostic_sessions_cumulative_confidence_range
  CHECK (cumulative_confidence BETWEEN 0 AND 100);

ALTER TABLE symptom_test_implications
  ADD CONSTRAINT symptom_test_implications_priority_range
  CHECK (priority BETWEEN 1 AND 10);

-- Value-shape constraints
ALTER TABLE tech_outcomes
  ADD CONSTRAINT tech_outcomes_value_or_observation_required
  CHECK (measured_value IS NOT NULL OR measured_observation IS NOT NULL);

ALTER TABLE component_connections
  ADD CONSTRAINT component_connections_no_self_loop
  CHECK (from_component_id <> to_component_id);

ALTER TABLE platform_equivalents
  ADD CONSTRAINT platform_equivalents_canonical_ordering
  CHECK (platform_a_id < platform_b_id);

-- Drop the ASC index drizzle-kit generated, replace with DESC for priority
DROP INDEX IF EXISTS symptom_test_implications_symptom_priority_idx;
CREATE INDEX symptom_test_implications_symptom_priority_idx
  ON symptom_test_implications (symptom_id, priority DESC);
