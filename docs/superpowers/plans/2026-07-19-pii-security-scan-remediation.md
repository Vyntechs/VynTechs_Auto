# PII Security Scan Remediation

**Goal:** Close the four findings from scan `118cc1aa-86c0-4452-a90e-6c9b38263738` without adding user pages, collecting media, re-enabling diagnostics, applying a production migration, or merging/deploying.

**Architecture:** Preserve existing ShopOS behavior while placing strict limits at the server and database boundaries: literalize intake-search patterns, meter part-request bodies before parsing, make every job writer and the history read respect the existing 25-job budget, and scope corpus decay to the atomically claimed follow-up's shop.

## Scope and non-goals

- Keep normal intake search behavior and treat `%`, `_`, and the escape character as literal search text.
- Keep part-request request/response contracts, while rejecting bodies over 16 KiB before they are materialized.
- Use `25` as the total jobs-per-ticket ceiling because it is already the creation contract. Preserve legacy oversized rows; never delete or backfill them.
- Add the source migration for the job-history index, but do not apply it to Supabase in this workstream.
- Stop before merge, production migration application, or production deployment.

## Convergence path

1. Write focused failing regressions for each reportable finding and watch each fail for the intended missing behavior.
2. Implement the minimum server/query/mutation changes required to make the regressions pass.
3. Run affected tests, typecheck, build, bounded full-suite verification, audit, and exact reproducer checks.
4. Conduct one static/security/runtime re-review of the consolidated diff; make one bounded repair wave if needed.
5. Produce a merge recommendation only after all local gates are green. Production remains a separate, explicit gate.

## Test-first implementation tasks

### 1. Literal intake search

**Files:** `lib/intake/search-limits.ts`, `lib/intake/search.ts`, `tests/unit/intake-search-query.test.ts`.

- Add failing tests proving wildcard-only text does not match broad results, literal underscore values are searchable, and the escape character is escaped before `%` and `_`.
- Run the focused test and confirm it fails because patterns are currently unescaped.
- Add one narrowly named literal-LIKE pattern helper and use it at every customer/vehicle search predicate and prefix score with an explicit escape clause.
- Re-run focused tests and existing normal-search/tenant tests.

### 2. Meter part requests before parsing

**Files:** `app/api/tickets/[id]/jobs/[jobId]/part-requests/route.ts`, a narrow request-body helper if necessary, `tests/unit/shop-os-part-requests-routes.test.ts`.

- Add failing route tests for quota-before-body access, declared and streamed payloads above 16 KiB, exact-limit success, UTF-8 byte accounting, malformed JSON, and unchanged normal creation.
- Run them and confirm they fail because the route calls `req.json()` before its quota.
- Meter after auth/paywall/shop authorization but before stream access; read at most 16 KiB from the actual byte stream; return `413` over limit and preserve existing `400` malformed-JSON behavior.
- Re-run the route and domain neighborhoods.

### 3. Bound ticket job fanout at writes and history reads

**Files:** `lib/tickets.ts`, `lib/shop-os/simple-work.ts`, `lib/shop-os/canned-jobs.ts`, `components/screens/simple-work-workspace.tsx`, `components/screens/vehicle-history.tsx`, `lib/db/schema.ts`, one new Drizzle migration, relevant ticket/simple-work/history tests.

- Add failing tests for: add-job, work escalation, and canned-job application at the 25 total-job boundary; idempotent replay at capacity; and vehicle history returning at most 25 jobs per ticket with an honest truncation signal.
- Run them and confirm current writers/read join are unbounded after initial creation.
- Centralize `MAX_TICKET_JOBS_PER_TICKET = 25`; check after every existing ticket lock and after replay lookup where applicable; return a non-retryable capacity error.
- Replace the history join with a database-limited per-ticket job selection (25 plus sentinel), expose `jobsHasMore`, and show compact continuation text on the same integrated page.
- Add the source index `(shop_id, ticket_id, created_at DESC, id DESC)` required for bounded ordered history. Do not apply it to production here.
- Re-run data, concurrency, route/UI, and history tests.

**Architecture correction (review-discovered):** Do not use a window-ranked join: it ranks every legacy job before applying the 26-row cutoff. Use a correlated `LATERAL` job query with `ORDER BY created_at DESC, id DESC LIMIT 26`, then prove via `EXPLAIN (ANALYZE)` that each ticket reads at most 26 index rows. Align the Drizzle schema and migration index directions, remove `IF NOT EXISTS` from the source migration, and add boundary/replay/concurrency/UI regressions for all three job writers.

### 4. Scope corpus decay to the claimed shop

**Files:** `lib/corpus/decay.ts`, `lib/comeback/resolve.ts`, `tests/unit/corpus-decay.test.ts`, `tests/unit/comeback-resolve.test.ts`.

- Add failing regressions proving the claimed follow-up shop is passed to decay and that matching corpus rows from other shops or with no source shop are not decayed or retired.
- Run them and confirm current global update behavior fails the isolation contract.
- Require the server-owned claimed `shopId` in the decay input and constrain both update statements to it. Do not use caller-provided shop identity.
- Re-run decay/resolve tests, including concurrent resolution and non-fatal decay failure.

## Verification and rollback

- Focused red/green runs per task; then affected suites, `pnpm exec tsc --noEmit`, `pnpm build`, sequential full-suite shards, and dependency audit.
- Re-run the four scan reproducers against the final local branch and record closure evidence.
- Every change is reversible by a single branch revert. The migration remains unapplied; no production data or policy changes occur.
- Stop if a normal, supported flow would require a new product decision, a destructive migration, a diagnostic re-enable, or a production action.

## Correction audit record

- The former window-ranked history query was replaced with a tenant-correlated LATERAL lookup and a 26-row index-bound `EXPLAIN (ANALYZE)` regression against 10,000 legacy jobs.
- Job-limit regression coverage now proves add-job, found-work escalation, and canned-job replay behavior at the 25-job boundary.
- Corpus decay coverage proves both database tenant isolation and follow-up-shop provenance after a technician moves shops.
- Focused remediation tests, TypeScript, production build, diff whitespace check, and production dependency audit passed. The monolithic Vitest run was terminated after its worker exited without an observable result; use the existing sequential-shard policy for the final suite gate.
