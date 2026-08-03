---
title: "Shop OS Customer Approval Handoff Implementation Plan"
status: active
created: 2026-08-02
---

# Customer Approval Handoff Implementation Plan

**Goal:** Ship a secure manual customer-approval link whose first valid view makes waiting truthful and whose atomic per-job response updates the current immutable quote.

**Architecture:** Extend the existing quote-send retention envelope with a channel-aware manual-link lifecycle. Keep authenticated link creation in the quote workspace, public token resolution and response in one isolated domain module, and public route shims thin. The raw token stays client-only through a URL fragment.

**Tech:** Next.js App Router, React, TypeScript, Drizzle/Postgres, Vitest/Testing Library, existing browser journey harness.

## Task 1: Pin the data contract

**Files:** `tests/unit/shop-os-customer-approval-schema.test.ts`, `drizzle/migrations/0050_shop_os_customer_approval_links.sql`, `lib/db/schema.ts`, `tests/helpers/db.ts`

1. Write failing tests for `channel = link`, submitted→responded, submitted→expired, SMS rule preservation, token removal at terminal state, and direct-client denial.
2. Run the focused schema test and observe the expected failure.
3. Add migration 0050 and matching Drizzle declarations/fixture expectations.
4. Re-run the focused schema and existing messaging retention/deletion/purge suites.

## Task 2: Build token and projection domain

**Files:** `tests/unit/shop-os-customer-approval.test.ts`, `lib/shop-os/customer-approval.ts`

1. Write failing integration tests for strict client-generated token-hash input, capability/tenant/version checks, raw-token non-persistence, exact customer-safe projection, view idempotency, truthful `sent` projection, atomic per-job response, replay, expiry, supersession, and contention rollback.
2. Implement token-hash validation, safe projections, lock order, create/load/respond functions, and terminal retention math.
3. Re-run the focused domain tests until green without weakening assertions.

## Task 3: Revoke old links with quote correction

**Files:** `tests/unit/shop-os-quote-versions.test.ts`, `lib/shop-os/quotes.ts`

1. Add a failing test proving new-version creation expires every queued link for the old active version in the same transaction.
2. Implement link-row locking and expiration immediately after version supersession.
3. Prove rollback under injected failure and run quote-version plus customer-approval tests.

## Task 4: Add thin routes and public boundary

**Files:** `tests/unit/shop-os-customer-approval-routes.test.ts`, `tests/unit/auth-return-routes-security.test.ts`, `lib/auth-access.ts`, `app/api/tickets/[id]/quote/approval-links/route.ts`, `app/api/public/quote-approval/route.ts`

1. Write failing tests for authentication/capability delegation, strict JSON, bearer grammar, no-cache/no-referrer/noindex headers, rate limiting, uniform invalid-link errors, and middleware exemptions limited to the two intended paths.
2. Add thin route shims and exact exemptions.
3. Run route, auth, and rate-limit tests.

## Task 5: Build the customer surface

**Files:** `tests/unit/shop-os-customer-approval-ui.test.tsx`, `app/approve/page.tsx`, `components/screens/customer-approval.tsx`, `components/screens/customer-approval.module.css`, `lib/shop-os/customer-approval-ui.ts`

1. Write failing tests for fragment removal, loading, per-job decisions, live selected total, incomplete-submit refusal beside the action, one atomic request, retry with the same request key, terminal receipt, invalid-link recovery, keyboard/focus, and reduced motion.
2. Implement strict response parsers, the mounted customer surface, restrained confirmation settle, and recovery state.
3. Run focused UI and CSS contract tests.

## Task 6: Add the mounted advisor action

**Files:** `tests/unit/shop-os-quote-approval-ui.test.tsx`, `components/screens/manual-quote-builder.tsx`, `components/screens/manual-quote-builder.module.css`, `lib/shop-os/quote-builder-ui.ts`

1. Write failing tests for exact-version availability, copy success, clipboard refusal, current-version drift, no false sent claim, and local focus/status feedback.
2. Implement `Copy customer link` beside the prepared quote action without adding a page transition.
3. Revalidate the existing authenticated quote read every 20 seconds and on visibility return. Merge only same-version approval fields, preserve every local draft/focus surface, queue through local mutations, and expose version drift as explicit refresh recovery.
4. Run the complete quote UI test neighborhood.

## Task 7: Converge and prepare PR

1. Run all affected tests, then the full repository suite once.
2. Run TypeScript and production build.
3. Exercise phone and desktop public/customer and advisor journeys with accessibility, overflow, console/request faults, stale-link, replay, and cleanup checks.
4. Self-review the diff from clean context for product, security, migration, and scope defects; apply one consolidated repair wave and focused re-review.
5. Update `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md` and `docs/strategy/SHOP_OS_DRIVER_STATE.md` with exact proof and exclusions.
6. Read repo git identity, commit with required Co-authored-by and Signed-off-by trailers, push the branch, and open a Buzz-linked PR against `main` using channel `3c51444f-299a-4be9-9ad5-560046dc0501`.
7. Stop before production merge/deploy for the mandatory immediate human gate.

### One-time focused replan — final recovery review (2026-08-02)

**Re-plans:** 1/3. The focused final review found two Important recovery gaps, so convergence paused once for this bounded correction:

1. Treat exact-version `quote_ready` and `sent` jobs with no approved version as equally undecided for fresh link replacement and advisor visibility. A successful Copy arms that same control as explicit `Replace customer link`; failures retain the exact draft for retry. Replacement atomically expires the prior submitted link, preserves history, and never moves `sent` backward. Approved, declined, and deferred remain ineligible.
2. Freeze `{ requestKey, exact decisions, serialized body }` in mounted memory on the customer's first complete submission. Network loss, malformed success, `429`, and `503` disable choices and expose only byte-identical retry until the exact receipt arrives; a definite non-`429` 4xx uses the existing unavailable/contact-shop state.

The correction may not add a public endpoint, browser persistence, payload field, schema change, or terminal-state link creation. Focused tests were added red first, then repaired; full-suite/build/browser proof remains owned by Task 7.

### Consolidated review repair and release gate (2026-08-02)

The single repair wave also makes copy feedback visibly local, constrains actionable link rows to complete bearer material, returns cross-ticket idempotency collisions as conflicts, aligns lock ordering, scrubs browser-history state, preserves mounted advisor drafts while approval truth changes, and repairs the customer surface's contrast/group semantics. Internal `sent` remains the persisted state name, but every visible label reports the narrower fact `Link opened`.

Technical PR completion does not authorize production release. Legal review found that the current per-job choice record is not yet a counsel-approved electronic repair authorization: responder attribution/authority, assent language, reproducible disclosure version, receipt delivery, and retention remain unresolved. Merge/deploy is blocked until Brandon chooses the intended authorization posture and licensed Texas automotive consumer counsel approves the exact language and record policy. No unapproved legal workflow is added inside this repair wave.

### Verification receipt (2026-08-02)

- Eight serialized shards: 3,909 tests passed on the final source and test tree.
- TypeScript, `git diff --check`, and the production build passed.
- Mounted system-Chrome proof: phone completion, locked receipt, browser-history scrub, and desktop geometry passed; no horizontal overflow, browser faults, or serious/critical Axe findings.
- Exact production-server proof: `/approve` returned `no-store`, `no-referrer`, and `noindex, nofollow`.
- Focused static re-review: APPROVE. Security re-review: PASS. Independent acceptance validation: DONE.
- No migration, production data, merge, deploy, external message, or legal representation was executed.

## Stop conditions

- A second failed approach on the same architecture.
- A required external provider, credential, spend, or production mutation.
- A new blocking defect after the focused final re-review.
- Scope expands beyond manual link creation, public per-job approve/decline, truthful shop projection, and safe correction/recovery.
