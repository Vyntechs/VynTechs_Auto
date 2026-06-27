-- 0020_sessions_wizard_state
--
-- PR-N4 of the curator architecture.
-- Adds a single NULLABLE jsonb column for the wizard's in-progress state, persisted
-- per session and version-PINNED (wizard_state.flowVersionId never changes mid-session).
-- Additive-only: no DROP, no ALTER on existing columns, no row UPDATE. Touches one table.
--
-- 'wizard_lock_in' is appended to the sessionEvents.eventType TypeScript enum array in
-- lib/db/schema.ts. There is NO DB-level CHECK constraint on session_events.event_type
-- (verified across migrations 0001-0019), so this requires no SQL change here.
--
-- Rollback: ALTER TABLE sessions DROP COLUMN wizard_state;

ALTER TABLE sessions ADD COLUMN wizard_state jsonb;
