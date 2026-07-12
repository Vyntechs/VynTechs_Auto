# Shop OS Row 27 — Vendor Accounts Schema Execution Plan

> Execute on `feat/shop-os-row27-vendor-accounts-schema` from deployed `main`. One writer owns source; reviewers are read-only. This is a source/local-proof row only.

## Intended change

Add the minimum server-only `vendor_accounts` table and the existing `job_lines.vendor_account_id` composite tenant foreign key. Store only constrained `env:`/`vault:` references; do not store or resolve credentials.

## Why this is the smallest path

Row 28 needs stable vendor-account identity for manual sourcing, while provider transport is externally gated. One table plus one existing-column foreign key closes tenant and secret-reference gaps without adding handlers, UI, provider code, seeds, or production DDL.

## Task 1 — Lock the contract with failing tests

1. Add `tests/unit/shop-os-vendor-accounts-schema.test.ts`.
2. Assert exact Drizzle fields, checks, indexes, the direct `shops` parent FK, delete behavior, and the `job_lines` composite FK.
3. Apply the real Row 27 migration through the standard PGlite helper and prove absent/complete/partial guarded migration behavior.
4. Prove valid manual, `env:`, and `vault:` accounts; reject raw/malformed references, invalid mode/reference pairs, invalid/oversized config, invalid names, and cross-shop line linkage.
5. Prove RLS, grants, direct-access deny policy, and referenced-account delete protection.

## Task 2 — Add the source schema and migration

1. Add `vendorAccounts` to `lib/db/schema.ts` with `shop_id -> shops.id ON DELETE CASCADE`, tenant-safe keys, bounded checks, and the shop list index.
2. Add `drizzle/migrations/0030_shop_os_vendor_accounts.sql` with the identical table, direct shop FK, `job_lines` composite foreign key, RLS, grants, and deny policy.
3. Do not invoke Vault, create secrets, seed accounts, or apply DDL remotely.
4. Do not retry Drizzle generation in this row: two isolated evidence attempts already failed on the pre-existing malformed historical metadata before reading Row 27 changes. Record that limitation and verify schema/migration parity mechanically; do not repair or absorb ADC metadata in this row.
5. Extend the existing guarded post-journal test helper to apply `0030` after `0029`. Count the complete object set—table, columns, constraints, index, RLS policy, grants, and `job_lines` foreign key; zero markers means absent, every marker means complete, and any partial set fails.

## Task 3 — Converge and ship the source-only row

1. Run the new schema test and the Row 16 quote-foundation schema regression.
2. Run the complete test suite, TypeScript, production build, and `git diff --check` serially.
3. Request independent whole-branch schema/security review and correct every validated finding.
4. Update the active plan and driver with exact proof, leaving production apply as an explicit gate. Select Row 28 reconciliation/design only; runtime implementation cannot deploy until Row 27 DDL is owner-approved and live advisors/invariants pass, unless it is separately proven completely unreachable and dormant.
5. Open a ready PR, wait for required checks, merge, and confirm the source-only deployment is healthy. Do not claim the production table exists.

## Done when

Row 27 is merged and deployed as dormant source, local catalog/constraint behavior is proven, no runtime path queries the unapplied table, independent review is clean, and production remains unchanged. Row 28 reconciliation/design is the next safe lane; Row 28 runtime deployment and live Row 27 DDL remain behind the production-database gate.

## Stop if

Stop before production DDL, external representation/access, credentials, spend, raw secret storage, provider transport, diagnostic-engine changes, or any requirement to repair unrelated migration history.
