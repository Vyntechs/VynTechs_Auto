-- drizzle/migrations/0040_shop_os_job_time_clock_onoff.sql
--
-- Clock on / clock off, so a tech who bounces between many jobs at once can
-- capture ACTUAL time on each one — not one start-to-finish stretch that would
-- count the minutes they were off working something else.
--
-- Two columns, per job:
--   clocked_on_since  — when the current on-interval started; null when the tech
--                       is clocked OFF this job. Each job carries its own, so a
--                       tech can be clocked on to several jobs at the same time.
--   active_seconds    — time already banked from finished on/off intervals. The
--                       currently-open interval (now - clocked_on_since) is added
--                       at read time, never stored, so the running total stays
--                       live without a write.
--
-- Total actual time on a job = active_seconds + (now - clocked_on_since when on).
-- Additive only: two columns, no backfill, no existing data path changes.

alter table ticket_jobs
  add column clocked_on_since timestamptz,
  add column active_seconds integer not null default 0;
--> statement-breakpoint
alter table ticket_jobs
  add constraint ticket_jobs_active_seconds_nonneg check (active_seconds >= 0);
