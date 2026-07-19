-- drizzle/migrations/0039_shop_os_job_work_clock.sql
--
-- The tech's job now keeps its own clock. work_started_at is stamped the
-- moment a tech taps "Start work"; work_completed_at the moment they tap
-- "Complete work". Both are set by server code on the same transitions that
-- already move work_status (open -> in_progress -> done), so the tech does
-- nothing new. Together they give the shop wall-clock time on the job, the
-- first half of "quoted hours vs actual".
--
-- Additive only: two nullable columns, no backfill, no existing data path
-- changes. Jobs already in progress before this ships simply carry a null
-- start (and get a completed stamp when finished); the UI renders "—".

alter table ticket_jobs
  add column work_started_at timestamptz,
  add column work_completed_at timestamptz;
