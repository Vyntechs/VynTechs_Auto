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

- [x] Confirm the branch diff contains only the remediation and its regression evidence.
- [x] Run focused regression tests, TypeScript, production build, diff whitespace check, and dependency audit.
- [x] Commit and push the exact candidate branch.

### Task 2: Apply the production index before source promotion

**Files:**
- Apply source-equivalent SQL: `drizzle/migrations/0044_ticket_job_history_bound.sql`

- [x] Read the live migration history and catalog to ensure the index is absent and no conflicting name exists.
- [x] Apply `create index ticket_jobs_shop_ticket_created_idx on public.ticket_jobs (shop_id, ticket_id, created_at desc, id desc);` through Supabase migration history.
- [x] Query the live catalog to prove the exact index definition.
- [x] Run Supabase security and performance advisors; no new security finding was introduced. The performance advisor's unused-index notice is expected while production has only one job row and no post-release history query yet.

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

## Release Receipt — 2026-07-20

- Candidate commit: `55f7b3f3387213dc6aafe5b0b87e60cc17206ed2` on `security/ai-pii-penetration-audit-2026-07-19`.
- Local proof: focused regression suites passed; `pnpm exec tsc --noEmit`, `pnpm build`, `git diff --check`, and `pnpm audit --prod --audit-level=high` passed.
- Production preflight: `ticket_jobs` had one row and no existing `ticket_jobs_shop_ticket_created_idx` catalog entry or matching migration record.
- Applied Supabase migration: `ticket_jobs_history_bound_index`.
- Catalog proof: `CREATE INDEX ticket_jobs_shop_ticket_created_idx ON public.ticket_jobs USING btree (shop_id, ticket_id, created_at DESC, id DESC)`.
- Advisor outcome: existing informational policy/index backlog remains outside this release; the new index is reported unused only because the current production dataset has not exercised the new history query. No customer rows, permissions, RLS policies, or storage objects were changed.
