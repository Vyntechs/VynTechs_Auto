# ShopOS Packet A — Continuity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Every code task uses `superpowers:test-driven-development`; every completion claim uses `superpowers:verification-before-completion`.

**Goal:** Build and locally prove the additive schema plus shared lock, revision, signature, and immutable-receipt primitives that every living-repair-order mutation needs, then stop at the named production-DDL gate.

**Architecture:** Keep `tickets` as the visit spine and `ticket_jobs` as independently truthful ordered work. One mutation foundation builds an unconditional preflight set plus a receipt-conditional insert extension, acquires every participating row in one repository-wide order under a runner-owned live transaction capability, captures the sole `ContinuitySignatureV1`, applies domain writes, increments each affected entity exactly once, and writes immutable idempotency receipts last when the route has an actor-bound request key. Migration `0037` stays held and is adopted in PGlite only after the guarded `0036` seam; no runtime declaration may merge or deploy while production lacks the exact DDL.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Drizzle ORM 0.45, PostgreSQL/Supabase, PGlite, Zod 4, Node HMAC-SHA256, Vitest 4.

## Global Constraints

- The founder-approved `docs/superpowers/specs/2026-07-15-shop-os-repair-order-continuity-design.md` and active status table are authoritative.
- Lane `CF` has one implementation writer. Reviewers are read-only. Do not partially publish mixed old/new lock ordering.
- Work from a fresh worktree and branch rooted at the pushed approved-docs commit. Do not reuse a stale main checkout.
- Packet A may create the held migration, runtime declarations, pure primitives, writer retrofits, and local proof. It may not apply production DDL, merge/deploy runtime code, backfill rows, validate legacy constraints, activate approval pairing, enable continuity, clean live data, or mutate production.
- Production-unavailable messaging/order tables remain unread. Diagnostics remain globally unavailable. Operational media remains refused. Do not alter AutoEYE, diagnostic semantics, media/purge paths, pricing, Stripe, provider accounts, or external contracts.
- The exact adaptive mode `state.ts`/`actor.ts` transaction may change only to
  replace its proven session-before-ticket lock inversion with the shared
  lock-only coordinator. Inputs, eligibility, diagnostic state transitions,
  replay response, feature/release/entitlement gates, and engine outputs remain
  behaviorally identical; this is compatibility safety, not a fifth ShopOS
  semantic seam or diagnostic re-enablement.
- Revisions use PostgreSQL `bigint`, Drizzle `{ mode: 'bigint' }`, and decimal-string transport. JavaScript `number` never carries a revision.
- Every current ticket/job/line/version/event writer must use the same profile-first total lock order and revision finalizer before Packet A can be considered locally complete.
- Every participating top-level writer runs through `runBoundedShopOsMutationV1`; no writer owns a private retry loop, unbounded uniqueness wait, or collision recovery.
- Every top-level writer parses, canonicalizes, and takes an owned deep copy of
  request/domain input before its first async preflight. Caller-owned objects,
  arrays, maps, and typed bytes never remain mutable across discovery/provider/
  lock seams.
- A logical transaction increments each affected job once and its parent projection once. Continuity increments once only when the sole canonical before/after signature differs.
- New tickets/jobs begin at revision `1`; additive defaults remain `0` for legacy rows until a writer touches them.
- `work_statement`, provenance/review fields, sequence numbers, and approval pins remain nullable for legacy compatibility. Packet B owns backfill and non-null coverage; Packet C owns approval-pair activation.
- Receipt rows contain only bounded identifiers, versions, digests, ordinals, and timestamps. They never contain work statements, notes, phone, email, VIN, media, response JSON, or raw candidate payloads.
- The Drizzle journal ends at `0028`; `0029`–`0036` use guarded fixture adoption. Do not rerun the twice-failed generator path, hand-edit historical snapshots, or register `0037` ahead of those migrations. Historical metadata repair is separate scope.
- Packet A adds a lifecycle-column trigger, not a full-row terminal `CHECK`: unrelated revision updates must remain safe for unclassified legacy terminal rows. Full check creation/validation waits for privacy-minimized classification and separate data authority.
- Every commit is independently reviewable. Focused tests must be green before the next task.

## Exact File Map

### Create

- `drizzle/migrations/0037_shop_os_continuity_foundation.sql`
- `lib/shop-os/continuity/mutation-foundation/contracts.ts`
- `lib/shop-os/continuity/mutation-foundation/keyring.ts`
- `lib/shop-os/continuity/mutation-foundation/keyring.server.ts`
- `lib/shop-os/continuity/mutation-foundation/ticket-origin.server.ts`
- `lib/shop-os/continuity/mutation-foundation/canonical.ts`
- `lib/shop-os/continuity/mutation-foundation/continuity-signature.ts`
- `lib/shop-os/continuity/mutation-foundation/conflicts.ts`
- `lib/shop-os/continuity/mutation-foundation/attempt-capability.ts`
- `lib/shop-os/continuity/mutation-foundation/lock-order.ts`
- `lib/shop-os/continuity/mutation-foundation/transaction-runner.ts`
- `lib/shop-os/continuity/mutation-foundation/revisions.ts`
- `lib/shop-os/continuity/mutation-foundation/receipts.ts`
- `lib/shop-os/continuity/mutation-foundation/writer-inventory.ts`
- `lib/shop-os/continuity/mutation-foundation/index.ts`
- `lib/intake/quick-ticket-contracts.ts`
- `lib/intake/ticket-identity.ts`
- `tests/unit/shop-os-continuity-schema.test.ts`
- `tests/unit/shop-os-continuity-acl.test.ts`
- `tests/unit/shop-os-continuity-canonical.test.ts`
- `tests/unit/shop-os-continuity-keyring.test.ts`
- `tests/unit/shop-os-continuity-server-boundary.test.ts`
- `tests/unit/shop-os-continuity-signature.test.ts`
- `tests/fixtures/shop-os-keyring-client-boundary/app/layout.tsx`
- `tests/fixtures/shop-os-keyring-client-boundary/app/page.tsx`
- `tests/fixtures/shop-os-keyring-client-boundary/next.config.ts`
- `tests/fixtures/shop-os-keyring-client-boundary/tsconfig.json`
- `tests/helpers/server-only-stub.ts`
- `tests/unit/shop-os-continuity-lock-order.test.ts`
- `tests/unit/shop-os-continuity-revisions.test.ts`
- `tests/unit/shop-os-continuity-receipts.test.ts`
- `tests/unit/shop-os-continuity-writer-inventory.test.ts`
- `tests/unit/shop-os-continuity-cross-writer-races.test.ts`
- `tests/unit/shop-os-ticket-intake-identity.test.ts`
- `tests/helpers/postgres-continuity-db.ts`
- `tests/integration/shop-os-continuity-postgres-races.test.ts`

### Modify

- `.env.example`
- `lib/db/schema.ts`
- `package.json`
- `pnpm-lock.yaml`
- `vitest.config.ts`
- `tests/helpers/db.ts`
- `tests/unit/shop-os-server-only-acl.test.ts`
- `app/api/sessions/route.ts`
- `lib/tickets.ts`
- `lib/intake/counter-ticket.ts`
- `lib/intake/quick-ticket.ts`
- `lib/sessions.ts`
- `lib/curator/deferred-actions.ts`
- `lib/diagnostics/adaptive/state.ts`
- `lib/diagnostics/adaptive/actor.ts`
- `lib/shop-os/canned-jobs.ts`
- `lib/shop-os/customer-stories.ts`
- `lib/shop-os/diagnostic-start.ts`
- `lib/shop-os/parts-offers.ts`
- `lib/shop-os/quotes.ts`
- `lib/shop-os/repair-authorization.ts`
- `lib/shop-os/simple-work.ts`
- `tests/unit/curator-deferred-actions.test.ts`
- `tests/unit/wizard-state-route.test.ts`
- `tests/unit/adaptive-mode-route.test.ts`
- `tests/unit/adaptive-eligibility.test.ts`
- the existing focused writer tests named in Tasks 7–9
- `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- `docs/strategy/SHOP_OS_DRIVER_STATE.md`

### Intentionally unchanged

- every route except the exact Tech Quick replay branch in
  `app/api/sessions/route.ts`, and every UI surface;
- diagnostic-engine modules beyond the four existing ShopOS bridge seams and
  the exact transaction-only adaptive compatibility correction named above;
- media/storage and Row 49 purge code;
- quote-version and quote-event immutable historical bodies;
- legacy `lib/intake/customers.ts` and `lib/intake/vehicles.ts` public upserts,
  retained only for the diagnostics-disabled intake compatibility path;
- migrations `0000`–`0036` and all historical Drizzle metadata;
- production environment, Supabase schema/data, Vercel configuration, and feature flags.

---

### Task 1: Establish the isolated held-release lane and verify its baseline

**Files:**
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`

- [ ] **Step 1: Create the implementation worktree from the pushed approved-docs ref**

Run from the repository root:

```bash
git fetch origin --prune
git merge-base --is-ancestor origin/main docs/repair-order-continuity-spec
git worktree add /Users/brandonnichols/.codex/worktrees/vyntechs-continuity-foundation -b feat/shop-os-continuity-foundation docs/repair-order-continuity-spec
git -C /Users/brandonnichols/.codex/worktrees/vyntechs-continuity-foundation status --short --branch
```

Expected: ancestry exits `0`; the new branch is clean and contains the approved design, active-plan rows, driver state, and this plan. Stop if another active worktree owns any `CF` file.

- [ ] **Step 2: Prove the inherited baseline before adding a RED test**

```bash
pnpm vitest run \
  tests/unit/shop-os-ticket-spine-schema.test.ts \
  tests/unit/shop-os-quote-foundation-schema.test.ts \
  tests/unit/shop-os-tickets-create.test.ts \
  tests/unit/shop-os-job-assignment.test.ts
```

Expected: all inherited tests PASS. Record any pre-existing failure before code and stop if it prevents an attributable RED/GREEN cycle.

- [ ] **Step 3: Record the active implementation lane**

```bash
git add docs/strategy/SHOP_OS_DRIVER_STATE.md
git commit -m "docs: activate ShopOS continuity foundation lane"
```

Each following code task writes only its own compile-safe failing tests, runs them to an assertion-level RED, implements the smallest passing behavior, and reruns GREEN before commit. Missing-module collection failures never count as RED.

---

### Task 2: Add the held additive migration, runtime declarations, and guarded PGlite adoption

**Files:**
- Create: `drizzle/migrations/0037_shop_os_continuity_foundation.sql`
- Modify: `lib/db/schema.ts`
- Modify: `tests/helpers/db.ts`
- Create: `tests/unit/shop-os-continuity-schema.test.ts`
- Create: `tests/unit/shop-os-continuity-acl.test.ts`
- Modify: `tests/unit/shop-os-server-only-acl.test.ts`

- [ ] **Step 1: Write compile-safe schema/ACL guards and prove assertion-level RED**

Begin both new tests with `readFile()` assertions over existing `lib/db/schema.ts`, the expected `0037` path, and current migration metadata; do not import nonexistent exports. Assert the new table/column/trigger names, no unique open-RO index, no full-row terminal check, and no historical journal edit. Run:

```bash
pnpm vitest run \
  tests/unit/shop-os-continuity-schema.test.ts \
  tests/unit/shop-os-continuity-acl.test.ts
```

Expected: tests collect successfully and FAIL only because `0037` and its declarations are absent. After the first implementation slice exists, extend these same tests with real Drizzle/PGlite behavior before adding each constraint or policy.

- [ ] **Step 2: Declare the additive ticket and job fields**

Define and reuse these exact tuples in `lib/db/schema.ts`; Task 3 imports their
types rather than redeclaring string unions:

```ts
export const SEPARATE_REASONS = [
  'warranty',
  'comeback',
  'different_payer',
  'internal_work',
  'future_or_scheduled_work',
  'fleet_split',
  'other',
] as const
export const CLOSE_DISPOSITIONS = [
  'delivered',
  'customer_declined',
  'no_repair',
  'remote_quote_not_proceeding',
] as const
export const CANCEL_REASON_CODES = [
  'duplicate_created',
  'customer_canceled_before_authorization',
  'administrative_error',
  'other',
] as const
export const STATEMENT_SOURCES = [
  'customer_concern',
  'customer_request',
  'technician_found',
  'advisor_added',
  'shop_internal',
  'legacy_migrated',
] as const
export const STATEMENT_REVIEW_STATES = ['confirmed', 'review_required'] as const
export const CREATOR_PROVENANCE = ['direct', 'ticket_creator_backfill'] as const
export const PART_STATUSES = [
  'proposed',
  'needs_order',
  'ordered',
  'received',
  'installed',
  'returned',
] as const
export const TICKET_MUTATION_KINDS = [
  'create_repair_order',
  'append_work_items',
  'create_separate_repair_order',
  'confirm_legacy_work_statement',
  'deliver_repair_order',
  'close_repair_order',
  'cancel_repair_order',
  'return_job_to_open_queue',
] as const
```

Use these exact logical declarations:

```ts
// tickets
projectionRevision: bigint('projection_revision', { mode: 'bigint' }).default(0n).notNull(),
continuityRevision: bigint('continuity_revision', { mode: 'bigint' }).default(0n).notNull(),
separateFromTicketId: uuid('separate_from_ticket_id'),
separateReason: text('separate_reason', { enum: SEPARATE_REASONS }),
separateReasonNote: text('separate_reason_note'),
closeDisposition: text('close_disposition', { enum: CLOSE_DISPOSITIONS }),
closeNote: text('close_note'),
cancelReasonCode: text('cancel_reason_code', { enum: CANCEL_REASON_CODES }),

// ticket_jobs
sequenceNumber: integer('sequence_number'),
workStatement: text('work_statement'),
statementSource: text('statement_source', { enum: STATEMENT_SOURCES }),
statementReviewState: text('statement_review_state', { enum: STATEMENT_REVIEW_STATES }),
statementConfirmedByProfileId: uuid('statement_confirmed_by_profile_id'),
statementConfirmedAt: timestamp('statement_confirmed_at', { withTimezone: true }),
whenStarted: text('when_started'),
howOften: text('how_often'),
diagnosticAuthorizedCents: bigint('diagnostic_authorized_cents', { mode: 'number' }),
diagnosticAuthorizationNote: text('diagnostic_authorization_note'),
createdByProfileId: uuid('created_by_profile_id'),
creatorProvenance: text('creator_provenance', { enum: CREATOR_PROVENANCE }),
createdFromJobId: uuid('created_from_job_id'),
revision: bigint('revision', { mode: 'bigint' }).default(0n).notNull(),
approvedAuthorizationFingerprint: text('approved_authorization_fingerprint'),
approvedApprovalEventId: uuid('approved_approval_event_id'),
```

`diagnosticAuthorizedCents` remains the existing money representation; only revisions require bigint transport. Add a partial unique index on `(shop_id, ticket_id, sequence_number)` where the sequence is non-null. Use the existing `AnyPgColumn` late-reference pattern for the job-to-approval-event composite FK.

- [ ] **Step 3: Create exact receipt declarations**

```ts
export const ticketMutationReceipts = pgTable('ticket_mutation_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  shopId: uuid('shop_id').notNull(),
  requestKey: uuid('request_key').notNull(),
  mutationSchemaVersion: integer('mutation_schema_version').notNull(),
  fingerprintKeyVersion: integer('fingerprint_key_version').notNull(),
  mutationKind: text('mutation_kind', { enum: TICKET_MUTATION_KINDS }).notNull(),
  actorProfileId: uuid('actor_profile_id').notNull(),
  targetTicketId: uuid('target_ticket_id'),
  targetBindingFingerprint: text('target_binding_fingerprint').notNull(),
  requestFingerprint: text('request_fingerprint').notNull(),
  resultTicketId: uuid('result_ticket_id').notNull(),
  resultJobCount: integer('result_job_count').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex('ticket_mutation_receipts_shop_request_key_uq')
    .on(table.shopId, table.requestKey),
  uniqueIndex('ticket_mutation_receipts_shop_id_uq')
    .on(table.shopId, table.id),
  uniqueIndex('ticket_mutation_receipts_shop_id_result_ticket_count_uq')
    .on(table.shopId, table.id, table.resultTicketId, table.resultJobCount),
  foreignKey({
    name: 'ticket_mutation_receipts_shop_actor_fk',
    columns: [table.shopId, table.actorProfileId],
    foreignColumns: [profiles.shopId, profiles.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'ticket_mutation_receipts_shop_target_ticket_fk',
    columns: [table.shopId, table.targetTicketId],
    foreignColumns: [tickets.shopId, tickets.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'ticket_mutation_receipts_shop_result_ticket_fk',
    columns: [table.shopId, table.resultTicketId],
    foreignColumns: [tickets.shopId, tickets.id],
  }).onDelete('restrict'),
  index('ticket_mutation_receipts_shop_result_created_idx')
    .on(table.shopId, table.resultTicketId, table.createdAt),
  index('ticket_mutation_receipts_shop_target_idx')
    .on(table.shopId, table.targetTicketId),
  index('ticket_mutation_receipts_shop_actor_created_idx')
    .on(table.shopId, table.actorProfileId, table.createdAt),
  check('ticket_mutation_receipts_schema_version_v1', sql`${table.mutationSchemaVersion} = 1`),
  check('ticket_mutation_receipts_key_version_positive', sql`${table.fingerprintKeyVersion} > 0`),
  check('ticket_mutation_receipts_kind_valid', sql`${table.mutationKind} in (${sql.join(TICKET_MUTATION_KINDS.map((kind) => sql`${kind}`), sql`, `)})`),
  check('ticket_mutation_receipts_target_fingerprint_valid', sql`${table.targetBindingFingerprint} ~ '^[0-9a-f]{64}$'`),
  check('ticket_mutation_receipts_request_fingerprint_valid', sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`),
  check('ticket_mutation_receipts_result_count_valid', sql`${table.resultJobCount} between 0 and 25`),
])

export const ticketMutationReceiptJobs = pgTable('ticket_mutation_receipt_jobs', {
  shopId: uuid('shop_id').notNull(),
  receiptId: uuid('receipt_id').notNull(),
  resultTicketId: uuid('result_ticket_id').notNull(),
  resultJobCount: integer('result_job_count').notNull(),
  ordinal: integer('ordinal').notNull(),
  jobId: uuid('job_id').notNull(),
}, (table) => [
  primaryKey({
    name: 'ticket_mutation_receipt_jobs_pk',
    columns: [table.shopId, table.receiptId, table.ordinal],
  }),
  uniqueIndex('ticket_mutation_receipt_jobs_shop_receipt_job_uq')
    .on(table.shopId, table.receiptId, table.jobId),
  foreignKey({
    name: 'ticket_mutation_receipt_jobs_receipt_ticket_fk',
    columns: [table.shopId, table.receiptId, table.resultTicketId, table.resultJobCount],
    foreignColumns: [
      ticketMutationReceipts.shopId,
      ticketMutationReceipts.id,
      ticketMutationReceipts.resultTicketId,
      ticketMutationReceipts.resultJobCount,
    ],
  }).onDelete('restrict'),
  foreignKey({
    name: 'ticket_mutation_receipt_jobs_job_fk',
    columns: [table.shopId, table.resultTicketId, table.jobId],
    foreignColumns: [ticketJobs.shopId, ticketJobs.ticketId, ticketJobs.id],
  }).onDelete('restrict'),
  index('ticket_mutation_receipt_jobs_shop_job_idx')
    .on(table.shopId, table.resultTicketId, table.jobId),
  index('ticket_mutation_receipt_jobs_header_idx')
    .on(table.shopId, table.receiptId, table.resultTicketId, table.resultJobCount),
  check('ticket_mutation_receipt_jobs_ordinal_range', sql`
    ${table.ordinal} >= 0
    and ${table.ordinal} < ${table.resultJobCount}
    and ${table.resultJobCount} between 0 and 25
  `),
])
```

- [ ] **Step 4: Write migration `0037` with exact additive guards**

The SQL must:

1. add all nullable compatibility fields and nonnegative revision defaults;
2. add sequence, enum, bounds, paired-field, tenant, and access-index constraints;
3. add `(shop_id, vehicle_id, status)` without any uniqueness;
4. add `quote_events_shop_ticket_job_id_uq` and the exact job approval-event FK, without requiring the approval triplet yet;
5. add `guard_ticket_terminal_shape()` on `BEFORE INSERT OR UPDATE OF` only the status/cancel/delivery/close/disposition/note columns, so unrelated revision updates on legacy rows do not evaluate terminal shape;
6. protect ticket identity, immutable legacy root, and `separate_*` evidence
   with the one-way reconciliation rule below, and protect work-item sequence
   plus creator/source provenance with its one-way rules;
7. create receipt tables with `result_job_count between 0 and 25`, exact composite FKs, immutable UPDATE/DELETE guards, and deferred completeness checks over `0..count-1`;
8. enable RLS, revoke all privileges from `PUBLIC`, `anon`, `authenticated`, and `service_role`, grant only `SELECT, INSERT` to `service_role`, and create one deny-direct policy per receipt table;
9. set every trigger function `search_path = ''`, keep trusted ownership, and run schema-qualified `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated, service_role` for every exact signature.

The migration must not backfill, validate legacy rows, change existing approval pins, or touch unavailable messaging/order tables.

Use these exact named contracts:

```text
tickets_projection_revision_nonnegative
tickets_continuity_revision_nonnegative
tickets_separate_reason_valid
tickets_separate_evidence_consistent
tickets_separate_from_not_self
tickets_close_disposition_valid
tickets_cancel_reason_code_valid
tickets_canceled_reason_bounded
tickets_close_note_bounded
tickets_shop_separate_from_fk
guard_ticket_terminal_shape()                INSERT or lifecycle-column UPDATE only
tickets_terminal_shape_write                 trigger using the guard above
tickets_shop_vehicle_status_idx              (shop_id, vehicle_id, status)
tickets_shop_separate_from_idx                (shop_id, separate_from_ticket_id) WHERE non-null
guard_ticket_immutable_identity()
tickets_immutable_identity_update

ticket_jobs_sequence_positive
ticket_jobs_shop_ticket_sequence_uq           partial unique WHERE non-null
ticket_jobs_work_statement_bounded            trimmed 1..5000 when non-null
ticket_jobs_statement_source_valid
ticket_jobs_statement_review_state_valid
ticket_jobs_statement_truth_consistent        statement/source/review all null or all non-null
ticket_jobs_statement_confirmation_consistent exact review/source/confirmer truth table below
ticket_jobs_context_bounded                   each trimmed 1..1000 when non-null
ticket_jobs_diagnostic_authorization_consistent cents nonnegative; note trimmed 1..2000 when non-null
ticket_jobs_creator_provenance_consistent     creator/provenance both null or both non-null
ticket_jobs_approved_fingerprint_valid        null or ^v1:[0-9a-f]{64}$
ticket_jobs_revision_nonnegative
ticket_jobs_shop_creator_fk
ticket_jobs_shop_confirmer_fk
ticket_jobs_shop_ticket_created_from_fk
quote_events_shop_ticket_job_id_uq
ticket_jobs_approved_approval_event_fk
ticket_jobs_shop_created_by_idx
ticket_jobs_shop_confirmed_by_idx
ticket_jobs_shop_ticket_created_from_idx
ticket_jobs_shop_ticket_approval_event_idx
guard_ticket_job_immutable_identity()
ticket_jobs_immutable_identity_update
```

`tickets_separate_evidence_consistent` permits either all three fields null or a non-self link plus a listed reason; notes are null or trimmed `1..2000`, and `other` requires one. Every non-null `canceled_reason` and `close_note` is trimmed and bounded `1..2000`; reason `other` and disposition `no_repair` additionally require the applicable note. `guard_ticket_terminal_shape()` enforces actor/timestamp pairs and exact open/closed/canceled field shapes only on insert or a listed lifecycle-column update; `delivered` requires delivery actor/time and other close dispositions forbid them. Once `OLD.status` is `closed` or `canceled`, every lifecycle field and status is immutable; a terminal row cannot reopen, switch terminal state, or rewrite its evidence. Cross-row “all jobs terminal” remains a handler invariant because a row trigger cannot safely query unlocked child rows.

`guard_ticket_immutable_identity()` forbids changes to shop, ticket number,
source, creator, creation time, the legacy root concern/context/diagnostic-fee
summary, and all `separate_*` evidence after insert. It permits only a
`tech_quick` ticket's `(customer_id, vehicle_id)` pair to move once from both
null to both populated during explicit reconciliation; after population the
pair is immutable. It rejects partial pairs, clearing, replacement, and
identity adoption on every other source.

`guard_ticket_job_immutable_identity()` unconditionally forbids UPDATE of a
job's `id`, `shop_id`, `ticket_id`, or `created_at`; a job can never be rekeyed,
moved to another repair order/shop, or retimed after insert. It permits
`sequence_number` to move from null to one positive value during Packet B
backfill and then forbids change or clearing. A job inserted with creator truth
may use only `creator_provenance='direct'`. UPDATE adoption from a null creator
pair requires `creator_provenance='ticket_creator_backfill'` and
`created_by_profile_id` equal to the parent ticket's immutable creator; after
that the pair cannot change or clear. The trigger uses a plain same-shop parent
lookup and acquires no late row lock; compliant backfill already holds the
parent ticket first. Null-to-`direct`, another profile, and every partial pair
fail. `created_from_job_id` is creation-time evidence and may never change after
insert, including null-to-value.

The statement confirmation check allows exactly these compatibility states:

- all statement/source/review/confirmer/time fields null for untouched legacy;
- `legacy_migrated + review_required` with confirmer/time both null;
- deterministic root-associated `legacy_migrated + confirmed` with
  confirmer/time both null;
- non-legacy `confirmed` with confirmer/time both null for direct new truth;
- non-legacy `confirmed` with confirmer/time both populated for an explicit
  human confirmation.

Every partial statement triple or confirmer/time pair fails. `review_required`
never has a confirmer, and a populated confirmer pair is never compatible with
`legacy_migrated`.

- [ ] **Step 5: Add fail-closed PGlite adoption after `0036`**

Expose:

```ts
export async function ensureRepairOrderContinuityMigration(
  client: PGlite,
): Promise<void>
```

`createTestDb()` calls it immediately after `ensureShopEntitlementsMigration()`. Marker inspection covers every new column, named FK/check/index, both tables, RLS/policies, exact effective grants, and every exact trigger function/trigger. Complete state is a no-op; zero state applies `0037`; any partial marker throws `partial repair order continuity schema in ephemeral database`.

- [ ] **Step 6: Prove additive preservation and security**

Tests insert representative populated legacy tickets/jobs/quotes before applying `0037`, then assert every protected preexisting value is byte-for-byte unchanged and new nullable fields remain null. A legacy closed/canceled row lacking new dispositions must accept an isolated projection-revision update; a new invalid terminal row and a lifecycle-column update into an invalid shape must fail. A valid terminal row cannot reopen, switch status, or rewrite actors/timestamps/disposition/reason/note. Direct attempts to rewrite the legacy root or separate evidence, replace/clear a populated customer/vehicle pair, adopt identity on a non-Tech-Quick ticket, rekey a job, move it across ticket or shop, retime `created_at`, reorder a sequenced job, adopt null creator truth as `direct`, use a non-ticket creator for backfill, clear/change populated creator provenance, or change `created_from_job_id` must fail. A Tech Quick null/null identity pair may adopt one valid same-shop customer/vehicle pair exactly once, and a legacy job may adopt only its parent ticket creator with `ticket_creator_backfill`. Assert:

```ts
expect(await hasPrivilege('anon', 'ticket_mutation_receipts', 'SELECT')).toBe(false)
expect(await hasPrivilege('authenticated', 'ticket_mutation_receipt_jobs', 'INSERT')).toBe(false)
expect(await servicePrivileges('ticket_mutation_receipts')).toEqual(['INSERT', 'SELECT'])
expect(await publicFunctionExecutePrivileges()).toEqual([])
await expect(updateReceipt()).rejects.toThrow('immutable_ticket_mutation_receipt')
await expect(deleteReceiptJob()).rejects.toThrow('immutable_ticket_mutation_receipt')
await expect(commitReceiptWithOrdinalGap()).rejects.toThrow('incomplete_ticket_mutation_receipt')
```

Also assert wrong-shop, wrong-ticket, wrong-source-job, wrong-approval-event, and wrong-result-job relationships fail their named composite constraints.

- [ ] **Step 7: Run schema/security proof and commit**

```bash
pnpm vitest run \
  tests/unit/shop-os-continuity-schema.test.ts \
  tests/unit/shop-os-continuity-acl.test.ts \
  tests/unit/shop-os-server-only-acl.test.ts \
  tests/unit/shop-os-ticket-spine-schema.test.ts \
  tests/unit/shop-os-quote-foundation-schema.test.ts
git diff --check
git add drizzle/migrations/0037_shop_os_continuity_foundation.sql lib/db/schema.ts tests/helpers/db.ts tests/unit/shop-os-continuity-schema.test.ts tests/unit/shop-os-continuity-acl.test.ts tests/unit/shop-os-server-only-acl.test.ts
git commit -m "feat: add held ShopOS continuity schema"
```

Expected: all named tests PASS; no historical migration/meta file changes.

---

### Task 3: Implement strict canonicalization, HMAC request identity, and the sole continuity signature

**Files:**
- Create: `lib/shop-os/continuity/mutation-foundation/contracts.ts`
- Create: `lib/shop-os/continuity/mutation-foundation/keyring.ts`
- Create: `lib/shop-os/continuity/mutation-foundation/keyring.server.ts`
- Create: `lib/shop-os/continuity/mutation-foundation/canonical.ts`
- Create: `lib/shop-os/continuity/mutation-foundation/continuity-signature.ts`
- Create: `lib/shop-os/continuity/mutation-foundation/index.ts`
- Create: `tests/unit/shop-os-continuity-canonical.test.ts`
- Create: `tests/unit/shop-os-continuity-keyring.test.ts`
- Create: `tests/unit/shop-os-continuity-server-boundary.test.ts`
- Create: `tests/unit/shop-os-continuity-signature.test.ts`
- Create: `tests/fixtures/shop-os-keyring-client-boundary/app/layout.tsx`
- Create: `tests/fixtures/shop-os-keyring-client-boundary/app/page.tsx`
- Create: `tests/fixtures/shop-os-keyring-client-boundary/next.config.ts`
- Create: `tests/fixtures/shop-os-keyring-client-boundary/tsconfig.json`
- Create: `tests/helpers/server-only-stub.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Write compile-safe canonical/signature guards and prove assertion-level RED**

Create the four tests with source-presence assertions for `contracts.ts`,
`keyring.ts`, `keyring.server.ts`, `canonical.ts`, and
`continuity-signature.ts`; they must collect without importing missing modules
and fail because the files are absent. Once the files exist, replace the
source-presence assertions with behavioral tests before implementing each
function below. The boundary test first asserts that the production loader is
absent and later runs the isolated Next.js client fixture as a negative build
canary.

Install the one mechanical boundary package at its registry-pinned current
version and commit its lockfile:

```bash
pnpm add server-only@0.0.1
```

`vitest.config.ts` maps `server-only` only inside Vitest to the empty
`tests/helpers/server-only-stub.ts` so server modules can be unit-tested in the
Node test runner. That alias is test-only; the real Next build and the negative
client fixture resolve the actual `server-only` package.

- [ ] **Step 2: Define strict transport and canonical contracts**

```ts
export type RevisionDecimal = string & { readonly __revisionDecimal: unique symbol }
export type TicketMutationKind = (typeof TICKET_MUTATION_KINDS)[number]
export const TICKET_CREATING_MUTATION_KINDS_V1 = [
  'create_repair_order',
  'create_separate_repair_order',
] as const
export type TicketOperationOriginV1 =
  | 'counter'
  | 'quick_quote'
  | 'tech_quick'
export type SeparateReason = (typeof SEPARATE_REASONS)[number]
export type CloseDisposition = (typeof CLOSE_DISPOSITIONS)[number]
export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number]
export type PartStatus = (typeof PART_STATUSES)[number]

export type CanonicalValue =
  | null
  | boolean
  | string
  | number
  | readonly CanonicalValue[]
  | Readonly<{ [key: string]: CanonicalValue }>

export type CandidateBindingV1 = Readonly<{
  ticketId: string
  continuityRevision: RevisionDecimal
}>

declare const mutationFingerprintKeyringBrand: unique symbol
export type MutationFingerprintKeyringV1 = Readonly<{
  [mutationFingerprintKeyringBrand]: true
}>

export type CanonicalMutationEnvelopeV1 = Readonly<{
  schemaVersion: 1
  mutationKind: TicketMutationKind
  operationOrigin: TicketOperationOriginV1 | null
  actorProfileId: string
  target: Readonly<Record<string, CanonicalValue>>
  candidates: readonly CandidateBindingV1[]
  payload: Readonly<Record<string, CanonicalValue>>
}>

declare const resolvedTicketCreationBrand: unique symbol
export type ResolvedTicketCreationV1 = Readonly<{
  [resolvedTicketCreationBrand]: true
}>
declare const finalizedTicketCreationBrand: unique symbol
export type FinalizedTicketCreationV1 = Readonly<{
  [finalizedTicketCreationBrand]: true
}>
declare const canonicalQuickReceiptRequestBrand: unique symbol
export type CanonicalQuickReceiptRequestV1 = Readonly<{
  [canonicalQuickReceiptRequestBrand]: true
}>
declare const resolvedTicketIntakeIdentityBrand: unique symbol
export type ResolvedTicketIntakeIdentityV1 = Readonly<{
  [resolvedTicketIntakeIdentityBrand]: true
}>
declare const materializedTicketIntakeIdentityBrand: unique symbol
export type MaterializedTicketIntakeIdentityV1 = Readonly<{
  [materializedTicketIntakeIdentityBrand]: true
}>
declare const resolvedQuickTemplateBrand: unique symbol
export type ResolvedQuickTemplateV1 = Readonly<{
  [resolvedQuickTemplateBrand]: true
}>
declare const resolvedLockedQuickTemplateBrand: unique symbol
export type ResolvedLockedQuickTemplateV1 = Readonly<{
  [resolvedLockedQuickTemplateBrand]: true
}>
export type TicketCreatingEnvelopeBaseV1 = Readonly<
  Omit<CanonicalMutationEnvelopeV1, 'operationOrigin' | 'actorProfileId'>
>

export function parseRevisionDecimal(value: unknown): bigint
export function serializeRevisionDecimal(value: bigint): RevisionDecimal
export function normalizeCandidateBindingsV1(value: readonly CandidateBindingV1[]): readonly CandidateBindingV1[]
export function canonicalJsonV1(value: CanonicalValue): string
export function createCanonicalMutationFingerprintV1(
  envelope: CanonicalMutationEnvelopeV1,
  keyring: MutationFingerprintKeyringV1,
): Readonly<{ keyVersion: number; digest: string }>
export function verifyCanonicalMutationFingerprintV1(
  envelope: CanonicalMutationEnvelopeV1,
  persisted: Readonly<{ keyVersion: number; digest: string }>,
  keyring: MutationFingerprintKeyringV1,
): 'match' | 'mismatch' | 'verification_unavailable'
export function createCanonicalTargetBindingFingerprintV1(
  target: CanonicalMutationEnvelopeV1['target'],
  candidates: CanonicalMutationEnvelopeV1['candidates'],
  keyring: MutationFingerprintKeyringV1,
): Readonly<{ keyVersion: number; digest: string }>
```

`keyring.ts` begins with `import 'server-only'`. It is otherwise deterministic
and environment-independent and owns an opaque handle backed by module-private
`WeakMap` state. It exposes no key collection, iterator, active-version field,
or raw-byte accessor:

```ts
export type MutationFingerprintKeyringEnvV1 = Readonly<{
  SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION?: string
  SHOP_OS_MUTATION_HMAC_KEYS_B64?: string
}>

export function createMutationFingerprintKeyringV1(
  env: MutationFingerprintKeyringEnvV1,
): MutationFingerprintKeyringV1

export function signCanonicalMutationPayloadV1(
  keyring: MutationFingerprintKeyringV1,
  canonicalPayload: string,
): Readonly<{ keyVersion: number; digest: string }>
export function verifyCanonicalMutationPayloadV1(
  keyring: MutationFingerprintKeyringV1,
  keyVersion: number,
  canonicalPayload: string,
  digest: string,
): 'match' | 'mismatch' | 'verification_unavailable'
```

`keyring.server.ts` begins with `import 'server-only'`, is the only module
allowed to read `process.env`, imports the pure factory directly, and exports:

```ts
export function loadMutationFingerprintKeyringFromProcessV1():
  MutationFingerprintKeyringV1
```

The general `mutation-foundation/index.ts` barrel must not export
any value from `keyring.ts`, `keyring.server.ts`, or the process loader.
`MutationFingerprintKeyringV1` is exported type-only from `contracts.ts`.
Production writers import the loader directly from the `.server` module; tests
inject the opaque handle and never mutate `process.env`. The factory and two
low-level HMAC operations are absent from the barrel; `canonical.ts` alone
imports signing/verification directly. The source inventory enforces those
allowlists.

`SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION` is one canonical positive decimal
integer up to `2147483647`. `SHOP_OS_MUTATION_HMAC_KEYS_B64` is an ascending
semicolon-separated list `version:canonicalBase64`, with 1–8 unique versions,
total length at most 4096, and each decoded key 32–64 bytes. The active version
must exist. Whitespace, leading-zero versions, duplicate/out-of-order versions,
noncanonical/invalid base64, extra delimiters, and missing/short/oversized keys
fail with one stable `mutation_keyring_unavailable` error that includes no env
text. The factory copies decoded bytes into private storage and wipes or
abandons parser temporaries; later mutation of input strings, input byte
fixtures, or returned values cannot change a known digest. Low-level
sign/verify helpers remain foundation-internal, obtain a fresh defensive copy
for each HMAC, and expose only `{ keyVersion, digest }` or the three-state
verification result. They never return key bytes. Verification rejects
malformed or non-32-byte digests before comparing fixed-length decoded bytes
with `timingSafeEqual`. The loader never logs, generates a random fallback, or
reuses another provider/service secret.

`.env.example` documents only the two blank variable names and format comments;
it contains no key material. Pure tests inject an env object. Production writers
default to the direct `keyring.server.ts` process-loader import through an
injectable dependency and privacy-map loader failure to their existing
retryable unavailable/conflict envelope.
Configured active plus retained historical keys are a required later runtime-
release gate; Packet A's production-DDL approval alone never authorizes or
changes environment values.

`canonicalJsonV1` accepts only null, booleans, strings, finite safe integers, dense arrays, and own-key plain objects whose prototype is `Object.prototype` or null. Every own string property must be an enumerable data descriptor. It sorts object keys, preserves array order, detects cycles, and rejects undefined, bigint, floats, unsafe numbers, sparse arrays, symbol keys/values, non-enumerable properties, functions, Dates, Maps, Sets, class/prototype instances, accessors, and `__proto__`/`constructor`/`prototype` pollution keys. Revisions and money in mutation envelopes are already normalized strings.

`normalizeCandidateBindingsV1` lowercases ticket UUIDs, parses revision strings, sorts by ticket ID, and rejects duplicate IDs. Candidate permutations therefore fingerprint identically; ordered work-item arrays in `payload` remain order-sensitive.

`operationOrigin` is part of every canonical envelope. It must be non-null when
`mutationKind` belongs to `TICKET_CREATING_MUTATION_KINDS_V1` and null for every
other mutation. Every receipt-bearing initial or explicit-separate creation
derives the value from the locked opaque-origin resolver; no request body or
adapter may supply it. A missing, extra, or mismatched origin is invalid before
HMAC creation or verification. Packet A wires this envelope to Quick Ticket,
the only current ticket creator with an actor-bound client key. Counter and Tech
Quick persist trusted source without inventing a receipt key; Packet D adds the
generic/Counter continuity request keys and consumes this same envelope for
create/append/separate.

`TicketCreatingEnvelopeBaseV1` omits both `operationOrigin` and
`actorProfileId`. Compile-time excess-property and runtime source tests reject
either in a Quick request/base; the resolved envelope builder injects them only
from the private locked origin and `scope.actor.id`.

Use HMAC-SHA256 with domain `vyntechs:ticket-mutation:v1\0`, a positive active
key version, and at least 32 secret bytes per key. New writes use the active
version held only in private state. Replay recomputes with the receipt's stored
version and compares exact decoded digest bytes with `timingSafeEqual`; malformed
length/hex fails before comparison. A missing retired key returns
`verification_unavailable` and the stable domain error
`receipt_verification_unavailable` without a write. Errors never echo inputs or
key material.

Define every writer/lock/signature type in `contracts.ts`; no task may invent an unlisted shape:

```ts
declare const lockedActorBrand: unique symbol
declare const mutationAttemptCapabilityBrand: unique symbol

export type MutationAttemptCapabilityV1 = Readonly<{
  [mutationAttemptCapabilityBrand]: true
}>

export type MutationAttemptContextV1 = Readonly<{
  capability: MutationAttemptCapabilityV1
  ordinal: 1 | 2
  purpose: 'primary' | 'unique_collision_recovery'
}>

export type LockedActiveActorV1 = Readonly<{
  [lockedActorBrand]: true
  id: string
  shopId: string
  role: 'tech' | 'advisor' | 'parts' | 'owner'
  skillTier: 1 | 2 | 3 | null
}>

export type MutationInsertionIntentsV1 = Readonly<{
  sessions: readonly Readonly<{ id: string; shopId: string; techId: string }>[]
  customers: readonly Readonly<{ id: string; shopId: string }>[]
  vehicles: readonly Readonly<{ id: string; customerId: string }>[]
  tickets: readonly string[]
  jobs: readonly Readonly<{ id: string; ticketId: string }>[]
}>

export type MutationLockExtensionV1 = Readonly<{
  lockShop: boolean
  customerIds: readonly string[]
  vehicleIds: readonly string[]
  ticketIds: readonly string[]
  jobIds: readonly string[]
  includeAllJobsForTickets: boolean
  includeAllLinesForJobs: boolean
  includeAllQuoteVersionsForTickets: boolean
  includeAllQuoteEventsForTickets: boolean
  sessionIds: readonly string[]
  sessionEventIds: readonly string[]
  vendorAccountIds: readonly string[]
  cannedJobIds: readonly string[]
  insertionIntents: MutationInsertionIntentsV1
}>

export type NormalizedMutationLockRequestV1 = Readonly<{
  shopId: string
  actorProfileId: string
  profileIds: readonly string[]
  lockShop: boolean
  customerIds: readonly string[]
  vehicleIds: readonly string[]
  ticketIds: readonly string[]
  jobIds: readonly string[]
  includeAllJobsForTickets: boolean
  includeAllLinesForJobs: boolean
  includeAllQuoteVersionsForTickets: boolean
  includeAllQuoteEventsForTickets: boolean
  sessionIds: readonly string[]
  sessionEventIds: readonly string[]
  vendorAccountIds: readonly string[]
  cannedJobIds: readonly string[]
  receiptRequestKey: string | null
  receiptConditionalInsert:
    | null
    | Readonly<{ kind: 'prepared'; extension: MutationLockExtensionV1 }>
    | Readonly<{ kind: 'unavailable' }>
  insertionIntents: MutationInsertionIntentsV1
}>

export type LockedTicketGraphV1 = Readonly<{
  ticket: typeof tickets.$inferSelect
  jobs: readonly (typeof ticketJobs.$inferSelect)[]
  lines: readonly (typeof jobLines.$inferSelect)[]
  versions: readonly (typeof quoteVersions.$inferSelect)[]
  events: readonly (typeof quoteEvents.$inferSelect)[]
}>

export type BuildContinuitySignatureInputV1 = Readonly<{
  graph: LockedTicketGraphV1
  customerBelongsToShop: boolean
  vehicleBelongsToCustomer: boolean
}>

declare const trustedTicketOriginBrand: unique symbol
export type TrustedTicketOriginV1 = Readonly<{
  [trustedTicketOriginBrand]: true
}>

export type NormalizedTicketCreateV1 = Readonly<{
  id: string
  customerId: string | null
  vehicleId: string | null
  concern: string
  whenStarted: string | null
  howOften: string | null
  diagnosticAuthorizedCents: number | null
  diagnosticAuthorizationNote: string | null
}>

export type NormalizedTicketJobCreateV1 = Readonly<{
  id: string
  title: string
  kind: 'diagnostic' | 'repair' | 'maintenance'
  requiredSkillTier: 1 | 2 | 3
  assignedTechId: string | null
  sessionId: string | null
  createdFromJobId: string | null
}>

type NormalizedSeedLineBaseV1 = Readonly<{
  description: string
  sort: number
  priceCents: number
  taxable: boolean
}>

export type NormalizedJobLineCreateV1 =
  | Readonly<NormalizedSeedLineBaseV1 & {
      kind: 'part'
      quantity: number
      partNumber: string | null
      brand: string | null
    }>
  | Readonly<NormalizedSeedLineBaseV1 & {
      kind: 'labor'
      laborHours: number
      laborRateCents: number | null
    }>
  | Readonly<NormalizedSeedLineBaseV1 & {
      kind: 'fee'
    }>
export type CreatedTicketBatchV1 = Readonly<{
  ticketId: string
  jobIds: readonly string[]
}>

export class ShopOsMutationNotFound extends Error {
  readonly code = 'not_found'
}
```

`ShopOsMutationNotFound` has one generic message and no row IDs. Top-level domain adapters map it to their existing privacy-collapsed `not_found` result. `ShopOsMutationConflict` owns drift/contention; unexpected exceptions propagate.

- [ ] **Step 3: Define `ContinuitySignatureV1` exactly once**

```ts
export type ContinuitySignatureV1 = Readonly<{
  schemaVersion: 1
  ticket: Readonly<{
    id: string
    customerId: string | null
    vehicleId: string | null
    reconciliationState: 'reconciled' | 'provisional' | 'inconsistent'
    status: 'open' | 'closed' | 'canceled'
    deliveredAt: string | null
    deliveredByProfileId: string | null
    closedAt: string | null
    closedByProfileId: string | null
    closeDisposition: CloseDisposition | null
    closeNote: string | null
    canceledAt: string | null
    canceledByProfileId: string | null
    cancelReasonCode: CancelReasonCode | null
    canceledReason: string | null
    separateFromTicketId: string | null
    separateReason: SeparateReason | null
    separateReasonNote: string | null
  }>
  jobs: readonly Readonly<{
    id: string
    kind: 'diagnostic' | 'repair' | 'maintenance'
    workStatement: string | null
    statementReviewState: 'confirmed' | 'review_required' | null
    workStatus: 'open' | 'in_progress' | 'blocked' | 'done' | 'canceled'
    approvalState: 'pending_quote' | 'quote_ready' | 'sent' | 'approved' | 'declined'
    approvedAuthorizationFingerprintPresent: boolean
    partStatuses: readonly PartStatus[]
  }>[]
}>
```

Jobs order by non-null `(sequenceNumber,id)` and legacy-null rows last by `(createdAt,id)`. Part lines filter to `kind='part'` and order by `(sort,id)`. Lowercase UUIDs and UTC ISO timestamps are mandatory. The signature excludes title, assignment, claim time, skill tier, notes, story prose, prices, UI state, diagnostic lease/session identifiers, and full fingerprint values.

`reconciliationState` is derived, never accepted from a caller: `provisional`
means a `tech_quick` ticket with both customer and vehicle null; `reconciled`
means both IDs are present and the locked same-shop/customer ownership proofs
are true; every other shape is `inconsistent` and therefore fail-closed.

Expose only:

```ts
export function buildContinuitySignatureV1(input: BuildContinuitySignatureInputV1): ContinuitySignatureV1
export function serializeContinuitySignatureV1(value: ContinuitySignatureV1): string
export function equalContinuitySignatureV1(left: ContinuitySignatureV1, right: ContinuitySignatureV1): boolean
```

- [ ] **Step 4: Prove exact sensitivity and exclusions**

Table-driven tests mutate every included field one at a time and expect inequality. Separate tests mutate every excluded field and expect equality. Include duplicate sort values, legacy-null sequence values, mixed-case UUID input, timestamps with offsets, and input immutability.

Canonical/HMAC tests prove key-order invariance; work-item array-order
sensitivity; candidate permutation invariance and duplicate rejection;
actor/kind/origin/payload/target/candidate/schema/key changes; minimum-key enforcement;
v1 replay after v2 activation; changed payload under v1; missing historical-key
fail-closed behavior; pollution/cycle/accessor rejection; no body/key text in
errors; no input mutation; and no public property, iterator, serialization, or
reflection path that reveals active versions or key bytes.

Keyring-loader tests cover missing/empty input, every grammar/bound/duplicate/
ordering/base64 failure, active-key absence, defensive copying, a valid v1
load, v1 retained after v2 activation, and captured stdout/stderr/error text
without key fragments. They replace every caller-owned env-object property
after handle creation, mutate every returned digest/result object, and prove
the next known digest remains unchanged. No returned value or thrown error may
contain any four-byte key fragment in text, hexadecimal, or base64 form. A
forged or foreign opaque handle fails with the same stable unavailable contract
and reveals no private-state distinction.

`shop-os-continuity-server-boundary.test.ts` proves both `keyring.ts` and
`keyring.server.ts` start with `import 'server-only'`,
`keyring.server.ts` is the only mutation-foundation module reading
`process.env`, and no keyring value is exported from `index.ts`. Its isolated
fixture contains a valid minimal root layout and a Client Component that imports
the actual key-owning `createMutationFingerprintKeyringV1` core directly and
references it as a runtime value so tree-shaking cannot erase the import. The
test runs a bounded
`next build tests/fixtures/shop-os-keyring-client-boundary` and passes only when
compilation fails specifically at that keyring module's
`server-only`/Client Component boundary;
an unrelated configuration, resolution, or TypeScript failure is a test
failure. The fixture writes build output only under its ignored local `.next`
directory, which the test removes in `finally`.

- [ ] **Step 5: Run pure foundation tests and commit**

```bash
pnpm vitest run \
  tests/unit/shop-os-continuity-canonical.test.ts \
  tests/unit/shop-os-continuity-keyring.test.ts \
  tests/unit/shop-os-continuity-server-boundary.test.ts \
  tests/unit/shop-os-continuity-signature.test.ts
pnpm exec tsc --noEmit
git add .env.example package.json pnpm-lock.yaml vitest.config.ts lib/shop-os/continuity/mutation-foundation tests/helpers/server-only-stub.ts tests/unit/shop-os-continuity-canonical.test.ts tests/unit/shop-os-continuity-keyring.test.ts tests/unit/shop-os-continuity-server-boundary.test.ts tests/unit/shop-os-continuity-signature.test.ts tests/fixtures/shop-os-keyring-client-boundary
git commit -m "feat: define continuity identity contracts"
```

Expected: all four test files and TypeScript PASS; the negative fixture build
fails only for the intended server/client boundary.

---

### Task 4: Implement one executable repository lock order and conflict contract

**Files:**
- Create: `lib/shop-os/continuity/mutation-foundation/conflicts.ts`
- Create: `lib/shop-os/continuity/mutation-foundation/attempt-capability.ts`
- Create: `lib/shop-os/continuity/mutation-foundation/lock-order.ts`
- Create: `lib/shop-os/continuity/mutation-foundation/transaction-runner.ts`
- Modify: `lib/shop-os/continuity/mutation-foundation/index.ts`
- Create: `tests/unit/shop-os-continuity-lock-order.test.ts`

- [ ] **Step 1: Write a compile-safe lock-order guard and prove assertion-level RED**

The new test reads current writer sources and asserts that the central module and order constant exist; it collects without importing a missing file and fails on the absent contract. Replace this guard with generated-SQL and behavior tests as the module is implemented.

- [ ] **Step 2: Define the complete preflight and locked-scope interfaces**

```ts
export const REPOSITORY_LOCK_CLASSES_V1 = [
  'profiles',
  'shop',
  'customers',
  'vehicles',
  'tickets',
  'ticket_jobs',
  'job_lines',
  'quote_versions',
  'quote_events',
  'quote_sends_and_orders',
  'sessions',
  'session_events',
  'vendor_accounts',
  'canned_jobs',
  'mutation_receipts',
] as const

export type RepositoryLockClassV1 =
  typeof REPOSITORY_LOCK_CLASSES_V1[number]

export type MutationLockRequestV1 = Readonly<{
  shopId: string
  actorProfileId: string
  profileIds: readonly string[]
  lockShop: boolean
  customerIds: readonly string[]
  vehicleIds: readonly string[]
  ticketIds: readonly string[]
  jobIds: readonly string[]
  includeAllJobsForTickets: boolean
  includeAllLinesForJobs: boolean
  includeAllQuoteVersionsForTickets: boolean
  includeAllQuoteEventsForTickets: boolean
  sessionIds: readonly string[]
  sessionEventIds: readonly string[]
  vendorAccountIds: readonly string[]
  cannedJobIds: readonly string[]
  receiptRequestKey: string | null
  receiptConditionalInsert:
    | null
    | Readonly<{ kind: 'prepared'; extension: MutationLockExtensionV1 }>
    | Readonly<{ kind: 'unavailable' }>
  insertionIntents: MutationInsertionIntentsV1
}>

export type LockedMutationScopeV1 = Readonly<{
  actor: LockedActiveActorV1
  request: NormalizedMutationLockRequestV1
  profiles: readonly (typeof profiles.$inferSelect)[]
  shop: typeof shops.$inferSelect | null
  customers: readonly (typeof customers.$inferSelect)[]
  vehicles: readonly (typeof vehicles.$inferSelect)[]
  tickets: readonly LockedTicketGraphV1[]
  sessions: readonly (typeof sessions.$inferSelect)[]
  sessionEvents: readonly (typeof sessionEvents.$inferSelect)[]
  vendorAccounts: readonly (typeof vendorAccounts.$inferSelect)[]
  cannedJobs: readonly (typeof cannedJobs.$inferSelect)[]
  beforeSignatures: ReadonlyMap<string, ContinuitySignatureV1>
  insertionIntents: NormalizedMutationLockRequestV1['insertionIntents']
  receiptPeek:
    | Readonly<{ kind: 'none' | 'occupied' }>
    | Readonly<{ kind: 'owned'; receiptId: string; resultTicketId: string }>
  receiptConditionalInsertState:
    | 'not_applicable'
    | 'activated'
    | 'suppressed_by_owned_receipt'
    | 'suppressed_by_occupied_receipt'
    | 'unavailable'
}>

export async function lockMutationScopeV1(
  tx: AppDb,
  attempt: MutationAttemptCapabilityV1,
  request: MutationLockRequestV1,
  seams?: Readonly<{ afterClass?: (name: RepositoryLockClassV1) => Promise<void> }>,
): Promise<LockedMutationScopeV1>
```

`attempt-capability.ts` makes transaction ownership executable rather than a
caller convention. It begins with `import 'server-only'`; its constructors and
binders are not barrel exports:

```ts
export function createMutationAttemptCapabilityV1(
  tx: AppDb,
  input: Readonly<{
    ordinal: 1 | 2
    purpose: 'primary' | 'unique_collision_recovery'
  }>,
): MutationAttemptContextV1 // transaction-runner.ts only

export function bindLockedMutationScopeToAttemptV1(
  tx: AppDb,
  capability: MutationAttemptCapabilityV1,
  scope: LockedMutationScopeV1,
): void // lock-order.ts only

export function assertLiveMutationAttemptV1(
  tx: AppDb,
  capability: MutationAttemptCapabilityV1,
): void

export function assertLiveLockedMutationScopeV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
): MutationAttemptCapabilityV1

export function closeMutationAttemptCapabilityV1(
  capability: MutationAttemptCapabilityV1,
): void // transaction-runner.ts finally only
```

Module-private `WeakMap`s bind each capability to the exact `tx` object,
attempt ordinal/purpose, live flag, and—after locking—the exact scope object. The runner
creates one capability inside each fresh transaction before `discover`, passes
the complete `MutationAttemptContextV1` to that attempt's callbacks, and closes
the capability in `finally` before the transaction object can escape. The lock
coordinator first asserts the live `(tx, capability)` pair and binds its returned
scope. Every trusted helper imports the relevant assertion directly rather than
accepting a caller assertion. A forged capability, a capability used with a
different transaction, a scope used before binding, or any scope/handle used
after the attempt closes fails before a query or write. Collision recovery
creates a fresh capability and discovery payload; it never revives attempt
one’s state.

Because the authoritative receipt peek occurs after the profile class,
`MutationLockExtensionV1` deliberately cannot contain profiles. Every possible
participating profile must be discovered in the unconditional base request and
locked before the peek; Packet A's Quick insert has only the actor. Replay needs
no assignee-profile lock because it performs no assignment mutation and returns
assignment IDs only through the separately authorized projection. The source
inventory permits `receiptConditionalInsert` only in Quick Ticket during Packet
A and fails any extension that attempts a completed lock class.

The normalizer rejects a conditional request unless its unconditional
customer/vehicle/ticket/job/session/vendor/template sets and insertion intents
are empty, apart from profile IDs that must be known before the peek. It deep-
copies but does not merge a prepared extension until the authoritative `none`
decision. It rejects duplicate/cross-parent extension intents, a prepared
extension containing an intent bound to a different shop, or any collision
between base and extension.
After the choice it produces one immutable effective request; every remaining
lock query and finalizer reads only that effective copy.

The coordinator lowercases, deduplicates, and UUID-sorts every class itself. `profileIds` must include the actor. Profile/customer/ticket and every composite-capable query is constrained by the request's expected shop; a cross-shop supplied ID is missing rather than locked or disclosed. After acquiring all named same-shop profile rows in sorted order, it re-authorizes the actor against the locked row as same-shop, active, and not deactivated. Each caller performs a non-locking preflight to discover the ticket's customer/vehicle parents plus current assignees, sessions, versions, and configuration IDs; every non-provisional ticket writer therefore locks its customer and vehicle before its ticket. After locks, any referenced ID outside the normalized set is a retryable drift conflict, never a late lock.

Owner/advisor/parts actors retain a null skill tier in the branded token; no
default is invented. Only a tech-only operation narrows `skillTier` to `1|2|3`
after role authorization. Lock and creation tests cover all four roles plus a
null-tier technician refusal.

Insertion intents are registered before any write. Every created
session/customer/vehicle/ticket/job ID must be a unique canonical UUID. A new
session binds the locked shop/technician, a new vehicle binds a locked or
registered customer, and a new job binds a locked or registered ticket.
Registration grants no authority and creates no row. The finalizer rejects
missing, extra, cross-parent, or unregistered inserted rows; only ticket/job
intents participate in revision output.

- [ ] **Step 3: Make contention classification exact and shared**

```ts
export class ShopOsMutationConflict extends Error {
  readonly code = 'mutation_conflict'
  readonly retryable = true
}

export function isRetryableMutationConflict(error: unknown): boolean
```

Only structured SQLSTATE `55P03`, `40001`, and `40P01`, plus the explicit drift class, are retryable. Do not infer from message text. Unexpected errors propagate.

Every existing writer returns its current public conflict envelope, but it must delegate classification to this helper.

- [ ] **Step 4: Add the bounded transaction owner**

```ts
export const MUTATION_LOCK_TIMEOUT_MS_V1 = 250
export const MUTATION_STATEMENT_TIMEOUT_MS_V1 = 5_000
export const MAX_MUTATION_ATTEMPTS_V1 = 2
export const RECOVERABLE_UNIQUE_CONSTRAINTS_V1 = [
  'ticket_mutation_receipts_shop_request_key_uq',
  'sessions_pkey',
] as const
export type RecoverableUniqueConstraintV1 =
  typeof RECOVERABLE_UNIQUE_CONSTRAINTS_V1[number]

export type BoundedMutationDiscoveryV1<TDiscovery> = Readonly<{
  lockRequest: MutationLockRequestV1
  payload: TDiscovery
}>

export type BoundedMutationOperationV1<T, TDiscovery = undefined> = Readonly<{
  discover: (
    tx: AppDb,
    attempt: MutationAttemptContextV1,
  ) => Promise<BoundedMutationDiscoveryV1<TDiscovery>>
  executeLocked: (
    tx: AppDb,
    scope: LockedMutationScopeV1,
    discovery: TDiscovery,
    attempt: MutationAttemptContextV1,
  ) => Promise<T>
  uniqueCollisionRecovery?: Readonly<{
    allowedConstraints: readonly RecoverableUniqueConstraintV1[]
    executeLocked: (
      tx: AppDb,
      scope: LockedMutationScopeV1,
      discovery: TDiscovery,
      attempt: MutationAttemptContextV1,
      constraint: RecoverableUniqueConstraintV1,
    ) => Promise<
      | Readonly<{ kind: 'recovered'; value: T }>
      | Readonly<{ kind: 'unresolved' }>
    >
  }>
}>

export async function runBoundedShopOsMutationV1<T, TDiscovery = undefined>(
  db: AppDb,
  operation: BoundedMutationOperationV1<T, TDiscovery>,
): Promise<T>
```

Each attempt opens a fresh transaction, executes `SET LOCAL lock_timeout = '250ms'` and `SET LOCAL statement_timeout = '5000ms'`, creates its live attempt capability, calls `discover`, acquires the full scope through `lockMutationScopeV1(tx, attempt.capability, ...)`, and only then calls `executeLocked`. The capability closes in a `finally` block on success, rollback, throw, or collision. A structured `55P03`, `40001`, or `40P01` retries once from fresh capability/discovery/authority/locks; exhaustion returns one retryable conflict.

`discover` returns an owned attempt-local payload beside its normalized lock
request. The runner keeps no discovery, scope, handle, or capability outside the
transaction callback and passes that exact payload only to the corresponding
`executeLocked` with the same live attempt context. Identity handles,
preallocated IDs, template copies, and similar preflight state therefore cannot
leak from attempt one into attempt two. Callers without preflight state use the
default `undefined` payload.

A structured `23505` is recoverable only when its exact `constraint` is in
both `RECOVERABLE_UNIQUE_CONSTRAINTS_V1` and that operation's explicit
`allowedConstraints`. The failed transaction first aborts; recovery then opens
one fresh transaction with `purpose='unique_collision_recovery'` and a new
capability, repeats discovery, active authority, and every lock,
and calls only `uniqueCollisionRecovery.executeLocked` with that recovery
attempt's fresh discovery payload/context plus the validated constraint.
`unresolved` rethrows the original database error.
Receipt recovery classifies only the named request-key constraint. Tech Quick
classifies only `sessions_pkey`: an exact same-shop/same-actor/same-input wrapper
returns its current session/ticket/job identity; changed input or an occupied
other actor/shop key returns generic `request key unavailable` without IDs;
still missing is unresolved. Every other uniqueness error and every message-
only spoof propagates. No callback receives an unlocked actor token.

- [ ] **Step 5: Implement sorted `FOR UPDATE NOWAIT` acquisition**

Each existing row class uses `FOR UPDATE NOWAIT`. Ticket/job/line/version/event/session lists explicitly `ORDER BY id`. The shop is locked only when the request says so. Unavailable quote-send/order resources are represented in the order constant but never queried until their schema is verified in later packets.

`lockMutationScopeV1` loads enough ticket/job/part truth to build every before-signature. It verifies tenant/composite ownership after locks and throws only the generic `ShopOsMutationNotFound`, which top-level domain adapters privacy-collapse to their existing `not_found` result.

- [ ] **Step 6: Prove order, drift, retry, and deadlock boundaries**

Tests capture emitted SQL and assert class order, per-class UUID ordering, actor reauthorization after profile locks, shop omission/inclusion, same-shop ownership, and no late lock. Add two-connection probes for:

- two actors assigning each other as targets;
- assignment versus quote decision;
- add-job versus version creation.

PGlite's shared queue is not production row-lock proof, so combine executable queue tests with exact generated-SQL order assertions here and the disposable PostgreSQL suite in Task 10. Prove the 250ms/5s local limits execute before discovery, exactly one fresh retry, authority/discovery repetition, retry exhaustion, operation-scoped exact-constraint recovery for receipt and session keys, unresolved rethrow, and no wait without a timeout. A spoofed message without the SQLSTATE/constraint propagates. Capability regressions cross-wire attempt-one preflight identity, materialized identity, both Quick-template, ticket-creation, and finalized-creation handles plus scopes into attempt two and collision recovery, use them with a different transaction, use an unbound scope, and reuse them after transaction completion. The materialized-identity case writes mileage and then rolls attempt one back before attempting creation in attempt two; direct helper, creation, finalization, receipt-bridge, and envelope-only calls all reject before a query or write.

- [ ] **Step 7: Run lock tests and commit**

```bash
pnpm vitest run tests/unit/shop-os-continuity-lock-order.test.ts
pnpm exec tsc --noEmit
git add lib/shop-os/continuity/mutation-foundation/conflicts.ts lib/shop-os/continuity/mutation-foundation/attempt-capability.ts lib/shop-os/continuity/mutation-foundation/lock-order.ts lib/shop-os/continuity/mutation-foundation/transaction-runner.ts lib/shop-os/continuity/mutation-foundation/index.ts tests/unit/shop-os-continuity-lock-order.test.ts
git commit -m "feat: centralize ShopOS mutation locking"
```

Expected: lock-order tests and TypeScript PASS.

---

### Task 5: Implement atomic job, projection, and continuity revisions

**Files:**
- Create: `lib/shop-os/continuity/mutation-foundation/revisions.ts`
- Modify: `lib/shop-os/continuity/mutation-foundation/index.ts`
- Create: `tests/unit/shop-os-continuity-revisions.test.ts`

- [ ] **Step 1: Write a compile-safe revision guard and prove assertion-level RED**

The test first reads `revisions.ts` by path and fails because it is absent. After creating the module, replace the guard with behavior tests for each finalizer branch before implementing that branch.

- [ ] **Step 2: Define the only revision finalizer**

```ts
export type TicketRevisionDeltaV1 = Readonly<{
  ticketId: string
  createdTicket: boolean
  createdJobIds: readonly string[]
  existingChangedJobIds: readonly string[]
  actorVisibleTicketFieldsChanged: boolean
}>

export type CreatedMutationRowsV1 = Readonly<{
  sessionIds: readonly string[]
  customerIds: readonly string[]
  vehicleIds: readonly string[]
}>

export type FinalizedMutationRevisionsV1 = Readonly<{
  tickets: readonly Readonly<{
    id: string
    projectionRevision: RevisionDecimal
    continuityRevision: RevisionDecimal
    continuityChanged: boolean
  }>[]
  jobs: readonly Readonly<{
    id: string
    revision: RevisionDecimal
  }>[]
}>

export function reserveJobSequencesForInsertionV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  ticketId: string,
  orderedJobIds: readonly string[],
): readonly Readonly<{ jobId: string; sequenceNumber: number }>[]

export async function finalizeMutationRevisionsV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  createdRows: CreatedMutationRowsV1,
  deltas: readonly TicketRevisionDeltaV1[],
  seams?: Readonly<{ afterDomainReload?: () => Promise<void>; afterRevisionWrite?: () => Promise<void> }>,
): Promise<FinalizedMutationRevisionsV1>
```

Run it after all domain writes/approval invalidations and before any shared receipt insertion. Every creation helper reports its session/customer/vehicle IDs in `createdRows` and its ticket/job IDs in the ticket deltas. The finalizer requires a bijection between those reported IDs and the scope's pre-registered insertion intents, validates actual rows and parent bindings, rejects any existing delta outside the locked graph, reloads after-signatures under the still-held transaction, and uses SQL `revision = revision + 1` with compare-and-swap against the locked bigint value. Runtime cannot introspect arbitrary hidden SQL writes, so Task 10's source inventory separately rejects direct creation inserts that bypass these helpers/manifests.

Before any reload or write, the finalizer calls
`assertLiveLockedMutationScopeV1(tx, scope)`. A stale, unbound, or cross-
transaction scope therefore cannot validate created rows or revisions.

`reserveJobSequencesForInsertionV1` is the sole sequence allocator. It directly
asserts the live `(tx, scope)` binding, requires the complete locked child graph
for the ticket, and binds each unique ordered job ID to a same-ticket registered
insertion intent. Its first reserved ordinal is
`max(locked existing job count + earlier reservations,
max(non-null locked/reserved sequence, 0)) + 1`; the remainder are contiguous.
This deliberately reserves the chronological prefix for every legacy null row:
if a legacy ticket has `N` null-sequence jobs, Packet A's first append is
`N+1`, not `1`. New tickets still receive `1..n`. Overflow, incomplete graph,
duplicate/already-reserved/unregistered IDs, a conflicting populated suffix, or
a second inconsistent reservation fails before insert. The finalizer proves
each inserted job's persisted sequence equals its private reservation.

For existing tickets, projection always increments once when either job list is nonempty or actor-visible ticket truth changed. Continuity increments once iff `equalContinuitySignatureV1(before, after)` is false. Each changed existing job increments once. New tickets/jobs are inserted with `1n`, must match their registered intent, and are returned without a second increment.

- [ ] **Step 3: Prove bigint, cardinality, CAS, and rollback behavior**

Tests must cover:

```ts
expect(result.tickets[0].projectionRevision).toBe('9007199254740994')
expect(result.tickets[0].continuityRevision).toBe('9007199254740993')
expect(result.jobs.map((job) => job.revision)).toEqual(['2', '2'])
```

Set persisted revisions beyond `Number.MAX_SAFE_INTEGER`; no code may call `Number()` on them. Prove a registered 25-job new ticket, one-job append, mixed new/existing job changes, missing registered session/customer/vehicle/ticket/job rows, unreported/extra/spoofed IDs for every row type, and cross-parent IDs. A multi-job transaction increments the parent once and each changed child once. Included signature changes increment continuity; assignment, claim timestamp, internal note, story prose, and price-only changes do not. Empty/replay deltas write nothing. CAS drift, injected failure after a domain write, failure during revision writes, and failure immediately after finalization all roll back every domain and revision change.

Sequence tests cover new `1..25`, a legacy ticket with null jobs, repeated
Packet-A append reservations, mixed null/populated suffixes, incomplete child
locks, duplicate IDs, overflow, and rollback. A compatibility simulation then
ranks only the still-null legacy rows by `(created_at,id)` into the unused
`1..N` prefix, validates populated ordinals solely as the exact immutable
`N+1..total` suffix in sequence order, and proves the full graph is contiguous
without rewriting any Packet-A sequence. It does not require transaction-start
timestamps or UUID order to equal serialized append order.

- [ ] **Step 4: Run revision proof and commit**

```bash
pnpm vitest run \
  tests/unit/shop-os-continuity-signature.test.ts \
  tests/unit/shop-os-continuity-lock-order.test.ts \
  tests/unit/shop-os-continuity-revisions.test.ts
pnpm exec tsc --noEmit
git add lib/shop-os/continuity/mutation-foundation/revisions.ts lib/shop-os/continuity/mutation-foundation/index.ts tests/unit/shop-os-continuity-revisions.test.ts
git commit -m "feat: add atomic continuity revisions"
```

Expected: all three files and TypeScript PASS.

---

### Task 6: Implement immutable receipt insertion, collision classification, and replay identity

**Files:**
- Create: `lib/shop-os/continuity/mutation-foundation/receipts.ts`
- Modify: `lib/shop-os/continuity/mutation-foundation/index.ts`
- Create: `tests/unit/shop-os-continuity-receipts.test.ts`

- [ ] **Step 1: Write a compile-safe receipt guard and prove assertion-level RED**

The new test reads the expected receipt module path and migration declaration names without importing missing exports; it fails on absence. Replace it incrementally with behavior tests before implementing each receipt path.

- [ ] **Step 2: Define actor-bound receipt interfaces**

```ts
export type MutationReceiptExpectationV1 = Readonly<{
  requestKey: string
  mutationKind: TicketMutationKind
  mutationSchemaVersion: 1
  targetTicketId: string | null
  envelope: CanonicalMutationEnvelopeV1
}>

export async function hintMutationReceiptPresenceV1(
  tx: AppDb,
  attempt: MutationAttemptCapabilityV1,
  input: Readonly<{ shopId: string; requestKey: string }>,
): Promise<'present' | 'absent'>

export async function peekMutationReceiptV1(
  tx: AppDb,
  attempt: MutationAttemptCapabilityV1,
  actor: LockedActiveActorV1,
  requestKey: string,
): Promise<
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'owned'; receiptId: string; resultTicketId: string }>
  | Readonly<{ kind: 'occupied' }>
>

export async function lockAndClassifyMutationReceiptV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  expected: MutationReceiptExpectationV1,
  keyring: MutationFingerprintKeyringV1,
): Promise<
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'replay'; ticketId: string; jobIds: readonly string[] }>
  | Readonly<{ kind: 'conflict' }>
  | Readonly<{ kind: 'verification_unavailable' }>
>

export async function insertMutationReceiptPrimitiveV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  input: MutationReceiptExpectationV1 & Readonly<{
    keyring: MutationFingerprintKeyringV1
    resultTicketId: string
    resultJobIds: readonly string[]
  }>,
): Promise<Readonly<{ ticketId: string; jobIds: readonly string[] }>>

export function isExactReceiptRequestKeyViolation(error: unknown): boolean
```

`hintMutationReceiptPresenceV1` is an internal, non-authoritative optimization.
It first asserts the live `(tx, attempt)` pair, executes only `SELECT 1` for the already-authenticated profile's derived shop
and normalized key, returns no row, actor, receipt, or result identifier, and
never escapes into an HTTP response or terminal domain decision. Quick calls it
inside every fresh attempt's discovery before any insert-only identity/template
preflight. Its `shopId` comes from a fresh persisted-profile lookup keyed by the
authenticated profile ID—not from the request body or a caller-supplied shop—and
the later locked actor row remains the only authority. The source guard keeps
the hint internal to Quick and rejects returned columns beyond the literal
presence bit.

`peek` is allowlisted only to `lock-order.ts`, asserts that coordinator's same
live attempt capability, and runs only after profile locks and live-actor reauthorization. It derives
shop and actor IDs from the branded token. Another actor's occupied key returns
no receipt/ticket identifier; cross-shop and inactive probes expose nothing.
`lockMutationScopeV1` accepts `receiptRequestKey` and one conditional insert
extension. After the profile class it performs this actor-scoped authoritative
peek, then chooses exactly one path before acquiring any later class:

- `owned`: ignore every insert-only extension and failure reason, non-lockingly
  discover only the immutable receipt result's current customer/vehicle/ticket
  graph, merge that replay graph into the remaining ordered lock classes, set
  `suppressed_by_owned_receipt`, and re-authorize exact replay without current
  intake deduplication or canned-template truth;
- `occupied`: ignore the extension, lock no insert-only resource, set
  `suppressed_by_occupied_receipt`, and return the generic privacy conflict;
- `none + prepared`: normalize and merge the prepared extension before the shop
  and remaining classes, set `activated`, and permit insert mode only after all
  extension resources and intents are locked/validated;
- `none + unavailable`: lock no insert-only resource, set `unavailable`, and let
  Quick throw retryable drift on attempt one. Attempt two maps its private stable
  identity/template failure or returns retry exhaustion; it never creates a row.

The receipt row itself is not locked until the last class. A receipt that appears
between the hint and authoritative peek always wins through `owned`/`occupied`,
and the prepared extension is suppressed. Replays return persisted result
identity only; callers reload a current actor-safe projection.

Receipt classification/insertion independently assert the live `(tx, scope)`
binding and reconstruct `envelope.actorProfileId` from `scope.actor`
before either digest is computed or compared; a caller cannot select or spoof
the actor included in HMAC identity. It enforces non-null
`envelope.operationOrigin` for both ticket-creating mutation kinds and null for
every non-ticket-creating mutation. The low-level insertion primitive is not
exported from the general barrel. For ticket-creating kinds it is callable only
by Task 7's finalized-creation receipt bridge, never by Quick or a later public
adapter; Task 10 rejects any alternate call edge. Classification expectations
are built only after the already-locked opaque-origin resolver returns. Packet
A's Counter and Tech Quick adapters do not construct or insert a shared receipt
because neither current request supplies a shared-receipt key.
Target and candidate IDs must also match the coordinator's locked scope before
classification or insertion.

- [ ] **Step 3: Implement exact match and named-race recovery**

An exact replay derives shop/actor/origin from locked server state and matches
request key, mutation kind, operation origin, schema version, target ticket,
target binding digest, and request digest. It recomputes digests with the stored
historical key version. For either ticket-creating replay kind, the already
locked result ticket's persisted `source` must equal the expected operation
origin before identity is returned. Any semantic difference returns a non-retryable conflict without a
write or identifiers; a missing historical key returns
`receipt_verification_unavailable` without identifying or changing the receipt.

Only structured SQLSTATE `23505` naming `ticket_mutation_receipts_shop_request_key_uq`, explicitly allowlisted by that receipt operation, triggers collision recovery through the named bounded transaction runner in Task 4. Recovery starts a fresh transaction, repeats active authority/full discovery/total locking, and classifies the winner. A different constraint or a spoofed message never replays.

Insert header and ordered `0..n-1` child rows in one transaction. Accept every integer result count from `0` through `25`; reject `26`, duplicate jobs, cross-ticket jobs, and unsorted/corrupt persisted ordinals.

- [ ] **Step 4: Prove privacy, replay, collision, and concurrency**

Tests cover exact `0`, `1`, `2`, `24`, and `25` ordered replay; `26` refusal;
same key in different shops; cross-actor occupied-without-IDs; inactive
authority; changed actor/kind/origin/payload/target/candidate conflict; persisted
result-source mismatch; a synthetic foundation conformance matrix that holds
shop/actor/key/business content constant while changing origin across
`counter`, `quick_quote`, and `tech_quick`, proving conflict without IDs or
writes; exact same-origin Quick replay; v1 replay after v2
activation; missing retired-key verification refusal; corrupted result failure;
one-winner identical races; one-winner/different-payload conflict; stale false-
positive presence hint followed by a fresh attempt that prepares insert mode;
receipt appearance between hint and lock suppressing every insert-only lock;
exact-constraint-only recovery; and rollback between revision finalization and
receipt insert.

Canonical and receipt tables include
`mutationKind='create_separate_repair_order'` with exact same-origin replay plus
missing/changed-origin refusal, proving V1 never needs a schema exception when
Packet D begins creating a justified parallel ticket.

The public identity object must equal:

```ts
{ ticketId: expect.any(String), jobIds: expect.any(Array) }
```

and must not expose shop ID, actor ID, fingerprints, versions, timestamps, or any PII/content.

- [ ] **Step 5: Run receipt/security proof and commit**

```bash
pnpm vitest run \
  tests/unit/shop-os-continuity-schema.test.ts \
  tests/unit/shop-os-continuity-acl.test.ts \
  tests/unit/shop-os-continuity-canonical.test.ts \
  tests/unit/shop-os-continuity-keyring.test.ts \
  tests/unit/shop-os-continuity-receipts.test.ts
pnpm exec tsc --noEmit
git add lib/shop-os/continuity/mutation-foundation/receipts.ts lib/shop-os/continuity/mutation-foundation/index.ts tests/unit/shop-os-continuity-receipts.test.ts
git commit -m "feat: add immutable mutation receipts"
```

Expected: all named tests and TypeScript PASS.

---

### Task 7: Retrofit ticket creation, Counter, Quick Ticket, add-job, and assignment atomically

**Files:**
- Modify: `app/api/sessions/route.ts`
- Modify: `lib/tickets.ts`
- Create: `lib/shop-os/continuity/mutation-foundation/ticket-origin.server.ts`
- Modify: `lib/intake/counter-ticket.ts`
- Create: `lib/intake/quick-ticket-contracts.ts`
- Create: `lib/intake/ticket-identity.ts`
- Modify: `lib/intake/quick-ticket.ts`
- Modify: `lib/sessions.ts`
- Modify: `lib/shop-os/canned-jobs.ts`
- Modify: `tests/unit/shop-os-tickets-create.test.ts`
- Modify: `tests/unit/shop-os-ticket-routes.test.ts`
- Modify: `tests/unit/shop-os-tickets-access.test.ts`
- Modify: `tests/unit/shop-os-counter-ticket.test.ts`
- Create: `tests/unit/shop-os-ticket-intake-identity.test.ts`
- Modify: `tests/unit/shop-os-quick-ticket.test.ts`
- Modify: `tests/unit/shop-os-tech-quick-session.test.ts`
- Modify: `tests/unit/shop-os-tech-quick-route.test.ts`
- Modify: `tests/unit/shop-os-job-assignment.test.ts`
- Modify: `tests/unit/intake-customers.test.ts`
- Modify: `tests/unit/intake-vehicles.test.ts`
- Modify: `tests/unit/intake-session.test.ts`

- [ ] **Step 1: Replace pinned old-order tests with the approved shared order**

Write failing tests that require:

- all participating actor/assignee profiles sorted and locked before the shop/ticket graph;
- allocation paths lock the shop before customer/vehicle/ticket work;
- existing customer/vehicle rows are locked in order and revalidated;
- every created batch receives sequence `1..n`, job revision `1`, and ticket revisions `1`;
- the generic `/api/tickets` body is strict and source-free; attempts to supply
  `counter`, `tech_quick`, or `quick_quote` all return `invalid_input` and
  create no ticket, job, session, line, or receipt;
- only the allowlisted server operation can derive each ticket origin, and a
  Tech Quick origin without the registered session intent plus linked job in the
  same transaction is impossible;
- Counter, Quick, and Tech Quick all persist their trusted origin; Quick alone
  writes the shared HMAC receipt in Packet A, while Counter creates no receipt
  without a client key and Tech Quick keeps exact `sessions_pkey` recovery;
- every new job records the locked actor as immutable creator with
  `creatorProvenance='direct'`; only an explicit found-concern/escalation path
  may set a same-ticket `createdFromJobId`;
- one logical Counter create plus requested service produces one parent revision, not nested bumps;
- every existing-ticket child insert reserves
  `max(locked_job_count, max(non_null_sequence_number, 0)) + 1` from the
  complete locked graph, preserving the `1..legacy_null_count` prefix for
  Packet B's immutable deterministic backfill;
- assignment increments job/projection only and preserves continuity;
- exact receipt-backed Quick Ticket replay re-authorizes, locks its persisted
  result graph, bypasses all mutable customer/vehicle/template insert preflight,
  and performs no line insert or revision bump—even if duplicate natural-key
  rows appeared or the canned template was retired/replaced after success;
  changed payload and a deterministic legacy ticket lacking a receipt conflict
  without IDs;
- Counter and Quick Ticket customer/vehicle discovery is preflight-only through
  one shared identity contract; every existing row appears in the centralized
  lock request and every proposed new row is a registered preallocated intent
  before any insert;
- existing and deduplicated Counter/Quick vehicles apply one exact mileage
  rule under lock: omitted/null preserves, a non-null value replaces only when
  changed, and a new vehicle persists the supplied value or null;
- Tech Quick session creation locks/re-authorizes the actor and shop before any
  session, ticket, or job insert, and an exact completed retry writes and bumps
  nothing;
- the sessions route treats its unlocked completed lookup as a hint only and
  cannot return IDs until a fresh bounded replay transaction has re-authorized
  and locked the exact session/ticket/job graph;
- canned Quick Ticket insert preparation preflights a resolved immutable copy,
  then—only after receipt-none activation—locks and revalidates its template at
  repository class 9 before inserting anything;
- manual Quick Ticket uses the same opaque canonical request/identity/receipt
  chain with no class-9 template lock, derives its job from the private parsed
  description/kind, and replays without duplicate ticket/job/lines;
- Quick discovery performs the non-disclosing receipt-presence hint before
  identity/template work and makes no insert-only failure terminal until the
  authoritative post-profile receipt peek; stale false-positive hints retry from
  fresh discovery, while a receipt appearing after an absent hint suppresses the
  prepared insertion extension;
- Counter-vs-Counter and Counter-vs-Quick races on an existing vehicle, shared
  customer phone, VIN, and plate fallback either reuse one locked identity or
  return a fresh retry with no duplicate customer/vehicle and no unreported
  created row;
- compile-time and runtime seed-line tests reject `id`, `shopId`, `jobId`,
  `source`, `partStatus`, cost/fitment/vendor fields, external offer/snapshot
  evidence, ordered/received actors or timestamps, and created/updated
  timestamps;
- mutating the caller body or seeded-line map after invocation cannot alter the
  locked request, receipt fingerprint, or inserted rows;
- failure after domain write but before finalization leaves no ticket/job/line/revision.

Tech Quick's unlocked completed-wrapper lookup is optimization-only and may
never return a public success. Exact replay always enters the bounded runner,
re-authorizes and locks actor, shop, ticket/job graph, and session in repository
order, then compares current ownership and normalized intake. Tests cover exact
same-actor replay, changed payload, cross-actor and cross-shop occupation,
`sessions_pkey` collision recovery, and spoofed error text in PGlite and real
PostgreSQL.

`findCompletedTechQuickSessionForUser` becomes a hint-only preflight: its
`state='match'` variant carries no session, ticket, or job ID. On that hint the
sessions route calls:

```ts
export async function replayCompletedTechQuickSessionForUser(input: {
  db: AppDb
  userId: string
  body: unknown
}): Promise<
  | Readonly<{ ok: true; id: string; ticketId: string; jobId: string }>
  | Readonly<{ ok: false; status: number; error: string }>
>
```

That function reparses owned input and enters `runBoundedShopOsMutationV1`,
rediscovers without trusting the hint, locks and re-authorizes actor/shop plus
the exact session/ticket/job graph, resolves `tech_quick` from locked persisted
truth, and only then returns actor-safe IDs. The route removes its direct
`preflight.state === 'match'` ID response. Exact retry still bypasses quota,
open-cap, and provider work, but never the locked replay classifier. Changed,
missing, cross-actor, cross-shop, inactive, or malformed replay returns the
existing generic error without IDs or writes. Route tests prove the response
cannot contain a mocked hint ID, and only the locked replay result can produce
success identity.

Run:

```bash
pnpm vitest run \
  tests/unit/shop-os-tickets-create.test.ts \
  tests/unit/shop-os-ticket-routes.test.ts \
  tests/unit/shop-os-tickets-access.test.ts \
  tests/unit/shop-os-counter-ticket.test.ts \
  tests/unit/shop-os-ticket-intake-identity.test.ts \
  tests/unit/shop-os-quick-ticket.test.ts \
  tests/unit/shop-os-tech-quick-session.test.ts \
  tests/unit/shop-os-tech-quick-route.test.ts \
  tests/unit/shop-os-job-assignment.test.ts \
  tests/unit/intake-customers.test.ts \
  tests/unit/intake-vehicles.test.ts \
  tests/unit/intake-session.test.ts
```

Expected: FAIL on old ticket-first/no-revision behavior.

- [ ] **Step 2: Consolidate creation into one in-transaction primitive**

Expose one opaque, transaction-bound creation orchestration in `lib/tickets.ts`.
No adapter receives a resolved source string, and no insert accepts a raw origin:

```ts
type ResolveTicketCreationInputV1 =
  | Readonly<{
      mode: 'insert'
      origin: TrustedTicketOriginV1
      ticket: NormalizedTicketCreateV1
      jobs: readonly NormalizedTicketJobCreateV1[] // 1..25
      seededLinesByJobIndex: ReadonlyMap<
        number,
        readonly NormalizedJobLineCreateV1[]
      >
    }>
  | Readonly<{
      mode: 'intake_insert'
      origin: TrustedTicketOriginV1
      ticket: Omit<NormalizedTicketCreateV1, 'customerId' | 'vehicleId'>
      identity: MaterializedTicketIntakeIdentityV1
      jobs: readonly NormalizedTicketJobCreateV1[] // 1..25
      seededLinesByJobIndex: ReadonlyMap<
        number,
        readonly NormalizedJobLineCreateV1[]
      >
    }>
  | Readonly<{
      mode: 'quick_insert'
      origin: TrustedTicketOriginV1
      identity: MaterializedTicketIntakeIdentityV1
      receipt: CanonicalQuickReceiptRequestV1
      template: ResolvedLockedQuickTemplateV1 | null
    }>
  | Readonly<{
      mode: 'replay'
      origin: TrustedTicketOriginV1
      resultTicketId: string
      receipt: CanonicalQuickReceiptRequestV1
    }>

function resolveTicketCreationInLockedScopeV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  input: ResolveTicketCreationInputV1,
): ResolvedTicketCreationV1

async function insertResolvedTicketBatchInTransactionV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  resolved: ResolvedTicketCreationV1,
): Promise<CreatedTicketBatchV1>

async function finalizeResolvedTicketCreationInTransactionV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  resolved: ResolvedTicketCreationV1,
  deltas: readonly TicketRevisionDeltaV1[],
): Promise<FinalizedTicketCreationV1>

async function insertResolvedTicketCreationReceiptInTransactionV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  finalized: FinalizedTicketCreationV1,
  keyring: MutationFingerprintKeyringV1,
): Promise<Readonly<{ ticketId: string; jobIds: readonly string[] }>>

async function classifyResolvedTicketCreationReceiptInTransactionV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  resolved: ResolvedTicketCreationV1,
  keyring: MutationFingerprintKeyringV1,
): ReturnType<typeof lockAndClassifyMutationReceiptV1>

function readFinalizedTicketCreationResultV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  finalized: FinalizedTicketCreationV1,
): Readonly<{ ticketId: string; jobIds: readonly string[] }>

function buildResolvedTicketCreationEnvelopeV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  resolved: ResolvedTicketCreationV1,
): CanonicalMutationEnvelopeV1
```

`lib/tickets.ts` owns a module-private `WeakMap` for each opaque resolved
handle. Resolution first calls `assertLiveLockedMutationScopeV1(tx, scope)` and
stores that exact live attempt capability with the exact transaction/scope
references. Generic insert mode copies and freezes the normalized ticket,
ordered jobs, and every seeded-line value before returning the handle; it stores the one
origin resolved from that scope. Quick insert and replay accept only
`CanonicalQuickReceiptRequestV1`; the resolver consumes it through the exact
allowlisted contract helper, validates its request key against the private
origin plus `scope.request.receiptRequestKey`, and privately retains its
already-canonical request/base. Neither value is accepted again at
classification or receipt insertion. The insert
helper and envelope helper each
independently reassert the live `(tx, scope)` binding and require the handle's
same capability, transaction, and scope. The insert helper runs once, inserts root
compatibility fields from jobs `[0]` only, persists all jobs in entered order,
writes seeded lines before finalization, and initializes all revisions to `1n`.
Generic insert mode is unavailable to Counter and Quick by source guard.
Intake insert accepts only `MaterializedTicketIntakeIdentityV1`; inside
`resolveTicketCreationInLockedScopeV1`, the creation resolver calls the exact
allowlisted ticket-identity consumer, independently verifies the same live
transaction/scope/capability, injects customer/vehicle IDs privately, and
retains its exact created-row manifest. Quick insert independently verifies the
identity and request handles against the same live transaction, scope, and
attempt capability, then proves the private request's identity/mileage fields
equal the consumed materialized identity. Manual mode requires no template and
derives the normalized job privately. Canned mode additionally requires
`ResolvedLockedQuickTemplateV1`, calls the exact allowlisted canned-job
consumer, and proves its private request fields equal that handle before it
constructs the normalized job and seeded lines. No raw intake identity,
Quick title, kind, tier, tax, fingerprint, seeded-line copy, or created-row
manifest crosses either adapter or enters a raw insert-mode shape.
`finalizeResolvedTicketCreationInTransactionV1` independently validates the
same creation handle and supplies its private created-row manifest to the sole
revision finalizer. Only after that succeeds does it return a second opaque
`FinalizedTicketCreationV1`, privately bound to the same transaction, scope,
capability, resolved handle, exact inserted ticket, ordered inserted jobs, and
final revision result. Counter and Quick cannot pass a caller-shaped manifest.
Counter/Tech Quick may obtain their safe success IDs only through
`readFinalizedTicketCreationResultV1`; receipt-backed Quick may not call that
projection and instead must call
`insertResolvedTicketCreationReceiptInTransactionV1`.

The receipt bridge independently reasserts the finalized handle's exact live
binding, proves its private inserted batch was finalized once, derives the HMAC
envelope plus exact result ticket and complete ordered job IDs from that same
private state, and only then calls Task 6's low-level receipt insertion. It
accepts no caller-supplied result ID or ordinal. A different same-shop ticket,
an omitted/extra/reordered job, a pre-finalization handle, prior-attempt or
collision-recovery handle, another scope/transaction, second insertion, or a
revoked capability fails before receipt query or write.
The classification bridge independently validates the resolved handle, derives
the complete expectation from its private receipt intent plus private origin,
and calls the low-level classifier without exposing the expectation to Quick.
The envelope helper accepts only the same scope/handle, injects the private
resolved origin plus `scope.actor.id`, and is callable only beneath the classification and finalized-
receipt bridges. Counter no longer creates one ticket and then calls a separately
finalized add-job transaction. Tech Quick and Quick Ticket use the same
orchestration.

Replay mode performs no insertion. It requires the result ticket already be in
the locked scope, verifies its persisted source against the server origin, and
stores that one value for the envelope helper. An insert call with a replay
handle, a second insert, a forged handle, a handle from another scope,
transaction, or attempt, a handle retained after transaction completion, a
cross-wired batch/envelope handle, or mutation of any caller-owned input fails
closed before a query, row, or receipt write. Focused tests exercise insert and
envelope helpers independently so envelope-only stale-handle use cannot bypass
the capability check. They prove a receipt-backed Quick
winner uses the same origin for `tickets.source` and HMAC and an exact Quick
replay uses that same persisted origin. Counter and Tech Quick prove trusted
persisted source without constructing an HMAC envelope. Foundation conformance
tests call the envelope builder with all three server-origin handle types so
Packet D can adopt them without a schema exception; no adapter can construct a
second source.

`ticket-origin.server.ts` begins with `import 'server-only'` and keeps each
opaque origin's private state in a module-local `WeakMap`. It exports three
named factories plus one resolver used only by `lib/tickets.ts`:

```ts
export function createCounterTicketOriginV1(): TrustedTicketOriginV1
export function createTechQuickTicketOriginV1(
  sessionId: string,
): TrustedTicketOriginV1
export function createQuickTicketOriginV1(
  requestKey: string,
): TrustedTicketOriginV1
```

The source inventory mechanically allowlists factory call sites:
`createCounterTicketOriginV1` only inside the generic/Counter orchestration,
`createTechQuickTicketOriginV1` only inside `createSessionForUser`, and
`createQuickTicketOriginV1` only inside `createQuickTicket`. Neither this module,
its resolver, nor any origin factory is exported by `index.ts`. The generic
`createTicketBodySchema` has no `source` property and derives Counter origin
after strict parsing; therefore every supplied source discriminator, including
`counter`, is rejected instead of ignored.

`createTechQuickTicketInTransaction` no longer constructs or accepts a raw
source. It requires the opaque origin produced by `createSessionForUser`, and
the source inventory permits exactly that one call site. Direct imports,
alternate callers, or an unbound origin fail the static guard or the locked
runtime resolver.

The private origin resolver receives the locked scope and normalized batch, not
merely the origin handle. It is imported only by `lib/tickets.ts`; every other
writer can call only the opaque orchestration above. Counter resolves to
`counter`. Quick Ticket resolves to
`quick_quote` only when its private request key equals the normalized
`receiptRequestKey` in the locked scope. Tech Quick resolves to `tech_quick`
only when its private session ID exactly matches one registered session
insertion intent for the locked shop and actor, the batch contains exactly one
job linked to that session, and the session plus ticket/job batch are inserted
in the same top-level transaction. Missing, duplicate, changed, cross-actor, or
cross-shop bindings fail before any insert.

For exact Tech Quick replay, no insertion is attempted: the fresh scope instead
contains the locked existing session and result graph, and the resolver requires
the same actor/shop, normalized intake, one persisted linked job, and
`tickets.source='tech_quick'` before returning the origin. The registered intent
is creation authority only, never a reason to duplicate an existing session.

The private resolver returns one `TicketOperationOriginV1` value into the
module-private resolved-handle state. That state always feeds the immutable
`tickets.source` insert and, when the route is receipt-backed, also feeds
`CanonicalMutationEnvelopeV1.operationOrigin`; adapters cannot read, derive, or
pass a second source string. On receipt replay the resolver runs again against
the locked scope, the HMAC comparison includes that origin, and the locked
result ticket must persist the same source. Non-receipt Counter and Tech Quick
replay paths still validate their locked persisted source but do not fabricate
a shared receipt.

Quick's parsed request identity becomes opaque before the bounded runner begins.
Create `lib/intake/quick-ticket-contracts.ts` and move the existing strict Zod
request schemas plus output type there without changing the accepted body:

```ts
export type ParsedQuickTicketRequestV1 = Readonly<{
  body: QuickTicketBodyV1
  receipt: CanonicalQuickReceiptRequestV1
}>

export function parseQuickTicketRequestV1(
  input: unknown,
): Readonly<
  | { ok: true; value: ParsedQuickTicketRequestV1 }
  | { ok: false; error: 'invalid_input' }
>

export function consumeCanonicalQuickReceiptRequestForCreationV1(
  receipt: CanonicalQuickReceiptRequestV1,
): Readonly<{
  requestKey: string
  body: QuickTicketBodyV1
  base: TicketCreatingEnvelopeBaseV1
}>
```

The module owns the only `WeakMap` behind
`CanonicalQuickReceiptRequestV1`. Parsing happens once from the untrusted body;
the factory deep-copies and freezes the complete normalized request and builds
the canonical envelope base deterministically from that copy. The base fixes
`mutationKind='create_repair_order'`, null target, empty candidates, and the
complete normalized Quick payload; it contains no actor or operation origin.
The public parsed body is a separate copy, so later adapter mutation cannot
change receipt identity. The request-level handle intentionally survives a
fresh transaction attempt, but it is unforgeable and exposes neither request
key nor base.

Only `lib/tickets.ts#resolveTicketCreationInLockedScopeV1` may direct-import the
consumer. Inside a live attempt it binds the consumed private request to that
resolved creation and proves the request key equals both the opaque Quick origin
and the coordinator's normalized `receiptRequestKey`. In insert mode it also
compares every customer/vehicle/mileage input with the materialized-identity
private payload. A manual quote requires `template=null` and derives its title,
kind, tier, and empty seed from the private request. A canned quote requires the
locked-template handle and proves canned ID, expected fingerprint, and expected
tax equal the private request before deriving the locked job/lines. Replay mode
deliberately consults no mutable identity/template truth; it binds the same
opaque normalized request to the locked origin/result and lets HMAC
classification decide. No adapter constructs or passes a
`TicketCreatingEnvelopeBaseV1`.

The primitive derives creator identity from `scope.actor`, never an unbranded
caller value. It always writes `creatorProvenance='direct'`, verifies any
`createdFromJobId` belongs to the locked destination ticket, and persists those
immutable fields on every new job. `ResolveTicketCreationInputV1` has no actor
or raw-source field; excess-property compile regressions prove both are
rejected. Packet B backfills only historical nulls.

Seeded-line input is parentless and parsed again with strict discriminated Zod
objects matching `NormalizedJobLineCreateV1`. For every map entry the primitive
derives `id`, `shopId` from `scope.actor.shopId`, and `jobId` from
`jobs[index].id`. It derives `source='manual'` and
`partStatus='proposed'`; sets `unitCostCents`, `coreChargeCents`, `fitment`,
`vendorAccountId`, `externalOfferId`, `vendorSnapshot`, `orderedAt`,
`orderedByProfileId`, `receivedAt`, and `receivedByProfileId` to null; and lets
database defaults own timestamps. Part-only fields are null on labor/fee;
labor-only fields are null on part/fee; non-part quantity is exactly `1`.
Compile-time excess-property checks and table-driven runtime regressions reject
an out-of-range job index, every attempted wrong-shop/wrong-job injection, and
every privileged database field individually.

`createSessionForUser` keeps its current completed-wrapper preflight, then owns
one bounded mutation. It registers the deterministic session/ticket/job insertion
intents, locks and re-authorizes the actor profile, locks the shop, and only
then inserts the new session plus its ticket/job batch in the same transaction.
The new session row is not a substitute for locking its existing profile/shop
parents. A thrown wrapper, failed finalizer, or injected seam rolls back the
session, ticket, job, sequence, and revisions together. Collision recovery
is operation-allowlisted only for exact `sessions_pkey` and starts from fresh
discovery/authority/locks; an exact completed retry returns the existing
session/ticket/job identity without a second insert or revision bump. Changed
input or another actor/shop receives generic `request key unavailable` with no
identifiers; a missing row after recovery rethrows the original collision.

Counter and Quick Ticket share one ticketed-intake identity boundary in
`lib/intake/ticket-identity.ts`; neither path calls a public upsert during a
continuity mutation:

```ts
export type TicketIntakeIdentityInputV1 =
  | Readonly<{
      mode: 'existing_vehicle'
      shopId: string
      existingVehicleId: string
      mileage?: number | null
    }>
  | Readonly<{
      mode: 'new_vehicle'
      shopId: string
      customer: Omit<UpsertCustomerInput, 'shopId'>
      vehicle: Omit<UpsertVehicleInput, 'customerId'>
    }>

export type TicketIntakeIdentityLockPlanV1 = Readonly<{
  lockShop: true
  customerIds: readonly string[]
  vehicleIds: readonly string[]
  insertionIntents: Readonly<{
    customers: readonly Readonly<{ id: string; shopId: string }>[]
    vehicles: readonly Readonly<{ id: string; customerId: string }>[]
  }>
}>

export type TicketIntakeIdentitySeamsV1 = Readonly<{
  afterCustomerInsert?: () => Promise<void>
  afterVehicleInsert?: () => Promise<void>
  afterMileageWrite?: () => Promise<void>
}>

export async function preflightTicketIntakeIdentityV1(
  tx: AppDb,
  attempt: MutationAttemptCapabilityV1,
  input: TicketIntakeIdentityInputV1,
): Promise<
  | Readonly<{
      ok: true
      identity: ResolvedTicketIntakeIdentityV1
      lockPlan: TicketIntakeIdentityLockPlanV1
    }>
  | Readonly<{
      ok: false
      error: 'not_found' | 'identity_ambiguous'
    }>
>

export async function materializeTicketIntakeIdentityInLockedScopeV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  identity: ResolvedTicketIntakeIdentityV1,
  seams?: TicketIntakeIdentitySeamsV1,
): Promise<
  | Readonly<{
      ok: true
      materialized: MaterializedTicketIntakeIdentityV1
    }>
  | Readonly<{
      ok: false
      error: 'identity_drift' | 'identity_ambiguous'
    }>
>
```

The module owns separate private `WeakMap`s behind
`ResolvedTicketIntakeIdentityV1` and
`MaterializedTicketIntakeIdentityV1`, deep-copies normalized values, generates all
proposed customer/vehicle UUIDs before locking, and returns a frozen lock-plan
copy. Preflight asserts and privately stores the exact live `(tx, attempt)`
binding. The materializer independently asserts the scope's live transaction
capability and rejects a forged, stale, cross-transaction, cross-attempt, or
cross-scope handle, plus any scope that does not contain the exact existing rows
and registered insertion intents stored in private state. It performs no `FOR
UPDATE`, allocation, or late discovery.

On success, the materializer stores customer ID, vehicle ID, exact
`CreatedMutationRowsV1`, mileage disposition, and the same live
`(tx, scope, capability)` only behind the second opaque handle. The Counter and
Quick adapters never receive those plain values. An exact allowlisted
`consumeMaterializedTicketIntakeIdentityForCreationV1(tx, scope, handle)` seam
is imported only by `lib/tickets.ts`; it independently reasserts the binding
and returns the private payload only inside
`resolveTicketCreationInLockedScopeV1`. The resulting ticket-creation handle
retains the created-row manifest, and an exact private finalization bridge in
`lib/tickets.ts` derives that manifest from the same handle before calling
`finalizeMutationRevisionsV1`. Neither adapter may pass customer/vehicle IDs or
created-row arrays around this capability boundary.

Natural-key behavior preserves current definitions and precedence while
failing closed on multiple matches: customer is same shop plus exact normalized
phone; vehicle is same customer plus nonblank
VIN, otherwise same customer/year/make/model/nonblank plate; a vehicle with
neither VIN nor plate has no deduplication key and is preallocated as a new row.
Because those indexes are not unique, each preflight reads the complete ordered
matching ID set with an ambiguity-detecting bound and accepts only cardinality
zero or one. Two or more matching customers or vehicles returns
`identity_ambiguous`, never an arbitrary `.limit(1)` winner. An
existing-vehicle request instead preflights the explicit same-shop
customer/vehicle join. A new-vehicle request may therefore resolve
existing/existing, existing/preallocated, or preallocated/preallocated; a
vehicle can never be preallocated beneath an unregistered or different
customer.

Counter's request sets `lockShop=true`; Quick's prepared insert extension does
the same only after authoritative `none` activation. Under that held shop lock, the materializer
rereads each applicable natural key without `FOR UPDATE`, in stable ID order,
and requires the complete match set to equal the private preflight set; it never
adopts an unplanned row or acquires a late lock. A set difference returns the
explicit retryable `identity_drift` conflict; cardinality above one returns
stable `identity_ambiguous`. The bounded runner retries drift at most once from
fresh discovery. Ambiguity never retries or adopts a row: Quick maps it to its
privacy-safe non-retryable conflict (`retryable: false`), while Counter may
preserve its current response shape without the bit but still performs no
internal retry. The failed
attempt writes no customer, vehicle, ticket, job, line, number, revision, or
receipt. Winning inserts use only the
preallocated registered IDs. The private `CreatedMutationRowsV1` contains
`sessionIds: []` plus the exact `customerIds` and `vehicleIds` actually
inserted. The ticket-creation handle's private finalization bridge passes it
unchanged into `finalizeMutationRevisionsV1`, whose insertion-intent bijection
rejects missing, extra, or cross-parent IDs.

Mileage has one shared rule. Omitted or null mileage preserves an existing
vehicle. A supplied non-null mileage updates the already-locked existing row
only when the integer differs, using a server timestamp; a new vehicle stores
the supplied value or null in its insert. Deduplicating a new-vehicle request
onto an existing vehicle follows that same rule. No customer name/email or
vehicle identity metadata is silently overwritten during deduplication.

`createCounterTicket` gains one test seam without changing its production
request shape:

```ts
export type CounterTicketDependencies = TicketIntakeIdentitySeamsV1 & Readonly<{
  afterIdentityPreflight?: () => Promise<void>
}>
```

Owned request normalization happens once. Counter always runs
`preflightTicketIntakeIdentityV1` inside each bounded attempt's
`discover(tx, attempt)` callback; Quick runs it there only after an absent
receipt hint, as specified below. `afterIdentityPreflight` runs immediately after that
attempt creates its identity handle/lock plan and before
`lockMutationScopeV1`; the transaction is open but holds no row lock and has
made no write. A retry performs fresh discovery and receives fresh preallocated
IDs/handle; `executeLocked` can consume only the discovery payload whose private
capability matches that same live transaction/scope, never an outer or prior-
attempt handle even if a caller cross-wires the object. Production uses a no-op
default. The three stage callbacks pass directly to the materializer;
Quick maps its existing `afterCustomer`, `afterVehicle`, and `afterMileage`
test callbacks to the same seam names. Each callback runs only after its named
write, still inside the top-level transaction. Deterministic PGlite tests use phase control rather than fake
parallelism: preflight A, commit a rival natural-key row, then materialize A in
its locked scope and prove drift/ambiguity with no write. The disposable
PostgreSQL suite owns true two-connection Counter-vs-Counter and
Counter-vs-Quick races, pausing only callback invocation one through a test
closure so a fresh retry cannot pause again.
Across explicit existing vehicle, shared phone, shared VIN, and plate fallback,
the cases prove one locked identity, fresh retry on drift, no arbitrary choice
from duplicate match sets, no duplicate identity insert, exact mileage
behavior, and created-row/insertion-intent equality. A failure after customer
insert, vehicle insert, or mileage update rolls back the full top-level
mutation.

The existing public `upsertCustomer`/`upsertVehicle` exports remain behaviorally
compatible and unchanged for dormant `lib/intake/session.ts`; their legacy unit
tests and `tests/unit/intake-session.test.ts` stay green. The Task 10 source
guard permits those helpers only from that diagnostics-disabled compatibility
path. Counter and Quick imports of either public upsert fail the inventory.
Diagnostics remain middleware-disabled, so preserving the legacy helper does
not create a session entrance.

The canned Quick preflight has the same mechanical attempt boundary as identity
discovery; a copied template object is never the authority token:

```ts
export async function preflightStrictCannedJobV1(
  tx: AppDb,
  attempt: MutationAttemptCapabilityV1,
  input: Readonly<{
    shopId: string
    cannedJobId: string
    expectedFingerprint: string
    expectedTaxRateBps: number | null
  }>,
): Promise<
  | Readonly<{
      ok: true
      template: ResolvedQuickTemplateV1
      cannedJobIds: readonly [string]
    }>
  | Readonly<{
      ok: false
      error: 'not_found' | 'template_drift'
    }>
>

export function resolveStrictCannedJobInLockedScopeV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  template: ResolvedQuickTemplateV1,
): ResolvedLockedQuickTemplateV1
```

`lib/shop-os/canned-jobs.ts` owns separate module-private `WeakMap`s behind the
preflight and locked opaque handles. Preflight asserts and stores the exact live
`(tx, attempt)` capability,
the normalized expected values, and a deep-frozen candidate copy; it exposes
only the template's lock ID beside the handle. The locked resolver independently
calls `assertLiveLockedMutationScopeV1(tx, scope)`, requires that capability to
equal the handle's private capability, and resolves only from `scope.shop` and
the exact row in `scope.cannedJobs`. It issues no query, deep-copies the locked
canonical values into the second handle, and never returns them to the adapter.
The exact allowlisted
`consumeResolvedLockedQuickTemplateForCreationV1(tx, scope, handle)` seam is
imported only by `lib/tickets.ts`; `resolveTicketCreationInLockedScopeV1` is its
sole caller and independently reasserts the handle's exact `(tx, scope,
capability)` before the private payload can construct the Quick creation
handle. Forged, different-
transaction, prior-attempt, collision-recovery, revoked, wrong-scope, wrong-ID,
or caller-mutated handles/copies fail before a query or write. Only the locked
opaque result may supply title, kind, tier, tax, fingerprint, or seed lines to
the creation handle; no raw canonical copy crosses the adapter boundary.

Quick Ticket owns one receipt-first discovery protocol. Owned request
normalization and the keyring load happen once before the runner, without a
domain write, but every attempt begins by calling
`hintMutationReceiptPresenceV1(tx, attempt.capability, { shopId, requestKey })`.
A `present` hint
skips customer/vehicle and, for canned mode, template discovery and returns a base lock
request containing only the actor profile and `receiptRequestKey`, with
`receiptConditionalInsert: { kind: 'unavailable' }`. An `absent` hint attempts
the identity preflight plus the canned-template preflight only when the private
canonical request is canned. If every required preflight succeeds, the opaque
attempt-bound identity and optional template handles, preallocated IDs, private
immutable template copy/fingerprint, lock
sets, and insertion intents live only in the discovery payload and a
`receiptConditionalInsert: { kind: 'prepared', extension }`; the base request
still contains no insert-only shop/customer/vehicle/canned locks or intents. If
any required preflight fails, discovery returns `kind: 'unavailable'` plus only a module-private
stable failure reason in its attempt-bound payload. It does not return a
terminal public error before the authoritative locked receipt peek.

After live actor reauthorization, the coordinator applies Task 6's authoritative
conditional path. An owned receipt ignores every insert-only handle/failure and
locks only the persisted replay graph in repository order; exact HMAC/source
classification therefore never depends on current identity match cardinality,
template presence, retirement, replacement, or tax. Occupied stays generic.
`none + prepared` activates and locks the full extension before insert. `none +
unavailable` writes nothing: attempt one throws the shared retryable drift so a
false-positive hint or moving insert truth receives fresh discovery; attempt two
maps a stable identity/template failure to the existing privacy-safe domain
error and maps any remaining transient state to retry exhaustion. No path
discovers or locks an insert-only resource after its repository class.

For insert-mode manual Quick Ticket, the prepared extension contains identity
locks/intents but no canned-template ID or class-9 lock. The creation resolver
requires `template=null`, derives its one normalized job and empty seed only
from `CanonicalQuickReceiptRequestV1`, and binds that same private request to
classification and final receipt insertion.

For insert-mode canned Quick Ticket, the prepared preflight copy remains private
behind `ResolvedQuickTemplateV1`. Once the conditional extension activates, the
mutation locks the canned template at class 9 and re-resolves title, kind, tier,
tax, fingerprint, and ordered lines from that locked row into
`ResolvedLockedQuickTemplateV1`. Retirement, replacement, corruption,
tax drift, or any mismatch returns the existing privacy-safe retryable conflict
with no customer, vehicle, ticket, job, line, number allocation, or receipt
write. Only the locked opaque handle enters the Quick creation resolver, which
independently unwraps it under the same live attempt before returning the
attempt-bound insert-mode creation handle consumed by
`insertResolvedTicketBatchInTransactionV1`; no raw preflight copy can enter it.

Quick Ticket consumes the shared immutable receipt with `clientKey` as request
key, `mutationKind='create_repair_order'`,
`operationOrigin='quick_quote'` from the locked opaque resolver, null target,
empty candidate set, and one ordered result job. New success inserts the receipt after lines and
revision finalization. Replay never trusts deterministic ticket existence
alone: the actor-scoped receipt peek supplies the result graph, the fresh lock
scope re-authorizes it, and the incoming normalized request is fingerprinted
against the stored HMAC identity. At the winning canned write, the locked
resolver computes the exact canonical seed fingerprint and proves it equals the
client's expected server-issued fingerprint; that bounded fingerprint, template
ID, expected tax, and request fields enter the HMAC envelope, never raw lines.
For manual mode, the normalized description/kind and identity/mileage request
fields enter the same private envelope; no template fields or raw seed lines do.
Replay therefore uses the same incoming fingerprint without consulting a now-
mutable template. Later template retirement or replacement neither breaks an
exact retry nor reintroduces mutable truth; nor do later duplicate customer or
vehicle natural-key rows. Changed input conflicts. A pre-
receipt deterministic ticket returns generic `request key unavailable` with no
write or identifiers.

For any receipt-backed creator, the same actor/shop/request key and identical
visible business content under a different server origin never classifies as
exact: origin changes the HMAC identity, and persisted result-source comparison
also fails closed. Packet A proves that rule in the synthetic three-origin
foundation harness and proves the live Quick-to-Quick path end to end. It does
not claim an actual Counter/Quick/Tech cross-route same-key race before Packet D
adds actor-bound continuity keys to generic/Counter requests; Tech Quick keeps
its distinct `sessions_pkey` recovery.

`QuickTicketDependencies` gains only
`loadMutationKeyring?: () => MutationFingerprintKeyringV1`; tests inject it and
production defaults to `loadMutationFingerprintKeyringFromProcessV1`. Loader
failure occurs before any domain write and maps to the existing generic
retryable conflict/unavailable response without logging configuration.

Replace Quick's use of `loadStrictCannedJobCopy` with the opaque attempt-bound
`preflightStrictCannedJobV1` and the already-locked pure
`resolveStrictCannedJobInLockedScopeV1` over `scope.shop` plus
`scope.cannedJobs`. The
latter issues no query and never calls `FOR UPDATE`; only the central
coordinator owns the class-2 shop and class-9 template locks. Unit and real-
PostgreSQL seams race template replacement/retirement, tax drift, customer
appearance, and vehicle appearance between preflight and lock. The same suite
runs Counter against Counter and Quick through the shared identity handle and
proves a retryable no-write outcome with no late lock or duplicate identity.
Quick regressions additionally prove exact replay after duplicate phone/VIN/
plate rows and after template retirement/replacement; a stale false-positive
hint that finds no authoritative receipt retries into valid insert preparation;
and a winner appearing between hint and lock suppresses prepared identities,
template locks, and all insertion intents. Separate tests cross-wire both opaque
template handles across ordinary attempts and collision recovery, pair either
with a different transaction/scope, mutate every caller-owned input/copy, and
reuse either after capability revocation. An attempt-one locked result passed
to attempt-two or collision-recovery ticket creation also fails before creation
can unwrap, query, or write.

Quick request-binding regressions cross-wire canonical request A with
materialized identity/template B and with a scope/origin carrying request key B;
the creation resolver rejects each before returning a handle, query, or write.
Finalized-creation receipt regressions prove Quick cannot substitute another
request key/envelope after resolution, substitute another locked same-shop
ticket, omit or duplicate a created job, reorder job ordinals, use the pre-
finalization creation handle, insert a second receipt, or reuse a
finalized handle from an earlier attempt, collision recovery, transaction,
scope, or revoked capability. The receipt rows always equal the exact private
inserted-and-finalized batch or no receipt is written.

Packet A preserves current accepted request shapes except for one intentional
trust-boundary hardening: generic `/api/tickets` no longer accepts any caller
`source` field and always derives Counter origin. The current New Work Order,
Counter, Quick Ticket, and Tech Quick UI adapters already use their dedicated
paths or are updated in this task. Packet B later replaces the automatic
diagnostic normalization and adds the new 1–25 public `workItems` contract.

- [ ] **Step 3: Retrofit add-job and assignment**

`addTicketJob` preflights every participating profile/resource, locks the
complete ticket/job graph through the shared coordinator, reserves its ordinal
with `reserveJobSequencesForInsertionV1`, inserts the job at revision `1n`, then
finalizes the parent once. It never computes `max(sequence_number)+1` locally.

Claim, unclaim, and reassign preflight current/target assignees, lock all profiles sorted first, lock the ticket/job graph, re-evaluate every existing race predicate, perform the conditional update, then finalize that job and parent. A diagnostic initialization lease remains a domain blocker. Because assignment is excluded from `ContinuitySignatureV1`, continuity stays unchanged.

- [ ] **Step 4: Run the core writer suite and commit**

```bash
pnpm vitest run \
  tests/unit/shop-os-tickets-create.test.ts \
  tests/unit/shop-os-ticket-routes.test.ts \
  tests/unit/shop-os-tickets-access.test.ts \
  tests/unit/shop-os-counter-ticket.test.ts \
  tests/unit/shop-os-ticket-intake-identity.test.ts \
  tests/unit/shop-os-quick-ticket.test.ts \
  tests/unit/shop-os-tech-quick-session.test.ts \
  tests/unit/shop-os-tech-quick-route.test.ts \
  tests/unit/shop-os-job-assignment.test.ts \
  tests/unit/intake-customers.test.ts \
  tests/unit/intake-vehicles.test.ts \
  tests/unit/intake-session.test.ts \
  tests/unit/shop-os-continuity-lock-order.test.ts \
  tests/unit/shop-os-continuity-revisions.test.ts
pnpm exec tsc --noEmit
git add app/api/sessions/route.ts lib/tickets.ts lib/intake/counter-ticket.ts lib/intake/quick-ticket-contracts.ts lib/intake/ticket-identity.ts lib/intake/quick-ticket.ts lib/sessions.ts lib/shop-os/canned-jobs.ts lib/shop-os/continuity/mutation-foundation/ticket-origin.server.ts tests/unit/shop-os-tickets-create.test.ts tests/unit/shop-os-ticket-routes.test.ts tests/unit/shop-os-tickets-access.test.ts tests/unit/shop-os-counter-ticket.test.ts tests/unit/shop-os-ticket-intake-identity.test.ts tests/unit/shop-os-quick-ticket.test.ts tests/unit/shop-os-tech-quick-session.test.ts tests/unit/shop-os-tech-quick-route.test.ts tests/unit/shop-os-job-assignment.test.ts tests/unit/intake-customers.test.ts tests/unit/intake-vehicles.test.ts tests/unit/intake-session.test.ts
git commit -m "refactor: unify ticket mutation foundation"
```

Expected: all named tests and TypeScript PASS.

---

### Task 8: Retrofit quote, line, canned-job, and manual-offer writers

**Files:**
- Modify: `lib/shop-os/quotes.ts`
- Modify: `lib/shop-os/canned-jobs.ts`
- Modify: `lib/shop-os/parts-offers.ts`
- Modify: `tests/unit/shop-os-quote-drafts.test.ts`
- Modify: `tests/unit/shop-os-quote-versions.test.ts`
- Modify: `tests/unit/shop-os-quote-decisions.test.ts`
- Modify: `tests/unit/shop-os-canned-job-apply.test.ts`
- Modify: `tests/unit/shop-os-manual-offers.test.ts`

- [ ] **Step 1: Write failing lock/revision regressions for every writer**

Replace ticket-first source assertions with profile-first shared-coordinator assertions. Add cases for:

- draft line create/replace/delete;
- quote-version supersede/create and per-job approval-state reset;
- online/offline quote decision event plus job approval update;
- canned-job apply with job and ordered line seed;
- manual-offer insert/delete with vendor-account revalidation.

Each physical mutation increments affected jobs and the parent projection once. A part-line insert/delete or `partStatus` change changes continuity. A labor/fee price-only change does not change continuity unless it also resets included approval state. Approval-state change always changes continuity. Exact idempotent quote-decision replay writes and bumps nothing.

- [ ] **Step 2: Recompose the quote lock helpers around `lockMutationScopeV1`**

Remove local ticket-first `lockDraftContext`, `lockVersionContext`, and decision-order ownership. They may remain thin domain-specific preflight adapters, but only `lockMutationScopeV1` acquires rows. Quote version creation locks participating profiles, the shop for rate truth, then ticket/jobs/lines/versions/events. A changed preflight graph returns retryable conflict.

`invalidateActiveQuoteVersion` becomes a pure in-transaction domain helper. It returns the exact changed job IDs and never finalizes revisions independently:

```ts
type QuoteInvalidationDeltaV1 = Readonly<{
  changedJobIds: readonly string[]
  supersededVersionIds: readonly string[]
}>
```

The top-level logical writer calls the revision finalizer once.

- [ ] **Step 3: Preserve idempotency and append-only quote history**

`recordQuoteDecision` keeps the current shop-global event key behavior. Exact retry is resolved before stale-version rejection, then live actor authority/current safe projection is reloaded. Existing quote versions/events are never rewritten. Packet A adds revision finalization around the winning write only; it does not introduce shared continuity receipts into quote events.

Canned-job apply preloads template identity without locks, locks the complete
ticket/job graph and all earlier classes, then locks/revalidates the template at
its repository position before reserving the job through the sole sequence
allocator and inserting its lines. Manual offers do the same for vendor
accounts. No late lock or private allocator is permitted.

- [ ] **Step 4: Run quote/sourcing proof and commit**

```bash
pnpm vitest run \
  tests/unit/shop-os-quote-drafts.test.ts \
  tests/unit/shop-os-quote-versions.test.ts \
  tests/unit/shop-os-quote-decisions.test.ts \
  tests/unit/shop-os-canned-job-apply.test.ts \
  tests/unit/shop-os-manual-offers.test.ts \
  tests/unit/shop-os-continuity-signature.test.ts \
  tests/unit/shop-os-continuity-revisions.test.ts
pnpm exec tsc --noEmit
git add lib/shop-os/quotes.ts lib/shop-os/canned-jobs.ts lib/shop-os/parts-offers.ts tests/unit/shop-os-quote-drafts.test.ts tests/unit/shop-os-quote-versions.test.ts tests/unit/shop-os-quote-decisions.test.ts tests/unit/shop-os-canned-job-apply.test.ts tests/unit/shop-os-manual-offers.test.ts
git commit -m "refactor: revision quote and parts mutations"
```

Expected: all named tests and TypeScript PASS.

---

### Task 9: Retrofit story, simple-work, diagnostic bridge, and ticketed session writers

**Files:**
- Modify: `lib/shop-os/customer-stories.ts`
- Modify: `lib/shop-os/simple-work.ts`
- Modify: `lib/shop-os/diagnostic-start.ts`
- Modify: `lib/shop-os/repair-authorization.ts`
- Modify: `lib/sessions.ts`
- Modify: `lib/curator/deferred-actions.ts`
- Modify: `lib/diagnostics/adaptive/state.ts`
- Modify: `lib/diagnostics/adaptive/actor.ts`
- Modify: `tests/unit/shop-os-customer-stories.test.ts`
- Modify: `tests/unit/shop-os-customer-story-review.test.ts`
- Modify: `tests/unit/shop-os-manual-findings.test.ts`
- Modify: `tests/unit/shop-os-simple-work.test.ts`
- Modify: `tests/unit/shop-os-work-escalation.test.ts`
- Modify: `tests/unit/shop-os-diagnostic-start.test.ts`
- Modify: `tests/unit/shop-os-repair-authorization.test.ts`
- Modify: `tests/unit/shop-os-repair-close-handlers.test.ts`
- Modify: `tests/unit/curator-deferred-actions.test.ts`
- Modify: `tests/unit/adaptive-mode-route.test.ts`
- Modify: `tests/unit/adaptive-eligibility.test.ts`

- [ ] **Step 1: Write failing regressions for the remaining mutation families**

Tests require the shared profile-first order for generated/reviewed/manual stories, simple-work start/note/complete, escalation, diagnostic lease/finalize/failure, and ticket-linked session close outcomes.

Exact revision classification:

| Mutation | Job | Projection | Continuity |
| --- | --- | --- | --- |
| Story/meta physical save | yes | yes | only if included approval state also changes |
| Work note | yes | yes | no |
| Work status | yes | yes | yes |
| Escalation child insert | new job `1` | yes | yes |
| Diagnostic lease/attempt/error/session-link only | yes | yes | no |
| Diagnostic finalize `open → in_progress` | yes | yes | yes |
| Ticket-linked session close `→ done/canceled` | yes | yes | yes |
| Ticket-graph authorization for an internal session event with no ticket/job write | no | no | no; lock order only |
| Adaptive mode/session-event mutation | no | no | no; ticket-linked lock order only |

Dormant diagnostic-engine internals that neither mutate nor lock ShopOS
ticket/job truth remain unchanged. `submitRepairObservationForUser` is an
explicit lock-only bridge: it follows the total order for its ticket-graph
authorization and session/event write but does not manufacture a revision.
Its provider input must come only from the immutable Stage-1 locked snapshot;
there is no unlocked event reload, positional `slice(0,-1)`, or stale preflight
tree state.

- [ ] **Step 2: Replace local lock ownership and preserve provider/race semantics**

Story generation may keep its provider preflight and post-provider revalidation, but its write transaction locks all profiles, ticket graph, sessions/events, and quote resources through the coordinator. It never locks the actor last. Manual findings preserve text-only behavior and no media entrance.

Simple-work helpers return changed job IDs to one top-level finalizer.
Escalation locks the complete parent/job graph and uses the sole sequence
allocator. Deterministic retry returns the existing escalation without a second
bump.

Diagnostic finalize replaces `job → ticket → vehicle → actor` with the full shared order. `lockDiagnosticRepairAccess` in `lib/shop-os/repair-authorization.ts` becomes the shared-coordinator adapter replacing `ticket → jobs → versions → session → actor`; ticketed session close and the lock-only observation transaction both consume it. Disabled diagnostic routes remain disabled; this is compatibility safety, not engine re-enablement.

`updateAdaptiveModeForUser` is also a ticket-linked lock-only writer, not a
non-ticket dormant exception. Each bounded attempt performs non-locking
discovery of the actor profile, owning ticket's customer/vehicle parents,
ticket/job, session, and the complete ordered event set for that session/request
key across actors; then the coordinator
locks profile → customer → vehicle → ticket/job → session → event.
`authorizeAdaptiveMutationInLockedScopeV1` in
`lib/diagnostics/adaptive/actor.ts` becomes a query-free predicate over that
live bound scope for same-shop technician, assignment, diagnostic-kind,
work-status, ticket-status, session-status, and expected adaptive-revision
checks. Each attempt's discovery reruns the existing feature flag and injected
paid-access precondition before producing a lock request; those preconditions
cannot be supplied in the request body. The route and handler retain their
existing diagnostics-release/entitlement refusals.

Exact adaptive replay is classified only after those locks. A new event is
inserted before the conditional adaptive session update inside the same bounded
transaction; the session lock serializes same-session request-key races, and a
fresh retry discovers the committed winner. No adaptive path mutates or bumps
ticket/job/projection/continuity truth, calls the finalizer, or locks session
before profile/ticket/job. Tests cover exact replay, changed-key occupation,
revision drift, cross-actor key occupation, actor/assignment/membership loss,
attempt/collision freshness,
and two-connection same-session races. Disabled diagnostics remain the product
gate; this refactor makes the dormant ticket-linked seam safe rather than
enabling it.

The three global curator actions remain outside ShopOS continuity only by making
their non-ticket boundary enforceable in `lib/curator/deferred-actions.ts`, not
by assuming diagnostics middleware covers curator routes. Each action owns one
database transaction, locks its target `sessions` row `FOR UPDATE`, and, while
that row lock remains held, checks for any `ticketJobs.sessionId` reference. A
missing session or any ticket link returns the same generic `{ kind:
'not-found' }` without mutation or identifying which condition applied. The
status/predicate is rechecked under lock before the conditional update.

A concurrent ticket-job link must acquire the session FK key lock and therefore
serializes against the curator's row lock: either curator commits while the
session is still truly non-ticket and the later link observes that result, or
the link commits first and curator refuses. Unit tests cover all three actions,
generic refusal, rollback, and predicate drift; the real PostgreSQL suite proves
both race orderings. A future requirement to curate ticket-linked sessions must
migrate that exact action into the shared coordinator/finalizer instead of
weakening this boundary. Curator routes remain curator-authorized global tools;
this change neither grants shop access nor claims they are diagnostics-gated.

`submitRepairObservationForUser` remains deliberately two-stage because the
provider call cannot hold database locks. Stage one uses the bounded runner and
shared coordinator to re-authorize and append only the observation, returning:

```ts
export type LockedObservationSnapshotV1 = Readonly<{
  observationEventId: string
  sessionId: string
  nodeId: string
  treeState: Readonly<TreeState>
  priorEvents: readonly Readonly<SessionEvent>[]
  observation: string
}>
```

The snapshot is deep-cloned/frozen from rows held in Stage 1; prior events use
explicit `(createdAt,id)` order and exclude the observation by exact event ID,
not array position. The provider consumes only this snapshot. No database query
or stale preflight object may alter its prompt after Stage 1 commits.

After the provider returns, stage two opens a fresh bounded transaction, repeats complete
profile-first discovery/authority/locking, proves the session is still open in
repair phase, still belongs to the same active technician, still has valid
ticket-graph repair authorization, and that the observation anchor is the
expected event, then appends guidance. Session close, reassignment, membership
loss, authorization drift, or anchor drift during the provider call returns a
privacy-safe retryable conflict and appends no guidance; the already committed
observation remains. Provider failure likewise preserves the observation.
Neither stage changes ticket/job truth or revisions. Tests pause the provider
and race all named drifts, prove exactly one observation and zero guidance on
failure, and prove no unlocked post-provider append remains.

Provider exceptions return only stable `repair_guidance_unavailable`; exception
messages, prompts, secrets, and customer/technician content enter neither the
HTTP response nor logs. Paused-provider regressions prove concurrent event/tree
changes cannot alter provider input, exact anchor drift prevents guidance, the
observation remains, and injected PII/secret text is absent from response and
captured logs.

- [ ] **Step 3: Run remaining writer proof and commit**

```bash
pnpm vitest run \
  tests/unit/shop-os-customer-stories.test.ts \
  tests/unit/shop-os-customer-story-review.test.ts \
  tests/unit/shop-os-manual-findings.test.ts \
  tests/unit/shop-os-simple-work.test.ts \
  tests/unit/shop-os-work-escalation.test.ts \
  tests/unit/shop-os-diagnostic-start.test.ts \
  tests/unit/shop-os-repair-authorization.test.ts \
  tests/unit/shop-os-repair-close-handlers.test.ts \
  tests/unit/curator-deferred-actions.test.ts \
  tests/unit/adaptive-mode-route.test.ts \
  tests/unit/adaptive-eligibility.test.ts \
  tests/unit/shop-os-continuity-lock-order.test.ts \
  tests/unit/shop-os-continuity-revisions.test.ts
pnpm exec tsc --noEmit
git add lib/shop-os/customer-stories.ts lib/shop-os/simple-work.ts lib/shop-os/diagnostic-start.ts lib/shop-os/repair-authorization.ts lib/sessions.ts lib/curator/deferred-actions.ts lib/diagnostics/adaptive/state.ts lib/diagnostics/adaptive/actor.ts tests/unit/shop-os-customer-stories.test.ts tests/unit/shop-os-customer-story-review.test.ts tests/unit/shop-os-manual-findings.test.ts tests/unit/shop-os-simple-work.test.ts tests/unit/shop-os-work-escalation.test.ts tests/unit/shop-os-diagnostic-start.test.ts tests/unit/shop-os-repair-authorization.test.ts tests/unit/shop-os-repair-close-handlers.test.ts tests/unit/curator-deferred-actions.test.ts tests/unit/adaptive-mode-route.test.ts tests/unit/adaptive-eligibility.test.ts
git commit -m "refactor: revision ShopOS work mutations"
```

Expected: all named tests and TypeScript PASS.

---

### Task 10: Enforce the source-wide writer inventory, race matrix, and held-release gate

**Files:**
- Create: `lib/shop-os/continuity/mutation-foundation/writer-inventory.ts`
- Modify: `lib/shop-os/continuity/mutation-foundation/index.ts`
- Create: `tests/unit/shop-os-continuity-writer-inventory.test.ts`
- Create: `tests/unit/shop-os-continuity-cross-writer-races.test.ts`
- Modify: `tests/unit/wizard-state-route.test.ts`
- Verify unchanged/gated: `app/api/sessions/[id]/wizard-state/route.ts`
- Create: `tests/helpers/postgres-continuity-db.ts`
- Create: `tests/integration/shop-os-continuity-postgres-races.test.ts`
- Modify: `package.json`
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`

- [ ] **Step 1: Write compile-safe inventory/race/PostgreSQL guards and prove RED**

Create both unit tests with `readFile()` assertions for the expected inventory,
PostgreSQL helper, integration test, and package-script text. They collect
without importing missing modules and fail only because those files/contracts
are absent:

```bash
pnpm vitest run \
  tests/unit/shop-os-continuity-writer-inventory.test.ts \
  tests/unit/shop-os-continuity-cross-writer-races.test.ts
```

Expected: assertion-level RED, not a missing-module collection failure. As each
file appears, replace its presence guard with behavior/source-coverage tests
before implementing that behavior. The integration file's ordinary no-URL skip
is added only after its loopback fail-closed configuration tests exist.

- [ ] **Step 2: Encode the exhaustive writer manifest**

```ts
export const CONTINUITY_WRITER_INVENTORY_V1 = [
  { file: 'lib/tickets.ts', mutations: ['createTicket', 'addTicketJob', 'mutateTicketJobAssignment'] },
  { file: 'lib/intake/counter-ticket.ts', mutations: ['createCounterTicket'] },
  { file: 'lib/intake/quick-ticket.ts', mutations: ['createQuickTicket'] },
  { file: 'lib/shop-os/canned-jobs.ts', mutations: ['applyCannedJobToTicket'] },
  { file: 'lib/shop-os/customer-stories.ts', mutations: ['generateAndSaveCustomerStory', 'saveReviewedCustomerStory'] },
  { file: 'lib/shop-os/diagnostic-start.ts', mutations: ['acquireDiagnosticStart', 'finalizeDiagnosticStart', 'recordDiagnosticStartFailure'] },
  { file: 'lib/shop-os/parts-offers.ts', mutations: ['captureManualOffer', 'removeManualOffer'] },
  { file: 'lib/shop-os/quotes.ts', mutations: ['createQuoteVersion', 'recordQuoteDecision', 'createDraftLine', 'replaceDraftLine', 'deleteDraftLine'] },
  { file: 'lib/shop-os/simple-work.ts', mutations: ['mutateSimpleWork', 'createWorkEscalation'] },
  {
    file: 'lib/sessions.ts',
    mutations: ['createSessionForUser', 'closeSessionForUser'],
    allowedEntrypointsByMutation: {
      createSessionForUser: ['app/api/sessions/route.ts#POST'],
      closeSessionForUser: ['app/api/sessions/[id]/close/route.ts#POST'],
    },
    gate: 'diagnostics_release_and_entitlement_refused',
  },
] as const

export const CONTINUITY_REGISTERED_CREATION_HELPER_INVENTORY_V1 = [
  {
    file: 'lib/intake/ticket-identity.ts',
    mutations: ['materializeTicketIntakeIdentityInLockedScopeV1'],
    callers: ['createCounterTicket', 'createQuickTicket'],
    returnsOpaque: 'MaterializedTicketIntakeIdentityV1',
    soleConsumer: 'lib/tickets.ts#resolveTicketCreationInLockedScopeV1',
    createdRowsBridge: 'lib/tickets.ts#finalizeResolvedTicketCreationInTransactionV1',
  },
] as const

export const CONTINUITY_NESTED_SESSION_HELPER_INVENTORY_V1 = [
  {
    file: 'lib/db/queries.ts',
    helper: 'appendSessionEvent',
    allowedCallers: [
      'lib/sessions.ts#advanceSession',
      'lib/sessions.ts#closeSessionForUser',
      'lib/sessions.ts#recordAmbientConditions',
      'lib/sessions.ts#releaseGateForUser',
      'lib/sessions.ts#declineOrDeferSessionForUser',
      'lib/sessions.ts#abandonSessionForUser',
      'lib/sessions.ts#lockDiagnosisForUser',
      'lib/sessions.ts#lockDiagnosisFromWizard',
      'lib/sessions.ts#submitRepairObservationForUser',
    ],
    ticketLinkedCallers: [
      'lib/sessions.ts#closeSessionForUser',
      'lib/sessions.ts#submitRepairObservationForUser',
    ],
    ownsLocksOrFinalization: false,
  },
  {
    file: 'lib/db/queries.ts',
    helper: 'closeSession',
    allowedCallers: ['lib/sessions.ts#closeSessionForUser'],
    ticketLinkedCallers: ['lib/sessions.ts#closeSessionForUser'],
    ownsLocksOrFinalization: false,
  },
  {
    file: 'lib/db/queries.ts',
    helper: 'updateSessionTreeState',
    allowedCallers: [
      'lib/sessions.ts#advanceSession',
      'lib/sessions.ts#recordAmbientConditions',
      'lib/sessions.ts#releaseGateForUser',
      'lib/sessions.ts#lockDiagnosisForUser',
    ],
    ticketLinkedCallers: [],
    ownsLocksOrFinalization: false,
  },
  {
    file: 'lib/db/queries.ts',
    helper: 'updateSessionIntake',
    allowedCallers: ['lib/sessions.ts#recordAmbientConditions'],
    ticketLinkedCallers: [],
    ownsLocksOrFinalization: false,
  },
  {
    file: 'lib/db/queries.ts',
    helper: 'updateSessionMaxCorpusSimilarity',
    allowedCallers: [
      'lib/retrieval/wire-into-tree.ts#buildUpdateTreeWithRetrieval',
    ],
    ticketLinkedCallers: [],
    ownsLocksOrFinalization: false,
  },
  {
    file: 'lib/db/queries.ts',
    helper: 'setSessionTerminalStatus',
    allowedCallers: [
      'lib/sessions.ts#declineOrDeferSessionForUser',
      'lib/sessions.ts#abandonSessionForUser',
    ],
    ticketLinkedCallers: [],
    ownsLocksOrFinalization: false,
  },
  {
    file: 'lib/db/queries.ts',
    helper: 'createSession',
    allowedCallers: [],
    ticketLinkedCallers: [],
    gate: 'currently_unreferenced_fail_on_new_caller',
    ownsLocksOrFinalization: false,
  },
] as const

export const CONTINUITY_LOCK_ONLY_INVENTORY_V1 = [
  { file: 'lib/shop-os/repair-authorization.ts', transactions: ['lockDiagnosticRepairAccess'] },
  {
    file: 'lib/sessions.ts',
    transactions: [
      'replayCompletedTechQuickSessionForUser',
      'submitRepairObservationForUser',
    ],
    allowedEntrypointsByTransaction: {
      replayCompletedTechQuickSessionForUser: ['app/api/sessions/route.ts#POST'],
      submitRepairObservationForUser: [
        'app/api/sessions/[id]/repair-observation/route.ts#POST',
      ],
    },
    gate: 'diagnostics_release_and_entitlement_refused',
  },
  {
    file: 'lib/diagnostics/adaptive/state.ts',
    transactions: ['updateAdaptiveModeForUser'],
    lockedAuthorizer: 'lib/diagnostics/adaptive/actor.ts#authorizeAdaptiveMutationInLockedScopeV1',
    allowedEntrypoints: ['app/api/sessions/[id]/adaptive/mode/route.ts#POST'],
    gate: 'diagnostics_release_and_entitlement_refused',
    ownsFinalization: false,
  },
] as const

export const CONTINUITY_DORMANT_COMPATIBILITY_INVENTORY_V1 = [
  {
    file: 'lib/intake/session.ts',
    mutations: ['createSessionFromIntake'],
    allowedEntrypoints: ['app/api/intake/submit/route.ts#POST'],
    nestedHelpers: [
      'lib/intake/customers.ts#upsertCustomer',
      'lib/intake/vehicles.ts#upsertVehicle',
    ],
    gate: 'diagnostics_release_and_entitlement_refused',
  },
] as const

export const CONTINUITY_GATED_NONWINNING_WRITER_INVENTORY_V1 = [
  {
    file: 'lib/sessions.ts',
    mutations: [
      'advanceSession',
      'captureArtifact',
      'recordAmbientConditions',
      'releaseGateForUser',
      'declineOrDeferSessionForUser',
      'abandonSessionForUser',
      'lockDiagnosisForUser',
      'lockDiagnosisFromWizard',
    ],
    allowedEntrypointsByMutation: {
      advanceSession: [
        'app/api/sessions/[id]/advance/route.ts#POST',
        'app/api/sessions/[id]/advance/stream/route.ts#POST',
      ],
      captureArtifact: [],
      recordAmbientConditions: ['app/api/sessions/[id]/ambient/route.ts#POST'],
      releaseGateForUser: ['app/api/sessions/[id]/release-gate/route.ts#POST'],
      declineOrDeferSessionForUser: ['app/api/sessions/[id]/decline-or-defer/route.ts#POST'],
      abandonSessionForUser: ['app/api/sessions/[id]/abandon/route.ts#POST'],
      lockDiagnosisForUser: ['app/api/sessions/[id]/lock-diagnosis/route.ts#POST'],
      lockDiagnosisFromWizard: ['app/api/sessions/[id]/lock-in-diagnosis/route.ts#POST'],
    },
    gate: 'diagnostics_release_and_entitlement_refused',
  },
  {
    file: 'lib/retrieval/wire-into-tree.ts',
    mutations: ['buildUpdateTreeWithRetrieval'],
    nestedWriter: 'lib/db/queries.ts#updateSessionMaxCorpusSimilarity',
    allowedCallers: [
      'app/api/sessions/[id]/advance/route.ts#POST',
      'app/api/sessions/[id]/advance/stream/route.ts#POST',
      'app/api/sessions/[id]/ambient/route.ts#POST',
    ],
    gate: 'diagnostics_release_gated_session_only_ticket_link_allowed_no_ticket_graph_access',
  },
  {
    file: 'lib/curator/deferred-actions.ts',
    mutations: [
      'approveDeferredSession',
      'overrideDeferredSession',
      'closeDeferredSession',
    ],
    allowedCallers: [
      'app/api/curator/sessions/[id]/approve/route.ts#POST',
      'app/api/curator/sessions/[id]/override/route.ts#POST',
      'app/api/curator/sessions/[id]/close/route.ts#POST',
    ],
    gate: 'curator_global_non_ticket_session_only_enforced',
  },
  {
    file: 'app/api/sessions/[id]/wizard-state/route.ts',
    mutations: ['POST'],
    gate: 'diagnostics_release_and_entitlement_refused',
  },
] as const
```

The inventory test scans all `lib/**/*.ts` **and `app/api/**/*.ts`**
application mutations of `customers`, `vehicles`, `sessions`, `sessionEvents`,
`tickets`, `ticketJobs`, `jobLines`, `quoteVersions`, and `quoteEvents`. Every mutation
must be covered by a named manifest family or explicitly classified as a
schema/bootstrap/test-only or gated legacy write. Every winning continuity
mutation family must reach `lockMutationScopeV1` and
`finalizeMutationRevisionsV1`; every customer/vehicle/session/ticket/job creation
in those families must flow through the registered-intent helpers and report
its created-row manifest. Nested helpers may return deltas but may not start a
second transaction or finalize independently; the exact ticket-creation bridge
may forward its private manifest to the sole finalizer inside the owning locked
scope. Lock-only families must reach `lockMutationScopeV1` and must not
call the finalizer. The scan fails when a new direct API writer, hidden insert,
unreported creation, or ticket-graph authorization lock appears. Dormant
`lib/intake/session.ts` and its preserved legacy helper exports are explicitly
classified and regression-tested, not silently treated as a continuity winner
while diagnostics are disabled.

The mutation collector covers Drizzle `.insert/.update/.delete`, raw/tagged SQL
passed to `execute`, imported aliases/re-exports, and named nested helpers; a
writer cannot evade classification by changing syntax.

Every `ticketJobs` insert must receive its sequence from
`reserveJobSequencesForInsertionV1`; the source guard rejects local max/count
allocators, literal/ad-hoc sequences, or a child insert that did not lock the
complete ticket graph. The finalizer checks the persisted job ID/parent/sequence
against the reservation. Tests cover generic create/add, Counter, Quick, Tech
Quick, canned apply, and work escalation, including legacy-null graphs.

For every gated top-level library writer, the test collects its complete
production import/call-edge set from `app/**` and compares it to the exact
manifest entry—scanning direct database calls alone is insufficient. Each
registered diagnostics entrypoint must stay under `/api/sessions/**` or the
exact `/api/intake/submit` exception, remain covered by
`isDiagnosticsGatedRoute`, and execute `entitlementReject` before calling the
writer. `captureArtifact` must retain zero production callers unless a future
plan registers and proves a still-refused entrance. A new route, alias,
re-export, dynamic wrapper, call-before-gate, or removal of the release/
entitlement guard fails closed.

That entrypoint/gate proof applies across winning, lock-only, dormant-
compatibility, and gated-nonwinning manifests. In particular, root session
create/replay, ticketed close, and repair observation keep their exact API call
edges plus diagnostics release and entitlement refusal even after their database
writes migrate into the shared lock order. Lock correctness never grants a new
product entrance.

The manifest is exhaustive at top-level library and API call sites, never a wildcard file
exclusion. Every session/event writer is named as a winning continuity writer,
a lock-only writer, a specifically gated non-winning writer, or an allowed
nested primitive edge. The listed gated functions within `lib/sessions.ts` and
retrieval may mutate only their registered diagnostic/session/event truth;
`captureArtifact` is additionally unreachable through the media-refusal gate.
Those function bodies and their nested callees may not access, mutate, or lock
`tickets`, `ticketJobs`, `jobLines`,
`quoteVersions`, `quoteEvents`, `customers`, or `vehicles`, call the ShopOS
coordinator/finalizer, or acquire ticket-graph truth after a session lock. They
may receive a ticket-linked session through their exact diagnostics-gated call
edges because their fields are excluded from ticket/job revisions; that linkage
does not authorize ticket access. File-level imports needed by separately
registered functions do not grant these listed functions a wildcard exemption;
the guard follows function-local calls and nested helpers. Retrieval's complete caller set and sole
`updateSessionMaxCorpusSimilarity` nested edge are source-guarded.

The low-level query helpers are allowed only beneath the exact listed caller
function, and the source test compares the complete import/call-edge set rather
than trusting the helper name. The two named ticket-linked edges beneath
`closeSessionForUser` and `submitRepairObservationForUser` are valid only after
their top-level caller acquires the shared scope; the helper itself owns no
lock, ticket access, or finalization. An added caller, unregistered indirect
writer, ticket-linked dormant edge, reverse lock, direct ticket import, or
independent finalizer fails the inventory. If any edge changes, that exact
top-level writer must be registered under an owning scope or migrated into the
shared order. No ad-hoc path or regular-expression suppression is accepted.

Adaptive mode is the explicit exception because it does authorize through
ticket truth. Its source guard requires `updateAdaptiveModeForUser` to reach
`runBoundedShopOsMutationV1` and `lockMutationScopeV1`, requires
`authorizeAdaptiveMutationInLockedScopeV1` to issue no query, and proves the
order profile → customer/vehicle parents → ticket/job → session/event. It must
not call the revision finalizer or mutate ticket/job truth. Its adaptive API
route is the sole entrypoint and must retain both diagnostics-release and
entitlement refusal.

Curator helpers are separately source-guarded: each must start one transaction,
lock the session row `FOR UPDATE`, query `ticketJobs.sessionId` while that lock
is held, privacy-collapse missing and linked sessions to `not-found`, and update
only the still-locked unlinked session. The three exact curator API callers are
the complete allowlist. Removing the row lock/link check, adding a caller, or
allowing a ticket-linked curator write fails the guard. The disposable
PostgreSQL suite proves the FK-link race serializes in both orderings.

`app/api/sessions/[id]/wizard-state/route.ts` remains an intentionally dormant
direct session writer in Packet A. Its source guard proves `/api/sessions`
remains in `DIAGNOSTICS_GATED_PREFIXES`, the route continues to call
`entitlementReject` before its direct update, and its route regression stays
refused at that boundary. A new API direct writer or removal of either gate is
unclassified and fails; it cannot inherit a file-wide exemption.

The same source inventory fails if any value from `keyring.ts`,
`keyring.server.ts`, or `ticket-origin.server.ts` is exported by the general
barrel; if either keyring module lacks its leading `import 'server-only'`; if any
mutation-foundation module other than `keyring.server.ts` reads `process.env`;
if the keyring factory is imported outside tests or `keyring.server.ts`; if
low-level keyring signing/verification is imported anywhere except
`canonical.ts`;
or if a ticket-origin factory/resolver appears outside its exact Task 7
allowlist. Generic ticket creation must contain no caller-shaped source parser,
and every `jobLines` insert fed by the ticket-batch seed path must visibly derive
all privileged provenance/evidence fields inside that trusted primitive. Every
result-ticket-creating receipt kind must feed one locked resolved origin to both
`tickets.source` and `CanonicalMutationEnvelopeV1.operationOrigin` and compare
the locked persisted source on replay; the scan rejects any second raw origin
string. Only `resolveTicketCreationInLockedScopeV1` may call the private origin
resolver; only `insertResolvedTicketBatchInTransactionV1` may feed that resolved
state to `tickets.source`; and only
`buildResolvedTicketCreationEnvelopeV1` may feed it to
`CanonicalMutationEnvelopeV1.operationOrigin`. All three must validate one
opaque handle and the same live transaction-bound scope/capability. The source
guard also makes `createMutationAttemptCapabilityV1` and
`closeMutationAttemptCapabilityV1` callable only by `transaction-runner.ts`,
`bindLockedMutationScopeToAttemptV1` callable only by `lock-order.ts`, and
requires every ticket-creation, identity-materialization, identity/template
consumer, insert, finalizer, and envelope helper,
`preflightStrictCannedJobV1`,
`resolveStrictCannedJobInLockedScopeV1`, plus receipt
hint/classification/insertion helper to invoke the
appropriate live-binding assertion directly. `peekMutationReceiptV1` is
callable only by `lock-order.ts`; receipt classification/insertion require the
bound scope, never a free actor token. No general
barrel exports the capability constructor/binder, finalized-creation handle, or
low-level receipt primitive. The Packet A production-callsite allowlist permits
Quick Ticket to call only the resolved-creation classification bridge and the
finalized-creation insertion bridge. Those bridges alone may call
`buildResolvedTicketCreationEnvelopeV1`; only the classification bridge may
call `lockAndClassifyMutationReceiptV1`, and only the insertion bridge may call
`insertMutationReceiptPrimitiveV1` for a ticket-creating kind. Both derive the
request key and envelope from private resolved-creation state; insertion also
derives the exact inserted/finalized ticket and ordered job IDs from
`FinalizedTicketCreationV1`. Any caller-shaped expectation/result IDs or direct
Quick import fails the guard. Counter and Tech Quick receipt
calls fail the guard, while the pure foundation
conformance tests exercise all three origin handles for Packet D readiness.

The source guard also permits `CanonicalQuickReceiptRequestV1` construction
only through `parseQuickTicketRequestV1`, permits its private consumer only as a
direct import inside `resolveTicketCreationInLockedScopeV1`, and rejects any
Quick-adapter construction/import of `TicketCreatingEnvelopeBaseV1` or any
request/base `actorProfileId`/`operationOrigin` property. Only the resolved
envelope builder may inject those two values from `scope.actor.id` and the
private locked origin. The
resolver must visibly compare canonical request A's key, identity/mileage, and
manual/canned quote fields with the private origin, normalized scope key,
materialized identity, and locked template before it returns a creation handle;
an A/B sibling-field copy is not an accepted bind.

The source guard permits the opaque Quick template preflight/locked resolver
only in `lib/shop-os/canned-jobs.ts`, their sole production adapter caller only
from `createQuickTicket`, and the locked handle's sole unwrap only inside
`resolveTicketCreationInLockedScopeV1` through the exact direct-import
`consumeResolvedLockedQuickTemplateForCreationV1` seam. A canned conditional
lock extension contains `cannedJobIds` but never a copied template; manual mode
contains neither. Any raw candidate/template value
flowing across the adapter or directly into the ticket creation handle, any
resolver query, any other locked-handle consumer, or any missing independent
live-scope/capability assertion fails the inventory. Source tests also reject an
attempt-one locked-template result used by attempt two, collision recovery, or
post-revocation creation.

The inventory also rejects Counter or Quick imports of `upsertCustomer` or
`upsertVehicle`, direct customer/vehicle inserts outside
`materializeTicketIntakeIdentityInLockedScopeV1`, unregistered identity IDs,
and any ticket-identity helper that locks or finalizes independently. The
materializer is allowed only from the two named top-level callers and must
return only `MaterializedTicketIntakeIdentityV1`. Its exact direct-import
consumer is callable only inside `resolveTicketCreationInLockedScopeV1`; its
plain payload may exist only inside `lib/tickets.ts`. Counter/Quick creation
must use `intake_insert`/`quick_insert`, never raw `insert`, and only
`finalizeResolvedTicketCreationInTransactionV1` may derive and pass the opaque
handle's created-row manifest into `finalizeMutationRevisionsV1`. Cross-attempt,
collision-recovery, rollback-after-mileage, different-scope, and post-
revocation materialized handles all fail before ticket creation. The unchanged public upserts are allowlisted only through dormant
`createSessionFromIntake` while the diagnostics gate remains disabled.

The inventory also scans `app/api/sessions/route.ts` and
`tests/unit/shop-os-tech-quick-route.test.ts` for the exact replay boundary. It
fails if the hint preflight returns identifiers, if the route serializes a
`state='match'` hint directly, or if a success response can bypass
`replayCompletedTechQuickSessionForUser` and its shared locked coordinator.

- [ ] **Step 3: Run the mandatory cross-writer race matrix**

Prove:

- assignment versus quote decision on one ticket;
- story save versus line edit/invalidation;
- add-job versus quote-version creation;
- diagnostic finalize versus assignment on a sibling job;
- simple-work completion versus ticketed diagnostic close on sibling jobs;
- manual-offer insert/delete versus quote-version creation;
- two actors assigning each other's profile targets;
- exact idempotent retries for Quick Ticket, quote decision, canned apply, escalation, and diagnostic start do not double-bump;
- changed Quick Ticket payload under the same request key and a pre-receipt
  deterministic ticket both conflict without result identifiers;
- the synthetic receipt harness holds actor/shop/request key/business content
  constant and changes only `counter`/`quick_quote`/`tech_quick` origin,
  producing conflict without IDs or writes; live exact-origin Quick replay still
  succeeds, while Counter/Tech create no shared receipt in Packet A;
- Tech Quick `sessions_pkey` races distinguish exact owned replay from changed
  payload and cross-actor/cross-shop occupation without exposing IDs;
- canned Quick Ticket insert-mode template/tax drift and newly appeared
  customer/vehicle identities cause fresh no-write retry rather than a late lock;
- exact Quick replay remains exact after template retirement/replacement or
  duplicate phone/VIN/plate rows; stale false-positive receipt hints retry into
  insert mode, and a receipt appearing after an absent hint suppresses every
  insert-only lock and intent;
- Counter-vs-Counter and Counter-vs-Quick existing-vehicle, phone, VIN, and
  plate-fallback races preserve one identity, exact mileage semantics, and a
  created-row/insertion-intent bijection;
- an attempt-one materialized identity with a rolled-back mileage write and an
  attempt-one locked Quick template both fail creation/finalization when reused
  in attempt two, collision recovery, another scope, or after revocation;
- Quick receipt insertion derives its result only from the opaque finalized
  creation; substituting another locked ticket or omitting, duplicating, or
  reordering a result job cannot produce a receipt;
- injected failure after row write, after finalization, and before receipt insert always rolls back;
- `55P03`, `40001`, and `40P01` map to the same retryable response;
- revisions beyond `Number.MAX_SAFE_INTEGER` round-trip as exact strings;
- one multi-job mutation bumps the parent once and each changed child once.
- legacy null-sequence jobs followed by generic/canned/escalation appends reserve
  a contiguous populated suffix; a Packet-B-style null-only `(created_at,id)`
  simulation fills the untouched prefix to exact `1..n` without rewriting or
  timestamp-ranking the suffix;
- curator mutation versus a concurrent ticket-job session link serializes in
  both orderings, and curator never mutates a session already linked to a ticket.
- adaptive mode versus assignment and ticket-linked session close follows one
  profile/ticket/job/session/event order, preserves exact replay, and creates no
  ticket/job revision.

Use isolated database instances for independent cases. Do not run multiple heavy test suites concurrently.

- [ ] **Step 4: Prove real PostgreSQL row-lock, FK, deadlock, and uniqueness behavior**

`tests/helpers/postgres-continuity-db.ts` accepts only a loopback URL whose database name is exactly `continuity_test`; it rejects every remote host or different database before connecting. It creates the test roles/auth stub/vector extension, applies every source migration `0000`–`0037` in lexical order to the disposable database without consulting the stale journal, and returns two independent `postgres`/Drizzle clients plus cleanup.

`tests/integration/shop-os-continuity-postgres-races.test.ts` skips only during ordinary `pnpm test` when `CONTINUITY_POSTGRES_URL` is absent. When `REQUIRE_CONTINUITY_POSTGRES=1`, absence or non-loopback configuration is a hard failure. It runs the complete cross-writer matrix with independent PostgreSQL connections, proves actual 250ms lock timeout, no deadlock, receipt and Tech Quick exact-key collision classification, changed/cross-actor/cross-shop session refusal, canned/tax/customer/vehicle drift without late locks, implicit FK-lock compatibility, rollback, and one parent/child revision cardinality.

One mandatory two-connection case begins transaction A first, deliberately lets
transaction B acquire the ticket lock and reserve `N+1`, then releases A to
acquire second and reserve `N+2`. It proves PostgreSQL `defaultNow()` transaction
timestamps and random UUID order may be the reverse of reservation order while
the suffix remains contiguous and a null-only legacy-prefix backfill still
accepts the graph without rewriting either append.

The same real-PostgreSQL file proves adaptive-mode versus assignment/session-
close serialization and curator versus ticket-job FK-link ordering; neither
case may be replaced by PGlite scheduling assertions.

Add:

```json
{
  "scripts": {
    "test:continuity:postgres": "vitest run tests/integration/shop-os-continuity-postgres-races.test.ts"
  }
}
```

Run a disposable local PostgreSQL 17 + pgvector instance:

```bash
set -euo pipefail
container="vyntechs-continuity-${RANDOM}"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --rm -d --name "$container" \
  -e POSTGRES_PASSWORD=continuity_test_only \
  -e POSTGRES_DB=continuity_test \
  -P pgvector/pgvector:pg17
port="$(docker inspect -f '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$container")"
ready=0
for attempt in $(seq 1 60); do
  if docker exec "$container" pg_isready -U postgres -d continuity_test; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" -ne 1 ]; then
  docker inspect "$container" --format '{{json .State}}' || true
  docker logs --tail 100 "$container" || true
  exit 1
fi
CONTINUITY_POSTGRES_URL="postgresql://postgres:continuity_test_only@127.0.0.1:${port}/continuity_test" \
REQUIRE_CONTINUITY_POSTGRES=1 \
pnpm test:continuity:postgres
```

Expected: the integration file reports no skips and every real-PostgreSQL race passes. Docker/runtime unavailability is a blocking proof gap; PGlite or SQL-source assertions may not substitute for this gate.

- [ ] **Step 5: Run focused continuity and all affected legacy tests**

```bash
pnpm vitest run \
  tests/unit/shop-os-continuity-schema.test.ts \
  tests/unit/shop-os-continuity-acl.test.ts \
  tests/unit/shop-os-continuity-canonical.test.ts \
  tests/unit/shop-os-continuity-keyring.test.ts \
  tests/unit/shop-os-continuity-server-boundary.test.ts \
  tests/unit/shop-os-continuity-signature.test.ts \
  tests/unit/shop-os-continuity-lock-order.test.ts \
  tests/unit/shop-os-continuity-revisions.test.ts \
  tests/unit/shop-os-continuity-receipts.test.ts \
  tests/unit/shop-os-continuity-writer-inventory.test.ts \
  tests/unit/shop-os-continuity-cross-writer-races.test.ts \
  tests/unit/shop-os-tickets-create.test.ts \
  tests/unit/shop-os-ticket-routes.test.ts \
  tests/unit/shop-os-tickets-access.test.ts \
  tests/unit/shop-os-counter-ticket.test.ts \
  tests/unit/shop-os-ticket-intake-identity.test.ts \
  tests/unit/shop-os-quick-ticket.test.ts \
  tests/unit/shop-os-tech-quick-session.test.ts \
  tests/unit/shop-os-tech-quick-route.test.ts \
  tests/unit/shop-os-job-assignment.test.ts \
  tests/unit/intake-customers.test.ts \
  tests/unit/intake-vehicles.test.ts \
  tests/unit/intake-session.test.ts \
  tests/unit/shop-os-quote-drafts.test.ts \
  tests/unit/shop-os-quote-versions.test.ts \
  tests/unit/shop-os-quote-decisions.test.ts \
  tests/unit/shop-os-canned-job-apply.test.ts \
  tests/unit/shop-os-manual-offers.test.ts \
  tests/unit/shop-os-customer-stories.test.ts \
  tests/unit/shop-os-customer-story-review.test.ts \
  tests/unit/shop-os-manual-findings.test.ts \
  tests/unit/shop-os-simple-work.test.ts \
  tests/unit/shop-os-work-escalation.test.ts \
  tests/unit/shop-os-diagnostic-start.test.ts \
  tests/unit/shop-os-repair-authorization.test.ts \
  tests/unit/shop-os-repair-close-handlers.test.ts \
  tests/unit/curator-deferred-actions.test.ts \
  tests/unit/wizard-state-route.test.ts \
  tests/unit/adaptive-mode-route.test.ts \
  tests/unit/adaptive-eligibility.test.ts
```

Expected: every listed file PASS with no timeout/retry masking.

- [ ] **Step 6: Run full verification sequentially**

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check
git status --short
```

Expected: full tests, TypeScript, and production build PASS; only intended files are modified. Review the complete diff for unrelated changes, mixed lock order, JS-number revisions, production-unavailable table reads, a unique open-RO index, diagnostic/media entrances, raw receipt content, and historical migration/meta edits.

- [ ] **Step 7: Obtain three independent read-only PASS reviews**

Run separate bounded reviews for:

1. schema/migration/tenant constraints/RLS/ACL/immutability;
2. lock order/revisions/idempotency/deadlock and rollback;
3. whole-branch spec coverage, scope, diagnostics-off/no-media preservation, and test adequacy.

Resolve every Critical or Important finding with a failing regression first. Re-run the affected focused suite after each fix and the complete verification set after convergence.

- [ ] **Step 8: Record truthful held state, commit, and push**

Update Row 50 and `SHOP_OS_DRIVER_STATE.md` with exact test/build counts, immutable commit, unresolved gates, and next safe move. Row 50 moves to `owner_gate`, not `complete`, once local proof is held and the exact production DDL is the only next action; it becomes complete only after the separately approved DDL and compatible runtime release are verified.

```bash
git add lib drizzle/migrations/0037_shop_os_continuity_foundation.sql tests docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md docs/strategy/SHOP_OS_DRIVER_STATE.md
git commit -m "feat: complete held ShopOS continuity foundation"
git push -u origin feat/shop-os-continuity-foundation
git rev-parse HEAD
shasum -a 256 drizzle/migrations/0037_shop_os_continuity_foundation.sql
```

Expected: a pushed immutable held ref and exact migration SHA-256. Open or update a draft PR marked **DO NOT MERGE — production DDL gate**. Do not merge or deploy.

- [ ] **Step 9: Stop at the named production-DDL gate with one bounded decision**

Return a gate packet containing:

- immutable branch/commit and migration hash;
- exact Supabase migration name `shop_os_repair_order_continuity_foundation`;
- additive objects/constraints/indexes/policies/triggers summary;
- local preservation, security, race, test, typecheck, build, and independent-review proof;
- read-only live preflight showing `0037` is absent and migrations `0033`–`0035` remain unavailable without reading customer content;
- exact post-apply verification and rollback/stop conditions.
- the two required mutation-HMAC environment variable names and proof that no
  values are committed, with configuration explicitly deferred to the separate
  runtime-release gate.

Ask only this authority question: approve or decline applying the exact reviewed additive production DDL. Approval does not authorize backfill, constraint validation, merge/deploy, continuity enablement, cleanup, or production smoke mutation.

## Packet A Done Boundary

Packet A local work is complete only when the held branch passes every proof above and is waiting at the production-DDL gate. Packet A is release-complete only after a separately approved DDL apply is verified, the compatible runtime branch is reverified/merged/deployed under its own gate, and all participating writers run against the proven live columns. Packet B may be planned while the gate waits, but no consuming runtime path may deploy early.
