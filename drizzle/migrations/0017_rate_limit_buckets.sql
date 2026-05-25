-- drizzle/migrations/0017_rate_limit_buckets.sql
--
-- rate_limit_buckets — Postgres-backed fixed-window rate limit counter.
-- One row per (key, current minute). Each protected route does an atomic
-- INSERT … ON CONFLICT DO UPDATE that either increments the counter for
-- the current window or rolls it over to a new window. No new vendor /
-- redis / env var needed; the existing pooled connection handles it.
--
-- key shape: '<scope>:<user-id>' (e.g. 'intake:abc-...') so different
-- scopes for the same user don't compete for the same bucket.
--
-- Cleanup: window_start lets a future cron prune rows older than ~1 hour.
-- The table is small (one row per active user per minute) so cleanup is
-- not load-bearing; this migration leaves cleanup to a follow-up.

CREATE TABLE "rate_limit_buckets" (
  "key" text PRIMARY KEY,
  "window_start" timestamp with time zone NOT NULL,
  "count" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX "idx_rate_limit_buckets_window_start"
  ON "rate_limit_buckets" ("window_start");
