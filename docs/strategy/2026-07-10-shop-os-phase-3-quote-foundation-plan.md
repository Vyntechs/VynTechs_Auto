# Shop OS Phase-3 Quote Foundation Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` task-by-task, `superpowers:test-driven-development` for every schema behavior, and `superpowers:verification-before-completion` before shipping.

**Goal:** Add the source-controlled, tenant-safe quote/story persistence foundation required by Phase 3 while leaving production application, handlers, UI, external sends, vendors, and diagnostic semantics unchanged.

**Architecture:** Extend shops and ticket jobs additively, then add five composite-FK tenant tables in one hand-written migration matching Drizzle declarations. Database checks own stable money/precision/ownership rules; row 17 owns quote math and validated snapshot construction. RLS and grants keep every new table server-only.

**Tech Stack:** Drizzle/PostgreSQL, hand-written SQL migration + journal entry, PGlite/Vitest, TypeScript.

## Global constraints

- Source migration and local proof only. Never apply DDL or inspect/change production in this row.
- Integer cents and basis points only; numeric quantity/hours only at approved precision.
- Shop labor/tax fields remain nullable/no-default until deliberately configured. Every bigint mapped to JavaScript number is checked within `0..9_007_199_254_740_991`.
- Every new tenant table has direct `shopId` plus composite same-shop parents. Quote job references also bind the same ticket.
- Quote events are append-only. Quote-version snapshots are immutable; only a one-time supersession timestamp may change.
- New tables are server-only: RLS enabled, direct anon/authenticated DML revoked, deny-all direct policies, service-role DML granted.
- JSON container shape is enforced in PostgreSQL: story/meta/snapshots are objects and canned default lines is an array.
- No send/token, vendor-account FK, transport, handler, UI, quote math, story AI, upload, repair mutation, or engine work.
- Preserve all existing migration entry states and data. Defaults must be safe for current shops/jobs.
- Immutable lineage uses `RESTRICT`. Approval/decline requires a job; approval channel rules and phone/in-person actor presence are database-checked.

## Task 1: Claim and publish row 16

- [x] Record PR #126 merge/tree equality and close row 15's final shipping checkbox.
- [x] Audit the approved row, master schema contract, current Drizzle declarations, official migration chain, RLS pattern, and known snapshot-generation constraint.
- [x] Choose one additive quote-foundation migration with five server-only tables and narrow existing-table columns.
- [ ] Commit/push this packet, mark row 16 `in progress`, and open draft PR #127 before implementation.

## Task 2: Declare the quote foundation in Drizzle

**Files:**

- Modify: `lib/db/schema.ts`
- Create: `tests/unit/shop-os-quote-foundation-schema.test.ts`

- [x] Write failing source-schema tests for shop rate/tax, job story/approved-version fields, and all five tables.
- [x] Add exported story/default-line types without defining row-17 snapshot math.
- [x] Add money/safe-integer, precision, JSON-container, event, enum, range, composite uniqueness, same-shop, same-ticket, and exact-version declarations plus required access/FK indexes.
- [x] Prove forward references/circular job-version FKs load through the real schema module.
- [x] Independently review the declaration task and resolve all findings.

## Task 3: Add and prove migration `0028`

> **Task 3 implementation correction (2026-07-10):** The required pinned generator attempt ran before any `0028` SQL was written: `pnpm drizzle-kit generate` exited with `drizzle/migrations/meta/0011b_snapshot.json data is malformed`. Per the approved boundary, row 16 leaves that unrelated historical snapshot untouched and follows the established hand-written migration plus journal-entry pattern.

> **Security review correction (2026-07-10):** A four-file diff scan completed with zero reportable row-16 findings. PGlite proved the deliberately writable job approval projection can diverge from its event without a handler; row 16 has no writer, consumer, public path, or production apply. Row 17 must therefore derive the exact version server-side, append the approval event and update the job projection atomically and idempotently, and reject unauthorized same-ticket repoint/clear transitions.

**Files:**

- Create: `drizzle/migrations/0028_shop_os_quote_foundation.sql`
- Modify: `drizzle/migrations/meta/_journal.json`
- Expand: `tests/unit/shop-os-quote-foundation-schema.test.ts`

- [x] Write failing PGlite tests for safe existing-row defaults and successful empty-table creation through the complete source chain.
- [x] Prove composite cross-shop/cross-ticket violations, money/precision/range violations, and exact approved-version ownership fail.
- [x] Prove RLS, deny policies, revoked direct DML, service grants, event append-only triggers, and version snapshot immutability.
- [x] Run `pnpm drizzle-kit generate`. If the known historical snapshot blocks it, capture the exact failure and record the explicit implementation correction before adding the hand-written migration/journal entry; do not repair unrelated historical snapshots in this row.
- [x] Independently review the migration/security task and resolve all findings.

## Task 4: Verify, reconcile, and ship row 16

- [ ] Run focused tests, full suite, TypeScript, production build, and diff checks.
- [ ] Inspect the full diff for tenant/ticket leaks, mutable quote history, money precision drift, destructive DDL, future-row scope, and unrelated changes.
- [ ] Obtain task reviews and one whole-branch review; correct every validated finding through tests.
- [ ] Add the Phase-3 schema implementation correction, mark row 16 complete, preserve production/external gates, and identify row 17 as next.
- [ ] Push final head, pass GitHub checks, mark ready, squash-merge, verify tree equality, and immediately continue row 17.

## Verification

```bash
pnpm test tests/unit/shop-os-quote-foundation-schema.test.ts tests/unit/shop-os-ticket-spine-schema.test.ts tests/unit/shop-os-reconciliation-draft.test.ts
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check origin/main...HEAD
```

## Stop conditions

- Stop before any production migration/apply, live Supabase mutation, advisor-clean claim, destructive reconciliation, external account/credential, spend, deployment enablement, or irreversible action.
- Stop if an approved-version reference cannot be constrained to the same shop and ticket without changing the canonical ticket spine.
- Stop if the row requires quote math, sends, vendors, handlers, UI, story generation, or diagnostic-engine changes; those belong to later rows.
- Stop before any live rollback. Before live apply this additive source migration is reversible by branch revert; after durable quote history, removal/rewrite is a destructive owner/data gate.
