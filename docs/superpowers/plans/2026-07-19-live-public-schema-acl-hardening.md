# Live public-schema ACL hardening plan

**Finding:** Supabase's live advisor reports `public.rls_auto_enable()` as a `SECURITY DEFINER` function executable by `PUBLIC`, `anon`, and `authenticated`. A metadata-only grant inspection also shows legacy `TRUNCATE`, `REFERENCES`, and `TRIGGER` table grants inherited by the client roles. The application uses Supabase's browser client for Auth only; product data access runs through server-side Drizzle or explicitly server-only provider clients.

## Intended change

Add one idempotent migration that:

1. revokes every public-schema table privilege from `PUBLIC`, `anon`, and `authenticated` on all existing tables;
2. removes those table grants from the database owner's public-schema defaults so future tables fail closed;
3. conditionally revokes `EXECUTE` on `public.rls_auto_enable()` from `PUBLIC`, `anon`, and `authenticated` when the provider-managed function exists; and
4. removes public/client execution from the database owner's future public-schema function defaults.

The migration will not remove `service_role` or application database-owner access, change rows, change RLS policies, drop the provider event trigger, enable diagnostics, or alter production.

## Why this is the smallest safe path

- RLS does not govern `TRUNCATE`, `REFERENCES`, or `TRIGGER`; revoking the complete privilege surface closes the gap rather than adding misleading row policies.
- The product has no browser-side public-table dependency to preserve.
- Keeping the provider event trigger retains automatic RLS-on-create defense while removing its unnecessary RPC entrance.
- Default-privilege hardening prevents the same provider/client grants from silently returning on later tables or functions.

## Test-first proof

1. Seed an ephemeral database with the same legacy client grants and a no-argument `SECURITY DEFINER` stand-in.
2. Prove the new guard fails before migration support exists.
3. Apply the migration twice.
4. Assert zero effective `PUBLIC`, `anon`, or `authenticated` privilege on every public table; zero client execution on the named function; unchanged service CRUD; and a newly-created sentinel table/function that inherit no public/client privilege.
5. Run the adjacent ACL and migration test neighborhood, TypeScript, production build, and diff review.

## Rollback and stop conditions

- Before production: revert or omit this migration.
- After production: restore only a documented, least-privilege grant required by a proven direct-client use case; do not restore broad defaults.
- Stop before applying to production. Live DDL and enabling Supabase leaked-password protection remain explicit production-control gates.
