# ShopOS Intent-Aware Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make repair-order intake distinguish diagnosis from known work, seed exact shop-configured scope, preserve customer-supplied-part truth, and show immutable approved scope to the technician.

**Architecture:** Extend the existing canned-job library to hold sessionless diagnostic authorization templates and let Counter Intake copy one selected template atomically. Add one bounded job-level supplied-item note, represent pre-diagnosis approval explicitly inside the immutable quote snapshot, and derive the technician's scope only from that approved snapshot.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Drizzle ORM/PostgreSQL, Zod 4, Vitest/PGlite, Playwright.

## Global Constraints

- Keep AutoEye and every diagnostic-engine entrance disabled.
- Do not add a page, route hierarchy, media field, upload path, dependency, or AI classifier.
- Keep customer, vehicle, ticket, job, and seeded-line creation in one database transaction.
- Never invent diagnostic pricing; fail visibly when the shop has no diagnostic template.
- Derive technician scope from the exact approved quote snapshot, never mutable quote lines.
- Preserve tenant isolation, assignment authorization, immutable approval, and retry behavior.
- Use calm technical product copy, 44px mobile targets, and contained layouts at 390px and 1440px.

---

### Task 1: Durable diagnostic-template and supplied-item truth

**Files:**
- Create: `drizzle/migrations/0048_shop_os_intent_aware_intake.sql`
- Modify: `lib/db/schema.ts`
- Modify: `lib/tickets.ts`
- Modify: `lib/shop-os/canned-jobs.ts`
- Modify: `lib/shop-os/canned-jobs-ui.ts`
- Modify: `components/vt/canned-jobs-section.tsx`
- Modify: `tests/helpers/db.ts`
- Test: `tests/unit/shop-os-quote-foundation-schema.test.ts`
- Test: `tests/unit/shop-os-canned-jobs.test.ts`
- Test: `tests/unit/shop-os-canned-jobs-ui.test.ts`
- Test: `tests/unit/shop-os-canned-job-settings.test.tsx`
- Test: `tests/unit/shop-os-tickets-create.test.ts`

**Interfaces:**
- Produces: canned-job kind `diagnostic`; `ticketJobs.customerSuppliedPartsNote: string | null`; ticket/job projections carrying the note.
- Invariant: diagnostic templates contain at least one labor line and no part lines.

- [x] **Step 1: Write failing schema and domain tests**

Add tests proving the migration drops/recreates `canned_jobs_kind_valid`, adds `ticket_jobs_customer_supplied_parts_note_valid`, diagnostic template creation accepts labor/fee but rejects no-labor or part templates, and ticket creation rejects supplied-item notes on diagnostic jobs.

- [x] **Step 2: Run the focused tests and observe the intended failures**

Run:

```bash
pnpm vitest run tests/unit/shop-os-quote-foundation-schema.test.ts tests/unit/shop-os-canned-jobs.test.ts tests/unit/shop-os-canned-jobs-ui.test.ts tests/unit/shop-os-canned-job-settings.test.tsx tests/unit/shop-os-tickets-create.test.ts --maxWorkers=1 --reporter=dot
```

Expected: failures show `diagnostic` is rejected and the supplied-item field is absent.

- [x] **Step 3: Add the migration and source schema**

Use this migration contract:

```sql
alter table ticket_jobs
  add column customer_supplied_parts_note text;

alter table ticket_jobs
  add constraint ticket_jobs_customer_supplied_parts_note_valid check (
    customer_supplied_parts_note is null
    or (kind in ('repair', 'maintenance')
      and customer_supplied_parts_note = btrim(customer_supplied_parts_note)
      and length(customer_supplied_parts_note) between 1 and 500)
  );

alter table canned_jobs drop constraint canned_jobs_kind_valid;
alter table canned_jobs
  add constraint canned_jobs_kind_valid check (kind in ('diagnostic', 'repair', 'maintenance'));
```

Mirror it in Drizzle and add the bounded optional field to `ticketJobBodySchema`, transaction inserts, and ticket detail projection.

- [x] **Step 4: Extend canned-job contracts and management UI**

Extend every safe kind union to `diagnostic`, add the Diagnostic option to the existing settings editor, and enforce:

```ts
if (body.kind === 'diagnostic'
  && (!body.lines.some((line) => line.kind === 'labor')
    || body.lines.some((line) => line.kind === 'part'))) return null
```

Extend applied canned-job projections to accept diagnostic jobs while leaving Quick Quote filtering to Task 2.

- [x] **Step 5: Run focused tests**

Run the Step 2 command. Expected: all pass.

- [x] **Step 6: Commit the independently testable data contract**

```bash
git add drizzle/migrations/0048_shop_os_intent_aware_intake.sql lib/db/schema.ts lib/tickets.ts lib/shop-os/canned-jobs.ts lib/shop-os/canned-jobs-ui.ts components/vt/canned-jobs-section.tsx tests/unit/shop-os-quote-foundation-schema.test.ts tests/unit/shop-os-canned-jobs.test.ts tests/unit/shop-os-canned-jobs-ui.test.ts tests/unit/shop-os-canned-job-settings.test.tsx tests/unit/shop-os-tickets-create.test.ts
git commit -m "feat(shop-os): add diagnostic intake templates"
```

### Task 2: Intent-aware atomic Counter Intake

**Files:**
- Modify: `lib/intake/counter-ticket.ts`
- Modify: `app/(app)/intake/page.tsx`
- Modify: `components/screens/counter-intake.tsx`
- Modify: `components/screens/counter-intake.module.css`
- Modify: `app/(app)/tickets/new/page.tsx`
- Modify: `components/screens/quick-ticket.tsx`
- Test: `tests/unit/shop-os-counter-ticket.test.ts`
- Test: `tests/unit/counter-intake.test.tsx`
- Test: `tests/unit/intake-page-wiring.test.tsx`
- Test: `tests/unit/shop-os-quick-ticket-ui.test.tsx`

**Interfaces:**
- Consumes: `loadStrictCannedJobCopy`, `cannedJobLineInsertValues`, diagnostic/known canned templates, and `customerSuppliedPartsNote`.
- Produces: a discriminated `work` input with `diagnosis`, `canned`, and `manual` modes.

- [x] **Step 1: Write failing counter-domain tests**

Cover new/existing customers, stale/cross-shop templates, transaction rollback, diagnosis with exact copied labor, known canned work, manual known work, supplied-item note, and rejection of supplied-item truth on diagnosis.

- [x] **Step 2: Replace the ambiguous request shape**

Use this boundary:

```ts
const workSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('diagnosis'), cannedJobId: uuidSchema,
    expectedFingerprint: fingerprintSchema, expectedTaxRateBps: taxRateSchema }),
  z.strictObject({ mode: z.literal('canned'), cannedJobId: uuidSchema,
    expectedFingerprint: fingerprintSchema, expectedTaxRateBps: taxRateSchema,
    customerSuppliedPartsNote: suppliedItemSchema }),
  z.strictObject({ mode: z.literal('manual'), kind: z.enum(['repair', 'maintenance']),
    description: boundedText(200), customerSuppliedPartsNote: suppliedItemSchema }),
])
```

Load template truth before customer mutation, create exactly one matching job, and insert copied lines before the outer transaction commits.

- [x] **Step 3: Wire saved work into the existing intake page**

Load `listCannedJobs` alongside recent customers and team. Pass the privacy-safe templates and tax-rate fingerprint into `CounterIntake`. Filter diagnostic templates out of Quick Quote so it remains known-work-only.

- [x] **Step 4: Replace Work type with one inline decision**

Render `Find the cause` and `Perform known work` as two 44px radio cards. For diagnosis, default to the first sorted diagnostic template and block with a direct configuration message if none exists. For known work, allow saved work or custom work; show one optional `Customer-supplied item` field only there.

- [x] **Step 5: Run focused domain and component tests**

```bash
pnpm vitest run tests/unit/shop-os-counter-ticket.test.ts tests/unit/counter-intake.test.tsx tests/unit/intake-page-wiring.test.tsx tests/unit/shop-os-quick-ticket-ui.test.tsx --maxWorkers=1 --reporter=dot
```

Expected: all pass with exact request envelopes and no full-page transition added.

- [x] **Step 6: Commit the intake flow**

```bash
git add lib/intake/counter-ticket.ts app/'(app)'/intake/page.tsx components/screens/counter-intake.tsx components/screens/counter-intake.module.css app/'(app)'/tickets/new/page.tsx components/screens/quick-ticket.tsx tests/unit/shop-os-counter-ticket.test.ts tests/unit/counter-intake.test.tsx tests/unit/intake-page-wiring.test.tsx tests/unit/shop-os-quick-ticket-ui.test.tsx
git commit -m "feat(shop-os): make intake intent aware"
```

### Task 3: Pre-diagnosis authorization quote contract

**Files:**
- Modify: `lib/shop-os/quote-math.ts`
- Modify: `lib/shop-os/quotes.ts`
- Modify: `lib/shop-os/quote-builder-ui.ts`
- Modify: `components/screens/manual-quote-builder.tsx`
- Test: `tests/unit/shop-os-quote-builder.test.ts`
- Test: `tests/unit/shop-os-quote-versions.test.ts`
- Test: `tests/unit/shop-os-quote-decisions.test.ts`
- Test: `tests/unit/shop-os-quote-builder-ui.test.ts`
- Test: `tests/unit/shop-os-manual-quote-builder.test.tsx`

**Interfaces:**
- Produces: optional snapshot `authorizationPurpose: 'diagnosis'`; builder story mode `authorization_only`.
- Invariant: only a sessionless diagnostic with no story and at least one labor line may use diagnosis authorization.

- [x] **Step 1: Write failing quote-contract tests**

Prove a sessionless diagnostic labor template can prepare a quote without findings, linked diagnostics still fail without reviewed findings, malformed authorization snapshots fail, and started manual diagnostics retain their pinned version.

- [x] **Step 2: Add explicit snapshot truth**

Extend `QuoteSnapshotJobV1` and the strict parser with:

```ts
authorizationPurpose?: 'diagnosis'
customerSuppliedPartsNote?: string | null
```

Require `authorizationPurpose === 'diagnosis'` exactly when a diagnostic snapshot has no story. Require at least one labor line and reject part lines for that authorization.

- [x] **Step 3: Split authorization from findings in the builder**

Project `authorization_only` for an open, sessionless diagnostic with no story. Exclude that mode from the diagnostic-story preparation blocker and render calm read-only copy explaining that findings are recorded after authorized testing.

- [x] **Step 4: Pin started manual diagnosis**

Replace the repair/maintenance-only pinned-work helper with a helper that also recognizes sessionless diagnostic work in progress or done. Use it consistently for version creation, invalidation, approval projection, and builder filtering.

- [x] **Step 5: Run focused quote tests**

```bash
pnpm vitest run tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-quote-decisions.test.ts tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-manual-quote-builder.test.tsx --maxWorkers=1 --reporter=dot
```

Expected: all pass; legacy/linked diagnostic story guards remain green.

- [x] **Step 6: Commit the authorization contract**

```bash
git add lib/shop-os/quote-math.ts lib/shop-os/quotes.ts lib/shop-os/quote-builder-ui.ts components/screens/manual-quote-builder.tsx tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-quote-decisions.test.ts tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-manual-quote-builder.test.tsx
git commit -m "feat(shop-os): separate diagnosis authorization from findings"
```

### Task 4: Immutable approved scope in technician work

**Files:**
- Modify: `lib/shop-os/quotes.ts`
- Modify: `lib/shop-os/simple-work.ts`
- Modify: `lib/shop-os/simple-work-ui.ts`
- Modify: `components/screens/simple-work-workspace.tsx`
- Modify: `components/screens/simple-work-workspace.module.css`
- Test: `tests/unit/shop-os-simple-work.test.ts`
- Test: `tests/unit/shop-os-simple-work-workspace.test.tsx`

**Interfaces:**
- Produces: `readApprovedJobScope(snapshot, jobId)` and workspace `approvedScope` plus `customerSuppliedPartsNote`.
- Invariant: only the exact approved immutable snapshot may populate technician scope.

- [x] **Step 1: Write failing scope tests**

Cover labor hours, part quantity/identity, customer-supplied note, diagnostic purpose, malformed snapshot refusal, superseded approval refusal, and the absence of prices/cost/vendor data.

- [x] **Step 2: Add a strict scope reader**

Return the minimum technician projection:

```ts
type ApprovedJobScope = {
  authorizationPurpose: 'diagnosis' | null
  customerSuppliedPartsNote: string | null
  lines: Array<{
    kind: 'part' | 'labor' | 'fee'
    description: string
    quantity: string
    laborHours: string | null
    partNumber: string | null
    brand: string | null
  }>
}
```

- [x] **Step 3: Project scope from the pinned version**

In `getSimpleWorkWorkspace`, resolve the exact approved version already validated by `hasPinnedApproval`. If its scope cannot be parsed, return a safe conflict instead of mutable lines or an empty ready state.

- [x] **Step 4: Render scope before Clock on**

Add one compact `Approved scope` module directly beneath the work title. Show diagnostic authorization, operations/hours, and customer-supplied truth. Do not render money. Keep the module mounted in open, in-progress, and done states.

- [x] **Step 5: Run focused work tests**

```bash
pnpm vitest run tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-simple-work-workspace.test.tsx --maxWorkers=1 --reporter=dot
```

Expected: all pass; tech cannot start when scope truth is missing or malformed.

- [x] **Step 6: Commit technician scope**

```bash
git add lib/shop-os/quotes.ts lib/shop-os/simple-work.ts lib/shop-os/simple-work-ui.ts components/screens/simple-work-workspace.tsx components/screens/simple-work-workspace.module.css tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-simple-work-workspace.test.tsx
git commit -m "feat(shop-os): show technicians approved work scope"
```

### Task 5: Cross-role release proof and active-plan truth

**Files:**
- Modify: `tests/unit/shop-os-golden-shop-day.test.ts`
- Modify: `tests/e2e/golden-shop-day.spec.ts`
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/flow.md`

**Interfaces:**
- Consumes: all prior contracts.
- Produces: one hermetic advisor → approval → technician proof for diagnosis and one supplied-item known-work proof.

- [x] **Step 1: Expand the hermetic Golden Shop Day**

Add one run that creates a diagnostic authorization from a saved template, verifies its labor before assignment, approves the exact version, and verifies the tech scope before clock-on. Add a known-work case whose customer-supplied note survives the same path.

- [ ] **Step 2: Expand browser assertions without creating retained data**

Exercise the intent control and approved-scope module at phone and desktop widths using the existing synthetic QA provision/cleanup lifecycle. Assert zero horizontal overflow and no serious/critical Axe findings.

- [x] **Step 3: Update durable project truth**

Mark Row 58 complete at PR #193, append the next ShopOS row for intent-aware intake, add its implementation correction, and update `docs/flow.md` with the new two-branch intake/authorization flow.

- [x] **Step 4: Run final focused regression**

```bash
pnpm vitest run tests/unit/shop-os-counter-ticket.test.ts tests/unit/shop-os-canned-jobs.test.ts tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-quote-decisions.test.ts tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-golden-shop-day.test.ts tests/unit/counter-intake.test.tsx tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-simple-work-workspace.test.tsx --maxWorkers=1 --reporter=dot
```

Expected: all pass.

- [ ] **Step 5: Run the repository release gates**

Run the documented serialized Vitest shards, then:

```bash
pnpm exec tsc --noEmit
pnpm build
pnpm test:e2e:golden
git diff --check
```

Expected: all tests and 64-page build pass; synthetic cleanup retains zero operational rows.

- [ ] **Step 6: Review and ship**

Review the complete diff for tenant/authz failures, transaction rollback, malformed snapshot acceptance, engine/media regressions, mobile containment, and unrelated changes. Push the branch, open the PR, wait for required checks, merge only after the migration/application order is safe, deploy, rerun health/authenticated Golden proof, and record exact receipts in the active plan.
