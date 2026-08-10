# Parts Arrival Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a safe, in-repair-order Needs order → Ordered → Received handoff for every approved part line, with authorized manual controls and technician read-only truth.

**Architecture:** Add one domain module that projects approved part-line truth and owns state transitions against existing schema fields. Expose strict thin GET/POST routes, parse the safe envelope at the client boundary, and mount one role-shaped component inside each approved job card. No migration, supplier integration, automatic hold release, or separate page.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Drizzle/PostgreSQL, Zod, Vitest/PGlite, Testing Library, Playwright, CSS Modules.

## Global Constraints

- Baseline and approval are exact: commit `616b88019e3fd8d8cb7e42b93bd4f4f31dccecb2`, Buzz event `906ffe0ba0ae02dd7f1c1573e9b1a689686e6ca92f109735dc8bb4dcdbe8a9d6`.
- Work only in `.worktrees/parts-arrival-handoff-2026-08-09` on `codex/parts-arrival-handoff-2026-08-09`.
- Follow `docs/superpowers/specs/2026-08-09-shop-os-parts-arrival-handoff-design.md` and the customer interaction doctrine.
- Tests must fail for missing behavior before production code is written.
- Never expose internal cost/vendor data, mutate quote history, release a hold, start work, add a migration, call a supplier, or touch production data.
- One repair wave after consolidated review; a newly discovered blocking architectural defect stops the slice.

---

## Task 1: Freeze approved intent and baseline

**Files:**
- Create: `docs/superpowers/specs/2026-08-09-shop-os-parts-arrival-handoff-design.md`
- Create: `docs/superpowers/plans/2026-08-09-shop-os-parts-arrival-handoff.md`

- [x] Create the isolated branch from exact production release `616b880`.
- [x] Install the frozen dependency graph.
- [ ] Complete all eight baseline test shards and record the exact exit.
- [x] Record the approved visual, state, role, privacy, concurrency, failure, and rollback contracts.

**Verify:** `git rev-parse HEAD` is `616b880...`; `pnpm test:shards` exits 0 before product edits.

## Task 2: Prove domain behavior red

**Files:**
- Create: `tests/unit/shop-os-parts-arrival.test.ts`
- Create: `lib/shop-os/parts-arrival.ts`

- [x] Write fixtures with two approved part lines and immutable quote snapshots.
- [x] Prove role-shaped reads, partial/all-here counts, safe receipts, and no internal sourcing fields.
- [x] Prove legal transitions, exact replay, lost-response replay, concurrent attempts, and original receipt preservation.
- [x] Prove tech, inactive, cross-shop, stale-version, changed-line, returned-line, unapproved, done/canceled-job, and closed-ticket failures.
- [x] Prove only permitted `job_lines` fields change; ticket, job, quote snapshot, prices, and work/hold state remain identical.
- [x] Run the new test and capture the expected missing-module/behavior failure.
- [x] Implement the smallest domain module until the focused domain suite passes.

**Verify:** `pnpm vitest run tests/unit/shop-os-parts-arrival.test.ts` passes with meaningful mutation assertions.

## Task 3: Prove HTTP contracts red

**Files:**
- Create: `app/api/tickets/[id]/jobs/[jobId]/parts-arrival/route.ts`
- Create: `app/api/tickets/[id]/jobs/[jobId]/parts-arrival/[lineId]/route.ts`
- Create: `tests/unit/shop-os-parts-arrival-routes.test.ts`

- [x] Prove authentication/paywall checks happen before body parsing.
- [x] Prove GET is no-store and both routes resolve persisted actor identity.
- [x] Prove strict media type/body limits and reject unknown actions/keys.
- [x] Prove not-found/authorization/conflict/retryable mappings reveal no tenant data.
- [x] Prove response serialization never includes internal cost/vendor fields.
- [x] Run route tests red, then add thin route adapters until green.

**Verify:** `pnpm vitest run tests/unit/shop-os-parts-arrival-routes.test.ts` passes.

## Task 4: Prove the mounted interaction red

**Files:**
- Create: `lib/shop-os/parts-arrival-ui.ts`
- Create: `tests/unit/shop-os-parts-arrival-ui.test.ts`
- Create: `components/screens/ticket-parts-arrival.tsx`
- Create: `components/screens/ticket-parts-arrival.module.css`
- Create: `tests/unit/shop-os-ticket-parts-arrival.test.tsx`
- Modify: `components/screens/ticket-detail.tsx`
- Modify: `app/(app)/tickets/[id]/page.tsx`

- [x] Write a strict client parser for IDs, states, receipts, counts, and version binding.
- [x] Prove the three-stop rail, one applicable action, partial count, all-here truth, receipts, technician read-only state, and hold-safe wording.
- [x] Prove no optimistic settlement: only a validated server projection changes the rail.
- [x] Prove one GET reconciliation repairs lost, malformed, or non-2xx POST responses.
- [x] Prove focus returns to the advanced line and duplicate accessible labels do not appear.
- [x] Run parser/component tests red, then implement the smallest production UI.
- [x] Load role-shaped projections on the existing ticket page and mount them under their approved jobs.

**Verify:** focused parser/component/page tests pass in both authorized and technician roles.

## Task 5: Prove the real mounted browser experience

**Files:**
- Create: `tests/e2e/living-repair-order-harness/parts-arrival-page.tsx`
- Create: `tests/e2e/living-repair-order-harness/parts-arrival-route.ts`
- Create: `tests/e2e/parts-arrival-mounted.spec.ts`
- Create: `playwright.parts-arrival.config.ts`
- Create: `docs/proofs/2026-08-09-parts-arrival-handoff-implementation-proof.md`
- Create: `docs/proofs/artifacts/parts-arrival-handoff/*`

- [x] Mount the real ticket/detail + parts component with deterministic role-shaped server fixtures.
- [x] Exercise partial arrival, all parts here with hold preserved, and technician read-only at 390×844 and 1440×900.
- [x] Verify keyboard operation, visible focus, 44px controls, reduced motion, Axe, no horizontal overflow, no outside requests, and no browser errors.
- [x] Capture named screenshots and an exact browser result artifact.

**Verify:** `pnpm exec playwright test --config=playwright.parts-arrival.config.ts` passes and proof links only to real mounted evidence.

## Task 6: Converge and prepare the release candidate

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Modify: `tasks/lessons.md` only if a non-obvious correction occurs

- [x] Search all fixtures for the new strict contract and old state assumptions.
- [x] Run static, security, runtime, accessibility, scope, and provenance review from fresh frames; consolidate findings once.
- [x] Apply one repair wave, then one focused re-review.
- [x] Run `pnpm test:shards`, `pnpm exec tsc --noEmit`, production build, and the mounted Playwright suite; this repository has no `verify` script.
- [x] Confirm no migrations, supplier access, production mutation, dormant feature activation, secrets, debug code, or unrelated changes exist.
- [x] Update the active roadmap and driver state with exact proof and remaining production gate.
- [x] Commit with identical Vyntechs co-author/sign-off trailers and verify them.
- [x] Push the branch and open PR #250 with originating Buzz channel `95938fc9-02c1-4c1a-8b20-84f540bc6c74` recorded in its body.

**Verify:** exact HEAD matches every reported check; PR checks are green; production remains unchanged pending exact-version approval.
