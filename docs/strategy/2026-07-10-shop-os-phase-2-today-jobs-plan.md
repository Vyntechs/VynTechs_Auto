# Shop OS Phase-2 Today Jobs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox syntax for durable tracking.

**Goal:** Compose tenant-safe ticket-backed My Jobs and Open Jobs into Today without removing current diagnoses, follow-ups, closed-today history, or creation controls, while keeping simple work disabled until immutable quote approval exists.

**Architecture:** Add one read-only ticket-job query that returns a narrow Today projection plus linked session IDs for de-duplication. The protected Today page composes that data with existing legacy session/follow-up data. A focused client board owns claim interaction through row 13's route; every job still links to the canonical ticket, and only an already-linked diagnostic session exposes the existing diagnosis route.

**Tech Stack:** Next.js App Router, React/TypeScript, Drizzle/PostgreSQL, Vitest/Testing Library, existing Vyntechs visual tokens and Shop OS capability helpers.

## Global Constraints

- Preserve current Today creation controls, follow-ups, open legacy diagnoses, closed-today history, curator access, and empty guidance.
- Never show cross-shop jobs or profiles. Null-tier/inactive actors receive no claimable Open Jobs.
- My Jobs includes the actor's nonterminal assigned ticket jobs; Open Jobs includes only unassigned open jobs the current tier can claim.
- Ticket-backed sessions render once through their ticket job; ticketless legacy sessions remain unchanged.
- Diagnostic jobs link to the existing session only when `sessionId` is persisted. Unlinked diagnostic start belongs to row 15.
- Repair/maintenance start stays disabled with exact copy `Quote and approval required` regardless of role; row 14 adds no work mutation.
- Claim uses row 13's `/assignment` route, handles a losing racer by naming only the safe current assignee, and refreshes from server truth.
- No schema, production, quote/approval, work-status, diagnostic-bootstrap, provider, or engine changes.

## Task 1: Claim and publish row 14

- [x] Record PR #124 merge/tree equality and close row 13's final shipping checkbox.
- [x] Audit Today page/screen/tests, ticket projections, row-13 route, legacy sessions, follow-ups, and Rev-4 composition rules against `main`.
- [x] Choose one read model and one focused board component; preserve current Today content rather than replacing it.
- [x] Commit/push this packet and open draft PR #125 before implementation.

## Task 2: Build the tenant-safe Today job read model

**Files:**

- Modify: `lib/tickets.ts`
- Create: `tests/unit/shop-os-today-jobs-query.test.ts`

**Produces:** `listTodayTicketJobs(db, { actor })` returning `{ myJobs, openJobs, linkedSessionIds }` with ticket/job/customer/vehicle labels only from persisted safe fields.

- [x] Write failing tests for assigned diagnostic/repair/maintenance jobs, eligible open jobs, persisted ordering, and linked-session IDs.
- [x] Prove tenant isolation, active Shop-role actor gating, sufficient-tier Open Jobs filtering, null-tier behavior, terminal ticket/job exclusion, and no profile user/shop leakage.
- [x] Include blocked/in-progress assigned jobs in My Jobs but only open/unassigned/sufficient-tier jobs in Open Jobs.
- [x] Independently review the query task and receive spec/code-quality approval with zero findings.

## Task 3: Compose the Today board and claim interaction

**Files:**

- Modify: `app/(app)/today/page.tsx`
- Modify: `components/screens/today-home.tsx`
- Create: `components/screens/today-jobs-board.tsx`
- Create: `components/screens/today-jobs-board.module.css`
- Modify: `tests/unit/today-home.test.tsx`
- Create: `tests/unit/shop-os-today-page.test.tsx`
- Create: `tests/unit/shop-os-today-jobs-board.test.tsx`

**Consumes:** `listTodayTicketJobs` and row 13's assignment route.

- [ ] Write failing DOM/page tests proving existing Today sections remain, ticket-backed sessions de-duplicate, and My/Open sections render persisted facts.
- [ ] Render quiet repair-order cards with ticket number, persisted customer/vehicle fallback, job title/kind/tier/status, and canonical ticket link.
- [ ] Show `Open diagnosis` only for persisted linked diagnostic sessions; show `Quote and approval required` as a disabled 44px control for repair/maintenance; do not invent an unlinked diagnostic start.
- [ ] Claim in one explicit control, announce pending/success/race/error state, display only the safe race winner, and refresh from server truth.
- [ ] Preserve keyboard focus, 44px controls, reduced motion, all-width layout, and 375px single-column composition.
- [ ] Independently review the UI/page task and resolve every finding.

## Task 4: Verify, review, reconcile, and ship row 14

- [ ] Run focused tests, full suite, TypeScript, production build, and diff check; record exact counts.
- [ ] Attempt signed-in Chrome only with launch authority; otherwise record the gate and protect the layout/interactions through DOM/static proof.
- [ ] Inspect the complete diff for removed Today content, duplicate sessions, tenant/tier leaks, fabricated facts, work-start drift, and unrelated changes.
- [ ] Obtain task reviews and one whole-branch review; resolve every finding and re-review.
- [ ] Add the Phase-2 Today implementation correction, mark row 14 complete, preserve owner gates, and identify row 15 as next.
- [ ] Push final head, pass GitHub checks, mark ready, squash-merge, verify tree equality, and immediately continue row 15.

## Verification

```bash
pnpm test tests/unit/shop-os-today-jobs-query.test.ts tests/unit/shop-os-today-page.test.tsx tests/unit/shop-os-today-jobs-board.test.tsx tests/unit/today-home.test.tsx tests/unit/shop-os-job-assignment-route.test.ts
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check origin/main...HEAD
```

## Stop conditions

- Stop before production data/schema writes, external credentials/accounts, spend, feature enablement, or irreversible action.
- Stop if row 14 would require quote approval, work-status mutation, or diagnostic bootstrap; those belong to rows 19 and 15.
- Stop if preserving existing Today content and de-duplicating ticket-backed sessions cannot both be proved from persisted IDs.
