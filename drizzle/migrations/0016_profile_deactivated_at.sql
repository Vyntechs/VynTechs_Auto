-- drizzle/migrations/0016_profile_deactivated_at.sql
--
-- profiles.deactivated_at — soft-delete timestamp for team members removed
-- by an Admin via /settings/team. Middleware reads this column on every
-- authed request; if set, the user is redirected to /deactivated. Past
-- sessions/diagnoses keep their FK to the deactivated profile (the name
-- still renders in history).
--
-- Additive only: new nullable column. No data path can break. Partial
-- index keeps it free for the common case (NULL) and small for the rare
-- one (deactivated rows). Rollback = revert this migration; column +
-- index stay (harmless).

ALTER TABLE "profiles"
  ADD COLUMN "deactivated_at" timestamp with time zone;
--> statement-breakpoint
CREATE INDEX "idx_profiles_deactivated_at"
  ON "profiles" ("deactivated_at")
  WHERE "deactivated_at" IS NOT NULL;
