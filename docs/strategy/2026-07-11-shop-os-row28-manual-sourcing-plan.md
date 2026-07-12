# Shop OS Row 28 — Manual Parts Sourcing Execution Plan

> This plan is not implementation authority until live Row 27 DDL is explicitly approved, applied from `0030_shop_os_vendor_accounts.sql`, and verified. Design review and docs shipping are safe before that gate.

## Intended change

Add a pure adapter boundary, integration-manager-created manual supplier accounts, and retry-safe human-verified offer capture/removal that fills complete quote truth without exposing internal sourcing data.

## Why this is the smallest path

Existing manual quote lines already cover most entry and money behavior. Row 28 adds only the missing supplier identity, normalized manual snapshot, adapter seam, and customer-safe projection completeness. Provider transports, orders, and UI stay in their owned later rows.

## Gate 0 — Live Row 27 prerequisite

1. Obtain explicit owner approval for the exact reviewed `0030_shop_os_vendor_accounts.sql` production apply.
2. Re-read live migrations/table state and prove `vendor_accounts` absent plus `job_lines.vendor_account_id` empty.
3. Apply the identical SQL through Supabase migration tooling; do not edit it in the dashboard.
4. Verify exact table/columns/checks/index/FKs/RLS/policy/grants, zero starting accounts, existing quote rows, security/performance advisors, and signed application health.
5. Stop and roll back/repair before Row 28 runtime work if any invariant or advisor regresses.

## Task 1 — Lock pure adapter and snapshot contracts

1. Add failing tests for strict search/refresh inputs and discriminated results; the interface contains no order methods.
2. Add the provider-neutral types plus a zero-network manual adapter.
3. Normalize only approved availability/fulfillment/money/fitment/reference fields; server-own verification time and actor.
4. Prove credentials, secret refs, raw payloads, and unknown keys cannot enter output or logs.

## Task 2 — Add manual account handlers and routes

1. Test `canManageIntegrations` create/update (including founder override), all-builder safe list, tenant-bound exact replay, changed-key conflict, display/enabled CAS, tenant isolation, inactive membership, and strict request/response projection.
2. Implement handler-in-`lib/` plus thin routes.
3. Force `vendor='manual'`, manual mode, `{}` config, null ref, enabled state, and bounded names server-side. Reauthorize before replay and compare exact normalized row truth; do not claim actor-bound account replay.
4. Add no API/punchout write path and no reference resolver.

## Task 3 — Add manual offer capture

1. Test the canonical ticket → all jobs → all lines → active versions → actor → account lock order, open/reconciled state, exact repair/maintenance `open|blocked` predicate, rejection of diagnostic/in-progress/done/canceled/pinned work, same-shop enabled manual account, and rollback.
2. Use `clientKey` as line ID and persist an exact canonical request fingerprint excluding server fields; test authorization-before-replay, exact retry after quote invalidation, changed collision, unavailable/no-line, and remove/retry.
3. Write only the version-1, 4-KiB, fixed-USD canonical `vendor_offer` line/snapshot contract with capture-time account display, server sort/time/verifier, explicit extended-price/core semantics, and strict stored-truth revalidation. Prove account rename/disable does not invalidate historical lines/versions; current enabled state gates new capture only.
4. Extend safe quote builder/versions so all customer-visible lines and totals remain complete while internal cost/vendor context stays absent. Add `source`/`mutable`; make the existing UI/parser render sourced lines read-only with no broken ordinary Edit/Remove controls.
5. Add exact internal response schemas, strict thin capture/removal routes, and hostile-response/privacy tests.

## Task 4 — Converge and ship

1. Run Row 17/18/19/27/28 focused regressions.
2. Run the complete suite, TypeScript, production build, and diff checks serially.
3. Obtain independent LP domain/security review plus bounded LQ quote-projection and A compatibility-UI review; correct every validated finding.
4. Update the active plan and driver with exact proof, open a ready PR, wait for checks, merge, source-deploy, and run signed non-mutating smoke plus fresh error logs.

## Done when

An authorized shop user can use tested server contracts to select/create a manual supplier, record one human-verified offer exactly once, and produce complete customer-safe quote truth with no provider dependency or secret exposure; independent review and production verification are clean.

## Stop if

Stop for unapplied/partial live Row 27 schema, production DDL without approval, provider access, credentials, spend/order placement, new schema, diagnostic-engine changes, customer-facing legal copy, or any requirement that moves work into Rows 29, 30, 38, 41, or 43.
