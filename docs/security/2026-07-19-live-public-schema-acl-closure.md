# Live public-schema ACL source closure receipt

**Branch:** `security/ai-pii-penetration-audit-2026-07-19`  
**Reviewed production deployment:** `5b9fb0505a1f505eb8de8b0129b607e3d618ce4e`  
**Status:** Live database metadata exposed a legacy ACL gap; migration `0043` closes its current and future source paths without changing production.

No production DDL, Auth setting, customer row, subscription, entitlement, provider configuration, or diagnostic setting was changed.

## Read-only live evidence

- Production is healthy on the exact audited base commit.
- Every public table reports RLS enabled.
- Supabase's security advisor reported 35 informational `RLS enabled, no policy` notices. Metadata inspection showed those fail closed for row CRUD, but legacy client roles still held `TRUNCATE`, `REFERENCES`, and `TRIGGER` privileges that RLS does not govern.
- Supabase reported `public.rls_auto_enable()`—a provider-side RLS-on-create event-trigger function—as `SECURITY DEFINER` and executable by `PUBLIC`, `anon`, and `authenticated`.
- Supabase also reports compromised-password screening disabled. That is a production Auth setting, not a source-code fix, and remains an explicit rollout gate.

Advisor references: [RLS without policies](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anonymous `SECURITY DEFINER` execution](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated `SECURITY DEFINER` execution](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), and [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Durable source control

Migration `0043_public_schema_client_acl.sql`:

- revokes every existing public-schema table privilege from `PUBLIC`, `anon`, and `authenticated`;
- removes the same client grants from future public-schema table defaults;
- conditionally removes client execution from `public.rls_auto_enable()` while leaving its event trigger and owner intact; and
- removes PostgreSQL's role-global default function execution for `PUBLIC`, `anon`, and `authenticated`, preventing future provider or application functions from becoming accidental RPCs.

The migration does not touch `service_role`, the application database owner, RLS policies, stored rows, or Supabase Auth.

## Verification receipt

- Red proof: the new migration test failed because the hardening helper did not exist.
- Intermediate red proof: a schema-scoped function-default revoke still allowed future functions to inherit public execution.
- Green proof: the role-global correction removed execution from future functions as PostgreSQL requires.
- Focused migration test: 1 file, 1 test passed.
- Adjacent RLS, server-only ACL, Stripe ledger, payment, quote, vendor, ticket, and messaging schema neighborhood: 8 files, 40 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed on Next.js `16.2.10`; 64 pages generated.
- `git diff --check`: passed.

## Remaining production gate

Before source promotion, migration `0042` and `0043` must be applied in order through a controlled database change. The post-apply proof must rerun security and performance advisors and confirm zero effective public/client table privileges, zero client execution on `public.rls_auto_enable()`, unchanged service access, and no failed application smoke path. Leaked-password screening should be enabled in the same controlled release window and verified with a non-customer QA identity.
