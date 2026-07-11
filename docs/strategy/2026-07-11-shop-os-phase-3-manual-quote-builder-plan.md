# Shop OS row 18 — manual quote builder implementation plan

**Goal:** Ship a tested, accessible manual quote builder and honest live totals on top of row 17's merged domain/API without widening into approval, sends, vendors, stories, or repair execution.

**Architecture:** A protected server page loads the safe ticket identity and row-17 builder projection. One client screen owns line editing and server-truth refresh. Row-17 integer math owns totals; row-17 API routes own all mutations and immutable version preparation.

## Hard constraints

- Reuse `/api/tickets/[id]/quote`, its line routes, and `/versions`; no new quote mutation seam unless a verified blocker requires a separate design correction.
- Never expose or accept unit cost, vendor lifecycle, event, profile, storage, or approval-projection controls.
- Drafting remains allowed on an open provisional ticket, but `Prepare quote` stays blocked until customer, vehicle, tax, and every labor line's pricing context are valid. A null shop labor rate is allowed when persisted labor already has an explicit extended price.
- Do not change diagnostic prompts, retrieval, gating, topology, session behavior, or production schema/data.
- UI copy is calm, technical, imperative, and free of send/approval/work-authorization claims.

## Task 1: Claim and prove the surface contract

**Files:** This design/plan, master plan row 18, driver state.

- [x] Mark row 18 in progress on `feat/shop-os-p3-quote-builder` and open draft PR #129.
- [x] Independently review the design against the merged row-17 API, interaction doctrine, mobile reality, and future-row boundaries.
- [x] Resolve plan findings before component implementation.

## Task 2: Protected route and ticket entry

**Files:** Create `app/(app)/tickets/[id]/quote/page.tsx`; extend ticket detail component/CSS and tests.

- [x] Authenticate, apply `checkAccess`-equivalent subscription/deactivation policy, require `canBuildQuotes`, then load tenant-safe ticket identity plus builder truth directly through the injected handlers; never self-fetch HTTP.
- [x] Add one 44px `Build quote` action only for open tickets and authorized paid actors; correct provisional copy to allow drafting while preparation and downstream actions remain blocked.
- [x] Prove auth, unsupported role, unpaid/deactivated access, cross-boundary failure, open/provisional entry, no dead link, and unchanged ticket-detail behavior.

## Task 3: Quote ledger and deterministic totals

**Files:** Create `components/screens/manual-quote-builder.tsx` and module CSS; add focused component/math tests.

- [x] Render reconciled/configuration truth, eligible jobs, manual lines, active-version truth, and empty guidance from the safe builder projection only.
- [x] Render subtotal and taxable subtotal through row 17's pure integer math; render tax/total only when tax is configured, and fail closed on aggregate overflow/corrupt money.
- [x] Parse and format dollar strings with BigInt quotient/remainder, define `Line price` as the complete extended customer charge, omit core editing, and show existing core only as `Included in line price`.
- [x] Prove cent-exact near-safe-limit formatting, tax edges, null-tax unavailable total, overflow block, core non-double-counting, current version, privacy omissions, and responsive semantics.

## Task 4: Manual line create/edit/remove

- [x] Add strict kind-specific part/labor/fee forms with honest `Line price`, taxability, configured-rate labor calculation or explicit no-rate price, and one open editor.
- [x] Preserve one create UUID across same-input/ambiguous retries; rotate it after success or input change.
- [x] Map 401 to sign-in, 403 to subscription/deactivation, 404 to the privacy-safe ticket boundary, retryable 409 to busy/refresh, and opaque 409/422/network outcomes without inventing causes; reload server truth after success and restore useful focus.
- [x] Treat same-line concurrent edits as last-write-wins v1 followed by mandatory refresh; do not claim stale-write detection.
- [x] Require explicit discard before switching a dirty editor; prove clean/dirty switching, create retry, no-op/edit/remove, invalid input, contention, access/network failure, focus, keyboard, decimal `inputMode`, 44px controls, and no optimistic/fake-save state.

## Task 5: Prepare immutable quote

- [ ] Enable `Prepare quote` only when the visible state can form a reconciled nonempty quote with configured tax and valid persisted line prices; do not require a global labor rate when labor has explicit pricing.
- [ ] POST the bodyless version route, render created/retried version truth, and refresh exact server state.
- [ ] Prove blocked reasons, no-rate explicit-price success, no-rate calculated-price failure, 201/200 behavior, busy conflict, active-version invalidation after a line change, and no send/approval/authorization wording.

## Task 6: Visual, accessibility, and independent review

- [ ] Implement the calibrated repair-order tape direction with existing tokens, visible labels/focus, decimal mobile keyboards, 44px controls, 375px support, reduced motion, safe-area padding, and no sticky/keyboard overlap.
- [ ] Run the required loaded protected-page browser/accessibility pass at desktop and 375px; an unauthenticated redirect alone is insufficient. Capture observable proof or report the exact credential/environment gate.
- [ ] Independently review product truth, money semantics, tenant/privacy boundaries, accessibility, and future-row scope; resolve every finding.

## Task 7: Verify, reconcile, and ship

- [ ] Run focused tests, full suite, TypeScript, production build, and diff checks.
- [ ] Add the row-18 implementation correction, mark row 18 complete, and identify row 19 as the next non-overlapping advisor lane.
- [ ] Push final head, pass GitHub checks, mark ready, squash-merge, verify tree equality, and continue the next safe source lane.

## Stop conditions

- Stop for a required production database apply, new external account/credential/spend, destructive action, or unresolved product decision.
- Stop and redesign if the UI needs a new stored money meaning, exposes internal cost/vendor state, or implies approval/work authorization.
- Stop if the required browser surface cannot be authenticated without external credentials; preserve the static/component proof and report the exact gate.

## Forward compatibility gate

Row 18's live totals are complete because row 17 currently persists manual lines only. Before row 19/20/30 inserts any non-manual line source, that row must extend the safe builder projection with every customer-safe line or server-computed complete totals and prove the prepared immutable version matches the visible total. Hidden lines and a `live total` claim may never coexist.
