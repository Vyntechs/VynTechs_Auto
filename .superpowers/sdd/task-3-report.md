# Task 3 Report — Atomic Journal Outcomes and Exact Consent Work Items

## Status

Complete. Replaced cursor-based consent compaction with exact request-scoped work-item compaction and made ordinary source mutations advance their journal outcomes in the same transaction. Quote-send parents remain locked before children and cannot delete while any source or journal child is unresolved. Task 4 finalization and journal deletion were intentionally not implemented.

## RED proof

The required focused tests were written before production changes and failed for the expected reasons:

- Exact schema tests: 2 failed because `compact_messaging_consent_work_items(uuid,uuid,uuid[])` did not exist.
- Runtime atomicity test: the source notification deleted while its journal item remained `pending`.
- Purge-authorization test: exact consent compaction was absent, so separation could not be proven.

No production file changed before those failures were observed.

## Implementation

- Added `compact_messaging_consent_work_items(uuid,uuid,uuid[]) returns integer` and removed the superseded cursor signature.
- Validated 1–256 distinct, non-null exact work-item IDs; locked the canonical pending request and supplied pending consent-event items; proved exact source ownership; and locked matching events, projections, suppressions, and active holds.
- Detached suppression source references, recorded each exact detach count, advanced exact work outcomes, and deleted only represented consent events in one transaction.
- Kept purge and compaction transaction-local authorization mutually exclusive.
- Updated migration ACL repair and fixture drift proof for the exact service-only security-definer signature.
- Journaled internal deletion-workflow consent events with `counts_toward_proof = false` and compacted them by exact work-item ID.
- Made SMS-log and notification deletion advance the matching work outcome atomically.
- Made held resources resolve with an exact `resource_hold`, `subject_hold`, or `held_dependency` basis.
- Required quote-send child deletion/outcomes before parent deletion and retained parents with lawfully retained children.
- Prioritized unresolved sends ahead of terminal retained sends so retry pages converge without replay counting.
- Aggregated Task 3 progress from request-scoped journal outcomes instead of incrementing page-local counters.

## GREEN proof

Fresh required commands:

```text
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts -t 'compacts exact deletion work items|rolls back work outcomes'
2 passed, 77 skipped

pnpm test tests/unit/shop-os-messaging-retention-acl.test.ts -t 'consent work items'
1 passed, 9 skipped

pnpm test tests/unit/shop-os-messaging-deletion.test.ts -t 'commits source and work outcome atomically|never deletes a parent before children'
7 passed, 59 skipped

pnpm test tests/unit/shop-os-messaging-retention-purge.test.ts -t 'compaction authorization'
1 passed, 36 skipped

pnpm exec tsc --noEmit
exit 0, no diagnostics

git diff --check
exit 0, no whitespace errors
```

Broader regression proof:

```text
pnpm test tests/unit/shop-os-messaging-retention-schema.test.ts tests/unit/shop-os-messaging-retention-acl.test.ts tests/unit/shop-os-messaging-deletion.test.ts tests/unit/shop-os-messaging-retention-purge.test.ts
4 files passed; 192 tests passed; 0 failed
```

## Self-review

- Exact consent compaction cannot mutate an event absent from the supplied request-scoped pending work items.
- Replay is rejected because supplied work items are no longer pending after the first commit.
- An injected outcome failure rolls back event deletion, suppression detachment, and work-item mutation.
- Injected runtime failures roll back quote-send, SMS-log, notification, consent-event, journal, and request-progress mutations.
- Parent deletion checks both unresolved journal children and unjournaled source children.
- The old consent-compaction signature remains only in the ACL test that proves it is absent.
- Consent work no longer reads or writes a consent-event cursor. Task 4 still owns removal of legacy hold paging and application-side finalization.
- Only the eight Task 3 source/test files and this report are staged; the pre-existing user-owned `tasks/lessons.md` change is excluded.

## Concerns

None within Task 3. The branch still requires Task 4's database finalizer, retained-basis revalidation, hold-page removal, and atomic journal deletion before Row 31 is complete.

## Skipped/Failed

- Production migration apply, provider calls, routes, UI, cron, credentials, policy, diagnostics, and Task 4 finalization: explicitly out of scope and skipped.
- Two intermediate broad verification runs exposed distinct test/behavior regressions (legacy cursor assertions, retry progress expectations, and retained-send starvation); each was corrected and the final broad suite is green.
- Full repository suite and production build: deferred to whole-branch convergence after Task 4.
