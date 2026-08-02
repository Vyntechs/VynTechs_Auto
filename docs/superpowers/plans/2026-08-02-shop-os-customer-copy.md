# Shop OS Customer Copy — Implementation Plan

> Execute with test-driven development in the isolated worktree `/Users/brandonnichols/.buzz/REPOS/vyntechs-customer-copy` on branch `codex/customer-copy-2026-08-02`. Do not apply a production migration, merge, or deploy.

**Goal:** Let an advisor or owner reveal and browser-print a complete customer-safe estimate, invoice, or paid receipt from the existing repair order.

**Architecture:** Add optional shop identity fields, build one tenant-scoped server projection that allowlists customer-safe quote/ring-out data, and render one in-place print view. Reuse immutable quote readers and ring-out totals; never create a second money calculation.

**Convergence:** implementation → parallel static/security/runtime review → one consolidated repair wave → focused re-review → full verification → Buzz-linked draft PR.

## Task 1: Pin the shop identity contract

**Files:**
- Create: `drizzle/migrations/0049_shop_os_customer_copy_identity.sql`
- Modify: `lib/db/schema.ts`
- Modify: `app/(app)/settings/shop/page.tsx`
- Modify: `components/vt/shop-section.tsx`
- Modify: `app/api/shop/route.ts`
- Test: `tests/unit/shop-route.test.ts`
- Test: add or extend the nearest Shop Settings component test
- Test: `tests/unit/migration-replay.test.ts`

**Red:** Add tests proving owner-only validated persistence, null normalization, length bounds, Settings rendering, and empty-database migration replay.

**Green:** Add nullable shop phone/address columns, pass them into Settings, and extend the existing update route/form. Do not introduce a new endpoint or page.

**Verify:** Run the new shop route/component tests and migration replay. Inspect the migration for non-destructive nullable additions only.

## Task 2: Build the customer-safe read model

**Files:**
- Create: `lib/shop-os/customer-copy.ts`
- Modify: `lib/shop-os/quotes.ts`
- Test: `tests/unit/shop-os-customer-copy.test.ts`
- Test: extend quote-reader tests beside `readApprovedJobPricing`

**Red:** With real PGlite data, prove tenant isolation; owner/advisor access; technician/parts refusal; Estimate, Invoice, and Paid receipt selection; pinned approved-version pricing; draft prepared-version estimate pricing; exact ring-out totals; missing identity; corrupt snapshots; and the absence of all forbidden internal fields.

**Green:** Add one validated customer-safe draft snapshot reader beside the approved readers, then compose the read model. Reuse `getTicketRingOut` or its exact underlying calculation; do not recalculate tax or payment balance.

**Verify:** Run the new domain tests. Serialize the returned object in a test and assert forbidden keys/known internal sentinel strings are absent.

## Task 3: Add the in-place document and print behavior

**Files:**
- Create: `components/screens/customer-copy.tsx`
- Modify: `app/(app)/tickets/[id]/page.tsx`
- Modify: `components/screens/ticket-detail.tsx`
- Modify: the existing global stylesheet used by the app shell
- Test: `tests/unit/customer-copy.test.tsx`
- Test: extend `tests/unit/ticket-detail-screen.test.tsx` or the nearest current screen test

**Red:** Prove the role-shaped control, immediate in-place reveal, focus movement, exact document labels/content, incomplete/pricing error states, `window.print()` call, and exclusion of app controls in print media hooks/classes.

**Green:** Add one `Customer copy` action and a mounted paper preview. Keep the repair order present. Print only through `window.print()`; do not add a route, PDF dependency, send action, or mutation.

**Verify:** Run component/screen tests and assert the route count has no page addition.

## Task 4: Add real browser proof

**Files:**
- Add or extend the smallest existing hermetic Playwright fixture/spec that can render an authenticated repair order with controlled Customer Copy data
- Add screenshot artifacts only to the existing ignored evidence location; do not commit generated screenshots unless repository convention requires it

**Red:** First make the journey fail because the action or print-only layout is absent.

**Green:** At 390×844 and 1440×900, open the repair order, reveal Customer Copy, emulate print media, and assert: correct state; shop/customer/vehicle and money detail; no staff sentinel; only the document is visible; no overflow; no browser faults; no serious/critical Axe findings.

**Verify:** Save phone and desktop screen/print evidence with the exact tested commit. If browser proof is impossible before the source migration is applied to the hosted database, use a hermetic local database and report hosted proof as the release gate rather than weakening the test.

## Task 5: Update durable project truth

**Files:**
- Modify: `docs/strategy/SHOP_OS_DRIVER_STATE.md`
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`

Record the exact shipped branch behavior, proof, remaining production migration gate, and explicit exclusions. Do not mark it live or production-proven.

## Task 6: Final convergence and PR

1. Self-review the diff for unrelated changes, duplicate money logic, client leakage, debug code, and print CSS affecting other screens.
2. Run independent static, security/privacy, and runtime/browser reviews in parallel. Consolidate all blocking findings before repair.
3. Apply one repair wave; run focused tests; request one focused re-review.
4. On the final unchanged head run:
   - `corepack pnpm test:shards`
   - `corepack pnpm exec tsc --noEmit`
   - `corepack pnpm build`
   - customer-copy browser proof at both viewports
   - `git diff --check`
5. Verify `git rev-parse HEAD` in the same shell as each final claim.
6. Commit with repository-configured identity and both required trailers.
7. Push the branch and open a draft PR linked to Buzz channel `3c51444f-299a-4be9-9ad5-560046dc0501`.

**Stop if:** production migration/application, merge, deploy, external communication, destructive schema action, customer data, or a new unresolved product decision is required.
