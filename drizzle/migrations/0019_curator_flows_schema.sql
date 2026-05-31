-- 0019_curator_flows_schema
--
-- PR-N1 of the curator architecture
-- (docs/superpowers/specs/2026-05-26-6.0-psd-cranks-no-start-flow-design.md, §6).
--
-- REALIGNED to the "name-tag" (slug) decision: flows + research_runs key on
-- platform_slug TEXT + symptom_slug TEXT, NOT uuid FKs to platforms(id)/symptoms(id).
-- Reasons (verified against origin/main + prod):
--   (a) main's live app has NO platforms/symptoms tables in code; symptoms are
--       denormalized text today (corpus_entries.symptom_tags text[]) — match it.
--   (b) The unit-test DB (PGlite, tests/helpers/db.ts) applies the main-line
--       migrations, which never CREATE platforms/symptoms — a FK to platforms
--       would fail the entire suite at migrate time.
--   (c) The runtime flow lookup (PR-N4 getPublishedFlowFor/getFlowForSession)
--       keys on slug pairs; resolvePlatformSlug() returns a slug STRING.
-- Referential integrity moves to AUTHORING time (curator picks from a real list;
-- messy-input resolver normalizes to canonical slug; PR-N2 publish-time check
-- refuses to publish a flow whose slug is not a known platform/symptom).
--
-- Additive-only. No DROP, no ALTER on existing rows/columns. Four NEW tables +
-- three NEW enums. Touches ZERO existing tables. Does NOT reference
-- platforms/symptoms at all.
--
-- Pre-apply rehearsal (required):
--   1. psql -d vyntechs_rehearsal -v ON_ERROR_STOP=1 -f drizzle/migrations/0019_curator_flows_schema.sql
--   2. BEGIN ... <this file> ... ROLLBACK on prod via Supabase MCP execute_sql
-- Apply path (Brandon-gated, per feedback_no_dangerous_prod_ops):
--   Supabase MCP apply_migration name=0019_curator_flows_schema, body = this file.

CREATE TYPE flow_version_state AS ENUM ('draft', 'published', 'archived');
CREATE TYPE flow_outcome_kind  AS ENUM ('confirmed_fix', 'returned_comeback', 'misdiagnosis', 'inconclusive', 'abandoned');
CREATE TYPE research_run_status AS ENUM ('running', 'completed', 'failed', 'partial');

-- ---- flows -----------------------------------------------------------------
-- Stable identifier for an authored (platform, symptom) case. Keyed on slug
-- TEXT pairs, not FK uuids. platform_slug must match a resolvePlatformSlug()
-- output (e.g. 'ford-super-duty-3rd-gen-60-psd'); symptom_slug a canonical
-- symptom slug (e.g. 'cranks-no-start'). Validated at AUTHORING/PUBLISH time.
CREATE TABLE flows (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE,                 -- 'sd3-60psd-cranks-no-start'
  platform_slug   text NOT NULL,                        -- e.g. 'ford-super-duty-3rd-gen-60-psd'
  symptom_slug    text NOT NULL,                        -- e.g. 'cranks-no-start'
  display_title   text NOT NULL,                        -- '2003-2007 F-250 6.0 PSD — Cranks-No-Start'
  created_at      timestamptz NOT NULL DEFAULT now(),
  is_retired      boolean NOT NULL DEFAULT false        -- last-ditch kill switch
);

-- One active (platform_slug, symptom_slug) pair at a time — retired excluded.
-- Replaces the spec's UNIQUE(platform_id, symptom_id) WHERE is_retired=false.
CREATE UNIQUE INDEX flows_active_platform_symptom_uniq
  ON flows (platform_slug, symptom_slug) WHERE is_retired = false;

-- ---- flow_versions ---------------------------------------------------------
-- Immutable per version. State: draft -> published -> archived. Never modified
-- in place after publish; "edit" creates a new draft row.
CREATE TABLE flow_versions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id                 uuid NOT NULL REFERENCES flows(id),
  version_number          integer NOT NULL,             -- monotonic per flow
  state                   flow_version_state NOT NULL,
  body                    jsonb NOT NULL,               -- the Flow body (lib/flows/types.ts)
  body_schema_version     text NOT NULL DEFAULT '1.0',
  authored_by             uuid NOT NULL REFERENCES profiles(id),
  authored_at             timestamptz NOT NULL DEFAULT now(),
  published_by            uuid REFERENCES profiles(id),
  published_at            timestamptz,
  archived_by             uuid REFERENCES profiles(id),
  archived_at             timestamptz,
  change_note             text NOT NULL,                -- mandatory human-readable change desc
  research_run_id         uuid,                         -- FK added after research_runs exists (below)
  forked_from_version_id  uuid REFERENCES flow_versions(id)
);

CREATE UNIQUE INDEX flow_versions_flow_version_uniq
  ON flow_versions (flow_id, version_number);

-- Exactly one published row per flow (the safe-serving guarantee).
CREATE UNIQUE INDEX flow_versions_one_published_per_flow
  ON flow_versions (flow_id) WHERE state = 'published';

-- ---- flow_outcomes ---------------------------------------------------------
-- One row per session that ran a published flow version. NEVER deleted
-- (ON DELETE RESTRICT on both FKs) — this is the first-time-fix moat.
CREATE TABLE flow_outcomes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
  flow_version_id   uuid NOT NULL REFERENCES flow_versions(id) ON DELETE RESTRICT,
  outcome           flow_outcome_kind NOT NULL,
  outcome_note      text,
  tagged_by         uuid NOT NULL REFERENCES profiles(id),
  tagged_at         timestamptz NOT NULL DEFAULT now()
);

-- One outcome per (session, version) — prevents double-counting in metrics.
CREATE UNIQUE INDEX flow_outcomes_session_version_uniq
  ON flow_outcomes (session_id, flow_version_id);

-- ---- research_runs ---------------------------------------------------------
-- Provenance of the parallel-subagent dispatch that pre-filled a draft.
-- platform_slug/symptom_slug TEXT (same slug-keying as flows); flow_id is
-- nullable because first-time research runs before a flow row exists.
CREATE TABLE research_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id         uuid REFERENCES flows(id),            -- null for first-time research
  platform_slug   text NOT NULL,
  symptom_slug    text NOT NULL,
  status          research_run_status NOT NULL DEFAULT 'running',
  error_message   text,                                 -- populated on status='failed'
  agent_outputs   jsonb NOT NULL DEFAULT '[]'::jsonb,   -- array of { agent_persona, research_log, findings_md, sources }
  synthesis_md    text NOT NULL DEFAULT '',             -- synthesized consensus + conflicts
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  initiated_by    uuid NOT NULL REFERENCES profiles(id)
);

-- Backfill the FK from flow_versions.research_run_id once research_runs exists.
ALTER TABLE flow_versions
  ADD CONSTRAINT flow_versions_research_run_id_fk
  FOREIGN KEY (research_run_id) REFERENCES research_runs(id);
