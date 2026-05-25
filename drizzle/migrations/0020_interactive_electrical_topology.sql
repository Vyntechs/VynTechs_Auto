-- 0020_interactive_electrical_topology.sql
-- Spec: docs/superpowers/specs/2026-05-23-interactive-electrical-topology-design.md
-- Additive — no column drops, no type changes on existing columns.

-- ============================================================
-- 1. components — six new prose columns for the panel body
-- ============================================================
ALTER TABLE components ADD COLUMN subtitle text;
--> statement-breakpoint
ALTER TABLE components ADD COLUMN role text;
--> statement-breakpoint
ALTER TABLE components ADD COLUMN wire_summary text;
--> statement-breakpoint
ALTER TABLE components ADD COLUMN body text;
--> statement-breakpoint
ALTER TABLE components ADD COLUMN probing_tactic text;
--> statement-breakpoint
ALTER TABLE components ADD COLUMN unknown_note text;
--> statement-breakpoint

-- ============================================================
-- 2. component_pins — new table; one row per pin per component
-- ============================================================
CREATE TYPE pin_edge AS ENUM ('top', 'right', 'bottom', 'left');
--> statement-breakpoint

CREATE TABLE component_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  component_id uuid NOT NULL REFERENCES components(id) ON DELETE CASCADE,
  name text NOT NULL,
  role_abbreviation text NOT NULL,
  pin_number text,
  edge pin_edge NOT NULL,
  display_order integer NOT NULL,
  probe_location text NOT NULL,
  expected_reading text NOT NULL,
  missing_logic text NOT NULL,
  label_gap text,
  source_provenance text NOT NULL DEFAULT 'TRAINING-CONFIRMED',
  is_retired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX component_pins_component_slug_active_unique
  ON component_pins (component_id, slug) WHERE is_retired = false;
--> statement-breakpoint

CREATE INDEX component_pins_component_id_idx ON component_pins(component_id) WHERE is_retired = false;
--> statement-breakpoint

-- ============================================================
-- 3. component_connections — electrical role + pin endpoints
-- ============================================================
CREATE TYPE electrical_role AS ENUM ('signal', '5v-ref', 'low-ref', 'pwm', '12v', 'ground');
--> statement-breakpoint

ALTER TABLE component_connections ADD COLUMN electrical_role electrical_role;
--> statement-breakpoint
ALTER TABLE component_connections ADD COLUMN from_pin_id uuid REFERENCES component_pins(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE component_connections ADD COLUMN to_pin_id uuid REFERENCES component_pins(id) ON DELETE SET NULL;
--> statement-breakpoint

-- ============================================================
-- 4. system_scenarios — operational + fault scenarios per (platform, system)
-- ============================================================
CREATE TYPE scenario_kind AS ENUM ('operation', 'fault');
--> statement-breakpoint
CREATE TYPE key_position AS ENUM ('off', 'on');
--> statement-breakpoint
CREATE TYPE engine_state AS ENUM ('off', 'running');
--> statement-breakpoint
CREATE TYPE load_level AS ENUM ('idle', 'light', 'medium', 'heavy');
--> statement-breakpoint

CREATE TABLE system_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL,
  platform_id uuid NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  system text NOT NULL,
  label text NOT NULL,
  sub text NOT NULL,
  kind scenario_kind NOT NULL,
  key_position key_position,
  engine_state engine_state,
  load_level load_level,
  is_default boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  is_retired boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX system_scenarios_platform_system_slug_active_unique
  ON system_scenarios (platform_id, system, slug) WHERE is_retired = false;
--> statement-breakpoint

CREATE UNIQUE INDEX system_scenarios_one_default_per_slice_idx
  ON system_scenarios(platform_id, system)
  WHERE is_default = true AND is_retired = false;
--> statement-breakpoint

CREATE INDEX system_scenarios_lookup_idx
  ON system_scenarios(platform_id, system)
  WHERE is_retired = false;
--> statement-breakpoint

-- ============================================================
-- 5. scenario_wire_states — per-pin per-scenario wire animation state
-- ============================================================
CREATE TYPE wire_state AS ENUM (
  'off',
  'steady-12v', 'steady-5v', 'steady-gnd',
  'signal-rest', 'signal-low', 'signal-med', 'signal-high', 'signal-pegged',
  'pwm-low', 'pwm-med', 'pwm-high', 'pwm-max'
);
--> statement-breakpoint

CREATE TABLE scenario_wire_states (
  scenario_id uuid NOT NULL REFERENCES system_scenarios(id) ON DELETE CASCADE,
  pin_id uuid NOT NULL REFERENCES component_pins(id) ON DELETE CASCADE,
  wire_state wire_state NOT NULL,
  PRIMARY KEY (scenario_id, pin_id)
);
--> statement-breakpoint

-- ============================================================
-- 6. pin_scenario_readings — the "right now" reading per (pin, scenario)
-- ============================================================
CREATE TABLE pin_scenario_readings (
  pin_id uuid NOT NULL REFERENCES component_pins(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES system_scenarios(id) ON DELETE CASCADE,
  reading text NOT NULL,
  PRIMARY KEY (pin_id, scenario_id)
);
--> statement-breakpoint

-- ============================================================
-- 7. system_data_status — captured/missing footer hybrid framing
--    (the framing wrapper; the bullet rows are derived from data)
-- ============================================================
CREATE TABLE system_data_status (
  platform_id uuid NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  system text NOT NULL,
  captured_header text NOT NULL,
  missing_header text NOT NULL,
  closing_note text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (platform_id, system)
);
--> statement-breakpoint

-- ============================================================
-- 8. sessions — persist the last-picked scenario per session
-- ============================================================
ALTER TABLE sessions ADD COLUMN last_scenario_slug text;
