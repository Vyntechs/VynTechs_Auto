# PII Remediation Production Release Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:verification-before-completion` for every release claim.

**Goal:** Release the security remediation safely by applying its required production index, merging the reviewed branch, and verifying the deployed system.

**Architecture:** Apply the additive index before source promotion so no deployed query can depend on absent schema. Preserve a rollback commit reference, verify the live catalog and advisors, merge only the validated branch, then prove the deployment is healthy without modifying customer data.

**Tech Stack:** Supabase Postgres, GitHub, Vercel, Next.js, Vitest.

## Global Constraints

- Apply only `ticket_jobs_shop_ticket_created_idx`; do not alter rows, RLS, grants, storage, or diagnostics.
- Use Supabase migration history rather than Drizzle's local migration table.
- Merge only the reviewed security branch after fresh local checks and remote CI pass.
- Production verification is read-only: catalog, advisors, health/deployment checks, and no customer-data mutation.

---

### Task 1: Preserve and validate the release candidate

**Files:**
- Modify: `docs/superpowers/plans/2026-07-19-pii-security-scan-remediation.md`
- Create: `drizzle/migrations/0044_ticket_job_history_bound.sql`

- [ ] Confirm the branch diff contains only the remediation and its regression evidence.
- [ ] Run focused regression tests, TypeScript, production build, diff whitespace check, and dependency audit.
- [ ] Commit and push the exact candidate branch.

### Task 2: Apply the production index before source promotion

**Files:**
- Apply source-equivalent SQL: `drizzle/migrations/0044_ticket_job_history_bound.sql`

- [ ] Read the live migration history and catalog to ensure the index is absent and no conflicting name exists.
- [ ] Apply `create index ticket_jobs_shop_ticket_created_idx on public.ticket_jobs (shop_id, ticket_id, created_at desc, id desc);` through Supabase migration history.
- [ ] Query the live catalog to prove the exact index definition.
- [ ] Run Supabase security and performance advisors; stop if the migration introduces a new warning.

### Task 3: Merge and verify production

**Files:**
- No source changes expected.

- [ ] Open or update the pull request for the exact pushed commit and wait for required CI.
- [ ] Merge into `main` only after checks pass.
- [ ] Verify the production deployment is ready and run read-only health/error checks.
- [ ] Record the deployed commit, production migration, advisor outcome, and rollback commit in the remediation plan.

## Rollback

- Code: revert the release commit on `main` and let the normal deployment pipeline restore the previous application behavior.
- Database: retain the additive index; it is safe and supports the former query too. Do not drop it during an incident.
