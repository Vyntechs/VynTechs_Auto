-- drizzle/migrations/0011a_session_curator_columns.sql
--
-- Phase P task 12 — adds curator-decision lifecycle fields to sessions for
-- the deferred-queue Approve/Override/Close handlers. Both columns are
-- nullable; existing rows are unaffected.

ALTER TABLE sessions
  ADD COLUMN curator_note text,
  ADD COLUMN curator_override_action text;
