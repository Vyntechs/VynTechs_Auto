-- Add system-grouping columns for the interactive wiring-topology diagnostic.
--
-- components.systems: which system diagram(s) a component appears in. A text
--   array because hub components (PCM, ground nodes, CAN bus) belong to every
--   system's diagram, not just one. Empty default — components are tagged in a
--   separate, reviewed data step (see drizzle/data/2026-05-20-fuel-system-tags.sql).
-- symptoms.system: which system's topology diagram a cached symptom opens.
--   Nullable — backfilled for the existing fuel symptoms in the tagging step.
--
-- Both additive. No existing column is changed or dropped.

ALTER TABLE "components" ADD COLUMN "systems" text[] NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "symptoms" ADD COLUMN "system" text;
