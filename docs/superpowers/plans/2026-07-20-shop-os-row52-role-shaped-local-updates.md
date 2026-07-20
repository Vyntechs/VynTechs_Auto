# ShopOS Row 52 — Role-Shaped Local Updates

**Goal:** Make the existing Today surface show the right active queue for each role and reconcile claims in place without broad page refreshes or lost creator recovery.

**Signature:** The ledger quietly re-sorts itself around the repair order. Nothing flashes, reloads, or asks the user to find the work again.

**Architecture:** Extend the bounded Today projection with actor-relative assignment facts and a dispatch-only team lane. Replace the assignment route's full-ticket success payload with a narrow actor-relative envelope. The client keeps one normalized job map plus durable mutation overrides and derives every visible lane from one pure placement rule.

**Scope boundary:** No schema, migration, new page, diagnostics/media behavior, general add-job route, realtime subscription, external provider, or production-data mutation.

## Pre-code decisions

- `teamJobs` is visible only when `canAssignWork(role)` is true.
- The assignee join binds both profile ID and shop ID and projects only the display name.
- Today receives `createdByMe`, never raw creator identity.
- Assignment responses project only target IDs, active work status, actor-relative assignment state, and optional assignee display name.
- The client never spreads or stores `TicketDetail`.
- `team` and `created` rows are view-only.
- The 200-row bound remains. Ordering priority is mine → creator recovery → assigned team → unassigned; `hasMore` stays explicit.
- Local overrides survive stale incoming props; no naïve prop-sync effect may erase a completed mutation.

---

### Task 1 — Add the dispatch team projection

**Files:**
- Modify `lib/tickets.ts`
- Modify `tests/unit/shop-os-today-jobs-query.test.ts`

- [x] Write RED tests proving advisor/owner receive all same-shop active jobs assigned to teammates in `teamJobs`, while tech/parts do not.
- [x] Prove own work, unassigned work, creator recovery, and team work are mutually exclusive.
- [x] Prove terminal jobs, closed tickets, cross-shop jobs, foreign assignee names, and teammate session navigation remain absent.
- [x] Prove the bounded priority keeps mine and creator recovery ahead of team/unassigned work and reports `hasMore`.
- [x] Add `teamJobs`, `assignmentState`, `assignedTechName`, and `createdByMe` to the safe read model.
- [x] Add a same-shop assignee join and the dispatch-only active-team query branch.
- [x] Run the focused query suite and commit.

### Task 2 — Narrow the assignment response boundary

**Files:**
- Modify `app/api/tickets/[id]/jobs/[jobId]/assignment/route.ts`
- Modify `tests/unit/shop-os-job-assignment-route.test.ts`

- [x] Write RED route tests that reject full ticket/customer/job projection in success and conflict responses.
- [x] Return only:

```ts
{
  assignment: {
    ticketId: string
    jobId: string
    workStatus: 'open' | 'in_progress' | 'blocked'
    state: 'mine' | 'team' | 'unassigned'
    assignedTechName: string | null
  }
}
```

- [x] On conflict, preserve the exact error and project only `currentAssignee.fullName`.
- [x] Validate the target job exists in the domain result; fail closed if the supposedly successful result cannot be projected.
- [x] Preserve authentication → paywall → parse → domain ordering and all status codes.
- [x] Run assignment domain/route tests and commit.

### Task 3 — Derive role-shaped lanes from one normalized board

**Files:**
- Create `lib/shop-os/today-board.ts`
- Create `tests/unit/shop-os-today-board.test.ts`
- Modify `components/screens/today-jobs-board.tsx`
- Modify `tests/unit/shop-os-today-jobs-board.test.tsx`

- [x] Write RED reducer tests for mine, available, team, creator-recovery, and hidden placement.
- [x] Add one pure placement function and one normalized keyed job model; lane arrays are derived, never independently mutated.
- [x] Keep server props as the base and mutation overrides as a separate keyed map so stale props cannot overwrite a completed claim.
- [x] Strictly parse assignment envelopes: exact target ticket/job, active status, allowed state, and bounded assignee display name. Never merge unknown response fields.
- [x] Successful claim follows returned truth: mine → `My work`; team → dispatch `With the team`, creator recovery, or hidden according to capability and immutable creator fact.
- [x] Conflict applies the same placement rule. Missing safe winner never invents identity.
- [x] Malformed/mismatched success leaves persisted board truth intact, removes no work, announces a reconciliation error, and prevents automatic retry.
- [x] Replace claim success/conflict `router.refresh()` calls; preserve refreshes only in the dormant diagnostic lifecycle.
- [x] Preserve pending serialization, accessible announcements, and focus: moved rows focus their mounted row/control; removed rows focus the board.
- [x] Team and creator rows expose only `View ticket`.
- [x] Run reducer and board tests and commit.

### Task 4 — Shape the existing surface by role

**Files:**
- Modify `app/(app)/today/page.tsx`
- Modify `components/screens/today-home.tsx`
- Modify `tests/unit/shop-os-today-page.test.tsx`
- Modify `tests/unit/today-home.test.tsx`
- Modify `components/screens/today-jobs-board.module.css` only if the existing responsive rules need a narrow assignee wrap correction.

- [x] Pass `canDispatchWork={canAssignWork(role)}` from the server boundary.
- [x] Dispatch view: header `Shop floor`; lane labels `My work`, `Needs assignment`, `With the team`, and `Created by me` when present.
- [x] Non-dispatch view: preserve personal header; labels `My work`, `Available`, and `Created by me`; never render a team heading.
- [x] Include `teamJobs` in empty-state truth.
- [x] Prove counts change in place, 44px controls remain, long assignee names wrap, and 375px stays one column.
- [x] Run Today page/home/board accessibility-focused tests and commit.

### Task 5 — Converge, publish, and continue

- [x] Run the affected suite with at most two workers.
- [x] Run `pnpm exec tsc --noEmit` and `pnpm build`.
- [x] Review the full diff for tenant/capability expansion, response leakage, duplicate lanes, stale overrides, pagination starvation, diagnostics/media drift, and extra pages.
- [x] Run independent static, security, and runtime reviews in parallel; consolidate once, repair once, focused re-review once.
- [x] Update Row 52 and `SHOP_OS_DRIVER_STATE.md` with exact proof.
- [ ] Publish and merge only after green GitHub/Vercel gates, then verify production health.

**Stop if:** tenant-safe assignee projection needs schema; literal unbounded/exhaustive team pagination becomes required; local reconciliation would expose full ticket/contact/VIN/session data; diagnostics behavior changes; or a new blocking architecture defect appears after focused re-review.

**Done when:** Advisor/owner can see personal, unassigned, and team work on the same Today surface; tech/parts see no unrelated team work; claim success/conflict re-sorts only the affected job with no broad refresh; creator recovery and focus survive every race; and phone/desktop proof remains green.
