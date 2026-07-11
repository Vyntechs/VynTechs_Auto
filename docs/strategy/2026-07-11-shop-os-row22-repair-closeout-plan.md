# Shop OS Row 22 — Repair Authorization and Honest Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce exact-version approval before ticket-backed diagnostic repair mutations while preserving legacy sessions and providing an honest declined/no-repair closeout.

**Architecture:** A new Shop OS repair-authorization module owns the bounded read projection and ticket-first transactional lock/revalidation contract. Existing session handlers call that contract at the mutation boundary; server pages use only its read projection to select approved, waiting, declined, unavailable, or byte-compatible legacy UI.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM, PostgreSQL/PGlite, Zod, Vitest, Testing Library.

**Design:** `docs/strategy/2026-07-11-shop-os-row22-repair-closeout-design.md`

## Global Constraints

- No schema, migration, feature flag, AI prompt, topology behavior, quote mutation, simple-work execution, delivery, or ticket-close change.
- Ticketless legacy sessions retain their existing server and rendered behavior.
- Ticket-backed mutation lock order is ticket → all jobs by ID → versions by ID → session → actor, using `NOWAIT` and rollback on conflict.
- Normal repair outcomes require current exact-version approval; declined closeout can never claim repair or verification.
- Tests are written red before implementation; one lane owns heavy test execution.

---

### Task 1: Server-owned repair authorization contract

**Files:**

- Create: `lib/shop-os/repair-authorization.ts`
- Modify: `lib/shop-os/quotes.ts`
- Create: `tests/unit/shop-os-repair-authorization.test.ts`

**Interfaces:**

- Produces:

```ts
export type DiagnosticRepairAccess =
  | { state: 'legacy' }
  | { state: 'approved'; ticketId: string; jobId: string; quoteVersionId: string }
  | { state: 'declined'; ticketId: string; jobId: string }
  | { state: 'awaiting_approval'; ticketId: string; jobId: string }
  | { state: 'unavailable' }

export async function resolveDiagnosticRepairAccess(
  db: AppDb,
  input: { shopId: string; sessionId: string },
): Promise<DiagnosticRepairAccess>

export async function lockDiagnosticRepairAccess(
  db: AppDb,
  input: { shopId: string; sessionId: string; actorProfileId: string },
): Promise<DiagnosticRepairAccess>

export function quoteSnapshotContainsJob(
  snapshot: unknown,
  input: { ticketId: string; jobId: string },
): boolean
```

- Consumes: `tickets`, `ticketJobs`, `quoteVersions`, `quoteEvents`, `sessions`, `profiles`, existing quote snapshot schema, `AppDb`, and the existing lock-unavailable classifier.

- [ ] **Step 1: Write failing state-projection tests**

Create fixtures for no linked job, valid approved version/event, declined, pending/sent/quote-ready, superseded version, missing approved event, malformed snapshot, snapshot missing job, canceled/done job, non-diagnostic linkage, cross-shop linkage, inactive actor, reassigned session owner, and duplicate/corrupt state.

Core assertions:

```ts
expect(await resolveDiagnosticRepairAccess(db, { shopId, sessionId }))
  .toEqual({ state: 'approved', ticketId, jobId, quoteVersionId })

expect(await resolveDiagnosticRepairAccess(db, { shopId, sessionId: legacySessionId }))
  .toEqual({ state: 'legacy' })

expect(await resolveDiagnosticRepairAccess(db, { shopId, sessionId: supersededSessionId }))
  .toEqual({ state: 'unavailable' })
```

- [ ] **Step 2: Run the red tests**

Run:

```bash
pnpm test -- tests/unit/shop-os-repair-authorization.test.ts
```

Expected: FAIL because the repair-authorization module and snapshot helper do not exist.

- [ ] **Step 3: Implement the pure snapshot helper and read projection**

Export the smallest wrapper around the existing strict quote snapshot parser:

```ts
export function quoteSnapshotContainsJob(
  snapshot: unknown,
  input: { ticketId: string; jobId: string },
): boolean {
  const parsed = quoteSnapshotSchema.safeParse(snapshot)
  return parsed.success
    && parsed.data.ticket.id === input.ticketId
    && parsed.data.jobs.some((job) => job.id === input.jobId)
}
```

Implement `resolveDiagnosticRepairAccess` without exposing snapshot, event, customer, vehicle, or story content.

- [ ] **Step 4: Implement ticket-first locked revalidation**

Perform the preliminary link lookup only to discover the ticket. Then lock and revalidate ticket, all jobs, versions, session, and actor in the documented order. Validate the current approval event for the exact job/version. Let lock-unavailable errors escape for the caller's transaction boundary to map as retryable conflict.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```bash
pnpm test -- tests/unit/shop-os-repair-authorization.test.ts tests/unit/shop-os-quote-decisions.test.ts tests/unit/shop-os-quote-versions.test.ts
pnpm exec tsc --noEmit
```

Expected: all named tests pass and TypeScript exits 0.

- [ ] **Step 6: Commit Task 1**

```bash
git add lib/shop-os/repair-authorization.ts lib/shop-os/quotes.ts tests/unit/shop-os-repair-authorization.test.ts
git commit -m "Add ticketed repair authorization contract"
```

---

### Task 2: Guard repair observation and close mutations

**Files:**

- Modify: `lib/types.ts`
- Modify: `lib/sessions.ts`
- Modify: `app/api/sessions/[id]/repair-observation/route.ts`
- Modify: `app/api/sessions/[id]/close/route.ts`
- Extend: `tests/unit/repair-observation.test.ts`
- Extend: `tests/unit/close-session-handler.test.ts`
- Create: `tests/unit/shop-os-repair-close-routes.test.ts`

**Interfaces:**

- Consumes: Task 1 authorization functions.
- Produces:

```ts
export type OutcomeCloseout = { kind: 'declined_no_repair' }

// Additive and optional; legacy payloads parse identically.
closeout: z.object({ kind: z.literal('declined_no_repair') }).optional()

type DeclinedNoRepairBody = {
  mode: 'declined_no_repair'
  note?: string
}
```

- [ ] **Step 1: Write failing authorization tests around both handlers**

For repair observation, assert pending/declined/unavailable paths append zero events and call guidance zero times; approved and legacy paths preserve the existing success and provider-failure behavior.

For close, assert:

```ts
expect(await closeSessionForUser({ ...approved, body: performedOutcome })).toEqual({ ok: true })
expect((await readJob()).workStatus).toBe('done')

expect(await closeSessionForUser({ ...declined, body: performedOutcome }))
  .toMatchObject({ ok: false, status: 409, error: 'repair_not_authorized' })

expect(await closeSessionForUser({
  ...declined,
  body: { mode: 'declined_no_repair', note: 'Customer declined after estimate review.' },
})).toEqual({ ok: true })
```

Also assert declined close stores `closeout.kind`, `actionType: 'no_fix'`, all-false verification, zero repair minutes, no part, and marks the job canceled. Smuggled action/verification/part/time/version/actor fields must be ignored or rejected. Specificity, AI, corpus promotion, proof-of-fix, and repair guidance must not run on any denied/no-repair path.

- [ ] **Step 2: Run the red tests**

```bash
pnpm test -- tests/unit/repair-observation.test.ts tests/unit/close-session-handler.test.ts tests/unit/shop-os-repair-close-routes.test.ts
```

Expected: new authorization and no-repair assertions fail against current unguarded behavior.

- [ ] **Step 3: Add the additive closeout type**

Extend `outcomeSchema` with the optional strict marker. Keep every existing field and default behavior unchanged.

- [ ] **Step 4: Guard repair observation at its persistence boundary**

Wrap ticket-backed authorization and the first observation append in one transaction. Return bounded `repair_not_authorized` or retryable `conflict` results before calling `getGuidance`. Keep the external guidance call and second guidance event behavior unchanged after an approved/legacy observation commits.

- [ ] **Step 5: Split performed-repair and declined-no-repair close paths**

Parse the no-repair discriminator before `outcomeSchema`. For approved ticket-backed normal close, atomically close the session, append the close event, and mark the job done. For declined no-repair, construct the outcome exclusively from locked server truth, close, append the typed disposition, and mark the job canceled. Invoke existing post-close optional callbacks only for approved/legacy performed outcomes.

- [ ] **Step 6: Map thin route responses**

Keep 401/paywall behavior unchanged. Map lock contention to `409 { error: 'conflict', retryable: true }` and authorization state to `409 { error: 'repair_not_authorized' }`. Do not return customer, diagnosis, quote, version, or job content.

- [ ] **Step 7: Run focused regression tests and typecheck**

```bash
pnpm test -- tests/unit/shop-os-repair-authorization.test.ts tests/unit/repair-observation.test.ts tests/unit/close-session-handler.test.ts tests/unit/shop-os-repair-close-routes.test.ts tests/unit/manual-session-loop.test.ts tests/unit/record-diagnostic-session.test.ts
pnpm exec tsc --noEmit
```

Expected: all pass; legacy tests remain unchanged.

- [ ] **Step 8: Commit Task 2**

```bash
git add lib/types.ts lib/sessions.ts app/api/sessions/[id]/repair-observation/route.ts app/api/sessions/[id]/close/route.ts tests/unit/repair-observation.test.ts tests/unit/close-session-handler.test.ts tests/unit/shop-os-repair-close-routes.test.ts
git commit -m "Enforce approved diagnostic repair mutations"
```

---

### Task 3: Render approved, waiting, and no-repair states

**Files:**

- Modify: `app/(app)/sessions/[id]/page.tsx`
- Modify: `app/(app)/sessions/[id]/outcome/page.tsx`
- Modify: `components/screens/active-session.tsx`
- Modify: `components/screens/repair-phase-view.tsx`
- Modify: `components/screens/outcome-capture.tsx`
- Modify: `components/screens/closed-case-summary.tsx`
- Create: `components/screens/declined-no-repair-close.tsx`
- Create: `tests/unit/shop-os-repair-authorization-ui.test.tsx`
- Extend: `tests/unit/outcome-capture.test.tsx`
- Extend: `tests/unit/session-page.test.tsx` if present; otherwise create `tests/unit/shop-os-session-repair-page.test.tsx`

**Interfaces:**

- Consumes: Task 1 `DiagnosticRepairAccess` and Task 2 close endpoint.
- Produces:

```ts
type RepairPhaseViewProps = {
  session: Session
  events: SessionEvent[]
  repairAccess?: DiagnosticRepairAccess // undefined preserves legacy callers
}

type DeclinedNoRepairCloseProps = {
  sessionId: string
  successHref?: string
}
```

- [ ] **Step 1: Write failing render and interaction tests**

Prove the branch tree:

```text
legacy → existing conversation, Ask AI, outcome link, abandon control
approved → same repair controls plus current exact-approval status
awaiting_approval → diagnosis visible; repair conversation, Ask AI, and performed-repair close hidden
declined → diagnosis visible; only explicit no-repair close and administrative incomplete control
unavailable → fail-closed unavailable message; no repair/no-repair mutation button
```

Direct `/outcome` entry must render the normal form only for legacy/approved, redirect waiting/unavailable to the session, and render the no-repair surface for declined.

Assert the declined control posts only `{ mode: 'declined_no_repair', note? }`, locks while busy, announces errors, restores action on failure, redirects on success, has a 44px target, and contains the literal phrase “No repair performed.”

- [ ] **Step 2: Run the red UI tests**

```bash
pnpm test -- tests/unit/shop-os-repair-authorization-ui.test.tsx tests/unit/outcome-capture.test.tsx tests/unit/shop-os-session-repair-page.test.tsx
```

Expected: FAIL because the repair-access props and declined close component do not exist.

- [ ] **Step 3: Wire server-owned read state into both pages**

Resolve access only for open repairing sessions after normal auth/session ownership. Pass `legacy` unchanged for no-link sessions. Never infer approval client-side.

- [ ] **Step 4: Implement the minimal UI branches**

Reuse the existing diagnosis module, tokens, typography, buttons, and spacing. Add no global CSS or dependency. Keep the legacy branch's element order, copy, links, and controls unchanged. The declined confirmation must restate:

```text
Customer declined this work.
No repair performed.
No verification will be recorded.
```

- [ ] **Step 5: Render honest closed history**

When `outcome.closeout.kind === 'declined_no_repair'`, `ClosedCaseSummary` renders a `No repair performed` module and omits performed-repair action, part, verification, and repair-time claims. Ordinary outcomes remain unchanged.

- [ ] **Step 6: Run UI, routing, and accessibility-focused tests**

```bash
pnpm test -- tests/unit/shop-os-repair-authorization-ui.test.tsx tests/unit/outcome-capture.test.tsx tests/unit/shop-os-session-repair-page.test.tsx tests/unit/session-routing.test.ts
pnpm exec tsc --noEmit
pnpm build
```

Expected: all present tests pass, TypeScript exits 0, and production build succeeds.

- [ ] **Step 7: Commit Task 3**

```bash
git add 'app/(app)/sessions/[id]/page.tsx' 'app/(app)/sessions/[id]/outcome/page.tsx' components/screens/active-session.tsx components/screens/repair-phase-view.tsx components/screens/outcome-capture.tsx components/screens/closed-case-summary.tsx components/screens/declined-no-repair-close.tsx tests/unit/shop-os-repair-authorization-ui.test.tsx tests/unit/outcome-capture.test.tsx tests/unit/shop-os-session-repair-page.test.tsx
git commit -m "Add honest diagnostic repair closeout states"
```

---

### Task 4: Converge, review, and ship row 22

**Files:**

- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`

- [ ] **Step 1: Run the complete focused row suite**

```bash
pnpm test -- tests/unit/shop-os-repair-authorization.test.ts tests/unit/repair-observation.test.ts tests/unit/close-session-handler.test.ts tests/unit/shop-os-repair-close-routes.test.ts tests/unit/shop-os-repair-authorization-ui.test.tsx tests/unit/outcome-capture.test.tsx tests/unit/shop-os-session-repair-page.test.tsx tests/unit/shop-os-quote-decisions.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/manual-session-loop.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run whole-branch verification once**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check origin/main...HEAD
```

Expected: full suite, TypeScript, build, and diff check pass.

- [ ] **Step 3: Perform independent review**

Review the full branch for tenant isolation, actor freshness, exact-version proof, event/snapshot validation, ticket-first locking, replay/race behavior, absence of mutation before authorization, honest no-repair persistence, legacy preservation, UI accessibility, and scope. Resolve every Critical, Important, and Minor finding before shipping.

- [ ] **Step 4: Run signed browser proof**

At 375px and desktop widths, verify approved repair, waiting-for-approval lock, declined no-repair confirmation, direct outcome URL denial, closed no-repair history, focus order, 44px targets, announcements, busy lock, no overflow, and zero new console errors. Use isolated QA data only.

- [ ] **Step 5: Update durable status in the shipping PR**

Mark row 22 complete with exact PR/test proof, add the phase implementation correction, set row 23 as the next safe move, and preserve every production/external gate.

- [ ] **Step 6: Commit documentation and publish**

```bash
git add docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md docs/strategy/SHOP_OS_DRIVER_STATE.md
git commit -m "Close Shop OS row 22"
git push -u origin feat/shop-os-row22-closeout
```

Open a ready PR, wait for required checks, merge through GitHub, delete the remote branch, wait for production Ready, then repeat the signed approved-path smoke and inspect fresh Vercel/Postgres errors.

## Done when

An approved linked diagnostic can repair and close; every unapproved mutation fails before side effects; a declined diagnosis closes only as “no repair performed”; legacy ticketless sessions behave unchanged; the branch is reviewed, fully verified, merged, deployed, and recorded with row 23 next.
