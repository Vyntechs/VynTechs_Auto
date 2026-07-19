# Current-production security Wave 2H closure receipt

**Branch:** `security/ai-pii-penetration-audit-2026-07-19`  
**Reviewed base:** `5b9fb0505a1f505eb8de8b0129b607e3d618ce4e`  
**Status:** Subscription events now advance base billing and optional diagnostics truth together under durable deduplication and provider-order controls.

No production Stripe API, webhook secret, subscription, entitlement, database, customer record, payment, or diagnostic setting was read or changed.

The design follows Stripe's current documented guarantees: webhook events may arrive out of order, and endpoints should guard against duplicate event IDs. Source reviewed 2026-07-19: [Stripe webhook documentation](https://docs.stripe.com/webhooks?lang=node).

| Finding | Durable control | Regression proof | User friction | Residual risk |
|---|---|---|---|---|
| `CAND-S010-003` | Migration `0042` adds a server-only processed-event ledger and a paired last-event cursor. One per-customer row lock serializes transitions; event ID uniqueness absorbs duplicates; older provider timestamps become `stale`; distinct equal-second events retrieve authoritative Stripe state; both local projections update in one transaction. | Newer-then-older, older-then-newer, duplicate-before/after, concurrent distinct, equal-second active/canceled, unknown-customer, missing-envelope, reconciliation-failure, and synthetic mid-projection database-failure cases all pass. | none | Equal-second reconciliation holds one customer row lock during a Stripe read and returns retryable 500 if Stripe is unavailable. The metadata ledger needs a future retention job if event volume becomes material; deleting it must preserve each customer's last-event cursor. |

## Migration safety

- Additive nullable cursor columns preserve every existing `stripe_customers` row.
- The new ledger begins empty, stores no signed body or customer payload, and is denied to `anon` and `authenticated` by both privileges and RLS.
- The ephemeral production-migration harness verifies all columns, constraints, index, policy, grants, and reapplication idempotence.
- Rollback before deployment: revert code and omit migration `0042`. After deployment: leave the additive table/columns in place while reverting application reads; do not drop audit state during an incident.

## Verification receipt

- Test-first proof: a newer deletion followed by an older active snapshot restored `active` before implementation.
- Focused ordering, entitlement, signature, and migration gate: 4 files, 26 tests passed.
- Complete billing, Stripe, access, entitlement, portal, checkout, and subscriber neighborhood: 13 files, 153 tests passed.
- `pnpm exec tsc --noEmit`: passed.
- `pnpm build`: passed on Next.js `16.2.10`; 64 pages generated.
- `git diff --check`: passed.

## Remaining gate

All seven high and all fourteen medium current-production source findings are closed with focused proof. Live-control inspection, broad-suite diagnosis, controlled browser proof, final role/tenant/account-status/retry/concurrency verification, base-drift review, and independent re-scan remain before Row 50 can be completed, deployed, or merged.
