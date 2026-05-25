-- drizzle/migrations/0018_profile_is_curator_flag.sql
--
-- profiles.is_curator — explicit grant for curator-console access. Replaces
-- the implicit "role='owner' inherits curator" rule, which started handing
-- platform-wide curator access to every new self-service signup once the
-- marketing site opened to traffic (every signup gets role='owner' on its
-- auto-created shop). canCurate() now reads this flag (OR matches
-- FOUNDER_EMAIL) and ignores role entirely.
--
-- Additive only: NOT NULL with DEFAULT false backfills every existing row
-- to false. The production migration applies this ALTER together with a
-- targeted UPDATE that flips is_curator = true for the explicit curator
-- allowlist (Brandon, Mac, Angel + the e2e test account), atomically, so
-- the curator team never loses access for a single request.

ALTER TABLE profiles
  ADD COLUMN is_curator boolean NOT NULL DEFAULT false;
