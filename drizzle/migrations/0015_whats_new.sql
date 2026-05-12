-- drizzle/migrations/0015_whats_new.sql
--
-- What's New — per-deploy changelog entries surfaced to logged-in users.
-- Brandon authors rows by hand via Supabase MCP execute_sql. Each user has
-- a last_seen_whats_new_at timestamp on profiles; entries published after
-- that timestamp count as unseen and drive both the in-nav "New" pill and
-- a "new" marker on /whats-new entries.
--
-- Additive only: new table + new nullable column. No data path can break.
-- Rollback = revert this migration; table + column stay (harmless).

CREATE TABLE "whats_new_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "whats_new_entries_published_at_idx" ON "whats_new_entries" USING btree ("published_at" DESC);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "last_seen_whats_new_at" timestamp with time zone;
