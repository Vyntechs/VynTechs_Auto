alter table profiles
  add column if not exists job_timer_enabled boolean not null default false;
