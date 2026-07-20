# ShopOS Golden Shop Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove one diagnostics-off Counter-intake repair order can move through owner, advisor, technician, and parts roles from creation to closed truth, and repair the sessionless-manual-work dead end that currently prevents it.

**Architecture:** Add one pure manual-work eligibility policy shared by server mutations and the two living UI projections. Build one hermetic PGlite acceptance harness that switches among four persisted actors, reloads Today/ticket truth at every handoff, and exercises the existing quote, approval, simple-work, part-request, payment, and close domains. No test-only product route, auth bypass, credential, network, schema, or production data is introduced.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM, PGlite, Vitest, Testing Library.

## Global Constraints

- Add no operational page, diagnostic-engine entrance, media path, schema/migration, dependency, provider call, stored credential, production mutation, or real customer data.
- A diagnostic job may use simple work only when it has no session and authoritative current diagnostics availability is false.
- Existing repair/maintenance behavior and entitled/session-backed diagnostic behavior remain unchanged.
- Every checkpoint reloads persisted server truth; optimistic client state is not acceptance evidence.
- Run database-heavy Vitest with at most two workers.

---

### Task 1: Give diagnostics-off manual findings an honest completion path

**Files:**
- Create: `lib/shop-os/manual-work-policy.ts`
- Modify: `lib/shop-os/simple-work.ts`
- Modify: `lib/shop-os/living-ticket.ts`
- Test: `tests/unit/shop-os-simple-work.test.ts`
- Test: `tests/unit/shop-os-living-ticket.test.ts`

**Interfaces:**
- Consumes: `kind`, `sessionId`, and resolved `diagnosticsEntitled` truth.
- Produces: `canUseManualWork({ kind, sessionId, diagnosticsEntitled }): boolean`.

- [x] **Step 1: Write RED policy and domain tests**

Add table tests proving repair/maintenance remain eligible only without a session; a diagnostic is eligible only when diagnostics are unavailable and `sessionId` is null. Extend the simple-work fixture with `shop_entitlements.diagnostics = false`, a reviewed sessionless diagnostic snapshot, exact approval, and assignment; prove `getSimpleWorkWorkspace()` and `clock_on` succeed. Prove both fail when entitlement is true or a session ID exists.

```ts
expect(canUseManualWork({
  kind: 'diagnostic', sessionId: null, diagnosticsEntitled: false,
})).toBe(true)
expect(canUseManualWork({
  kind: 'diagnostic', sessionId: null, diagnosticsEntitled: true,
})).toBe(false)
```

- [x] **Step 2: Prove RED**

Run:

```bash
pnpm vitest run tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-living-ticket.test.ts --maxWorkers=2 --reporter=dot
```

Expected: diagnostic manual-work assertions fail under the categorical kind guards.

- [x] **Step 3: Implement the shared pure policy and authoritative domain check**

Create:

```ts
export function canUseManualWork(input: {
  kind: string
  sessionId: string | null
  diagnosticsEntitled: boolean
}): boolean {
  if (input.sessionId !== null) return false
  if (input.kind === 'repair' || input.kind === 'maintenance') return true
  return input.kind === 'diagnostic' && !input.diagnosticsEntitled
}
```

In both `lockContext()` and `getSimpleWorkWorkspace()`, resolve current shop diagnostics truth with `hasDiagnostics()` only for a sessionless diagnostic candidate, then apply the shared policy. Keep actor, assignment, approval, ticket, and lock checks unchanged.

Extend `LivingTicketJob` with `sessionId`, extend projector input with `diagnosticsEntitled`, and replace the hardcoded repair/maintenance condition with the shared policy.

- [x] **Step 4: Prove the bounded behavior and commit**

Run:

```bash
pnpm vitest run tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-living-ticket.test.ts tests/unit/entitlements.test.ts --maxWorkers=2 --reporter=dot
git diff --check
git add lib/shop-os/manual-work-policy.ts lib/shop-os/simple-work.ts lib/shop-os/living-ticket.ts tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-living-ticket.test.ts
git commit -m "fix: complete manual diagnostic work"
```

Expected: diagnostics-off sessionless work passes; entitled or session-backed diagnostic work remains unavailable.

---

### Task 2: Project the same next move on Today and the mounted repair order

**Files:**
- Modify: `app/(app)/tickets/[id]/page.tsx`
- Modify: `components/screens/ticket-detail.tsx`
- Modify: `components/screens/today-jobs-board.tsx`
- Modify: `lib/tickets.ts`
- Test: `tests/unit/shop-os-ticket-page.test.tsx`
- Test: `tests/unit/shop-os-ticket-detail.test.tsx`
- Test: `tests/unit/shop-os-today-jobs-board.test.tsx`
- Test: `tests/unit/shop-os-today-jobs-query.test.ts`

**Interfaces:**
- Consumes: server-resolved `diagnosticsEntitled` and the shared manual-work policy.
- Produces: one `Open work`/`Start work` path for an approved assigned diagnostics-off sessionless job; `Record findings` remains the pre-approval move.

- [x] **Step 1: Write RED UI tests**

Prove the ticket page resolves entitlements and passes them to the mounted screen. For a diagnostics-off assigned job, assert `Record findings` before approval and `Open work`/`Start work` after approval. Repeat with entitlement true and session present to prove no manual-work entrance appears. Preserve the no-diagnostics/no-media copy contract.

- [x] **Step 2: Prove RED**

Run:

```bash
pnpm vitest run tests/unit/shop-os-ticket-page.test.tsx tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-today-jobs-board.test.tsx --maxWorkers=2 --reporter=dot
```

Expected: the approved diagnostics-off job still renders `Record findings` and the living projector has no work command.

- [x] **Step 3: Wire server truth into existing surfaces**

Reuse the authoritative diagnostics entitlement already returned by `checkAccess()` in the ticket page, avoiding a second entitlement read. Pass the boolean to `TicketDetailScreen`, then to `projectLivingTicketCommands()`. Add approval state to the bounded Today read model, then use the shared policy to choose `SimpleWorkAction` for an approved assigned sessionless diagnostics-off job; otherwise retain `DiagnosticAction` and its manual-findings link.

No route or new screen is added. Both surfaces link to the existing `/tickets/[id]/jobs/[jobId]/work` fallback.

- [x] **Step 4: Prove responsive and authority contracts and commit**

Run:

```bash
pnpm vitest run tests/unit/shop-os-ticket-page.test.tsx tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-today-jobs-board.test.tsx tests/unit/shop-os-simple-work-page.test.tsx tests/unit/shop-os-living-ticket.test.ts --maxWorkers=2 --reporter=dot
git diff --check
git add 'app/(app)/tickets/[id]/page.tsx' components/screens/ticket-detail.tsx components/screens/today-jobs-board.tsx tests/unit/shop-os-ticket-page.test.tsx tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-today-jobs-board.test.tsx
git commit -m "fix: surface manual diagnostic work"
```

Expected: one existing route, one next move, no diagnostic engine entrance, and existing 375px/desktop contracts remain green.

---

### Task 3: Build the executable Golden Shop Day role-flow gate

**Files:**
- Create: `tests/helpers/golden-shop-day.ts`
- Create: `tests/unit/shop-os-golden-shop-day.test.ts`
- Modify: `lib/shop-os/part-requests.ts`
- Modify: `lib/tickets.ts`
- Modify: `lib/shop-os/today-board.ts`
- Modify: `components/screens/today-jobs-board.tsx`
- Modify: `components/screens/today-home.tsx`
- Test: existing focused parts and Today suites

**Interfaces:**
- Consumes: existing `createCounterTicket`, `listTodayTicketJobs`, `mutateTicketJobAssignment`, manual-story, quote, decision, simple-work, part-request, payment, close, ticket-detail, and living-command functions.
- Produces: `createGoldenShopDay()` returning a disposable PGlite database, four actors, and fixed fake scenario identities; one release-gate test with checkpoint receipts.

- [x] **Step 1: Add the synthetic shop fixture**

Seed only reserved fake values:

```ts
const PEOPLE = {
  owner:   { role: 'owner',   skillTier: 3, name: 'Golden Owner' },
  advisor: { role: 'advisor', skillTier: null, name: 'Golden Advisor' },
  tech:    { role: 'tech',    skillTier: 3, name: 'Golden Technician' },
  parts:   { role: 'parts',   skillTier: null, name: 'Golden Parts' },
} as const
```

Insert one diagnostics-false entitlement. Use fixed UUIDs, `example.invalid` email strings where needed, no phone resembling a real subscriber, and return `close()` so every test disposes its database.

- [x] **Step 2: Write the complete RED journey**

Drive this exact sequence through domain functions:

```text
advisor Counter intake -> owner/advisor queue receipt -> assign tech
tech queue receipt -> manual findings -> quote line/version
advisor exact-version approval -> tech clock on -> text-only part request
parts ticket receipt -> source request -> tech note + complete
owner ring-out -> payment -> close -> terminal read-only receipts for all roles
```

At each checkpoint call `listTodayTicketJobs()`, `getTicketDetail()`, and `projectLivingTicketCommands()` again. Assert intended lane/command and explicitly forbidden assign, work, parts, money, or close authority for the other roles.

- [x] **Step 3: Add failure-path receipts**

Within the same journey prove:

- premature work before exact approval fails;
- tech cannot resolve the parts request or close;
- parts cannot start the technician's work or record customer approval;
- stale work-note update conflicts without losing the current note;
- close before work completion and before payment fails;
- replaying part request and payment keys creates one record;
- a second fresh fixture starts at ticket number one and contains none of the first run's rows.

- [x] **Step 4: Run the gate twice and commit**

Run:

```bash
pnpm vitest run tests/unit/shop-os-golden-shop-day.test.ts --maxWorkers=1 --reporter=verbose
pnpm vitest run tests/unit/shop-os-golden-shop-day.test.ts --maxWorkers=1 --reporter=verbose
git diff --check
git add tests/helpers/golden-shop-day.ts tests/unit/shop-os-golden-shop-day.test.ts
git commit -m "test: certify Golden Shop Day"
```

Expected: both clean runs pass with no environment variables, network, skips, or shared rows.

---

### Task 4: Converge, review, and record Row 54

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Modify: `docs/superpowers/plans/2026-07-20-shop-os-golden-shop-day.md`

**Interfaces:**
- Consumes: verified Tasks 1–3 and consolidated review findings.
- Produces: Row 54 status and durable next-safe-move evidence.

- [x] **Step 1: Run focused convergence**

Run the Golden gate plus existing auth, capability, Today, ticket, quote, decision, simple-work, parts, ring-out, and no-media files with at most two workers.

- [x] **Step 2: Run one consolidated static/security/runtime review**

Review for entitlement races, auth/capability expansion, session-backed diagnostic reopening, cross-shop leakage, stale state, duplicate payment/part writes, hidden live-data dependencies, added pages, diagnostic-engine/media drift, and test assertions that merely mirror implementation.

- [x] **Step 3: Apply one repair wave and focused re-review**

Batch all blocking findings, rerun only affected tests, and stop/re-plan if a new Critical or Important architecture defect appears that was not caused by the repair.

- [x] **Step 4: Run repository gates**

Run the documented eight serialized Vitest shards with two workers, then:

```bash
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Expected: zero failures; no new schema, page, dependency, credential, network, diagnostic engine, media, or production-data path.

- [x] **Step 5: Record proof and commit**

Add Row 54 with exact counts and review verdict. Update `SHOP_OS_DRIVER_STATE.md` with Outcome, Current slice, Last proof, Next safe move, Open gates, Worker lanes, Stop only when, and Usage balance. Mark this plan's tasks complete only from real evidence.

```bash
git add docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md docs/strategy/SHOP_OS_DRIVER_STATE.md docs/superpowers/plans/2026-07-20-shop-os-golden-shop-day.md
git commit -m "docs: record Golden Shop Day proof"
```

**Done when:** One fresh hermetic shop moves one Counter-intake repair order across all four roles to closed truth twice, every role sees only its intended queue/actions on the existing Today or mounted repair order, diagnostics/media remain off, the manual sessionless job has a safe completion path, and all release gates pass.

**Verified by:** Golden journey twice; focused role/auth/domain/UI suite; serialized full suite; TypeScript; production build; diff review; consolidated static/security/runtime review.
