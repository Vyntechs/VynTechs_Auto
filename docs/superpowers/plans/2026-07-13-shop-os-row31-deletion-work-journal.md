# Shop OS Row 31 Deletion Work Journal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the failed cursor-based messaging cleanup with a bounded request-scoped work journal that converges, preserves dependency order, and produces one exact privacy-safe tombstone.

**Architecture:** A temporary server-only journal records one opaque work item per source record and links child items to their exact parent. Bounded anti-join discovery and atomic source/outcome mutations replace cursors; a narrow database finalizer revalidates holds, aggregates only the canonical request's journal, deletes the journal, and completes the immutable tombstone in one transaction.

**Tech Stack:** TypeScript 6, Drizzle ORM SQL templates, PostgreSQL/PGlite PL/pgSQL, Vitest, pnpm.

## Global Constraints

- Authority is `docs/superpowers/specs/2026-07-13-shop-os-row31-deletion-work-journal-design.md`, then the finished Task 1/2 behavior in `docs/superpowers/plans/2026-07-12-shop-os-row31-deletion-convergence.md`, then `AGENTS.md`.
- Preserve canonical pending-request coalescing, request-key conflict behavior, suppression-before-cleanup, exact multi-key suppression, live actor authorization, and immutable completed tombstones.
- Preserve the bounded consent compaction security boundary, but replace its cursor input with exact journal work-item IDs.
- Every cleanup call locks shop → canonical request `FOR UPDATE` → customer → work items → source parents/children → matching holds.
- Do not use `SKIP LOCKED`; skipped work must never look exhausted.
- Discovery is an ordered anti-join against the journal, limited to 1,024 new items per call.
- Source outcomes retain the existing family ceilings and 1,024 total outcomes per call.
- Journal rows contain no customer ID, subject key, destination fingerprint, key version, phone number, customer name, message, token, evidence, vehicle detail, provider payload, or secure URL.
- Final counts come only from the canonical request's journal; no shop-wide detached-row aggregate may enter the tombstone.
- Journal rows never survive successful completion.
- All Row 31 writers serialize on the shop row; finalization holds that lock through its final anti-existence proof.
- Do not apply migration 0033, touch production, provider/routes/UI/cron/credentials/public policy/diagnostic engine, enable messaging, or create spend.
- Preserve the uncommitted `tasks/lessons.md`; never stage or commit it.
- Stop only for readable identity in the journal, an unbounded query, a relaxed suppression barrier, lock inversion, production action, irreversible action, or scope beyond the approved spec.

## File Map

- `drizzle/migrations/0033_shop_os_messaging_retention.sql` — work-item table, constraints, indexes, ACL/RLS, mutation guard, exact consent work-item compaction, and atomic finalizer.
- `lib/db/schema.ts` — exact Drizzle mirror for the work-item table and relations needed by tests/runtime.
- `lib/shop-os/messaging-deletion.ts` — canonical request lock, bounded anti-join discovery, dependency-aware processing, and finalizer call; public API stays unchanged.
- `tests/helpers/db.ts` — exact migration marker counts, function signatures/digests, table metadata, and clean-source drift proof.
- `tests/unit/shop-os-messaging-retention-schema.test.ts` — direct database invariants, guard behavior, finalizer authorization, and rollback.
- `tests/unit/shop-os-messaging-retention-acl.test.ts` — server-only table/function ACL proof.
- `tests/unit/shop-os-messaging-deletion.test.ts` — convergence, dependencies, holds, isolation, races, idempotency, and exact counts.
- `tests/unit/shop-os-messaging-consent.test.ts` — writer/shop-lock and deletion-suppression regressions.
- `tests/unit/shop-os-messaging-retention-purge.test.ts` — consent compaction/purge authorization separation.

---

### Task 1: Server-Only Work Journal and Mutation Guard

**Files:**
- Modify: `drizzle/migrations/0033_shop_os_messaging_retention.sql:102-360,1395-1720`
- Modify: `lib/db/schema.ts:1012-1460`
- Modify: `tests/helpers/db.ts:300-845`
- Modify: `tests/unit/shop-os-messaging-retention-schema.test.ts`
- Modify: `tests/unit/shop-os-messaging-retention-acl.test.ts`

**Interfaces:**
- Consumes: `messaging_deletion_requests (shop_id, id)` and the canonical pending request invariant.
- Produces: `messaging_deletion_work_items`, `guard_messaging_deletion_work_item_mutation()`, and exact service-only ACL/RLS behavior.

- [ ] **Step 1: Add schema RED tests for the exact journal contract**

Create one canonical pending request, then assert a valid pending quote-send item inserts. Add direct failures for a duplicate request/type/resource tuple, cross-shop request, cross-request parent, terminal insert, retained-without-basis, pending-with-resolution-time, non-consent detach count, and `counts_toward_proof = false` on an ordinary consent event.

Use this exact valid shape in the direct database test:

```sql
insert into messaging_deletion_work_items (
  id, shop_id, request_id, resource_type, resource_id,
  parent_work_item_id, outcome, retention_basis,
  counts_toward_proof, detached_suppression_sources,
  discovered_at, resolved_at
) values (
  $1, $2, $3, 'quote_send', $4,
  null, 'pending', null,
  true, 0,
  now(), null
)
```

- [ ] **Step 2: Add ACL RED tests**

Require `anon` and `authenticated` to have no table privilege, no policy path, and no execute privilege on the new guard/finalizer functions. Require only `service_role` to have the intended table operations and execute access.

- [ ] **Step 3: Run the focused RED tests**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts -t 'deletion work journal'
pnpm test tests/unit/shop-os-messaging-retention-acl.test.ts -t 'deletion work journal'
```

Expected: both fail because the table, constraints, function, and ACL markers do not exist.

- [ ] **Step 4: Add the journal table and exact constraints**

Add the table with these source values:

```sql
create table messaging_deletion_work_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null,
  request_id uuid not null,
  resource_type text not null,
  resource_id uuid not null,
  parent_work_item_id uuid,
  outcome text not null default 'pending',
  retention_basis text,
  counts_toward_proof boolean not null default true,
  detached_suppression_sources integer not null default 0,
  discovered_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint messaging_deletion_work_items_shop_request_fk
    foreign key (shop_id, request_id)
    references messaging_deletion_requests(shop_id, id) on delete cascade,
  constraint messaging_deletion_work_items_parent_fk
    foreign key (parent_work_item_id)
    references messaging_deletion_work_items(id) on delete cascade,
  constraint messaging_deletion_work_items_resource_type_valid check (
    resource_type in ('consent_event','consent_projection','quote_send','sms_log','notification')
  ),
  constraint messaging_deletion_work_items_outcome_valid check (
    outcome in ('pending','deleted','detached','retained')
  ),
  constraint messaging_deletion_work_items_retention_basis_valid check (
    retention_basis is null
    or retention_basis in ('resource_hold','subject_hold','held_dependency')
  ),
  constraint messaging_deletion_work_items_state_consistent check (
    (outcome = 'pending' and retention_basis is null and resolved_at is null)
    or (outcome in ('deleted','detached') and retention_basis is null and resolved_at is not null)
    or (outcome = 'retained' and retention_basis is not null and resolved_at is not null)
  ),
  constraint messaging_deletion_work_items_detached_count_valid check (
    detached_suppression_sources >= 0
    and (resource_type = 'consent_event' or detached_suppression_sources = 0)
  )
);
create unique index messaging_deletion_work_items_request_resource_uq
on messaging_deletion_work_items (request_id, resource_type, resource_id);
create unique index messaging_deletion_work_items_request_id_uq
on messaging_deletion_work_items (request_id, id);
create index messaging_deletion_work_items_pending_idx
on messaging_deletion_work_items (request_id, outcome, resource_type, id);
create index messaging_deletion_work_items_parent_idx
on messaging_deletion_work_items (request_id, parent_work_item_id, outcome);
```

Add the matching Drizzle table, named indexes, checks, composite request FK, and self-reference.

- [ ] **Step 5: Add the mutation guard**

Require inserts to be pending, request-scoped, and source-backed. Derive `counts_toward_proof` for consent events as:

```sql
not (event_type = 'deleted' and program_version = 'internal_deletion_v1')
```

Reject direct resource identity changes. Accept only `pending → deleted|detached|retained` and `retained → deleted|detached`; require the controlled compaction transaction setting for non-zero detached counts. Validate parent ownership and exact parent resource type for consent events, SMS logs, and quote-send notifications.

- [ ] **Step 6: Add RLS, ACL, schema mirrors, and drift fixtures**

Enable RLS, add the server-only deny-direct policy, revoke all table privileges from `public`, `anon`, and `authenticated`, and grant the exact service-role operations. Update table/index/trigger/function counts and normalized function digests in `tests/helpers/db.ts` from the migrated PGlite definitions.

- [ ] **Step 7: Run Task 1 GREEN tests**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts -t 'deletion work journal'
pnpm test tests/unit/shop-os-messaging-retention-acl.test.ts -t 'deletion work journal'
pnpm exec tsc --noEmit
git diff --check
```

Expected: all selected tests pass; TypeScript and diff checks exit 0.

- [ ] **Step 8: Review and commit Task 1**

Stage only migration, schema, helper, and focused schema/ACL tests. Exclude `tasks/lessons.md`.

```bash
git commit -m "Add messaging deletion work journal"
```

Rollback gate: revert this commit if a clean migration cannot enforce request/parent isolation without readable identity columns.

---

### Task 2: Bounded Cursor-Free Discovery and Dependency Proof

**Files:**
- Modify: `lib/shop-os/messaging-deletion.ts:620-1140`
- Modify: `tests/unit/shop-os-messaging-deletion.test.ts`

**Interfaces:**
- Consumes: canonical request/customer lock and `messaging_deletion_work_items` from Task 1.
- Produces: `discoverDeletionWorkItems(tx, request, limit)` and request-scoped parent links; public `completeMessagingDeletion` result shape remains unchanged.

- [ ] **Step 1: Write discovery RED tests**

Add deterministic tests proving:

- a first call journals no more than 1,024 records and returns pending;
- a retry skips already-journaled held records and discovers later eligible records;
- SMS logs and quote-send notifications link to their exact quote-send work item;
- customer notifications are scoped by the request customer;
- 257 notifications for send A cannot hide notification 258 for send B;
- a second customer in the same shop contributes zero work items to the first request.

Assert journal contents using only `requestId`, `resourceType`, `resourceId`, `parentWorkItemId`, and `outcome`; never add readable identity to the fixture output.

- [ ] **Step 2: Run discovery tests and verify RED**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-deletion.test.ts -t 'journals bounded deletion work|discovers every child|isolates journal discovery'
```

Expected: failures show no journal rows and the current first-page child behavior.

- [ ] **Step 3: Lock the canonical request correctly**

Change the pending request read to end in `FOR UPDATE` before the customer lock. Keep completed retries immutable and do not create a second request lookup.

- [ ] **Step 4: Implement bounded anti-join discovery**

Add one ordered insertion pass per family. Each pass selects source rows with `NOT EXISTS` for `(request_id, resource_type, resource_id)`, consumes the remaining discovery budget, and inserts pending items with `ON CONFLICT DO NOTHING`.

Quote-send children use this exact ownership shape:

```sql
from sms_log child
join messaging_deletion_work_items parent
  on parent.request_id = $request_id
 and parent.resource_type = 'quote_send'
 and parent.resource_id = child.quote_send_id
left join messaging_deletion_work_items existing
  on existing.request_id = parent.request_id
 and existing.resource_type = 'sms_log'
 and existing.resource_id = child.id
where child.shop_id = $shop_id and existing.id is null
```

Use the equivalent parent join for `notifications.entity_type = 'quote_send'`. Direct customer notifications require `entity_type = 'customer'` and the canonical request's still-locked customer ID.

- [ ] **Step 5: Keep discovery cursor-free without breaking the temporary legacy processor**

Do not add a cursor to journal discovery. Leave the old source-processing cursor reads/writes intact only as temporary compatibility until Tasks 3 and 4 replace processing and finalization atomically; Task 5 removes the superseded code. Do not weaken the pending-request mutation guard in this task.

- [ ] **Step 6: Run Task 2 GREEN tests**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-deletion.test.ts -t 'journals bounded deletion work|discovers every child|isolates journal discovery|coalesces a second deletion request'
pnpm exec tsc --noEmit
git diff --check
```

Expected: all selected tests pass and each child has the exact request-scoped parent.

- [ ] **Step 7: Review and commit Task 2**

```bash
git commit -m "Journal messaging deletion dependencies"
```

Rollback gate: revert if any discovery query infers ownership from a null-customer row or uses a shop-wide retained-row scan.

---

### Task 3: Atomic Journal Outcomes and Exact Consent Work Items

**Files:**
- Modify: `drizzle/migrations/0033_shop_os_messaging_retention.sql:825-1215`
- Modify: `drizzle/migrations/0034_shop_os_messaging_retention_acl.sql` — replace the old consent-compaction function ACL signature so the idempotent ACL repair migration remains clean-source compatible.
- Modify: `lib/shop-os/messaging-deletion.ts:760-1010`
- Modify: `tests/helpers/db.ts`
- Modify: `tests/unit/shop-os-messaging-retention-schema.test.ts`
- Modify: `tests/unit/shop-os-messaging-retention-acl.test.ts`
- Modify: `tests/unit/shop-os-messaging-deletion.test.ts`
- Modify: `tests/unit/shop-os-messaging-retention-purge.test.ts`

**Interfaces:**
- Replaces: `compact_messaging_consent_events(uuid,uuid,uuid,uuid,integer)`.
- Produces: `compact_messaging_consent_work_items(uuid,uuid,uuid[]) returns integer` where the UUID array contains at most 256 exact consent-event work-item IDs.

- [ ] **Step 1: Write source/outcome atomicity RED tests**

Prove a forced failure after each family mutation leaves both the source row and journal outcome unchanged. Prove a committed mutation advances exactly one outcome and cannot be replay-counted.

- [ ] **Step 2: Write exact consent-work-item RED tests**

Seed 257 countable events plus one internal deletion-workflow event. Pass the first 256 exact work-item IDs and assert:

- only their exact source events delete;
- every affected suppression `source_event_id` detaches;
- each item becomes `deleted` with its own exact detach count;
- the internal workflow item has `counts_toward_proof = false`;
- purge authorization settings cannot authorize compaction, and compaction settings cannot authorize purge.

- [ ] **Step 3: Run Task 3 tests and verify RED**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts -t 'compacts exact deletion work items|rolls back work outcomes'
pnpm test tests/unit/shop-os-messaging-deletion.test.ts -t 'commits source and work outcome atomically'
pnpm test tests/unit/shop-os-messaging-retention-purge.test.ts -t 'compaction authorization'
```

Expected: failures reference the missing exact-ID function and unchanged cursor-based compaction.

- [ ] **Step 4: Replace consent cursor compaction with exact work-item compaction**

The new definer validates array length `1..256`, locks the canonical request, locks exact pending consent-event items, proves their source rows belong to the request customer, locks matching projections/events/suppressions, rejects unrepresented IDs, detaches suppression sources, deletes exact events, and updates each work item in the same transaction.

Set transaction-local authorization to the exact event IDs before delete. Return the number of work items advanced, not the proof count.

- [ ] **Step 5: Process ordinary journal items in dependency order**

Select at most the existing per-family and total source-outcome budgets. Lock quote-send/projection parents before SMS, notification, or event children. Mutate children first. For each item:

- `deleted`: source row deleted;
- `detached`: readable send identity/token material removed without retained content;
- `retained`: source remains under an exact resource hold, subject hold, or actively held child.

Write the outcome and source mutation in the same transaction. A parent may delete only after no unresolved child item and no unjournaled source child exist.

- [ ] **Step 6: Run Task 3 GREEN tests**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts -t 'compacts exact deletion work items|rolls back work outcomes'
pnpm test tests/unit/shop-os-messaging-retention-acl.test.ts -t 'consent work items'
pnpm test tests/unit/shop-os-messaging-deletion.test.ts -t 'commits source and work outcome atomically|never deletes a parent before children'
pnpm test tests/unit/shop-os-messaging-retention-purge.test.ts -t 'compaction authorization'
pnpm exec tsc --noEmit
git diff --check
```

Expected: all selected tests pass; exact IDs and outcomes survive retries without cursor state.

- [ ] **Step 7: Review and commit Task 3**

```bash
git commit -m "Process messaging deletion work atomically"
```

Rollback gate: revert if the consent definer can mutate an event absent from the supplied request-scoped work items or if any source/outcome pair can commit separately.

---

### Task 4: Hold Revalidation and Atomic Request Finalization

**Files:**
- Modify: `drizzle/migrations/0033_shop_os_messaging_retention.sql:1395-1720`
- Modify: `lib/shop-os/messaging-deletion.ts:980-1140`
- Modify: `tests/helpers/db.ts`
- Modify: `tests/unit/shop-os-messaging-retention-schema.test.ts`
- Modify: `tests/unit/shop-os-messaging-retention-acl.test.ts`
- Modify: `tests/unit/shop-os-messaging-deletion.test.ts`

**Interfaces:**
- Produces: `finalize_messaging_deletion_request(uuid,uuid) returns table(state text, prior_record_counts jsonb, proof_summary jsonb)`.
- Consumes: canonical request, suppression barriers, request-scoped journal, and source/hold tables.

- [ ] **Step 1: Write finalization RED tests**

Add direct database and runtime proofs for:

- direct pending-to-completed update rejected;
- finalizer returns pending when an unjournaled source row, unresolved child, eligible pending item, or expired retained basis exists;
- 257 held consent records plus one eligible later record converge;
- more than 256 holds produce exact resource counts without paging holds;
- a released hold advances its item on retry;
- a held child lawfully retains its parent and exact parent/child counts;
- two customers' detached/held records never cross-contaminate;
- journal rows are absent after completion and the completed retry returns the same tombstone.

- [ ] **Step 2: Run finalization tests and verify RED**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts -t 'finalizes deletion work journal atomically'
pnpm test tests/unit/shop-os-messaging-deletion.test.ts -t 'held work converges|isolates final tombstones|deletes journal on completion'
```

Expected: failures show no finalizer and current page-local held aggregation.

- [ ] **Step 3: Add the narrow finalizer**

The security-definer function must:

1. lock the canonical request `FOR UPDATE`;
2. validate its shop, pending state, customer, and suppression barrier;
3. run exact request-scoped anti-existence checks for all five source families;
4. reject eligible pending work and unresolved parent dependencies;
5. revalidate every retained basis against current holds/source rows;
6. aggregate prior/result/held/detach counts from only `request_id = p_request_id`;
7. compute the version-2 tombstone and database transition time;
8. authorize the exact final transition transaction-locally;
9. delete the request's journal rows; and
10. update the request to completed with `customer_id = null`.

Return `pending` without deleting journal rows when any proof fails because work remains. Raise for malformed/cross-tenant state.

- [ ] **Step 4: Tighten the deletion-request guard**

Remove Task 3 cursor acceptance from pending progress after the runtime no longer writes it. Permit final completion only when the finalizer's transaction-local request/shop IDs match and no journal row remains. Preserve completed immutability and purge-only deletion.

- [ ] **Step 5: Replace application-side held/count reconciliation**

Delete cursor advancement, hold pages, shop-wide null-customer aggregates, and application-built final proof. After bounded discovery/processing, call the finalizer and map its returned state/proof to the unchanged `MessagingDeletionResult`.

- [ ] **Step 6: Add the writer/finalizer serialization proof**

Use two database clients: hold the shop lock in finalization, start a consent writer, prove it waits, commit finalization, then prove the writer returns the existing deletion/suppression rejection rather than inserting a row outside the tombstone.

- [ ] **Step 7: Run Task 4 GREEN tests**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts -t 'finalizes deletion work journal atomically|pending-to-completed'
pnpm test tests/unit/shop-os-messaging-deletion.test.ts -t 'held work converges|isolates final tombstones|deletes journal on completion|late|concurrent'
pnpm test tests/unit/shop-os-messaging-consent.test.ts -t 'deletion_pending|suppression'
pnpm exec tsc --noEmit
git diff --check
```

Expected: all selected tests pass; no journal/cursor/held-page reconciliation remains in the runtime.

- [ ] **Step 8: Review and commit Task 4**

```bash
git commit -m "Finalize messaging deletion from exact work journal"
```

Rollback gate: revert if completion can occur with any unjournaled, eligible, cross-request, or invalidly retained resource.

---

### Task 5: Whole-Branch Convergence, Review, and Row 31 Closure

**Files:**
- Modify: `docs/superpowers/specs/2026-07-13-shop-os-row31-deletion-work-journal-design.md`
- Modify: `docs/superpowers/plans/2026-07-12-shop-os-row31-deletion-convergence.md`
- Modify only if shipping in this branch: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Review: every file changed since the current `origin/main` Row 31 base.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: one reviewable Row 31 source branch with no known correctness finding and a clean verification packet.

- [ ] **Step 1: Remove superseded Task 3 code and tests**

Search for `cursors`, `holdCursor`, `holdPage`, `reconciledHeld`, and the old consent compaction signature. Keep only historical documentation references and tests that explicitly prove their removal.

- [ ] **Step 2: Run the focused Row 31 suites serially**

Run:

```bash
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts
pnpm test tests/unit/shop-os-messaging-retention-acl.test.ts
pnpm test tests/unit/shop-os-messaging-consent.test.ts
pnpm test tests/unit/shop-os-messaging-deletion.test.ts
pnpm test tests/unit/shop-os-messaging-retention-purge.test.ts
```

Expected: every suite passes with no concurrent heavy test process.

- [ ] **Step 3: Run project verification**

Run:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 4: Review the exact branch diff**

Fetch current `origin/main`, identify the Row 31-only base, and inspect the branch diff for production actions, readable journal identity, unbounded SQL, unrelated changes, stale cursor code, weakened ACL/RLS, and scope drift. Confirm `tasks/lessons.md` is unstaged.

- [ ] **Step 5: Run one severity-gated final review**

Review only for concrete critical/important correctness or security defects with a reproducer. Fix at most one bounded remediation wave. Stop and re-approach if the same architecture fails again; do not enter an open-ended review loop.

- [ ] **Step 6: Update durable status and commit closure**

Change the work-journal spec status to implemented/verified, mark the superseded Task 3 plan section accordingly, and update the active Shop OS status only if the branch is actually ready to ship. Commit only source-controlled Row 31 files.

```bash
git commit -m "Verify Shop OS messaging deletion convergence"
```

- [ ] **Step 7: Finish the branch**

Use `superpowers:finishing-a-development-branch`, present the verified integration choice, and do not apply production migration 0033 without the separate production gate.
