# ShopOS Living Repair Order — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:test-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the first three continuity failures: unfinished work cannot be closed, every creator can recover newly created open work, and advisors can use the complete counter-intake path.

**Architecture:** Keep the current ticket/job model and existing pages. Add one transaction-local terminal-work guard, one creator fallback inside the bounded Today query, and capability-based intake authorization. This wave deliberately adds no schema, migration, route, page, client cache, gesture, diagnostics, media, or external integration.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle ORM, PGlite, Vitest.

## Global Constraints

- Preserve current tenant, membership, paywall, rate-limit, diagnostics-off, and no-media boundaries.
- Preserve the retired general add-job route; do not reopen `POST /api/tickets/[id]/jobs`.
- Use `canAssignWork()` as the authority for full counter-intake access.
- Creator visibility is a recovery fallback, not permission to claim above tier or perform someone else's work.
- Add no new page. Existing `/today`, `/intake`, and `/tickets/[id]` remain the surfaces.
- Run database-heavy tests serially with at most two workers.

## Completion receipt — 2026-07-20

- **Task 1 complete:** active `open`, `in_progress`, and `blocked` work now prevents repair-order closeout inside the existing transaction; `done` and `canceled` work remains terminal.
- **Task 2 complete:** unassigned creator work remains visible even above the creator's tier or without a tier; work assigned to someone else appears in a quiet `Created by me` recovery lane with ticket-view authority only.
- **Task 3 complete:** Today, the intake layout, and the counter API now share `canAssignWork()`; advisor and owner pass, while tech and parts continue to fail closed.
- **Scope held:** no schema, migration, new page, general add-job route, cache, gesture, diagnostic/media path, external integration, or production mutation.
- **Proof:** 10 affected files / 125 tests, TypeScript, production build, and clean diff checks pass. Final independent review remains the branch-convergence gate.

---

### Task 1: Refuse terminal closeout while any work remains active

**Files:**
- Modify: `lib/tickets.ts`
- Modify: `lib/shop-os/ring-out.ts`
- Modify: `components/screens/ring-out-section.tsx`
- Test: `tests/unit/shop-os-ring-out.test.ts`
- Test: `tests/unit/shop-os-ring-out-section.test.tsx`

**Interfaces:**
- Consumes: `ticketJobs.workStatus` values `open | in_progress | blocked | done | canceled`.
- Produces: `TicketDomainError` value `unfinished_work`, mapped through the existing ring-out API and rendered as calm corrective copy.

- [ ] **Step 1: Write failing domain tests**

Add one parameterized test that creates an otherwise closable ticket containing each active status and proves closure is refused:

```ts
it.each(['open', 'in_progress', 'blocked'] as const)(
  'refuses to close while a job is %s',
  async (workStatus) => {
    await db.insert(ticketJobs).values({
      shopId: ownerActor.shopId as string,
      ticketId: EMPTY_TICKET,
      title: `Still ${workStatus}`,
      kind: 'repair',
      requiredSkillTier: 1,
      workStatus,
    })

    await expect(closeTicket(db, { actor: ownerActor, ticketId: EMPTY_TICKET }))
      .resolves.toEqual({ ok: false, error: 'unfinished_work' })
  },
)
```

Extend the successful zero-balance test with one `done` and one `canceled` job so both terminal statuses remain closable.

- [ ] **Step 2: Run the focused domain test and prove RED**

Run: `pnpm vitest run tests/unit/shop-os-ring-out.test.ts --maxWorkers=2 --reporter=dot`

Expected: the three new cases fail because `closeTicket()` currently closes them.

- [ ] **Step 3: Add the minimal locked guard**

Add `unfinished_work` to `TicketDomainError`. Inside the existing ticket transaction, after locking the ticket and before computing money, read at most one active job:

```ts
const [unfinishedJob] = await tx
  .select({ id: ticketJobs.id })
  .from(ticketJobs)
  .where(and(
    eq(ticketJobs.shopId, shopId),
    eq(ticketJobs.ticketId, ticket.id),
    inArray(ticketJobs.workStatus, ['open', 'in_progress', 'blocked']),
  ))
  .limit(1)
if (unfinishedJob) return { ok: false as const, error: 'unfinished_work' }
```

Keep this inside the existing transaction so work cannot be created or changed between the decision and close.

- [ ] **Step 4: Add the user-facing refusal**

Map `unfinished_work` in `humanizeError()`:

```ts
case 'unfinished_work':
  return 'Finish or cancel every work item before closing this repair order.'
```

Add a component test that submits close, receives `unfinished_work`, and asserts the exact message without navigation or refresh.

- [ ] **Step 5: Run focused proof and commit**

Run:

```bash
pnpm vitest run tests/unit/shop-os-ring-out.test.ts tests/unit/shop-os-ring-out-section.test.tsx --maxWorkers=2 --reporter=dot
git diff --check
git add lib/tickets.ts lib/shop-os/ring-out.ts components/screens/ring-out-section.tsx tests/unit/shop-os-ring-out.test.ts tests/unit/shop-os-ring-out-section.test.tsx
git commit -m "fix: keep unfinished repair orders open"
```

Expected: both files pass and the commit contains only terminal closeout safety.

---

### Task 2: Keep newly created open work discoverable to its creator

**Files:**
- Modify: `lib/tickets.ts`
- Modify: `components/screens/today-home.tsx`
- Modify: `components/screens/today-jobs-board.tsx`
- Test: `tests/unit/shop-os-today-jobs-query.test.ts`
- Test: `tests/unit/shop-os-today-jobs-board.test.tsx`
- Test: `tests/unit/today-home.test.tsx`

**Interfaces:**
- Consumes: immutable `tickets.createdByProfileId` plus active job state.
- Produces: `TodayTicketJobs.createdJobs` for work created by the actor but assigned elsewhere; unassigned created work remains in `openJobs`. No new page.

- [ ] **Step 1: Write three failing recovery tests**

Using the existing Today fixtures, prove both recovery cases:

```ts
it('keeps a null-tier creator\'s unassigned open job discoverable', async () => {
  await db.update(profiles).set({ role: 'parts', skillTier: null })
    .where(eq(profiles.id, actorProfileId))
  actor = { ...actor, role: 'parts', skillTier: null }
  await db.insert(ticketJobs).values({
    shopId, ticketId, title: 'Source requested part', kind: 'repair',
    requiredSkillTier: 2, workStatus: 'open',
  })
  const result = await listTodayTicketJobs(db, { actor })
  expect(result.openJobs.map((job) => job.title)).toContain('Source requested part')
  expect(result.openJobs[0]?.canClaim).toBe(false)
})
```

Add the equivalent Tier-1 tech / Tier-2 work test. Add a third case where an advisor creates work pre-assigned to another profile and prove it appears in `createdJobs`, not `myJobs` or `openJobs`. In every case, assert the job is viewable without expanding claim or work authority.

- [ ] **Step 2: Run the focused query test and prove RED**

Run: `pnpm vitest run tests/unit/shop-os-today-jobs-query.test.ts --maxWorkers=2 --reporter=dot`

Expected: all three recovery cases fail because the current projection excludes creator-only work.

- [ ] **Step 3: Add the creator recovery projection**

Add `createdJobs` to `TodayTicketJobs` and its empty value. Compose creator visibility without changing claim authorization:

```ts
const createdOpenWork = and(
  eq(tickets.createdByProfileId, actor.profileId),
  inArray(ticketJobs.workStatus, ['open', 'in_progress', 'blocked']),
)
const visibleOpenWork = canAssignWork(actor.role)
  ? and(isNull(ticketJobs.assignedTechId), eq(ticketJobs.workStatus, 'open'))
  : claimable
```

Include `createdOpenWork` as a separate branch in the query's outer `or()`. Select `tickets.createdByProfileId`, then classify without duplicates:

```ts
if (row.assignedTechId === actor.profileId) myJobs.push(job)
else if (row.assignedTechId === null) openJobs.push(job)
else if (row.createdByProfileId === actor.profileId) createdJobs.push(job)
```

The existing `canClaim` calculation remains tier-based and unchanged. Render `createdJobs` as a third Today section labeled `Created by me`; its only row action is `View ticket`. Include it in Today empty-state calculations.

- [ ] **Step 4: Prove tenant, status, and capability boundaries still hold**

Run:

```bash
pnpm vitest run tests/unit/shop-os-today-jobs-query.test.ts tests/unit/shop-os-today-jobs-board.test.tsx tests/unit/today-home.test.tsx tests/unit/shop-os-tickets-access.test.ts --maxWorkers=2 --reporter=dot
git diff --check
git add lib/tickets.ts components/screens/today-home.tsx components/screens/today-jobs-board.tsx tests/unit/shop-os-today-jobs-query.test.ts tests/unit/shop-os-today-jobs-board.test.tsx tests/unit/today-home.test.tsx
git commit -m "fix: keep created work recoverable"
```

Expected: unassigned and pre-assigned creator recovery passes; cross-shop, closed-ticket, claim, and perform restrictions remain green.

---

### Task 3: Let advisors use complete counter intake

**Files:**
- Modify: `app/(app)/today/page.tsx`
- Modify: `app/(app)/intake/layout.tsx`
- Modify: `app/api/tickets/counter/route.ts`
- Test: `tests/unit/today-home.test.tsx`
- Test: `tests/unit/shop-os-counter-ticket-route.test.ts`
- Create: `tests/unit/shop-os-counter-intake-access.test.tsx`

**Interfaces:**
- Consumes: `canAssignWork(role)` capability authority.
- Produces: unchanged `/intake` page and `/api/tickets/counter` contract for advisors and owners.

- [ ] **Step 1: Write failing advisor-access tests**

Add assertions that an active advisor sees `New work order`, the server layout returns its children for an advisor, and the API reaches `createCounterTicket()` for an advisor. Preserve tech and parts 404 behavior.

```ts
expect(canAssignWork('advisor')).toBe(true)
expect(canAssignWork('owner')).toBe(true)
expect(canAssignWork('tech')).toBe(false)
expect(canAssignWork('parts')).toBe(false)
```

- [ ] **Step 2: Run the three focused files and prove RED**

Run: `pnpm vitest run tests/unit/today-home.test.tsx tests/unit/shop-os-counter-ticket-route.test.ts tests/unit/shop-os-counter-intake-access.test.tsx --maxWorkers=2 --reporter=dot`

Expected: advisor UI/page/API access assertions fail under the current owner string comparisons.

- [ ] **Step 3: Replace scattered role checks with the capability helper**

Use `canAssignWork(ctx.profile.role)` consistently:

```ts
canWriteCounterOrder={canAssignWork(ctx.profile.role)}
```

```ts
if (!canAssignWork(ctx.profile.role)) notFound()
```

```ts
if (!canAssignWork(ctx.profile.role)) {
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}
```

- [ ] **Step 4: Run focused access proof and commit**

Run:

```bash
pnpm vitest run tests/unit/today-home.test.tsx tests/unit/shop-os-counter-ticket-route.test.ts tests/unit/shop-os-counter-intake-access.test.tsx tests/unit/shop-os-capabilities.test.ts --maxWorkers=2 --reporter=dot
git diff --check
git add 'app/(app)/today/page.tsx' 'app/(app)/intake/layout.tsx' app/api/tickets/counter/route.ts tests/unit/today-home.test.tsx tests/unit/shop-os-counter-ticket-route.test.ts tests/unit/shop-os-counter-intake-access.test.tsx
git commit -m "fix: align advisor intake access"
```

Expected: advisor and owner pass; tech and parts continue to fail closed.

---

### Task 4: Converge Wave 1 and prepare the next living-object slice

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Modify: this plan

**Interfaces:**
- Consumes: the three verified commits above.
- Produces: a durable checkpoint that names the next slice: role-shaped queue lenses and precise local mutation updates.

- [ ] **Step 1: Run the affected regression set**

Run:

```bash
pnpm vitest run tests/unit/shop-os-ring-out.test.ts tests/unit/shop-os-ring-out-section.test.tsx tests/unit/shop-os-today-jobs-query.test.ts tests/unit/shop-os-today-jobs-board.test.tsx tests/unit/shop-os-tickets-access.test.ts tests/unit/today-home.test.tsx tests/unit/shop-os-counter-ticket-route.test.ts tests/unit/shop-os-counter-intake-access.test.tsx tests/unit/shop-os-capabilities.test.ts --maxWorkers=2 --reporter=dot
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Expected: all focused files, TypeScript, and production build pass.

- [ ] **Step 2: Review the complete Wave 1 diff**

Confirm there is no schema/DDL, new page, general add-job route, diagnostics/media path, cross-tenant disclosure, claim expansion, or unrelated refactor.

- [ ] **Step 3: Record the durable checkpoint and commit**

Update the active plan with fresh row numbers after Row 50, mark the production security row complete through PR #176, and record Wave 1 proof. Update `SHOP_OS_DRIVER_STATE.md` with the broader outcome, exact proof, next safe move, gates, lanes, and stop condition.

```bash
git add docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md docs/strategy/SHOP_OS_DRIVER_STATE.md docs/superpowers/plans/2026-07-20-shop-os-living-repair-order-wave-1.md
git commit -m "docs: record living repair order wave 1"
```

**Done when:** Every intended creator can recover their unassigned open work, advisors can complete counter intake, unfinished work cannot close, all existing authorization and tenant boundaries pass, and the next role-shaped no-refresh slice is durably queued.
