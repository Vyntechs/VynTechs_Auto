# Shop OS Row 31 Request-Scoped Deletion Work Journal Design

**Status:** Implemented and verified in source 2026-07-13; ready to ship. Migrations `0033` and `0034` have not been applied.

**Supersedes:** Task 3 runtime batching in `2026-07-12-shop-os-row31-deletion-convergence.md`

**Scope:** Source-only replacement for the failed cursor-based cleanup runtime. Production application remains a separate owner gate.

## Decision

Replace pending-request cursors with a temporary, request-scoped work journal. One journal row represents one source record. The journal records only opaque identifiers, dependency links, a bounded outcome, and privacy-safe counters.

The journal is the sole source for final deletion counts. Source tables remain the authority for whether a record still exists and whether an active hold lawfully retains it.

This design preserves the finished canonical-request and consent-compaction work from Tasks 1 and 2. It replaces only the Task 3 cleanup coordinator and its cursor/held-count behavior.

## Why the Cursor Design Is Replaced

The cursor design passed its authored tests but failed whole-branch review in four structural ways:

1. A full page of held consent records could be read forever without advancing.
2. A later hold page could overwrite or omit retained counts from an earlier page.
3. A parent send could be processed before all of its SMS and notification children were discovered.
4. Shop-wide queries for already-detached rows could mix an unrelated customer's retained records into the final proof.

These are not isolated conditions. They all come from using changing source pages as both the work queue and the completion proof. The journal separates those responsibilities.

## Alternatives Considered

### Selected: one request-scoped item per source record

Each source record is discovered once with an anti-join, linked to its parent when applicable, and advanced atomically with its source mutation. Completion aggregates only those request-scoped items.

This adds one temporary server-only table, but it makes discovery, dependency ordering, exact counts, retries, and held-record proof independently testable.

### Rejected: keep adding source-table cursors

More cursors would still need special cases for held pages, expired holds, late children, detached parents, and count reconciliation. The proof would remain distributed across changing source rows and bounded JSON.

### Rejected: delete everything in one unbounded transaction

One transaction would avoid durable progress, but large customers could hold locks too long, stall ordinary shop work, exceed practical statement limits, and recreate the original permanent `busy` ceiling as operational failure.

## Data Model

Add `messaging_deletion_work_items` to migration 0033 and its Drizzle mirror.

Each row contains:

- `id`: opaque journal UUID;
- `shop_id`: tenant boundary;
- `request_id`: canonical pending deletion request;
- `resource_type`: `consent_event`, `consent_projection`, `quote_send`, `sms_log`, or `notification`;
- `resource_id`: opaque UUID of the source record;
- `parent_work_item_id`: nullable self-reference used for dependency ordering;
- `outcome`: `pending`, `deleted`, `detached`, or `retained`;
- `retention_basis`: null unless retained; otherwise `resource_hold`, `subject_hold`, or `held_dependency`;
- `counts_toward_proof`: false only for internal deletion-workflow consent events;
- `detached_suppression_sources`: non-negative integer, used only by consent-event items;
- `discovered_at` and nullable `resolved_at`.

Required database invariants:

- unique `(request_id, resource_type, resource_id)`;
- composite request foreign key keeps `shop_id` and `request_id` aligned;
- a parent item belongs to the same request;
- `pending` has no retention basis or resolution time;
- `deleted` and `detached` have no retention basis and have a resolution time;
- `retained` has one exact retention basis and a resolution time;
- only consent-event items may have a non-zero detached-suppression count;
- resolved outcomes cannot regress; a retained item may advance to `deleted` or `detached` if its hold expires before finalization;
- no direct client role has table privileges; service-only RLS, ACL, and trigger proof match the other Row 31 internal tables.

The mutation guard accepts inserts only as `pending`, locks the canonical request, and validates the exact source row, customer binding, proof-count classification, and parent relationship before the item becomes part of the journal. Final counts therefore never trust an application-supplied classification.

The journal stores no customer ID, subject key, destination fingerprint, key version, phone number, customer name, message, token, evidence, vehicle detail, provider payload, or secure URL.

Journal rows are temporary. Successful finalization folds their counts into the existing privacy-minimized tombstone and deletes every item in the same transaction. No journal row survives a completed request.

## Dependency Map

```text
canonical deletion request
│
├── consent projection
│   └── consent event
│       └── suppression source reference [count only; detached atomically]
│
├── quote send
│   ├── SMS log
│   └── quote-send notification
│
└── customer notification
```

The suppression source is not a separate journal item. Its exact detach count is stored on the consent-event item in the same transaction that detaches the reference and deletes the event.

An event links to the exact projection with the same shop, subject, destination fingerprint, key version, and program version when that projection exists. An SMS log or quote-send notification links to the exact quote-send item. A customer notification has no parent item.

Parents cannot resolve as deleted until every discovered child is resolved and an anti-existence query proves no undiscovered source child remains. A parent retained solely for a child uses `held_dependency` and must still have a lawfully retained descendant at finalization.

## Runtime Flow

```text
complete deletion call
│
├── lock shop [prevents current/future messaging writers racing final proof]
├── revalidate live actor authority
├── lock canonical request FOR UPDATE
├── return immutable tombstone if already completed
├── lock customer
│
├── discover bounded unjournaled source records
│   ├── quote sends by exact request customer
│   ├── consent projections/events by exact request customer
│   ├── SMS logs by this request's quote-send items
│   ├── quote-send notifications by this request's quote-send items
│   └── customer notifications by exact request customer
│
├── process bounded journal items
│   ├── lock parents before children
│   ├── mutate children before parents
│   ├── delete eligible ordinary records
│   ├── detach required send identity/token material
│   └── mark active-hold records retained with exact basis
│
├── final reconciliation [database function]
│   ├── prove no unjournaled source record remains
│   ├── prove every parent dependency is resolved
│   ├── revalidate every retained hold/dependency
│   ├── return pending if any eligible work remains
│   ├── aggregate exact request-scoped counts
│   ├── delete this request's journal rows
│   └── complete the immutable tombstone atomically
│
└── return pending or completed
```

## Discovery Rules

Discovery uses `NOT EXISTS` against the journal rather than a cursor. Every discovery query is ordered and limited. Already-journaled rows are skipped even when they remain in the source table under a hold.

Each call has two independent hard bounds:

- at most 1,024 newly discovered journal items;
- at most the existing per-family and 1,024 total source outcomes.

The bounds control both write amplification and lock duration. Repeated calls converge because each committed call either adds previously absent items, advances unresolved items, or completes. A transaction failure commits neither discovery nor source outcomes.

Discovery always starts from the canonical request's still-present customer binding. A quote send must be journaled before cleanup detaches its `customer_id`. All later child discovery joins through that request-scoped quote-send item, so detached or same-shop records can never be reassigned by inference.

Holds are not paged and are not journal items. They are indexed predicates evaluated for each bounded resource item. Therefore 257 or 25,700 hold rows cannot become a work cursor or a completion counter.

## Processing and Lock Order

The canonical request is selected `FOR UPDATE`; that lock serializes every cleanup call for the customer. Do not use `SKIP LOCKED`, because skipped work must never look exhausted.

The database lock order remains:

```text
shop
└── canonical request
    └── customer
        └── journal items
            ├── quote-send parents
            ├── consent projection/event parents
            ├── SMS children
            ├── notification children
            └── matching active holds
```

Source mutations occur child-first after the necessary parent locks are held:

- detach suppression references, then delete consent events, then delete empty projections;
- delete or lawfully retain SMS/notifications, then delete or detach their quote send.

The bounded consent security-definer function from Task 2 remains. It receives exact journaled event IDs, detaches suppression references, deletes only those event IDs, and advances their work-item outcomes and counts inside the same transaction. It no longer owns or consumes a deletion cursor.

All current and future messaging writers must lock the shop row before inserting or changing a Row 31 source resource. Existing consent writes already obey this contract. The completion transaction holds the same shop lock through its final anti-existence proof, so a late writer either commits before discovery sees it or waits until after suppression/completion makes the write ineligible.

## Holds and Retained Records

An active resource hold or subject hold may resolve an item as `retained`. A parent required by an actively held child may resolve as `retained` with `held_dependency`.

Retained does not mean blindly permanent. Before completion, final reconciliation revalidates every retained item against the source row and currently active hold:

- if the basis remains valid, the item contributes once to the held proof;
- if the hold expired or was released, the request remains pending and the item is eligible to advance to deleted or detached on the next bounded pass;
- if the source record disappeared outside the authorized transaction, fail retryably rather than manufacture an outcome;
- if a dependency basis has no actively held descendant, it is invalid and cannot complete.

Held pages cannot starve ordinary work because processing selects unresolved eligible items and excludes currently valid retained items. Counts do not come from the current hold query; they come from the final request-scoped journal aggregate.

## Atomic Finalization

Add one service-only security-definer function for final reconciliation and completion. It is intentionally narrow: it does not discover or mutate ordinary source records.

Inside the caller's already ordered transaction it:

1. locks and validates the canonical pending request;
2. proves all five source families have no unjournaled matching rows;
3. proves no eligible pending item or unresolved dependency remains;
4. revalidates every `retained` basis;
5. aggregates exact prior, deleted, detached, retained, and held counts from work items for this request only;
6. constructs the existing bounded version-2 tombstone proof;
7. deletes all journal items for this request; and
8. changes the request from pending to completed with its customer binding removed.

Steps 5–8 are one database transaction. A failure rolls back the journal deletion and tombstone update together.

The deletion-request mutation guard requires the finalizer's transaction-local authorization and rejects direct pending-to-completed updates. The work-item guard rejects fabricated terminal outcomes, cross-request parent links, privacy-unsafe fields, and outcome regressions.

## Exact Count Mapping

Final counts are derived mechanically:

- prior consent events: countable `consent_event` items;
- prior consent projections: all `consent_projection` items;
- prior quote sends, SMS logs, notifications: all items of that type;
- deleted consent events: countable consent-event items with `deleted`;
- deleted quote sends, SMS logs, notifications: matching items with `deleted`;
- retained quote sends: quote-send items with `retained`;
- held counts: retained items grouped by source type;
- detached suppression sources: sum of the consent-event counter;
- total held: sum of the five held source-family counts.

No shop-wide retained-row query participates in the tombstone. A different customer's null-customer send, SMS log, notification, or hold cannot affect this request.

## Idempotency and Recovery

- Request-key retry behavior and the canonical pending-request unique index remain unchanged.
- Repeating discovery is safe because the request/resource unique key turns it into a no-op.
- A source mutation and its journal outcome commit together.
- A completed retry returns the immutable tombstone without reading journal rows.
- A crash before commit repeats the same bounded work; a crash after commit resumes from durable outcomes.
- Stable datasets above every former ceiling converge after finite retries without `busy`.
- Legacy cursor progress needs no production compatibility because migration 0033 and Task 3 have never been applied. The source branch replaces that unshipped behavior before release.

## Verification Matrix

### Structural database proof

- clean migration creates the journal, exact constraints, indexes, RLS, ACL, self/request foreign keys, guards, and finalizer signature;
- direct client reads/writes and direct finalization fail;
- cross-shop, cross-request, and cross-parent item construction fails;
- only the controlled consent function can record a suppression detach count;
- request selection and finalization both contain `FOR UPDATE`.

### Convergence proof

- 129 sends, 257 same-subject consent events, 513 SMS logs, 257 notifications, and more than 1,024 total records complete after finite retries;
- 257 held consent records do not starve one eligible later record;
- more than 256 holds complete with exact held counts across retries;
- a hold released or expired before finalization reopens only its retained resource;
- a transaction failure rolls back source mutations and journal outcomes together.

### Dependency proof

- 257 earlier notifications for send A cannot hide notification 258 for send B;
- a send never deletes while an undiscovered or unresolved SMS/notification child exists;
- a consent projection never deletes while an undiscovered or retained event exists;
- an event deletion and every suppression-source detach are atomic and exactly counted.

### Isolation and race proof

- two customers in one shop with detached/held records produce independent tombstones;
- late consent, send, SMS, and notification rows inserted between retries are discovered;
- a writer racing finalization serializes on the shop lock and cannot land outside the proof;
- concurrent completion calls serialize on the canonical request and return one tombstone.

### Regression proof

- canonical request coalescing, exact request-key conflicts, multi-key suppression, live authorization, consent compaction, purge authorization separation, immutable completion, privacy-safe responses, TypeScript, schema drift fixtures, ACL tests, full Row 31 suites, and the project build remain green.

## Authorized Files and Boundaries

Implementation may touch:

- migration 0033 and its Drizzle mirror;
- exact schema, ACL, and migration-drift fixtures;
- deletion runtime and focused tests;
- bounded consent compaction only where required to replace its cursor with exact journal item IDs;
- the Row 31 convergence plan and final source status/proof documentation.

Do not apply a migration, touch production data, add a provider, route, UI, cron, credential, message send, published policy, or diagnostic-engine change. Stop if implementation requires readable identity in the journal, an unbounded discovery/mutation query, a relaxed suppression barrier, a lock-order inversion, or a second coordinator for the same customer.
