# Shop OS Phase-2 Diagnostic Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Use `superpowers:test-driven-development` for each behavior change and `superpowers:verification-before-completion` before shipping.

**Goal:** Let an eligible assigned technician safely start a ticket-backed diagnostic from Today, reusing the complete existing diagnostic initialization pipeline while concurrent/repeated taps produce one linked session and at most one provider call per live lease.

**Architecture:** A domain state machine acquires a bounded database lease, the route winner invokes the existing full retrieval/tree initializer outside the transaction, and a second transaction atomically creates and uniquely links the owned session. Expired or uncertain attempts become `ambiguous` and require explicit possible-duplicate-cost confirmation. Today owns the third-tap interaction; repair/maintenance remains disabled.

**Tech Stack:** Next.js App Router, React/TypeScript, Drizzle/PostgreSQL, Vitest/PGlite/Testing Library, existing retrieval and diagnostic engine.

## Global constraints

- Preserve diagnostic prompts, retrieval adapters, generated tree shape, counter intake's topology preflight/populated sentinel, and session UI/API behavior.
- Never invoke a provider for unauthorized, cross-shop, unassigned, other-tech, below-tier, terminal, simple-work, live-lease, ready, or unconfirmed-ambiguous requests.
- Use database time and conditional writes for lease/state ownership. In-memory locks are not correctness boundaries.
- Never hold a database transaction across provider work.
- Return an existing linked session before quota/cap work. A new lease winner must pass the shared intake rate limit and current five-open-session cap before provider work; a certain rejection releases the lease safely.
- Never auto-regenerate an expired or uncertain attempt.
- Use a named two-minute database-time lease, exceeding the 60-second route envelope. Every finalize/fail/ambiguity write must match job, `initializing`, attempt key, and lease ownership; a stale worker never changes a newer attempt.
- Link exactly one session to one diagnostic job; the linked session belongs to the current assigned technician and carries the ticket vehicle ID/intake snapshot.
- Do not expose attempt keys, provider internals, customer data, or cross-shop resource existence.
- No migration, production write, quote/approval, repair mutation, account/credential, spend, deployment, or engine redesign.

## Task 1: Claim and publish row 15

- [x] Record PR #125 merge/tree equality and close row 14's final shipping checkbox.
- [x] Audit the approved spec, shipped schema, session creation route/domain, Today board, authorization, and test harness.
- [x] Choose the two-transaction leased state machine and unchanged initialization seam; document alternatives and failure rules.
- [x] Commit/push this packet, mark row 15 `in progress`, and open draft PR #126 before implementation.

## Task 2: Build the leased diagnostic-start domain

**Files:**

- Modify: `lib/tickets.ts` or create focused `lib/shop-os/diagnostic-start.ts`
- Create: `tests/unit/shop-os-diagnostic-start.test.ts`

**Produces:** acquire/finalize/fail domain operations with narrow safe result unions.

- [x] Write failing tests for existing ready reuse, one two-minute lease winner, live-lease waiter, attempt-key collision, and database-time lease ownership.
- [x] Prove active role/shop/tier/assignment/ticket/job/kind/status authorization and uniform safe failures.
- [x] Write failing tests for atomic session insert/link, vehicle/intake persistence, `in_progress` transition, idempotent finalize, and competing finalize recovery.
- [x] Prove expired initializing becomes `ambiguous`, ambiguity never auto-acquires, explicit confirmation uses a fresh key, and every transition is attempt-key conditional.
- [x] Prove an old worker finalizing or failing after expiry or a confirmed new attempt creates/links nothing and cannot change newer state.
- [x] Independently review the domain task and resolve all findings.

## Task 3: Reuse the full existing initializer and expose the route

**Files:**

- Create: `lib/diagnostics/initial-tree-bootstrap.ts` (or an equivalently focused shared seam)
- Modify: `app/api/sessions/route.ts`
- Modify: `app/api/intake/submit/route.ts` only as needed to share and lock existing topology/generator behavior
- Create: `app/api/tickets/[id]/jobs/[jobId]/diagnostic/start/route.ts`
- Create: `tests/unit/shop-os-diagnostic-start-route.test.ts`
- Modify focused session-route tests if the initializer factory is extracted

**Consumes:** Task 2 acquire/finalize/failure operations and the exact current retrieval/tree pipeline.

- [x] Write failing route tests for auth, paywall, strict UUID body, exact shared `intake:${userId}` limit of ten, five-open-session cap, ready/wait/ambiguous envelopes, ready-retry bypass, and no provider calls outside a lease-winning, quota-eligible state.
- [x] Extract only the initializer seams needed to preserve counter intake's topology preflight/populated sentinel and the existing retrieval/tree assembly; prove topology skips AI and non-topology input wiring does not drift.
- [x] Run the lease winner through the full initializer, then finalize. Restrict `failed` to errors proven before initializer entry; map every initializer throw/timeout/transport or uncertain persistence outcome to `ambiguous`.
- [x] Return only safe state, retry guidance, warning, and owned session ID. Keep `maxDuration = 60`.
- [x] Keep optional cold-case draft synthesis outside row 15; it is not part of session initialization correctness.
- [x] Independently review the route/pipeline task and resolve all findings.

## Task 4: Add the Today third-tap start interaction

**Files:**

- Modify: `lib/tickets.ts`
- Modify: `components/screens/today-jobs-board.tsx`
- Modify: `components/screens/today-jobs-board.module.css`
- Modify: `tests/unit/shop-os-today-jobs-query.test.ts`
- Modify: `tests/unit/shop-os-today-jobs-board.test.tsx`

- [x] Write failing tests proving My Jobs exposes only safe diagnostic start state/error fields and no lease/attempt internals.
- [x] Implement the explicit matrix: `idle|failed` Start; `initializing` disabled/wait+refresh; `ambiguous` warning+confirmation; owned `ready` Open; inconsistent `ready` safe refresh/error. Preserve exact simple-work disabled copy.
- [x] Generate one attempt UUID per deliberate start, announce pending/wait/ready/ambiguous/error, and navigate only to a returned owned session.
- [x] Require an explicit second confirmation for ambiguous retry with exact possible-duplicate-cost warning and a fresh attempt UUID.
- [x] Preserve refresh truth, focus, 44px controls, reduced motion, and 375px single-column behavior.
- [x] Independently review the UI task and resolve all findings.

## Task 5: Verify, review, reconcile, and ship row 15

- [x] Run focused tests (10 files/176 tests), full suite (209 files/1,866 tests), TypeScript, production build, and diff check; all pass.
- [x] Inspect the full diff for provider duplication, authorization leaks, stale-lease auto-retry, empty-tree persistence, session ownership drift, simple-work start, and unrelated changes; none remain.
- [x] Obtain task reviews and a whole-branch review; resolve initializer isolation/typing, snapshot drift, stale-state privacy, settlement containment, local/server truth, assignment/provider interleaving, finalize TOCTOU, and expiry-recovery findings through TDD; final reviews approve with zero findings.
- [x] Add the Phase-2 diagnostic-bootstrap implementation correction, mark row 15 complete, preserve owner gates, and identify row 16 as next.
- [x] Push final head, pass GitHub checks, mark ready, squash-merge PR #126, verify source/merge tree equality at `224a8937444a6d68af12c2f02e130f057927fff7`, and immediately continue row 16.

## Verification

```bash
pnpm test tests/unit/shop-os-diagnostic-start.test.ts tests/unit/shop-os-diagnostic-start-route.test.ts tests/unit/shop-os-today-jobs-query.test.ts tests/unit/shop-os-today-jobs-board.test.tsx
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check origin/main...HEAD
```

## Stop conditions

- Stop before production schema/data writes, external credentials/accounts, spend, deployment/feature enablement, or irreversible action.
- Stop if the existing diagnostic initializer cannot be reused without changing its semantics.
- Stop if an authorized source-only implementation cannot guarantee a single live-lease provider winner or cannot preserve ambiguous expiry without auto-regeneration.
