# Shop OS Phase-3 Quote Domain Implementation Plan

**Goal:** Ship row 17's deterministic quote domain and thin authenticated APIs without UI, production schema application, sends, vendors, repair execution, or diagnostic changes.

**Architecture:** Pure scaled-integer math feeds one canonical snapshot builder. Injected handlers own tenant-safe draft line CRUD, ticket-version serialization/invalidation, and exact-version phone/in-person decisions. Existing row-16 constraints and immutable triggers remain the database backstop.

## Global constraints

- No schema/migration changes and no production database access.
- Use `canBuildQuotes` and `canRecordCustomerApproval`; never scatter role comparisons.
- Derive tenant/actor from current persisted profile inside each transaction.
- Allow reads/draft CRUD on open provisional tickets; reject version/decision on unreconciled, closed/canceled, cross-shop, cross-ticket, stale/superseded, or malformed context without leaking existence.
- Use BigInt scaled numerators and fail closed before converting any persisted/output cents value beyond safe range.
- Lock ticket first, then stable dependent rows with `NOWAIT`; return retryable 409 instead of waiting behind a held job.
- Preserve the diagnostic engine and all current session behavior.

## Task 1: Claim, critique, and publish

- [x] Close row 16's final shipping checkbox with PR/tree proof.
- [x] Mark row 17 active and correct the stale resume protocol.
- [x] Draft the row-17 design and implementation packet from the approved master contract.
- [x] Independently attack lock order, snapshot identity, math precision, mutation invalidation, role gates, idempotency, and row boundaries; correct two Critical, eight Important, and three Medium findings in the packet.
- [x] Commit/push the approved packet and open draft PR #128 before implementation.

## Task 2: Pure quote math and snapshot types

**Files:** Create `lib/shop-os/quote-math.ts`; create focused math tests.

- [x] Prove canonical quantity/hour parsing and rejection at precision/range boundaries.
- [x] Prove BigInt labor/tax numerators, default/override, subtotal, taxable subtotal, half-up tax, final safe conversion, and overflow behavior without floating-point multiplication.
- [x] Define `QuoteSnapshotV1`, recursive JSON key canonicalization, stable job/line/attachment ordering, and content-only identity without volatile actor/time fields.
- [x] Independently review math and snapshot identity; resolve tax-cap, stored-null-rate, volatile-story-metadata, and boundary-proof findings through tests.

## Task 3: Tenant-safe draft line CRUD and invalidation

**Files:** Create/extend `lib/shop-os/quotes.ts`; add PGlite tests.

- [x] Add strict per-kind manual schemas, tenant-derived pinned-rate exact-retry client-key create, no-op update, and privacy-safe idempotent delete.
- [x] Reauthorize persisted actor/ticket/job/line; allow open provisional draft work while rejecting closed/canceled/cross-boundary context.
- [x] Atomically supersede the sole active version, reset every snapshot-included job, clear approved pointers, leave excluded jobs unchanged, and fail closed on duplicate-active anomalies.
- [x] Prove unauthorized direct projection repoint/clear is absent from public domain inputs.
- [x] Independently review draft mutation and invalidation; resolve snapshot, decimal-bound, safe-projection, tenant-key privacy, lock-classification, and UUID-canonicalization findings through tests.

**Task-3 verification boundary:** PGlite proves the generated `NOWAIT` lock structure and deterministic `55P03` rollback/classification, but cannot prove real two-connection wait timing.

## Task 4: Immutable version creation

- [ ] Lock ticket then stable dependent rows with `NOWAIT`; reauthorize/reload the complete quote context and return retryable 409 on contention.
- [ ] Reject unreconciled tickets, unconfigured tax, missing labor rate when computation is requested, empty quotes, and unsafe snapshot values.
- [ ] Return an identical sole active snapshot on retry; otherwise supersede once and allocate `max(versionNumber)+1` atomically.
- [ ] Persist only content-stable typed inputs and move non-canceled jobs with lines to `quote_ready`; leave excluded jobs untouched.
- [ ] Prove held diagnostic job, add-job serialization, duplicate-active anomaly, same/different concurrent requests, canonical ties/nested JSON, and immutable-trigger behavior.
- [ ] Independently review version creation.

## Task 5: Idempotent phone/in-person decision

- [ ] Require advisor/owner capability and current exact version containing the named job.
- [ ] Use discriminated approval/decline input; append event plus update projection atomically, and serialize new-key approve→decline or decline→approve so the projection follows the latest event before any work-execution path exists.
- [ ] After actor authorization, return exact actor-bound request-key retries before stale checks and conflict on changed/cross-actor reuse.
- [ ] Prove held diagnostic job, event-then-projection rollback, same/different concurrent keys, both authorized decision reversals, cross-boundary/stale/role/channel failures, and forbidden direct repoint/clear.
- [ ] Independently security-review the event/projection seam.

## Task 6: Thin route shims

- [ ] Add the safe builder GET plus line, version, and phone/in-person decision routes required by row 18.
- [ ] Authenticate, paywall-check, validate strict JSON, translate current profile, and map discriminated outcomes.
- [ ] Prove route verbs, malformed JSON, auth/paywall, privacy-safe 404, conflict, and success mappings.

## Task 7: Verify, reconcile, and ship

- [ ] Run focused tests, full suite, TypeScript, production build, and diff checks.
- [ ] Review the full diff for money drift, tenant leaks, mutable history, projection/event divergence, deadlocks, future-row scope, and engine changes.
- [ ] Resolve all task and whole-branch findings through tests.
- [ ] Add the row-17 implementation correction, mark row 17 complete, preserve owner/external gates, and identify row 18 as next.
- [ ] Push final head, pass GitHub checks, mark ready, squash-merge, verify tree equality, and immediately continue row 18.

## Verification

```bash
pnpm test <row-17-focused-files>
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check origin/main...HEAD
```

## Stop conditions

- Stop before production DDL/data, live Supabase, external account/credential/spend, send/token, vendor/order, repair mutation, or deployment enablement.
- Stop if exact approval cannot be bound atomically to its immutable event/version without a new schema change.
- Stop if safe lock ordering requires modifying diagnostic-start semantics or another active lane.
