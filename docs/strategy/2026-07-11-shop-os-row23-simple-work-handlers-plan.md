# Shop OS Row 23 — Simple Work Handler Execution Plan

> Execute on `feat/shop-os-row23-work-handlers` from the current `origin/main`. Follow project `AGENTS.md`, `tasks/lessons.md`, the active Shop OS plan, and the Row 23 design. One writer owns source; review lanes are read-only.

**Goal:** Ship the handler/API contract for approved simple work, proof attachments, and found-concern diagnostic escalation without UI, schema, production-data, provider, or diagnostic-engine changes.

**Architecture:** One `lib/shop-os/simple-work.ts` domain owns persisted actor truth, active-before-start and pinned-after-start immutable approval validation, ticket-first locks, optimistic state transitions, server-derived retry identities, content-bound attachment compensation, proof proxying, and source-bound escalation creation. Thin routes authenticate/paywall and translate strict JSON or bounded multipart requests. The narrow quote lifecycle correction preserves pinned approval for in-progress/done simple work, blocks edits to that historical scope, and excludes its totals from later authorization versions while preserving in-progress diagnostic quoting. Existing storage receives job-scoped upload/delete/download helpers; raw storage paths never cross the API.

**Tech:** Next.js route handlers, TypeScript, Drizzle, PostgreSQL/PGlite, Supabase private storage, Zod, Vitest.

---

### Task 1: Exact simple-work authorization and state transitions

**Files:**

- Create: `lib/shop-os/simple-work.ts`
- Create: `tests/unit/shop-os-simple-work.test.ts`
- Create: `app/api/tickets/[id]/jobs/[jobId]/work/route.ts`
- Create: `tests/unit/shop-os-simple-work-routes.test.ts`
- Modify: `lib/shop-os/quotes.ts`
- Modify: `tests/unit/shop-os-quote-drafts.test.ts`
- Modify: `tests/unit/shop-os-quote-versions.test.ts`

1. Write failing handler tests for same-shop active assigned actor, repair/maintenance-only scope, open ticket, no session, exact active snapshot ID+kind, latest approved decision, stale/reassigned/inactive/cross-shop denial, lock contention, and quote-decision races.
2. Write failing transition tests for `open → in_progress`, state-idempotent start, bounded trimmed note, `expectedUpdatedAt` conflict/no-op behavior, completion requiring note plus a Row-23 proof photo, and already-done completion replay.
3. Write quote regressions proving in-progress and done simple work retain pinned approval when other ticket quote work supersedes the active version, cannot have their scope edited or approval provenance cleared, and are excluded from later authorization snapshots/totals. Prove done replay/history still work and preserve diagnostic quoting while its job is `in_progress`.
4. Implement the smallest ticket-first locked authorization helper and mutation handler. Add an exact snapshot ID+kind helper alongside the existing quote snapshot helper; do not change diagnostic semantics.
5. Add a privacy-minimized repeatable-read GET workspace containing job title/kind/work status, `updatedAt`, note, authorization projection, and safe attachment metadata only.
6. Add the thin authenticated/paywalled work route with strict discriminated bodies and bounded status mapping.
7. Run:

   ```bash
   pnpm exec vitest run tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-simple-work-routes.test.ts --testTimeout=30000 --hookTimeout=30000
   pnpm exec tsc --noEmit
   git diff --check
   ```

8. Commit: `Add approved simple work contract`.

---

### Task 2: Retry-safe job proof attachments

**Files:**

- Modify: `lib/shop-os/simple-work.ts`
- Modify: `lib/storage/client.ts`
- Create: `app/api/tickets/[id]/jobs/[jobId]/attachments/route.ts`
- Create: `app/api/tickets/[id]/jobs/[jobId]/attachments/[attachmentId]/route.ts`
- Create: `tests/unit/shop-os-job-attachments.test.ts`
- Create: `tests/unit/shop-os-job-attachment-routes.test.ts`

1. Write failing tests for strict kind/canonical MIME/magic-byte pairs, fatal UTF-8 text, non-empty ≤4 MiB bytes, assigned approved in-progress work, server-derived shop+job+actor+request identity, content-digest paths, uploader-bound retry matching, collision denial, and no storage path in results.
2. Write race tests proving upload occurs outside locks, final authorization is rechecked, database failure triggers best-effort object cleanup, failed cleanup followed by same-byte retry recovers through safe content-bound upsert, and lock/unique conflicts are retryable.
3. Add job-scoped private upload, delete, and download helpers to the existing storage client. Keep session artifact behavior unchanged.
4. Implement upload/finalize compensation and an authenticated ≤4 MiB private-byte proxy that rejects oversized/unsupported persisted metadata before download, rechecks downloaded length, and returns 60-second private cache, canonical content type, and `nosniff`.
5. Add thin multipart and proof routes. Reject excessive `Content-Length` before `formData()`, extra fields, malformed UUIDs, byte/MIME mismatches, unsupported MIME, and oversized files before storage work where platform ordering permits.
6. Run:

   ```bash
   pnpm exec vitest run tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-job-attachments.test.ts tests/unit/shop-os-job-attachment-routes.test.ts --testTimeout=30000 --hookTimeout=30000
   pnpm exec tsc --noEmit
   git diff --check
   ```

7. Commit: `Add retry-safe simple work proof`.

---

### Task 3: Found-concern diagnostic escalation

**Files:**

- Modify: `lib/shop-os/simple-work.ts`
- Create: `app/api/tickets/[id]/jobs/[jobId]/escalations/route.ts`
- Create: `tests/unit/shop-os-work-escalation.test.ts`
- Create: `tests/unit/shop-os-work-escalation-route.test.ts`

1. Write failing tests for active assigned approved in-progress source work, bounded concern/tier, server-derived shop+ticket+source+actor+request identity, exact retry, same client UUID from another source/actor, derived-ID collision, cross-shop/reassigned/stale-pinned-approval races, and ticket-first lock order.
2. Prove the created job is one unassigned `diagnostic` job with `open`, `pending_quote`, no session, no story, and no approval; source work is unchanged.
3. Prove zero diagnostic initialization, provider, AI, artifact extraction, quote mutation, or customer-facing side effects.
4. Implement the handler and thin authenticated/paywalled route.
5. Run:

   ```bash
   pnpm exec vitest run tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-work-escalation.test.ts tests/unit/shop-os-work-escalation-route.test.ts --testTimeout=30000 --hookTimeout=30000
   pnpm exec tsc --noEmit
   git diff --check
   ```

6. Commit: `Add simple work diagnostic escalation`.

---

### Task 4: Converge, review, and ship Row 23

**Files:**

- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`

1. Run the complete Row 23 focused suite plus Row 17/22 approval regressions.
2. Run once, serializing heavy commands:

   ```bash
   pnpm exec vitest run --maxWorkers=4 --testTimeout=30000 --hookTimeout=30000
   pnpm exec tsc --noEmit
   pnpm run build
   git diff origin/main --check
   ```

3. Independently review the full branch for tenant isolation, actor freshness, pinned exact-version proof, quote invalidation behavior, optimistic concurrency, completion replay, lock order, source/content-bound retry identity, upload compensation recovery, proxy privacy, work-phase photo evidence, escalation honesty, zero AI/provider work, and scope.
4. Resolve every Critical, Important, and Minor finding and rerun affected proof.
5. Update Row 23 complete with exact PR/test proof, add its implementation correction, and set Row 24 as the next safe move. Preserve all production/external/feature gates.
6. Open a ready PR, wait for required checks, merge through GitHub, delete the remote branch, wait for production Ready, run signed non-mutating route smoke, inspect fresh errors, and record the deployed checkpoint.

## Done when

Approved assigned repair/maintenance work can start, retain a bounded note and proof, and complete without AI; unapproved or stale mutations fail before side effects; a found concern creates one honest independently locked diagnostic job; retries do not duplicate durable resources; the branch is independently reviewed, fully verified, merged, deployed, and recorded with Row 24 next.
