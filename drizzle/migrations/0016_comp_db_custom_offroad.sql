-- drizzle/migrations/0016_comp_db_custom_offroad.sql
--
-- Ad-hoc comp grant for the DB Custom Offroad technician
-- (Sales@dbcustomoffroad.com). Same mechanism that was used to
-- grandfather the original Young Motorsports crew in 0014_comp_flag.sql:
-- flip profiles.is_comp to true so checkAccess() in lib/auth-access.ts
-- short-circuits to 'allow' regardless of Stripe subscription status.
--
-- Idempotent and safe:
--   * If the user has already completed Google sign-in, his profile row
--     exists and this UPDATE flips one row.
--   * If he has NOT signed in yet, the subquery returns no rows and the
--     UPDATE matches zero rows — harmless no-op. In that case, after his
--     first sign-in, re-run the same UPDATE in the Supabase SQL Editor
--     (or land a follow-up migration) to flip the flag.
--
-- Additive only: touches one boolean on at most one row. No schema
-- change, no destructive operation. Rollback = run the same UPDATE with
-- SET is_comp = false.
--
-- Email match is case-insensitive because auth.users.email is stored as
-- entered by the OAuth provider.
--
-- Guarded by a check on the auth schema so this migration is also safe
-- to apply against the pglite test database (which has no auth.users
-- table); in that environment the UPDATE simply doesn't run.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'auth' AND table_name = 'users'
  ) THEN
    UPDATE profiles
    SET is_comp = true
    WHERE user_id = (
      SELECT id FROM auth.users
      WHERE lower(email) = lower('Sales@dbcustomoffroad.com')
    );
  END IF;
END $$;
