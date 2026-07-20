# Current-Production Security Wave 2H: Stripe Ordering Integrity

**Goal:** Close `CAND-S010-003` so an older authentic Stripe subscription event can never overwrite newer billing or diagnostics-access truth.

**Architecture:** Stripe explicitly does not guarantee event delivery order and recommends deduplicating event IDs. Add a server-only processed-event ledger plus last-applied event metadata on the mapped Stripe customer. Serialize each customer's transition in one database transaction, acknowledge exact duplicates, retain stale events as audit receipts without applying them, and resolve distinct equal-second events from Stripe's authoritative subscription object before atomically updating both local projections.

**Current official grounding:** [Stripe webhook event ordering and duplicate handling](https://docs.stripe.com/webhooks?lang=node) (reviewed 2026-07-19).

## Constraints

- Preserve raw-body signature verification, recognized event types, paywall behavior, diagnostics hard-off policy, and the public webhook response shape.
- Store only provider event IDs, type, timestamp, customer ID, disposition, and processing time; never store signed bodies or customer payloads.
- Lock by mapped Stripe customer so distinct events serialize; exact duplicate claims must be database-enforced.
- Apply base subscription and add-on projections in the same transaction.
- Equal provider timestamps must use an authoritative Stripe retrieval; retrieval failure rolls back the event claim and returns retryable server failure.
- Unknown customers remain harmless and write no entitlement or processed-event row.
- No production event, secret, subscription, entitlement, customer row, or live Stripe API call during implementation.

## Test-first execution

- [ ] Reproduce newer cancellation followed by older active delivery restoring access.
- [ ] Prove newer removal followed by older add-on delivery leaves both projections denied.
- [ ] Prove exact duplicate delivery applies at most once before and after another transition.
- [ ] Prove older-then-newer advances normally, while newer-then-older records stale without regressing.
- [ ] Prove distinct equal-second events reconcile from an injected authoritative retrieval and a retrieval failure rolls back cleanly.
- [ ] Prove migration completeness, server-only ACL/RLS, unknown-customer behavior, signature failures, and transaction atomicity.
- [ ] Run all Stripe, access, entitlement, migration, typecheck, build, and diff gates.
- [ ] Record closure while keeping Row 50 `in_progress` until live controls and final proof complete.
