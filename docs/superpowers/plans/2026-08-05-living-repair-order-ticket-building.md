# Living Repair Order Ticket Building Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an authorized technician, advisor, parts user, or owner build a real ticket inside the mounted repair order, with the part, labor, fee, tax, and total appearing causally before an authorized user prepares the ticket, then settle the prepared truth back into the repair order without a page change.

**Architecture:** Preserve `TicketDetailScreen → InlineQuoteWorkspace → ManualQuoteBuilder`, the quote math/version contracts, and existing routes. Extend the pure living-ticket projector so an assigned technician can receive a job-bound `Build ticket` command and tied top-ranked job commands become one truthful local group. Add one fail-closed server boundary shared by manual line and manual sourcing mutations: technicians may change only their assigned active `pending_quote` job, while advisor/parts/owner keep current ticket-wide quote-building authority. Add strict projection capabilities so the full-page fallback and mounted builder expose only the same server-authorized controls; technicians cannot perform ticket-wide Prepare in this slice. Let `TicketDetailScreen` mount one selected workspace inside its job, hide secondary commands behind `More`, and settle returned truth locally. Reorder presentation inside `ManualQuoteBuilder`: current jobs first, add-more tools last, no totals before a saved line, and no new money, persistence shape, or supplier connector behavior.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, CSS Modules, Vitest 4, Testing Library, Playwright 1.59.

## Global Constraints

- Execute from the existing isolated branch/worktree `codex/living-repair-order-visual-2026-08-05` at source baseline `3a3c71a05ba0c66fa4e60a7bfadfe2117a69d3c5`; compare with current `origin/main` before coding. If an owned production file changed, stop and regenerate this plan from a fresh worktree instead of rebasing the dirty proof worktree.
- Add no route, endpoint, schema, migration, dependency, workflow stage, orchestration service, client-authored progress value, money rule, provider call, or production/customer-data mutation. The only server behavior change is an authorization hardening on existing quote mutations plus additive read-projection capabilities.
- Do not apply migrations `0050` or `0051`; do not activate Customer Approval or Ticket Correction; do not run correction-enabled preview or production proof.
- Preserve `canBuildQuotes` as the broad read/entry gate, handler-side tenant checks, prepared-version fingerprints, draft recovery, retry identity, stale recovery, customer-decision authority, Customer Copy privacy, and deep-link fallbacks. Extend strict quote projections with server-derived per-job editability and ticket-wide Prepare authority; the client never invents either value.
- A technician receives `Build ticket` and may add/edit/remove manual lines or manual sourced offers only for an active `pending_quote` job assigned to that technician. Advisor, owner, and parts retain their existing ticket-wide revision authority across every currently editable active, non-pinned approval state; their edit can continue to invalidate/supersede a prepared version exactly as it does today. Advisor/owner/parts may Prepare the ticket; only advisor/owner retain customer-decision authority. This is the smallest safe contract because the existing prepared version commits every included job, not one technician's selected job.
- Assignment, hold recovery, declined-job retirement, active work, payment, and close keep their current numeric ranks. Presentation may hide only commands the projector classifies as secondary.
- Never show a total before at least one saved line exists. Never invent per-line technician/advisor authorship; the schema does not store it.
- O'Reilly First Call, PartsTech, and RepairLink may appear only as passive text labeled `Planned connections · not live`; they are not buttons, links, provider calls, or a promise of current availability. Existing manual supplier accounts and manual part entry remain the only working sourcing paths.
- `Add work` means adding another job. Existing jobs render before canned work, another repair, or diagnostic-time creation, and those add-more tools remain behind an honest disclosure.
- Exactly one filled action exists in the active context. When the quote workspace opens, the job opener is removed from competition; the workspace's strict projection owns its next authorized action, refusal, and recovery. A technician sees saved math but no Prepare control.
- All active controls are at least 44 CSS pixels, keyboard reachable, visibly focused, overflow-safe at 390×844 and 1440×900, and equivalent under reduced motion.
- One consolidated final repair wave is allowed after parallel static/security/runtime review. A new unrelated Critical or Important finding after focused re-review stops the lane for architecture review.
- Build approval authorizes implementation, commits, push, and PR preparation only. Merge, deployment, migrations, activation, external supplier access, and production proof remain separate human gates.

---

### Task 1: Make the living-ticket projection job-bound and tie-safe

**Files:**
- Modify: `lib/shop-os/living-ticket.ts`
- Modify: `tests/unit/shop-os-living-ticket.test.ts`
- Modify: `tests/unit/shop-os-golden-shop-day.test.ts`

**Interfaces:**
- Produces: job-bound `Build ticket` commands for eligible `pending_quote` jobs.
- Produces: `LivingTicketCommandGroup` and `LivingTicketCommands.primaryGroup`.
- Preserves: current rank numbers, terminal refusal, assignment/claim/work/hold/decline/payment/close rules, and advisor/owner-only decision wording.

- [x] **Step 1: Write RED projection tests**

Add tests proving:

```ts
expect(project({
  role: 'tech',
  jobs: [job({ assignedTechId: PROFILE, approvalState: 'pending_quote' })],
}).primary).toEqual({
  kind: 'quote',
  jobId: '00000000-0000-0000-0000-000000000201',
  label: 'Build ticket',
})
```

Also prove:

- an unassigned technician still sees `Claim work` and no quote command;
- a technician assigned to someone else's job receives no quote command;
- advisor/owner/parts pending work says `Build ticket` without changing authority;
- quote-ready technician work stays `Waiting for advisor`, while advisor/owner says `Record approval` and parts says `View quote`;
- two equal best-ranked commands on two different jobs produce `primary: null`, one `primaryGroup` labeled `2 jobs need attention`, and no implicit row-order winner;
- unequal ranks keep the existing winner and never group;
- grouped commands are not duplicated into `secondary`;
- terminal, declined, deferred, hold, handoff, work, payment, and close fixtures remain unchanged.

- [x] **Step 2: Prove RED**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-living-ticket.test.ts tests/unit/shop-os-golden-shop-day.test.ts --maxWorkers=1
```

Expected: new technician quote, label, and tie-group assertions fail against the current projector.

- [x] **Step 3: Implement the narrow public shape**

Use this additive return contract:

```ts
export type LivingTicketCommandGroup = {
  label: string
  commands: LivingTicketCommand[]
}

export type LivingTicketCommands = {
  primary: LivingTicketCommand | null
  primaryGroup: LivingTicketCommandGroup | null
  secondary: LivingTicketCommand[]
}
```

Replace the singular pending-quote projector with job-bound commands:

```ts
function quoteCommands(input: Input, activeJobs: LivingTicketJob[]): RankedCommand[] {
  if (!canBuildQuotes(input.role)) return []

  const buildable = activeJobs.filter((job) => (
    job.approvalState === 'pending_quote'
      && (input.role !== 'tech' || assignmentState(job, input.profileId!) === 'mine')
  ))
  if (buildable.length > 0) {
    return buildable.map((job) => ({
      kind: 'quote',
      jobId: job.id,
      label: 'Build ticket',
      rank: 30,
    }))
  }

  if (input.role === 'tech') return []
  // Preserve the current ticket-level Record approval / View quote projection.
}
```

After the existing numeric sort, group only when two or more best-ranked commands all carry distinct `jobId` values. The group label is `${count} jobs need attention`. Do not persist a selection and do not change rank values or add a secondary sort that silently chooses a job.

- [x] **Step 4: Prove GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-living-ticket.test.ts tests/unit/shop-os-golden-shop-day.test.ts --maxWorkers=1
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: focused projector tests, TypeScript, and diff checks pass.

Commit:

```bash
LIVING_RO_AUTHOR_NAME=$(git config user.name)
LIVING_RO_AUTHOR_EMAIL=$(git config user.email)
test -n "$LIVING_RO_AUTHOR_EMAIL"
git add lib/shop-os/living-ticket.ts tests/unit/shop-os-living-ticket.test.ts tests/unit/shop-os-golden-shop-day.test.ts
git commit -m "feat: project shared ticket building" \
  --trailer "Co-authored-by: ${LIVING_RO_AUTHOR_NAME} <${LIVING_RO_AUTHOR_EMAIL}>" \
  --trailer "Signed-off-by: ${LIVING_RO_AUTHOR_NAME} <${LIVING_RO_AUTHOR_EMAIL}>"
```

---

### Task 2: Enforce job-bound quote authority at the server boundary

**Files:**
- Modify: `lib/shop-os/capabilities.ts`
- Modify: `lib/shop-os/quotes.ts`
- Modify: `lib/shop-os/parts-offers.ts`
- Modify: `lib/shop-os/quote-builder-ui.ts`
- Modify: `components/screens/manual-quote-builder.tsx`
- Modify: `components/screens/quote-commitment-panel.tsx`
- Modify: `tests/unit/shop-os-quote-drafts.test.ts`
- Modify: `tests/unit/shop-os-manual-offers.test.ts`
- Modify: `tests/unit/shop-os-quote-versions.test.ts`
- Modify: `tests/unit/shop-os-quote-builder.test.ts`
- Modify: `tests/unit/shop-os-quote-builder-ui.test.ts`
- Modify: `tests/unit/shop-os-quote-routes.test.ts`
- Modify: `tests/unit/shop-os-manual-offer-routes.test.ts`
- Modify: `tests/unit/shop-os-quote-page.test.tsx`
- Modify: `tests/unit/shop-os-manual-quote-builder.test.tsx`
- Modify: `tests/unit/shop-os-quote-commitment-panel.test.tsx`

**Interfaces:**
- Produces: pure `canEditQuoteJob(role, actorId, assignedTechId)` and `canPrepareQuotes(role)` capability checks.
- Produces: strict `jobs[].canEdit` and `capabilities.canPrepareQuote` projection fields.
- Enforces: the same job-bound decision after the ticket, all jobs, active versions, and actor are locked.
- Preserves: all existing routes and payloads, tenant hiding through `not_found`, advisor/parts/owner quote authority, quote math, version fingerprinting, and customer-decision authority.

- [x] **Step 1: Write RED domain and projection tests**

Use two active `pending_quote` jobs on one ticket: one assigned to the technician actor and one assigned to another technician. Prove:

- `getQuoteBuilder` returns both jobs in server order so mixed-job truth remains visible;
- the technician's assigned job has `canEdit: true`, the other job has `canEdit: false`, and `canPrepareQuote: false`;
- advisor, parts, and owner receive `canEdit: true` for both jobs and `canPrepareQuote: true`;
- an unassigned, done, canceled, quote-ready, sent, approved, declined, or deferred technician job is not editable;
- direct technician create/replace/delete line calls on the other job return `not_found` without changing a line or invalidating a version;
- direct technician capture/remove manual-offer calls on the other job return `not_found` without changing a line or invalidating a version;
- the same line and sourcing mutations succeed on the technician's assigned active pending job;
- advisor/parts/owner keep their current cross-job line and sourcing behavior on active, non-pinned jobs across `pending_quote`, `quote_ready`, `sent`, `approved`, `declined`, and `deferred` states;
- representative advisor/parts/owner edits to a prepared or sent job still invalidate/supersede the active version and reset the included editable jobs exactly through the existing `invalidateActiveQuoteVersion` path;
- a technician's direct `createQuoteVersion` call returns `not_found` before any version or approval-state write;
- advisor/parts/owner can still prepare the exact validated ticket-wide draft;
- role, membership, assignment, approval state, tenant, ticket, and job are re-read under lock so a stale client projection cannot authorize a write;
- the strict parser rejects a missing, extra, or non-boolean job/Prepare capability.

Route tests must preserve the existing 404/409/422 mappings and no-store behavior. The full-page quote test must prove a technician can load the fallback, see all jobs, edit only the assigned job, and cannot see or invoke Prepare.

- [x] **Step 2: Prove RED**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-quote-drafts.test.ts tests/unit/shop-os-manual-offers.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-quote-routes.test.ts tests/unit/shop-os-manual-offer-routes.test.ts tests/unit/shop-os-quote-page.test.tsx tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-quote-commitment-panel.test.tsx --maxWorkers=2
```

Expected: technician cross-job denial, Prepare denial, and strict capability assertions fail against the current ticket-wide authorization.

- [x] **Step 3: Add pure capability checks and strict read truth**

Keep `canBuildQuotes` unchanged as the broad quote read/entry gate. Add pure helpers with these exact semantics:

```ts
export function canEditQuoteJob(
  role: string | null | undefined,
  actorProfileId: string | null | undefined,
  assignedTechId: string | null | undefined,
): boolean {
  if (!isShopRole(role)) return false
  return role !== 'tech'
    || (typeof actorProfileId === 'string' && actorProfileId === assignedTechId)
}

export function canPrepareQuotes(role: string | null | undefined): boolean {
  return role === 'advisor' || role === 'parts' || role === 'owner'
}
```

In `getQuoteBuilder`, derive `jobs[].canEdit` from an explicit role matrix:

- technician: job is active, non-pinned, assigned to this actor, and `approvalState === 'pending_quote'`;
- advisor/parts/owner: preserve today's active, non-pinned editability without adding an approval-state restriction.

Add `capabilities.canPrepareQuote`. Keep every eligible job visible and keep line-level `mutable` as the existing source-integrity fact; UI editability requires both the job and line facts.

Update `quoteBuilderProjectionSchema` as a strict additive contract. Do not infer assignment or role on the client and do not filter another job out of the ticket.

- [x] **Step 4: Reauthorize every covered write under lock**

Extend `lockDraftContext` and `parts-offers.lockContext` job selects with `assignedTechId` and `approvalState`. After locking the actor and jobs, preserve the current active, non-pinned target check for every quote-building role, then add the narrower technician-only requirement: assigned to the fresh actor and still `pending_quote`. Return the existing indistinguishable `not_found` response for unauthorized tenant/job/assignment states.

Do not add an approval-state restriction for advisor/parts/owner. Their existing edit path must still reach `invalidateActiveQuoteVersion` so prepared/sent quote revisions remain possible and auditable.

In `lockVersionContext`, require `canPrepareQuotes(actor.role)` rather than broad `canBuildQuotes(actor.role)`. Keep `loadActiveActor` as the broad persisted-member gate so reads and mutation entry still fail closed, but never treat that broad gate as write authorization.

This first slice does not create job-scoped quote versions. Technicians build their assigned job; advisor/parts/owner perform the existing ticket-wide Prepare after reviewing the combined ticket. Do not change `createAdHocJob`, canned-job, supplemental-diagnostic-time, or story contracts in this slice; their controls remain governed by their existing domains and the `Add work` disclosure.

- [x] **Step 5: Make every UI path consume server truth**

In the mounted and full-page `ManualQuoteBuilder`, disable or omit Add part/labor/fee, edit/remove, and manual sourcing controls when `job.canEdit` is false. Omit the Prepare action unless `builder.capabilities.canPrepareQuote` is true. Read-only jobs must still show title, approval/work truth, saved lines, source provenance, and totals.

Do not rely on hidden controls as authority. Domain tests in this task are the enforcement proof; component/full-page tests are the affordance proof.

- [x] **Step 6: Prove GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-quote-drafts.test.ts tests/unit/shop-os-manual-offers.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-quote-routes.test.ts tests/unit/shop-os-manual-offer-routes.test.ts tests/unit/shop-os-quote-page.test.tsx tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-quote-commitment-panel.test.tsx --maxWorkers=2
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: direct-domain authorization, strict projection, route mapping, full-page fallback, TypeScript, and diff checks pass.

Commit:

```bash
LIVING_RO_AUTHOR_NAME=$(git config user.name)
LIVING_RO_AUTHOR_EMAIL=$(git config user.email)
test -n "$LIVING_RO_AUTHOR_EMAIL"
git add lib/shop-os/capabilities.ts lib/shop-os/quotes.ts lib/shop-os/parts-offers.ts lib/shop-os/quote-builder-ui.ts components/screens/manual-quote-builder.tsx components/screens/quote-commitment-panel.tsx tests/unit/shop-os-quote-drafts.test.ts tests/unit/shop-os-manual-offers.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-quote-routes.test.ts tests/unit/shop-os-manual-offer-routes.test.ts tests/unit/shop-os-quote-page.test.tsx tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-quote-commitment-panel.test.tsx
git commit -m "fix: enforce assigned quote building" \
  --trailer "Co-authored-by: ${LIVING_RO_AUTHOR_NAME} <${LIVING_RO_AUTHOR_EMAIL}>" \
  --trailer "Signed-off-by: ${LIVING_RO_AUTHOR_NAME} <${LIVING_RO_AUTHOR_EMAIL}>"
```

---

### Task 3: Make one job own the mounted ticket-building workspace

**Files:**
- Modify: `components/screens/ticket-detail.tsx`
- Modify: `components/screens/ticket-detail.module.css`
- Modify: `components/screens/inline-quote-workspace.tsx`
- Modify: `tests/unit/shop-os-ticket-detail.test.tsx`
- Modify: `tests/unit/shop-os-inline-quote-workspace.test.tsx`

**Interfaces:**
- Consumes: `LivingTicketCommands.primaryGroup` from Task 1 and strict job/Prepare capabilities from Task 2.
- Produces: `activeTool: { kind: 'quote'; jobId: string | null }`.
- Produces: optional `focusJobId?: string | null` on `InlineQuoteWorkspace` and `ManualQuoteBuilder`.
- Produces: an explicit stale Customer Copy refresh that uses the existing server action without automatic `router.refresh()`.
- Preserves: one mounted-tool arbitration boundary, strict quote load/retry parsing, close/focus recovery, fail-closed Customer Copy freshness, and the full-page quote fallback.

- [x] **Step 1: Write RED mounted-flow tests**

Extend the component mocks so a quote workspace reports its `focusJobId`. Prove:

```ts
const jobRow = screen.getByRole('heading', { name: 'Diagnose brake vibration' }).closest('li')!
const opener = within(jobRow).getByRole('button', { name: 'Build ticket' })
await user.click(opener)

expect(within(jobRow).getByRole('region', { name: 'Quote for this repair order' }))
  .toHaveAttribute('data-focus-job-id', 'job-1')
expect(screen.queryByRole('button', { name: 'Build ticket' })).toBeNull()
```

Also prove:

- assigned technician, advisor, parts, and owner see the one job-bound entrance;
- an unassigned advisor sees `Assign work` as primary and `Build ticket` only after opening `More`;
- two tied best-ranked jobs initially show only `2 jobs need attention`; selecting one focuses that row and reveals only its existing authorized command;
- the group selection is local, resets when the projected best commands change, and performs no request;
- `More` is closed by default and exposes current secondary controls without changing their authorization;
- opening one tool disables/hides every competing tool without discarding state;
- a quote projection changing `pending_quote → quote_ready` closes the workspace, focuses the remounted job opener/row, updates the stamp to `Priced`, and reprojects `Record approval` for advisor/owner without automatic `router.refresh()`;
- a line-save projection that remains `pending_quote` keeps the workspace open;
- a financial projection closes an open Customer Copy and replaces its disabled `Refreshing…` dead end with an explicit `Refresh customer copy` action;
- the explicit refresh calls `refreshCustomerCopyAction(ticket.id)` once, validates the returned result, installs the fresh local copy, clears stale state, and never navigates;
- refresh failure keeps the stale copy closed, shows a retryable error, and never reopens or prints stale money;
- load failure, malformed projection, retry, close, and direct quote fallback remain intact.

- [x] **Step 2: Prove RED**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-inline-quote-workspace.test.tsx --maxWorkers=1
```

Expected: job ownership, grouping, disclosure, focus job, and prepared settlement assertions fail.

- [x] **Step 3: Compose primary, group, and secondary visibility locally**

Keep command authority in `projectLivingTicketCommands`. Add only local UI state:

```ts
const [selectedPrimaryJobId, setSelectedPrimaryJobId] = useState<string | null>(null)
const [moreOpen, setMoreOpen] = useState(false)
```

Rules:

- no group: render only `commands.primary` as the emphasized command;
- unresolved group: render one 44px `2 jobs need attention` disclosure and outline job choices;
- selected group job: reveal that already-projected command inside its job and close the chooser;
- `More` closed: do not mount `commands.secondary` controls;
- `More` open: mount current secondary controls in their existing job/ticket locations, styled as secondary;
- when command identities change after a server projection, clear a no-longer-valid selection and close stale disclosures.

Use `command.kind + jobId` as a local identity. Never use selection to rewrite job order, command rank, assignment, approval, or work status.

- [x] **Step 4: Mount Build ticket inside its job**

Change quote tools to carry `jobId: string | null`. A job-bound quote opener renders in that job body and passes the ID through `InlineQuoteWorkspace.focusJobId`. Ticket-level `Record approval` / `View quote` may remain at the ticket edge because those actions cover the exact prepared version, not one job.

While a quote workspace is mounted, remove its filled opener from the action set. The workspace's existing safe close/discard behavior remains responsible for leaving; after close, remount and focus the opener. Do not bypass `ManualQuoteBuilder`'s unsaved-draft guard.

- [x] **Step 5: Settle prepared truth and refresh Customer Copy explicitly**

In `applyQuoteProjection`, compare the validated projection with `approvalStateRef`. If any job changes from `pending_quote` to `quote_ready`, apply the projection, close only the active quote tool, and schedule focus to its job row/opener. Do not close for ordinary line saves.

Split the current `invalidateCustomerCopy` behavior:

- `markCustomerCopyStale` closes the preview and marks its local projection stale without calling `router.refresh()`;
- an explicit `Refresh customer copy` control calls the existing `refreshCustomerCopyAction(ticket.id)`, accepts only an `{ ok: true }` result, installs that returned projection in local state, clears stale/error state, and may reopen the preview;
- failure leaves stale money closed and offers retry; printing remains owned by `CustomerCopy.printFreshCopy`, which performs its own fresh server read immediately before `window.print()`;
- correction, payment, close, and quote financial changes all use the same fail-closed stale marker. None automatically navigates or reloads the repair order.

Use a local effective-copy state initialized from the server prop and reset it only when that prop identity changes. Do not fabricate a refreshed copy from quote totals and do not clear stale state on a timer.

- [x] **Step 6: Prove GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-living-ticket.test.ts tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-inline-quote-workspace.test.tsx tests/unit/shop-os-golden-shop-day.test.ts --maxWorkers=2
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: command, mounted-flow, workspace recovery, journey-projection, TypeScript, and diff checks pass.

Commit:

```bash
LIVING_RO_AUTHOR_NAME=$(git config user.name)
LIVING_RO_AUTHOR_EMAIL=$(git config user.email)
test -n "$LIVING_RO_AUTHOR_EMAIL"
git add components/screens/ticket-detail.tsx components/screens/ticket-detail.module.css components/screens/inline-quote-workspace.tsx tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-inline-quote-workspace.test.tsx
git commit -m "feat: mount ticket building in the job" \
  --trailer "Co-authored-by: ${LIVING_RO_AUTHOR_NAME} <${LIVING_RO_AUTHOR_EMAIL}>" \
  --trailer "Signed-off-by: ${LIVING_RO_AUTHOR_NAME} <${LIVING_RO_AUTHOR_EMAIL}>"
```

---

### Task 4: Make the ticket earn its total visibly

**Files:**
- Modify: `components/screens/manual-quote-builder.tsx`
- Modify: `components/screens/manual-quote-builder.module.css`
- Modify: `components/screens/quote-commitment-panel.tsx`
- Modify: `components/screens/manual-part-sourcing.tsx`
- Modify: `components/screens/manual-part-sourcing.module.css`
- Modify: `tests/unit/shop-os-manual-quote-builder.test.tsx`
- Modify: `tests/unit/shop-os-quote-commitment-panel.test.tsx`
- Modify: `tests/unit/shop-os-manual-part-sourcing.test.tsx`

**Interfaces:**
- Consumes: optional `focusJobId` from Task 3 and strict job/Prepare capabilities from Task 2.
- Produces: job-first embedded composition, passive planned-connection truth, and `Add work` disclosure.
- Preserves: `buildManualLineInput`, `summarizeQuoteMoney`, `getQuotePreparationState`, `ManualPartSourcing` math, all fetch routes/payloads, exact refresh validation, prepared-version confirmation, and draft recovery.

- [x] **Step 1: Write RED causal-pricing tests**

Prove an empty builder contains `No quote lines yet` and does not expose `Subtotal`, `Tax`, `Total`, `$0.00`, or `Prepare quote`. Then walk visible inputs:

```ts
await user.click(screen.getByRole('button', { name: 'Add part' }))
await user.type(screen.getByLabelText('Description'), 'Front brake pads')
await user.type(screen.getByLabelText('Quantity'), '1')
await user.type(screen.getByLabelText('Line price'), '140.00')
// save and strict refresh

await user.click(screen.getByRole('button', { name: 'Add labor' }))
await user.type(screen.getByLabelText('Hours'), '1.25')
await user.clear(screen.getByLabelText('Labor rate'))
await user.type(screen.getByLabelText('Labor rate'), '150.00')
```

After validated saves, assert the stored line facts, subtotal, taxable subtotal, tax, and exact total appear in that order. In an advisor/parts/owner fixture, `Prepare quote` then appears from `canPrepareQuote: true`; in a technician fixture the same earned math remains visible but no Prepare control exists. Keep existing tests proving hours × rate and supplier cost × quantity × markup; do not duplicate math in the component.

Also prove:

- embedded heading says `Build ticket`; the URL and server vocabulary remain unchanged;
- `focusJobId` marks/focuses the matching existing job without reordering jobs or hiding mixed-job truth;
- current jobs appear in the DOM before canned work, Add repair, and Add diagnostic time;
- add-more controls are absent until `Add work` is opened, then remain fully functional;
- each current job keeps Add part, Add labor, Add fee, and Source part inside that job;
- a read-only job shows saved lines and totals but mounts no add/edit/remove/source controls;
- the sourcing surface displays a non-interactive `Planned connections · not live` list containing O'Reilly First Call, PartsTech, and RepairLink;
- no planned provider name has button/link/tab semantics and no provider network request occurs;
- existing manual supplier account, supplier cost, quantity, markup-derived customer price, save, retry, and focus behavior remain unchanged;
- quote preparation, job editing, and customer-decision actions consume only their strict server-projection gates.

- [x] **Step 2: Prove RED**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-quote-commitment-panel.test.tsx tests/unit/shop-os-manual-part-sourcing.test.tsx --maxWorkers=1
```

Expected: empty-total suppression, heading, job-first order, Add work disclosure, focus job, and planned-not-live assertions fail.

- [x] **Step 3: Recompose without touching business logic**

In `ManualQuoteBuilder`:

- accept `focusJobId?: string | null`;
- keep `current.jobs` in server order;
- mark the matching row with `data-active-job="true"` and focus it once after the loaded workspace mounts;
- render the current jobs list before all add-more controls;
- place canned work, `AddRepairJob`, and `AddDiagnosticTime` inside one native `details` disclosure whose summary is `Add work`;
- use `Build ticket` for the embedded heading and keep the full-page route as a fallback, not a second workflow;
- do not rename Add part/labor/fee/source or change editor placement, save, recovery, or projection code.

In `QuoteCommitmentPanel`, derive:

```ts
const hasSavedLines = builder.jobs.some((job) => job.lines.length > 0)
```

When there is no active version and `hasSavedLines` is false, render a quiet `No price yet` instruction and no money list, version claim, or primary prepare action. Once a saved line exists, render the existing totals/preparation branches, but pass/render the Prepare control only when `builder.capabilities.canPrepareQuote` is true. A technician receives the exact totals as read truth without a ticket-wide commit action.

- [x] **Step 4: Label future supplier doors without feature theater**

Add one passive block in `ManualPartSourcing`:

```tsx
<aside className={styles.plannedConnections} aria-label="Planned supplier connections, not live">
  <p>Planned connections · not live</p>
  <ul>
    <li>O'Reilly First Call</li>
    <li>PartsTech</li>
    <li>RepairLink</li>
  </ul>
</aside>
```

Do not attach click handlers, `role="button"`, links, focus targets, credentials, provider imports, or network calls. Keep the current manual vendor controls visually dominant.

- [x] **Step 5: Add restrained responsive styling**

Keep the existing Bone/Graphite/Signal tokens. On phone, the active job, its line actions, the causal line facts, and the total stack vertically without horizontal overflow. `Add work` and `More` have 44px summaries. The active job may receive one static signal edge; do not add cards, gradients, glass, role colors, or looping motion. Under reduced motion, preserve state through static border/weight only.

- [x] **Step 6: Prove GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-quote-commitment-panel.test.tsx tests/unit/shop-os-manual-part-sourcing.test.tsx tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-parts-sourcing-ui.test.ts --maxWorkers=2
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: causal presentation, existing math/contracts, TypeScript, and diff checks pass.

Commit:

```bash
LIVING_RO_AUTHOR_NAME=$(git config user.name)
LIVING_RO_AUTHOR_EMAIL=$(git config user.email)
test -n "$LIVING_RO_AUTHOR_EMAIL"
git add components/screens/manual-quote-builder.tsx components/screens/manual-quote-builder.module.css components/screens/quote-commitment-panel.tsx components/screens/manual-part-sourcing.tsx components/screens/manual-part-sourcing.module.css tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-quote-commitment-panel.test.tsx tests/unit/shop-os-manual-part-sourcing.test.tsx
git commit -m "feat: show how the ticket earns its total" \
  --trailer "Co-authored-by: ${LIVING_RO_AUTHOR_NAME} <${LIVING_RO_AUTHOR_EMAIL}>" \
  --trailer "Signed-off-by: ${LIVING_RO_AUTHOR_NAME} <${LIVING_RO_AUTHOR_EMAIL}>"
```

---

### Task 5: Turn the approved proof into real-component acceptance evidence

**Files:**
- Modify: `tests/e2e/living-repair-order-harness/main.tsx`
- Modify: `tests/e2e/living-repair-order-harness/style.css`
- Modify: `tests/e2e/living-repair-order-visual-proof.spec.ts`
- Modify: `playwright.living-repair-order.config.ts`
- Modify: `docs/proofs/2026-08-05-living-repair-order-visual-proof.md`
- Create: `docs/proofs/2026-08-05-living-repair-order-implementation-proof.md`

**Interfaces:**
- Consumes: the production `TicketDetailScreen`, `InlineQuoteWorkspace`, `ManualQuoteBuilder`, `ManualPartSourcing`, and global CSS.
- Produces: deterministic phone/desktop proof of the implemented interaction and a receipt that distinguishes hermetic evidence from authenticated hosted evidence.
- Preserves: the six approved direction images as pre-code artifacts; never rewrite them as post-code proof.

- [x] **Step 1: Add RED browser assertions against real components**

Keep the existing visual direction route. Add an implementation route in the same fail-closed loopback harness that mounts the real `TicketDetailScreen` and intercepts only the existing quote/vendor/canned/manual-line/version endpoints with complete strict projections.

At both 390×844 and 1440×900 prove:

1. technician, advisor, parts, and owner on an assigned one-job pending quote see `Build ticket` inside that job;
2. no price or total exists before a saved line;
3. visible part input creates the exact part line after strict refresh;
4. visible labor hours/rate create the exact labor line after strict refresh;
5. subtotal, taxable subtotal, tax, and total match the fixture math;
6. technician can save exact part/labor lines only on the assigned job, sees the earned total, and has no Prepare action; an advisor/parts/owner fixture sends the exact current draft commitment once;
7. the workspace collapses only after the authorized Prepare response returns `quote_ready`, the job shows `Priced`, and advisor/owner see `Record approval`;
8. Add work and secondary commands stay behind disclosure;
9. a two-job equal-rank fixture shows one grouped choice and no row-order promotion;
10. planned supplier names are passive and no outside-network request occurs;
11. all active targets are at least 44px, focus moves/restores correctly, no horizontal overflow exists, Axe reports zero serious/critical findings, reduced motion remains truthful, and browser faults are empty.

- [x] **Step 2: Prove RED**

Run:

```bash
PLAYWRIGHT_USE_SYSTEM_CHROME=1 pnpm exec playwright test --config=playwright.living-repair-order.config.ts
```

Expected: real-component implementation route or its new assertions fail before Tasks 1–4 are complete.

- [x] **Step 3: Complete the real-component fixture and proof receipt**

Validate every fixture projection with the same exported parsers production uses. Record every request method/path/outcome and assert there are no unhandled requests, duplicate line writes, duplicate Prepare writes, provider requests, navigation to a second workflow page, or production origins. Label this evidence `hermetic real-component proof`, not authenticated production proof.

Keep the pre-code receipt active as design provenance. Write the implementation receipt with source SHA, commands, pass counts, viewport list, exact screenshots, known evidence ceiling, and explicit skipped/failed items.

- [x] **Step 4: Prove GREEN and commit**

Run:

```bash
PLAYWRIGHT_USE_SYSTEM_CHROME=1 pnpm exec playwright test --config=playwright.living-repair-order.config.ts
git diff --check
```

Expected: all applicable phone/desktop journeys pass with intentional viewport skips named, and diff check passes.

Commit:

```bash
LIVING_RO_AUTHOR_NAME=$(git config user.name)
LIVING_RO_AUTHOR_EMAIL=$(git config user.email)
test -n "$LIVING_RO_AUTHOR_EMAIL"
git add tests/e2e/living-repair-order-harness tests/e2e/living-repair-order-visual-proof.spec.ts playwright.living-repair-order.config.ts docs/proofs/2026-08-05-living-repair-order-visual-proof.md docs/proofs/2026-08-05-living-repair-order-implementation-proof.md
git commit -m "test: prove living repair order ticket building" \
  --trailer "Co-authored-by: ${LIVING_RO_AUTHOR_NAME} <${LIVING_RO_AUTHOR_EMAIL}>" \
  --trailer "Signed-off-by: ${LIVING_RO_AUTHOR_NAME} <${LIVING_RO_AUTHOR_EMAIL}>"
```

---

### Task 6: Converge, document, and open the reviewed PR

**Files:**
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Modify if this task discovers a durable correction: `tasks/lessons.md`
- Track: `docs/superpowers/plans/2026-08-05-living-repair-order-ticket-building.md`

**Interfaces:**
- Produces: Row 65 `Living Repair Order: shared ticket building and causal pricing` in the active status table.
- Produces: a current driver-state section with Outcome, Current slice, Last proof, Next safe move, Open gates, Worker lanes, and Stop only when.
- Produces: one PR linked to Buzz channel `95938fc9-02c1-4c1a-8b20-84f540bc6c74`.

- [x] **Step 1: Run focused regression before final review**

Run:

```bash
pnpm exec vitest run tests/unit/shop-os-living-ticket.test.ts tests/unit/shop-os-golden-shop-day.test.ts tests/unit/shop-os-ticket-detail.test.tsx tests/unit/shop-os-inline-quote-workspace.test.tsx tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-quote-commitment-panel.test.tsx tests/unit/shop-os-manual-part-sourcing.test.tsx tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-parts-sourcing-ui.test.ts tests/unit/shop-os-quote-drafts.test.ts tests/unit/shop-os-manual-offers.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-routes.test.ts tests/unit/shop-os-manual-offer-routes.test.ts tests/unit/shop-os-quote-page.test.tsx --maxWorkers=2
PLAYWRIGHT_USE_SYSTEM_CHROME=1 pnpm exec playwright test --config=playwright.living-repair-order.config.ts
pnpm exec tsc --noEmit --pretty false
git diff --check
```

Expected: focused unit/component, real-component browser, TypeScript, and diff checks pass.

- [x] **Step 2: Run independent final review in parallel**

Dispatch three read-only reviewers against the exact head:

- static/product reviewer: command grouping, role clarity, one-action hierarchy, focus, mixed-job behavior, and scope fidelity;
- security reviewer: technician assignment and Prepare enforcement in direct domains, tenant/role hiding, full-page fallback parity, no provider/credential path, no data leakage, strict projection parsing, and no dormant-feature activation;
- runtime reviewer: 390×844/1440×900 causal pricing, Add work/More disclosure, accessibility, overflow, recovery, and settled prepared state.

Batch all Critical/Important findings into one repair set. Apply at most one consolidated repair wave, rerun focused tests, then request one focused re-review. A new unrelated Critical/Important defect after that stops for architecture review.

- [x] **Step 3: Run the full repository gate once after repair**

Run:

```bash
pnpm test
pnpm exec tsc --noEmit --pretty false
pnpm build
PLAYWRIGHT_USE_SYSTEM_CHROME=1 pnpm exec playwright test --config=playwright.living-repair-order.config.ts
git diff --check
git status --short
```

Expected: the full suite, TypeScript, production build, real-component browser proof, diff check, and scoped working tree all pass. Confirm the build route count does not increase.

- [x] **Step 4: Verify scope guards**

Run:

```bash
git diff --name-only origin/main...HEAD
git diff -- drizzle/migrations lib/db/schema.ts app/api package.json pnpm-lock.yaml
rg -n "O'Reilly First Call|PartsTech|RepairLink" components/screens tests/unit tests/e2e
```

Expected: no schema/migration/API-route/dependency diff; the capability/domain diff is limited to existing quote authorization and additive strict projection fields; provider names occur only in passive UI/tests/proof; no connector import, handler, route, link, button, or network call exists.

- [x] **Step 5: Update the active plan and driver receipt**

Add Row 65 only after exact-head verification. Record the tested SHA, focused/full/browser counts, TypeScript/build result, reviewer verdicts, and explicit exclusions. Do not claim authenticated hosted or production proof before it exists. Update `SHOP_OS_DRIVER_STATE.md` with the PR as the next gate, not merge/deploy.

- [x] **Step 6: Self-review and commit documentation**

Search for placeholders and accidental scope:

```bash
rg -n "TODO|TBD|placeholder|magic price|Build price|Price by hand" lib/shop-os/living-ticket.ts components/screens/ticket-detail.tsx components/screens/manual-quote-builder.tsx components/screens/manual-part-sourcing.tsx docs/superpowers/plans/2026-08-05-living-repair-order-ticket-building.md
git diff --check
git status --short
```

Expected: no unowned placeholder or ambiguous action label; only deliberate historical/proof references remain.

Commit using the repository-local identity and required trailers:

```bash
LIVING_RO_AUTHOR_NAME=$(git config user.name)
LIVING_RO_AUTHOR_EMAIL=$(git config user.email)
test -n "$LIVING_RO_AUTHOR_EMAIL"
git add docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md docs/strategy/SHOP_OS_DRIVER_STATE.md docs/superpowers/plans/2026-08-05-living-repair-order-ticket-building.md tasks/lessons.md
git commit -m "docs: record living repair order proof" \
  --trailer "Co-authored-by: ${LIVING_RO_AUTHOR_NAME} <${LIVING_RO_AUTHOR_EMAIL}>" \
  --trailer "Signed-off-by: ${LIVING_RO_AUTHOR_NAME} <${LIVING_RO_AUTHOR_EMAIL}>"
git log -1 --format=full
```

Stop if `git config user.email` is empty. Do not hardcode identity values from this plan.

- [x] **Step 7: Push and open the PR; stop before merge**

Push the exact reviewed branch, open one PR with Buzz channel `95938fc9-02c1-4c1a-8b20-84f540bc6c74`, and report the returned PR link. Wait for hosted checks. Do not merge, deploy, apply migrations, activate flags, use supplier credentials, or mutate production data.

## Acceptance Contract

The implementation is ready for the PR gate only when all of these are true:

- an assigned authorized technician, advisor, parts user, and owner can open `Build ticket` from the correct existing job;
- a technician can mutate only the assigned active pending-quote job through both UI and direct line/manual-sourcing domain calls; another job remains visible read-only and unauthorized calls return `not_found` without writes;
- advisor/parts/owner preserve current revision authority on every active, non-pinned quote state, including prepared/sent work and its existing active-version invalidation;
- assignment/hold/decline/work/payment/close rank above it exactly when the existing projector says they do;
- tied highest-ranked job commands become one truthful local group rather than a stored-row winner;
- the mounted builder shows existing jobs before Add work, and Add work/secondary commands are disclosed on request;
- visible saved part/labor/fee inputs causally precede subtotal, tax, and total; only advisor/parts/owner receive ticket-wide Prepare from strict server truth;
- no empty `$0.00` or magical total appears;
- prepared server truth collapses into `Priced` and reprojects the next role-valid action without navigation or automatic page refresh;
- stale Customer Copy remains closed until an explicit fresh server read succeeds, and print still performs its own fresh read;
- existing money, tenant, decision, strict projection, retry, recovery, deep-link, and manual sourcing contracts pass; the only permission change is the documented technician job boundary and ticket-wide Prepare gate;
- supplier integrations are passive planned text only and make no outside request;
- phone/desktop accessibility, focus, target size, overflow, and reduced-motion checks pass;
- full tests, TypeScript, production build, scoped diff, and independent final reviews pass;
- the PR is open and linked to Buzz, while merge/deploy/activation/production remain untouched.

## Rollback

Revert the presentation commits, additive strict capability fields, authorization hardening, and the additive `primaryGroup` return shape together. Because the slice adds no schema, route, endpoint, dependency, money rule, provider, or persisted stage, rollback returns to the existing ticket-level quote opener and ticket-wide quote behavior without data repair. Preserve any quote lines or versions created during isolated/local tests; production data is never in scope.
