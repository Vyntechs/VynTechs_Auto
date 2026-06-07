-- 0024_diagram_step_kind_out_of_range.sql
-- Spec: docs/superpowers/specs/2026-06-07-diagnostic-diagram-design.md
-- Additive — no column drops, no type changes on existing columns.
-- The ONLY two genuinely-new columns the diagram rebuild needs; the meter
-- fields, routes_to_test_action_id, reasoning, and priority already exist
-- (migration 0021). Both new columns are nullable; partial data is the
-- steady state, not an error.

ALTER TABLE test_actions ADD COLUMN step_kind text;
--> statement-breakpoint
ALTER TABLE pin_scenario_readings ADD COLUMN is_out_of_range boolean;
