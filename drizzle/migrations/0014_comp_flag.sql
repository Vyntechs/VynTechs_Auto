-- drizzle/migrations/0014_comp_flag.sql
--
-- profiles.is_comp — override flag that lets the paywall middleware grant
-- access regardless of Stripe subscription status. Used for grandfathered
-- users (the original Young Motorsports shop crew) before any paying
-- customer touches the app, and reusable later for ad-hoc comps.
--
-- Additive only: NOT NULL with a DEFAULT false means every existing row is
-- backfilled automatically. No data path can break. Rollback = revert this
-- migration; column stays in the table (harmless).

ALTER TABLE profiles
  ADD COLUMN is_comp boolean NOT NULL DEFAULT false;
