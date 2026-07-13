# Shop OS Row 31 Bounded Deletion Convergence Design

**Status:** Owner-approved 2026-07-12
**Scope:** Replace permanent `busy` ceilings with bounded, retry-safe verified deletion. Source only; production application remains a separate gate.

## Invariants

- Suppression commits before cleanup and remains active through every retry.
- One canonical pending deletion operation coordinates a `(shop_id, customer_id)` at a time.
- Every call locks shop → canonical request → customer before resource rows.
- Each call processes at most the existing family and total budgets.
- Progress is monotonic, bounded, privacy-safe, and committed atomically with its resource mutations.
- Completion occurs only after every family is exhausted or lawfully retained under an active hold.
- Completed tombstones remain immutable and retain exact accumulated proof.

## Canonical Pending Operation

Add a partial unique index on `messaging_deletion_requests (shop_id, customer_id) where state = 'pending' and customer_id is not null`.

`requestMessagingDeletion` continues exact request-key idempotency. A second valid deletion request for the same customer while cleanup is pending strengthens every supported-key suppression barrier, then returns the canonical pending request ID instead of inserting a sibling request. It never weakens suppression or creates a second cleanup coordinator.

`guard_quote_send_lifecycle()` locks that one canonical pending request `FOR SHARE`, derives the required five-year barrier from it, and retains the exact suppression validation. The lifecycle no longer scans an unbounded sibling-request set because the database proves at most one exists.

## Pending Progress Envelope

Pending requests may update only `prior_record_counts` and `proof_summary`. Identity, customer, destination fingerprint, key version, reason, actor, request key/fingerprint, requested time, state, completion time, and retention time remain immutable.

The pending `proof_summary` uses an exact versioned envelope:

```json
{
  "progressVersion": 1,
  "resultCounts": {},
  "heldCounts": {},
  "detachedSuppressionSources": 0,
  "cursors": {}
}
```

Allowed count keys are the existing final proof/count vocabulary only. Values are non-negative safe integers and may never decrease. Cursor values are opaque UUID/time ordering keys for existing Row 31 records; no phone number, message content, token, evidence payload, customer name, or destination appears. The envelope remains below the existing 4 KiB proof bound.

The database guard accepts `pending → pending` only when the exact envelope validates and every count/cursor is monotonic. `pending → completed` remains the only terminal transition. Final completion removes progress-only cursors and writes the existing bounded tombstone summary.

## Bounded Resource Passes

`completeMessagingDeletion` processes resources in the existing dependency and lock order. It selects no more than the current per-family limits and no more than `MAX_TOTAL_RESOURCES` successful resource outcomes per call.

Deleted or detached rows disappear from later customer-bound scans. Lawfully retained immutable rows advance an opaque cursor so they are counted once. After a pass:

- if eligible work remains, atomically update pending progress and return `state: 'pending'` with accumulated counts;
- if no eligible work remains, reconcile accumulated counts, complete the tombstone, detach readable customer identity, and return `state: 'completed'`.

A transaction failure rolls back both resource changes and progress. Retrying the same request therefore repeats no committed work and loses no committed count.

## Bounded Consent Compaction

Replace whole-subject consent deletion with a bounded security-definer batch function. It:

1. requires the canonical same-shop pending request and its non-null customer;
2. locks the subject projection and the next ordered event batch;
3. proves every selected row belongs to that customer;
4. rejects active subject or event holds;
5. deletes only the authorized event IDs;
6. records the exact deleted count in the canonical request’s pending progress inside the same transaction; and
7. exposes transaction-local request/shop/event authorization consumed by the deferred delete guard.

The deferred guard accepts only exact event IDs authorized by that definer call. It no longer requires request completion in the same transaction because the pending request, suppression barrier, and atomic progress update are the durable authorization. Purge authorization remains separate and unchanged.

The projection is deleted only when the subject has no remaining unheld events. Held subjects remain readable only to the extent required by the active hold and advance a subject cursor so retries do not recount them.

## Convergence and Idempotency

Stable datasets above every former ceiling converge after finite retries. This includes more than 128 sends, 256 consent events, 512 SMS rows, 256 notifications, 256 holds, and 1,024 total resources. Multiple incoming requests coalesce, so the former 33-pending-request dead end cannot be created.

Completed retries return the same tombstone and counts. New messaging cannot appear through the suppressed eligibility path while deletion is pending.

## Verification

- Preserve the deterministic 129-send RED and make repeated calls complete with 129 exact sends.
- Prove a second request coalesces to the canonical pending operation.
- Prove pending progress accepts exact monotonic updates and rolls back regressions, unknown keys, identity changes, and privacy-unsafe values.
- Prove more than 256 same-subject events compact across bounded calls with exact counts.
- Convert every former `limit + 1 => busy` assertion into finite retry convergence proof.
- Re-run schema, ACL, consent, deletion, purge, TypeScript, and diff checks.

## Authorized Source Boundary

Changes may touch migration 0033, its Drizzle mirror and exact schema/ACL fixtures, consent/deletion runtime, and their focused tests. No migration application, production data, provider, route, UI, cron, credential, send, public policy, or diagnostic-engine change is authorized.
