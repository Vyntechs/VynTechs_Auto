# Shop OS Attention Clock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a truthful, automatically aging `Quiet <age>` signal on every active Today job and every vehicle on the Floor.

**Architecture:** Project the existing `ticket_jobs.updated_at` through the bounded Today feed, derive a vehicle-level newest timestamp in the Floor projection, and format the age with one pure shared helper. Client boards own one hydration-safe minute tick; no schema, route, permission, or workflow changes are required.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM, Zod 4, Vitest, Testing Library, Playwright.

## Global constraints

- Copy is exactly `Quiet now`, `Quiet <minutes>m`, `Quiet <hours>h`, or `Quiet <days>d`.
- Elapsed units floor and future clock skew clamps to `Quiet now`.
- Only 24 hours or more receives the stale visual tier.
- Use existing `ticket_jobs.updated_at`; never label it customer contact, a promise, or a due date.
- No migration, dependency, page, permission, reminder, notification, automation, diagnostic, or media scope.
- All implementation is owned by Atlas in `codex/attention-clock-2026-08-02`.
- Allowed writes are limited to the files named below plus the active Shop OS status row.

---

### Task 1: Lock the relative-time contract

**Files:**
- Create: `lib/shop-os/attention-clock.ts`
- Create: `tests/unit/shop-os-attention-clock.test.ts`

**Interfaces:**
- Produces: `formatAttentionClock(attentionAt: string, nowMs: number): { label: string; tier: 'normal' | 'stale' } | null`

- [ ] **Step 1: Write failing tests** with literal expectations for `Quiet now`, `Quiet 42m`, `Quiet 7h`, `Quiet 3d`, future skew, invalid input, and the exact 24-hour stale boundary.
- [ ] **Step 2: Run** `corepack pnpm vitest run tests/unit/shop-os-attention-clock.test.ts` and verify the failure is the missing module/export.
- [ ] **Step 3: Implement** the smallest pure formatter using `Date.parse`, non-negative elapsed milliseconds, floored units, and the 24-hour tier.
- [ ] **Step 4: Re-run** the focused test and verify all cases pass.

### Task 2: Carry exact server truth through the bounded feed

**Files:**
- Modify: `lib/tickets.ts`
- Modify: `lib/shop-os/ready-to-collect.ts`
- Modify: `lib/shop-os/today-board.ts`
- Modify: `tests/unit/shop-os-today-jobs-query.test.ts`
- Modify: `tests/unit/shop-os-today-board.test.ts`
- Modify: ready-to-collect tests discovered beside `lib/shop-os/ready-to-collect.ts`

**Interfaces:**
- Extends `TodayTicketJob` with required ISO `attentionAt: string`.
- Extends `ReadyToCollectTicket` with required ISO `attentionAt: string` from the newest terminal job.
- The strict Today parser accepts only offset-aware ISO timestamps.

- [ ] **Step 1: Add failing query/projection tests** proving an active job returns its exact `updated_at` and a finished-open ticket returns the maximum terminal-job `updated_at`.
- [ ] **Step 2: Add failing parser tests** proving valid timestamps pass and a missing, malformed, or extra-field payload cannot replace mounted truth.
- [ ] **Step 3: Run** the affected query/parser test files and verify failures are caused by the absent `attentionAt` contract.
- [ ] **Step 4: Select and serialize** `ticketJobs.updatedAt` in `listTodayTicketJobs`; add a bounded correlated maximum for ready-to-collect tickets; add strict Zod fields.
- [ ] **Step 5: Re-run** the affected tests and verify they pass without widening role or tenant visibility.

### Task 3: Aggregate one vehicle clock on the Floor

**Files:**
- Modify: `lib/shop-os/floor-board.ts`
- Modify: `tests/unit/floor-board.test.tsx`

**Interfaces:**
- Extends `FloorRow` with `attentionAt: string`.
- For duplicate ticket rows, keeps the chronologically newest valid source timestamp.

- [ ] **Step 1: Add failing projection tests** for a single vehicle, two jobs with different timestamps, and a ready-to-collect-only vehicle.
- [ ] **Step 2: Run** `corepack pnpm vitest run tests/unit/floor-board.test.tsx` and verify the new timestamp assertions fail.
- [ ] **Step 3: Extend** the ticket aggregate and row projection, updating with `Math.max(Date.parse(...))` while preserving lane priority, order, row budget, and overflow behavior.
- [ ] **Step 4: Re-run** the Floor tests and verify they pass.

### Task 4: Render hydration-safe clocks on Today and Floor

**Files:**
- Modify: `components/screens/today-jobs-board.tsx`
- Modify: `components/screens/today-jobs-board.module.css`
- Modify: `components/screens/floor-board.tsx`
- Modify: `components/screens/floor-board.module.css`
- Modify: `tests/unit/shop-os-today-jobs-board.test.tsx`
- Modify: `tests/unit/floor-board.test.tsx`

**Interfaces:**
- Each board owns one nullable `nowMs` state and one 60-second timer initialized after mount.
- Both boards consume `formatAttentionClock`; stale labels expose `data-attention='stale'` for styling and proof.

- [ ] **Step 1: Add failing UI tests** proving recent and stale copy, stale semantics, one board-level timer, timer cleanup, and label aging.
- [ ] **Step 2: Run** both component test files and verify failures are the missing rendered behavior.
- [ ] **Step 3: Implement** the board-level clock state, Today fact label, Floor right-column label, and restrained normal/stale styles.
- [ ] **Step 4: Re-run** both component test files and verify copy, timers, refresh fail-safety, row budget, and existing actions remain green.

### Task 5: Close source truth and verify the whole slice

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify only if a reusable correction appears: `tasks/lessons.md`

**Interfaces:**
- Adds one completed status row only after all source verification passes.

- [ ] **Step 1: Run focused affected tests** for formatter, query, parser, Today UI, and Floor UI.
- [ ] **Step 2: Run the full package suite with the repository's stable policy:** `node scripts/test-shards.mjs` (eight serialized shards, at most two workers).
- [ ] **Step 3: Run TypeScript:** `corepack pnpm exec tsc --noEmit`.
- [ ] **Step 4: Run production build:** `corepack pnpm build`.
- [ ] **Step 5: Run browser proof** at 390×844 Today, 1440×900 Today, and a 1920×1080 Floor viewport; assert exact labels, automatic aging, no horizontal overflow, zero serious/critical Axe findings, and no browser faults.
- [ ] **Step 6: Review** `git diff --check`, changed paths, forbidden scope, secrets, tenant boundaries, hydration, timers, and responsive CSS.
- [ ] **Step 7: Record** the verified status row with exact commit/test/browser evidence, then re-run the documentation-sensitive diff checks.
- [ ] **Step 8: Commit** with repo-configured `Co-authored-by` and `Signed-off-by` trailers, push the branch, and open a Buzz-linked pull request with `--channel 3c51444f-299a-4be9-9ad5-560046dc0501`.
- [ ] **Step 9: Stop at the merge gate.** Do not merge or deploy without a new explicit production approval.

**Verified by:** Focused tests; full `node scripts/test-shards.mjs`; `corepack pnpm exec tsc --noEmit`; `corepack pnpm build`; phone/desktop/wall browser + accessibility proof; diff/security review; hosted PR checks.
