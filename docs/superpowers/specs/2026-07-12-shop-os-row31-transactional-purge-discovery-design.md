# Shop OS Row 31 Transactional Purge Discovery Design

**Status:** Owner-approved 2026-07-12
**Scope:** Close the remaining Task 7 locked-candidate starvation defect without schema, route, provider, cron, UI, or production changes.

## Problem

The purge worker must satisfy four constraints together:

1. preserve global `retain_until, id` order;
2. lock a shop before locking or deleting its messaging records;
3. keep security-definer purge context limited to one shop per transaction; and
4. make progress past an arbitrarily long prefix of externally row-locked candidates.

A fixed look-ahead cannot guarantee progress. Grouping non-contiguous hints by shop can reorder records. Locking candidates before shops violates the established deadlock-safe order. Persisting a cursor requires new schema and is outside Row 31.

## Selected Design

Use an ordered keyset walk over candidate hints.

1. Read a bounded page ordered by `retain_until, id`, starting strictly after an optional keyset cursor.
2. Divide the page into contiguous shop runs. Never combine a later run with an earlier run from the same shop.
3. Process runs in global order. Each run gets its own transaction:
   - lock exactly that shop first;
   - attempt the run's candidates with `FOR UPDATE SKIP LOCKED`;
   - keep any security-definer calls inside that single-shop transaction;
   - commit the run atomically.
4. Stop the family after the first run that deletes or newly identifies a held record.
5. If a run makes no progress because every candidate is locked or stale, advance the cursor beyond that run and continue.
6. If the page makes no progress, load the next keyset page. Stop only after progress, the successful-delete budget is exhausted, or the current candidate set is exhausted.

The public deletion budget remains 1–100. Lock contention may increase candidate scanning, but cannot increase successful deletions or permanently hide later eligible work.

## Ordering and Transaction Guarantees

- Keyset ordering is global and stable: `(retain_until, id)`.
- Contiguous runs preserve `A1, B1, A2`; `A1` and `A2` are never coalesced.
- A fully locked run may be skipped, but an unlocked later run remains discoverable.
- Only one shop is mutated in a transaction.
- A failed run rolls back that run and increments the existing bounded family failure count.
- Existing dependency-family gates and `skippedHeld` semantics remain unchanged.

## Code Boundary

Allowed implementation files:

- `lib/shop-os/messaging-retention-purge.ts`
- `tests/unit/shop-os-messaging-retention-purge.test.ts`

No migration, schema snapshot, public API, scheduled invocation, provider integration, credential, message send, production mutation, or diagnostic-engine change is authorized.

## Verification

Regression proof must demonstrate:

- locked candidates in shops A and B do not starve an eligible candidate in shop C;
- ordered hints `A1, B1, A2` never process `A2` before `B1`;
- crossing a keyset page boundary preserves contiguous-run ordering;
- security-definer calls never mix shops in one transaction;
- `skippedHeld` remains dependency-accurate; and
- the complete Row 31 focused suite, TypeScript, and diff checks pass.

If the local database harness cannot create genuine concurrent row locks, the orchestration boundary must be made deterministically testable without changing the public purge interface or adding production-only test hooks.

## Stop Conditions

Stop before schema expansion, production access, a change to shop-first locking, candidate-first row locking, or a third implementation that cannot reproduce the locked-prefix behavior in an automated test.
