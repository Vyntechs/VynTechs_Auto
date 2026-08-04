# Shop OS Technician Claim and Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a technician claim one eligible job, review its exact approved scope in place, and deliberately clock on while Today keeps ownership, approval, skill-fit, and running-clock truth honest.

**Architecture:** Keep assignment and timekeeping as the two existing server mutations. Strengthen the claim with an approval-state compare-and-swap, widen only the bounded Today and assignment envelopes, centralize technician readiness wording in a pure projector, then let the mounted Today board reconcile claim → approved-scope focus → Clock on without a page transition.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Drizzle/PostgreSQL, PGlite, Zod 4, CSS Modules, Vitest 4, Testing Library, Playwright 1.59.

**Approved design:** `docs/superpowers/specs/2026-08-04-shop-os-technician-claim-start-design.md`

**Written approval:** Buzz event `9ccca41a90e34201ded53a2b67259f9c984df3b40c2c626191dbc5fde91032a4`

## Global Constraints

- Claim changes assignment only. Clock on remains a separate, deliberate action after the exact approved scope is visible.
- Add no page, endpoint, table, schema, migration, dependency, provider, permission, diagnostic activation, production-data mutation, payroll meaning, or single-job clock rule.
- New self-claims accept only `pending_quote`, `quote_ready`, `sent`, or `approved`; `deferred` and `declined` never become valid claim intents.
- The assignment mutation remains authoritative and atomically rechecks tenant, open ticket/job, null assignment, active persisted actor, role, tier, and exact expected approval state.
- The claim receipt binds the expected approval state. Reusing one request key with a different state fails closed.
- The assignment success envelope adds only the allowlisted current approval state; it adds no quote totals, quote lines, links, actor IDs, timestamps, or private ticket data.
- Every changed assignment-route response is `Cache-Control: no-store`, including validation failures and conflicts.
- Today adds only `clockedOnSince: string | null`; it adds no active seconds, money, payroll copy, technician attribution, or forecast.
- Technicians may see above-tier unassigned work as read-only truth, but `canClaim` remains false. Claimable rows sort before read-only rows under the existing 200-row bound.
- Technician next-move surfaces never make Build quote, Prepare, totals, or customer price the primary action for assigned work. Existing deliberate quote authorization elsewhere remains unchanged.
- Approved sessionless manual work opens beneath the Today card. Session-linked diagnostics keep their existing separate entrance.
- Exact approved scope precedes Clock on. Focus lands on `Exactly what is approved`; it never jumps past scope to the clock control.
- Stale embedded work removes all mutation controls and offers only truthful refresh/repair-order recovery.
- Keep the current mounted repair order and Today surfaces, one-active-tool arbitration, read-only work GET, and transaction lock order.
- The handoff detent is a 2px signal rail plus a 200ms settle; reduced motion removes the transition while keeping equivalent placement, wording, focus, and announcement.
- Claim, Review & clock on, Clock on, Retry work, and fallback controls remain at least 44×44px at 390×844 and 1440×900.
- Migration `0050`/`0051`, dormant-feature activation, production secrets, production data, merge, and deployment remain outside this source plan.
- Before every commit, `git config user.name` and `git config user.email` must resolve to `Vyntechs` and `brandon@vyntechs.com`. Use `Co-authored-by` before `Signed-off-by` with those exact values.
- Database-heavy Vitest uses at most two workers. The complete suite runs only with `node scripts/test-shards.mjs`. Stop after the same technical approach fails twice.

---

### Task 1: Approval-bound claim and bounded Today truth

**Owner:** Inline implementation lane

**Files:**
- Modify: `lib/tickets.ts`
- Modify: `app/api/tickets/[id]/jobs/[jobId]/assignment/route.ts`
- Modify: `lib/shop-os/today-board.ts`
- Modify: `tests/unit/shop-os-job-assignment.test.ts`
- Modify: `tests/unit/shop-os-job-assignment-route.test.ts`
- Modify: `tests/unit/shop-os-today-jobs-query.test.ts`
- Modify: `tests/unit/shop-os-today-board.test.ts`
- Modify mechanically for required Today fixtures only: `tests/unit/shop-os-today-page.test.tsx`
- Modify mechanically for required Today fixtures only: `tests/unit/today-home.test.tsx`
- Modify mechanically for required Today fixtures only: `tests/unit/floor-board.test.tsx`

**Interfaces:**
- Extend the claim variant only:

```ts
type ClaimApprovalState = 'pending_quote' | 'quote_ready' | 'sent' | 'approved'

type ClaimAssignmentBody = {
  action: 'claim'
  requestKey: string
  expectedApprovalState: ClaimApprovalState
}
```

- Preserve unclaim and reassign request shapes unchanged.
- Add `approvalState` and `clockedOnSince` to `AssignmentContext` so claim compare-and-swap and safe conflict diagnosis use current persisted truth.
- Add `approvalState: TodayTicketJob['approvalState']` to the assignment success envelope.
- Add `clockedOnSince: string | null` to `TodayTicketJob`, the bounded Today schema, equality/override projection, and all required fixtures.
- `createTodayJobOverride(before, after)` must carry both `approvalState` and `clockedOnSince` when changed.

- [ ] **Step 1: Write RED claim-domain tests**

Add literal tests that prove an exact expected approval state claims once; a state change between render and update produces `assignment_conflict` with zero assignment/receipt mutation; `deferred` and `declined` are rejected by the strict body before database work; one request key cannot replay against a different expected state; exact replay returns unchanged current truth; a simultaneous winning claim still returns only the safe assignee name.

The intended write predicate includes the approval comparison in the same update:

```ts
and(
  eq(ticketJobs.shopId, shopId),
  eq(ticketJobs.ticketId, ticketId),
  eq(ticketJobs.id, jobId),
  eq(ticketJobs.workStatus, 'open'),
  eq(ticketJobs.approvalState, expectedApprovalState),
  isNull(ticketJobs.assignedTechId),
  /* existing open-ticket and persisted-actor predicates */
)
```

- [ ] **Step 2: Write RED route-envelope tests**

Prove the route passes the strict claim body unchanged, includes only `ticketId`, `jobId`, active `workStatus`, actor-relative `state`, safe `assignedTechName`, and current `approvalState`, fails closed when the returned job is missing/terminal/malformed, and never exposes the assignee ID or quote data.

Expected success shape:

```ts
{
  assignment: {
    ticketId,
    jobId,
    workStatus: 'open',
    state: 'mine',
    assignedTechName: 'Casey Tech',
    approvalState: 'approved',
  },
}
```

- [ ] **Step 3: Write RED Today-query and parser tests**

Prove a technician receives both claimable and above-tier unassigned open work, customer outcome suppresses self-claim for `deferred`/`declined`, waiting/approved work within tier remains claimable, claimable rows precede below-tier rows, `clockedOnSince` is ISO-or-null, the strict client parser rejects missing/extra/malformed clock truth, and the 200-row response bound remains intact.

Add the clock projection directly from the existing column:

```ts
clockedOnSince: row.clockedOnSince ? row.clockedOnSince.toISOString() : null
```

- [ ] **Step 4: Prove RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-job-assignment.test.ts tests/unit/shop-os-job-assignment-route.test.ts tests/unit/shop-os-today-jobs-query.test.ts tests/unit/shop-os-today-board.test.ts --maxWorkers=1
```

Expected: new claim-body, state comparison, below-tier visibility, and clock-envelope assertions fail against the production baseline.

- [ ] **Step 5: Implement strict state-bound claims**

Use a shared Zod enum for the four claimable approval states. Include `expectedApprovalState` in `AssignmentReceiptIntent`, comparison, and activity payload. Pass it to `claimTicketJob` and include the persisted approval comparison in the conditional update. If the update loses because current approval differs and assignment is still null, return a no-store conflict without inventing an assignee; Today will refresh current truth.

Representative receipt shape:

```ts
type AssignmentReceiptIntent = {
  action: AssignmentBody['action']
  requestedAssignedTechId: string | null
  confirmBelowTier: boolean
  expectedApprovalState: ClaimApprovalState | null
}
```

- [ ] **Step 6: Widen only bounded read projections**

Select `ticketJobs.clockedOnSince`, expose above-tier open rows to active technicians without changing `canClaim`, derive `canClaim` only for the four claimable approval states within tier, sort claimable rows before read-only rows, and add the two strict fields to assignment/Today parsers and local overrides.

- [ ] **Step 7: Prove GREEN and commit**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-job-assignment.test.ts tests/unit/shop-os-job-assignment-route.test.ts tests/unit/shop-os-today-jobs-query.test.ts tests/unit/shop-os-today-board.test.ts tests/unit/shop-os-today-page.test.tsx tests/unit/today-home.test.tsx tests/unit/floor-board.test.tsx --maxWorkers=2
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
git config user.name
git config user.email
git add lib/tickets.ts app/api/tickets/'[id]'/jobs/'[jobId]'/assignment/route.ts lib/shop-os/today-board.ts tests/unit/shop-os-job-assignment.test.ts tests/unit/shop-os-job-assignment-route.test.ts tests/unit/shop-os-today-jobs-query.test.ts tests/unit/shop-os-today-board.test.ts tests/unit/shop-os-today-page.test.tsx tests/unit/today-home.test.tsx tests/unit/floor-board.test.tsx
git commit -m "fix: bind technician claims to current truth" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

Expected: focused domain/route/projection/parser tests, TypeScript, and diff integrity pass.

---

### Task 2: One shared technician readiness and command policy

**Owner:** Inline implementation lane

**Files:**
- Modify: `lib/shop-os/living-ticket.ts`
- Modify: `components/screens/ticket-detail.tsx`
- Modify: `components/screens/today-jobs-board.tsx`
- Modify: `tests/unit/shop-os-living-ticket.test.ts`
- Modify: `tests/unit/shop-os-ticket-detail.test.tsx`
- Modify: `tests/unit/shop-os-today-jobs-board.test.tsx`

**Interfaces:**
- Export one pure technician readiness projector from `lib/shop-os/living-ticket.ts`:

```ts
export type TechnicianJobReadiness =
  | { state: 'claimable'; label: 'Claim work' }
  | { state: 'below_tier'; label: `Requires ${string}` }
  | { state: 'waiting_quote'; label: 'Waiting for quote' }
  | { state: 'waiting_advisor'; label: 'Waiting for advisor' }
  | { state: 'waiting_customer'; label: 'Waiting for customer' }
  | { state: 'declined'; label: 'Customer declined' }
  | { state: 'review'; label: 'Review & clock on' }
  | { state: 'running'; label: 'Clock running since'; clockedOnSince: string }
  | { state: 'paused'; label: 'Clock paused' }
  | { state: 'continue'; label: 'Continue work' }
  | { state: 'unavailable'; label: 'Review repair order' }

export function projectTechnicianJobReadiness(input: {
  assignmentState: 'mine' | 'team' | 'unassigned'
  approvalState: TodayTicketJob['approvalState']
  workStatus: TodayTicketJob['workStatus']
  canClaim: boolean
  requiredSkillTier: number
  clockedOnSince: string | null
}): TechnicianJobReadiness
```

- Use the same projector from Today and repair-order job rows. Keep role capability checks outside this pure display function.
- `projectLivingTicketCommands` may still offer deliberate quote work to authorized non-technician flows, but assigned technician work must resolve its work/waiting command before quote commands.

- [ ] **Step 1: Write RED pure-policy matrix tests**

Pin every state in the approved specification: four unassigned claimable states, below-tier explanation, deferred/declined customer precedence, approved mine → Review & clock on, three waiting labels, running versus paused, blocked recovery, and no invented command for terminal/unsupported truth.

Representative assertions:

```ts
expect(projectTechnicianJobReadiness({
  assignmentState: 'mine', approvalState: 'approved', workStatus: 'open',
  canClaim: false, requiredSkillTier: 2, clockedOnSince: null,
})).toEqual({ state: 'review', label: 'Review & clock on' })

expect(projectTechnicianJobReadiness({
  assignmentState: 'mine', approvalState: 'pending_quote', workStatus: 'open',
  canClaim: false, requiredSkillTier: 2, clockedOnSince: null,
})).toEqual({ state: 'waiting_quote', label: 'Waiting for quote' })
```

- [ ] **Step 2: Write RED cross-surface command tests**

Prove Today and ticket detail use the same Claim work, Review & clock on, waiting, running, and paused wording; an assigned technician never receives Build quote as the primary command; advisor/owner quote behavior remains unchanged; session-backed diagnosis and diagnostics-off manual work keep their existing gates.

- [ ] **Step 3: Prove RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-living-ticket.test.ts tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-today-jobs-board.test.tsx --maxWorkers=1
```

Expected: shared projector imports and the new command precedence fail because Today and ticket detail currently derive labels independently and an assigned technician can be routed to Build quote.

- [ ] **Step 4: Implement the pure projector and consume it twice**

Keep state precedence explicit and exhaustive. Customer outcome precedes tier, assignment precedes claim, and a persisted running clock precedes generic in-progress wording:

```ts
if (input.approvalState === 'declined') return { state: 'declined', label: 'Customer declined' }
if (input.approvalState === 'deferred') return { state: 'waiting_customer', label: 'Waiting for customer' }
if (input.assignmentState === 'unassigned') {
  return input.canClaim
    ? { state: 'claimable', label: 'Claim work' }
    : { state: 'below_tier', label: `Requires ${tierLabel(input.requiredSkillTier)}` }
}
if (input.assignmentState === 'mine' && input.approvalState === 'approved') {
  if (input.workStatus === 'open') return { state: 'review', label: 'Review & clock on' }
  if (input.clockedOnSince) {
    return { state: 'running', label: 'Clock running since', clockedOnSince: input.clockedOnSince }
  }
  return { state: 'paused', label: 'Clock paused' }
}
```

Format persisted timestamps at the component boundary with the existing localized time component; do not turn the pure projector into a clock.

- [ ] **Step 5: Prove GREEN and commit**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-living-ticket.test.ts tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-today-jobs-board.test.tsx --maxWorkers=2
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
git add lib/shop-os/living-ticket.ts components/screens/ticket-detail.tsx components/screens/today-jobs-board.tsx tests/unit/shop-os-living-ticket.test.ts tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-today-jobs-board.test.tsx
git commit -m "feat: unify technician handoff truth" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

Expected: the pure matrix, Today, ticket-detail, TypeScript, and diff checks pass with no quote-capability change.

---

### Task 3: Mounted claim-to-clock handoff and truthful recovery

**Owner:** Inline implementation lane

**Files:**
- Modify: `components/screens/today-jobs-board.tsx`
- Modify: `components/screens/today-jobs-board.module.css`
- Modify: `components/screens/inline-work-workspace.tsx`
- Modify: `components/screens/simple-work-workspace.tsx`
- Modify: `components/screens/simple-work-workspace.module.css`
- Modify: `tests/unit/shop-os-today-jobs-board.test.tsx`
- Modify: `tests/unit/shop-os-inline-work-workspace.test.tsx`
- Modify: `tests/unit/shop-os-simple-work-workspace.test.tsx`

**Interfaces:**
- Claim POST body becomes `{ action: 'claim', requestKey, expectedApprovalState: job.approvalState }`.
- Keep a retained attempt per job containing both values so network retry replays identical intent:

```ts
type ClaimAttempt = {
  requestKey: string
  expectedApprovalState: 'pending_quote' | 'quote_ready' | 'sent' | 'approved'
}
```

- Add a focus token for approved scope, separate from board/row/claim focus.
- `SimpleWorkWorkspace` receives an optional approved-scope focus ref or deterministic `tabIndex={-1}` heading target; it does not auto-start work.
- After `onProjection`, parent Today updates both `workStatus` and `clockedOnSince` before any collapse.
- `SimpleWorkWorkspace` stores an embedded stale state that replaces action modules with a recovery panel after work GET/POST returns 404.

- [ ] **Step 1: Write RED approved-claim journey tests**

Prove the exact POST body includes approval state; Claiming… disables every claim button; successful approved claim moves Available → My work; the existing `InlineWorkWorkspace` mounts automatically beneath the moved row; focus lands on `Exactly what is approved`; Clock on is still untouched until a second explicit tap; its strict server success projects running truth into the parent card.

Expected fetch sequence:

```ts
expect(fetch).toHaveBeenNthCalledWith(1, assignmentUrl, expect.objectContaining({
  method: 'POST',
  body: JSON.stringify({
    action: 'claim',
    requestKey: expect.any(String),
    expectedApprovalState: 'approved',
  }),
}))
expect(fetch).toHaveBeenNthCalledWith(2, workUrl, { method: 'GET', cache: 'no-store' })
```

- [ ] **Step 2: Write RED waiting, retry, race, and malformed-response tests**

Prove waiting-state claim settles into My work without opening work; a failed request retains the same key and expected state for explicit retry; an assignment conflict without a safe winner refreshes bounded Today truth instead of inventing a lane or retrying stale intent; a safe losing winner is announced and stale action removed; malformed success preserves the row, removes stale claim authority, and exposes repair-order fallback; a work-load failure leaves durable ownership visible with Retry work, full work page, and Close.

- [ ] **Step 3: Write RED stale-work and focus tests**

Prove a 404 after embedded work is mounted removes Clock on, note, completion, hold, parts, and found-work mutation controls; shows a non-actionable recovery panel; refreshes parent truth; and offers only repair-order fallback/close. Prove long approved scope appears before Clock on, heading focus is real, controls are 44px, phone layout has no horizontal overflow, and reduced motion removes transform/transition without removing the signal rail.

- [ ] **Step 4: Prove RED**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-today-jobs-board.test.tsx tests/unit/shop-os-inline-work-workspace.test.tsx tests/unit/shop-os-simple-work-workspace.test.tsx --maxWorkers=1
```

Expected: automatic open, exact focus, retained state-bound attempt, parent clock projection, stale-control removal, and detent assertions fail on the production baseline.

- [ ] **Step 5: Implement the retained claim attempt and automatic open**

Replace `Map<string, string>` with `Map<string, ClaimAttempt>`. Delete an attempt only after a valid successful envelope. On approved mine success, reconcile the job, set it as the one active work tool, and request approved-scope focus. On waiting success, reconcile without opening work. On a conflict with no safe winner, refresh bounded Today truth and clear the stale attempt so the next explicit tap uses the newly rendered state; the refreshed server projection distinguishes an approval change from a nameless claim race.

- [ ] **Step 6: Implement parent clock projection and stale recovery**

Extend `applyWorkProjection`:

```ts
function applyWorkProjection(job: TodayTicketJob, work: SimpleWorkProjectionView) {
  applyJobTruth(job, {
    ...job,
    workStatus: work.status === 'done' ? job.workStatus : work.status,
    clockedOnSince: work.clockedOnSince,
    canClaim: false,
  })
}
```

Preserve the existing completion/hold parent behavior rather than forcing `done` into an active Today type. In embedded stale state, render no mutation child components. Call the existing parent refresh callback before offering fallback.

- [ ] **Step 7: Implement scope focus and restrained detent**

Give the approved-scope heading `tabIndex={-1}` and an explicit focus target. Move focus after the existing work GET produces a validated workspace. Add the 2px signal rail and 200ms settle to the claimed row/work pair; under `prefers-reduced-motion: reduce`, set `transition: none` and `transform: none`. Keep touch targets and long-string containment explicit.

- [ ] **Step 8: Prove GREEN and commit**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-today-jobs-board.test.tsx tests/unit/shop-os-inline-work-workspace.test.tsx tests/unit/shop-os-simple-work-workspace.test.tsx tests/unit/shop-os-simple-work.test.ts --maxWorkers=2
node_modules/.bin/tsc --noEmit --pretty false
git diff --check
git add components/screens/today-jobs-board.tsx components/screens/today-jobs-board.module.css components/screens/inline-work-workspace.tsx components/screens/simple-work-workspace.tsx components/screens/simple-work-workspace.module.css tests/unit/shop-os-today-jobs-board.test.tsx tests/unit/shop-os-inline-work-workspace.test.tsx tests/unit/shop-os-simple-work-workspace.test.tsx
git commit -m "feat: mount technician claim and clock handoff" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

Expected: component journeys, work-domain regression, TypeScript, and diff checks pass.

---

### Task 4: Phone/desktop proof, independent convergence, and release candidate

**Owner:** Control lane

**Files:**
- Modify: the existing Shop OS golden browser harness selected by source inspection
- Modify: its existing Vitest contract file
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Create: `docs/strategy/SHOP_OS_TECHNICIAN_CLAIM_START_TEST_REPORT.md`

**Interfaces:**
- Add one hermetic browser suite using production components and CSS, not a lookalike fixture.
- Cover four journeys at 390×844 and 1440×900:
  1. approved unassigned → Claim work → exact scope → Clock on → running truth;
  2. approved preassigned → Review & clock on → exact scope → Clock on;
  3. waiting/below-tier/customer-outcome state matrix with no forbidden action;
  4. claim race, lost response replay, work-load failure, and stale embedded-access recovery.
- Browser proof fails on serious/critical Axe findings, console/page errors, horizontal overflow, control targets below 44px, focus skipping scope, price leakage, false running truth, or more than one active inline tool.

- [ ] **Step 1: Write the RED harness contract test**

Pin the suite name, both viewport sizes, the production imports, exact four journeys, focus/target/overflow/privacy sentinels, and absence of active Buzz/Nostr credentials in the spawned harness environment.

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-golden-browser-script.test.ts --maxWorkers=1
```

Expected: the new technician-handoff suite contract fails because the harness does not yet register it.

- [ ] **Step 2: Implement and run the focused browser proof**

Add only the smallest new suite/fixture path needed by the existing harness. Use deterministic server receipts and semantic readiness markers rather than timing sleeps.

```bash
node scripts/shop-os-golden-browser.mjs test --suite technician-handoff --base-url http://127.0.0.1:4173
```

Expected: 4/4 journey families pass at phone and desktop widths with clean accessibility, console, focus, overflow, and privacy checks.

- [ ] **Step 3: Run focused integration and build gates**

```bash
node node_modules/vitest/vitest.mjs run tests/unit/shop-os-job-assignment.test.ts tests/unit/shop-os-job-assignment-route.test.ts tests/unit/shop-os-today-jobs-query.test.ts tests/unit/shop-os-today-board.test.ts tests/unit/shop-os-living-ticket.test.ts tests/unit/shop-os-today-jobs-board.test.tsx tests/unit/shop-os-inline-work-workspace.test.tsx tests/unit/shop-os-simple-work-workspace.test.tsx tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-golden-browser-script.test.ts --maxWorkers=2
node_modules/.bin/tsc --noEmit --pretty false
npm run build
git diff --check
```

Expected: focused suite, TypeScript, production build, and diff integrity pass on the same exact head.

- [ ] **Step 4: Run the defined convergence path**

Run static, security, and runtime reviews in parallel against the same committed candidate. Consolidate all Critical/Important findings into one repair set, make one repair commit, rerun focused checks, then perform one focused re-review. A new unrelated Critical/Important finding after that re-review triggers the architecture stop condition.

- [ ] **Step 5: Run the complete exact-head gate**

```bash
node scripts/test-shards.mjs
node_modules/.bin/tsc --noEmit --pretty false
npm run build
git diff --check
git status --short
git rev-parse HEAD
```

Expected: every shard passes, TypeScript/build/diff pass, the worktree is clean, and the recorded exact head matches all proof receipts.

- [ ] **Step 6: Write the test report, update driver state, and commit**

Record exact head, commands, counts, browser journeys, reviewer verdicts, repairs, skipped gates, rollback, and remaining merge/deploy authority in `SHOP_OS_TECHNICIAN_CLAIM_START_TEST_REPORT.md`. Update the driver to candidate-ready truth without claiming release.

```bash
git add docs/strategy/SHOP_OS_DRIVER_STATE.md docs/strategy/SHOP_OS_TECHNICIAN_CLAIM_START_TEST_REPORT.md
git commit -m "docs: record technician handoff proof" --trailer "Co-authored-by: Vyntechs <brandon@vyntechs.com>" --trailer "Signed-off-by: Vyntechs <brandon@vyntechs.com>"
```

- [ ] **Step 7: Push and open the linked pull request**

Push only after local exact-head proof. Open the PR linked to Buzz channel `95938fc9-02c1-4c1a-8b20-84f540bc6c74`, wait for every hosted check, and compare the remote PR head to the clean local head. Do not merge or deploy before a new explicit owner approval.

Expected release packet: linked PR, exact local/remote head equality, local complete gate, four browser journeys, hosted-green checks, source-only rollback (`git revert` of the merge), and one explicit approve/decline merge-and-deploy decision.
