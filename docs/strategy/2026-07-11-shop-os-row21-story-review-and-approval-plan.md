# Shop OS Row 21 — Story Review and Exact-Version Approval Implementation Plan

> Required execution mode: test-driven development with independent task and whole-branch review.

**Goal:** Complete the human story-review and exact-version phone/in-person decision surface without adding schema or duplicating row 17/20 domain contracts.

**Design:** `docs/strategy/2026-07-11-shop-os-row21-story-review-and-approval-design.md`

## Task 1 — Human story review domain

**Files**

- Modify `lib/db/schema.ts`
- Modify `lib/shop-os/customer-stories.ts`
- Modify `app/api/tickets/[id]/quote/jobs/[jobId]/story/route.ts`
- Create `tests/unit/shop-os-customer-story-review.test.ts`
- Extend `tests/unit/shop-os-customer-story-route.test.ts`

**Red tests**

- reviewed AI story preserves server-owned concern, waiver, source-bound proof, and increments revision;
- manual story can be created only for topology sessions without an AI call; published-wizard remains unsupported;
- manual save identifies its source honestly and becomes reviewed;
- changed story invalidates one active version; unchanged canonical retry does not;
- stale revision, changed client-key reuse, cross-actor key reuse, corrupt metadata, closed ticket/job/session, non-diagnostic job, ordinary-tree manual fallback, published wizard, parts role, other tenant, inactive actor, and lock contention fail closed;
- same-key/same-actor/same-payload retry returns committed truth before stale-revision rejection;
- reviewer identity/time/request fingerprint come only from server truth;
- route auth/paywall/input/status mappings remain thin and do not log content.

**Implementation**

1. Add optional review idempotency/audit fields to `CustomerStoryMeta`.
2. Split common authorized job/session loading from row 20's stricter generation eligibility without loosening generation.
3. Add `saveReviewedCustomerStory` with only finding/recommendation input, expected revision, stable client key, transaction locks, source rules, and active-version invalidation.
4. Add `PUT` to the existing story route.

**Verify**

```bash
pnpm test -- tests/unit/shop-os-customer-story-review.test.ts tests/unit/shop-os-customer-story-route.test.ts tests/unit/customer-story-generator.test.ts
pnpm exec tsc --noEmit
```

## Task 2 — Safe quote workspace projection

**Files**

- Modify `lib/shop-os/quotes.ts`
- Modify `lib/shop-os/quote-builder-ui.ts`
- Extend `tests/unit/shop-os-quote-builder.test.ts`
- Extend `tests/unit/shop-os-quote-builder-ui.test.ts`
- Extend `tests/unit/shop-os-quote-decisions.test.ts`

**Red tests**

- builder returns bounded story/review facts and approval projections;
- active version returns validated immutable version, job subtotals before tax, and ticket total, never recomputed client totals;
- corrupt story/snapshot/meta fails closed;
- approval capability derives from the fresh actor;
- tech/parts projection cannot enable decision controls;
- version/job projection matches the same snapshot validation used by the decision handler;
- diagnostic jobs with quote lines fail version creation unless their story is valid and reviewed/manual;
- diagnostic decisions succeed only when the active snapshot contains that valid story, while repair/maintenance behavior stays unchanged.

**Implementation**

1. Extend `QuoteBuilderResult` minimally with story, approval, active-version snapshot summary, and capability facts.
2. Reuse validated snapshot parsing; do not create a second snapshot schema.
3. Extend the existing decision/snapshot eligibility helpers for valid diagnostic story approval without weakening repair/maintenance rules.
4. Add pure UI parsers/state helpers for story and decision responses, stale refresh, and stable request-key retry behavior.

**Verify**

```bash
pnpm test -- tests/unit/shop-os-quote-builder.test.ts tests/unit/shop-os-quote-builder-ui.test.ts tests/unit/shop-os-quote-decisions.test.ts tests/unit/shop-os-quote-versions.test.ts
pnpm exec tsc --noEmit
```

## Task 3 — Integrated story and authorization UI

**Files**

- Modify `app/(app)/tickets/[id]/quote/page.tsx`
- Modify `components/screens/manual-quote-builder.tsx`
- Modify `components/screens/manual-quote-builder.module.css`
- Create `tests/unit/shop-os-story-review-ui.test.tsx`
- Create `tests/unit/shop-os-quote-approval-ui.test.tsx`
- Extend `tests/unit/shop-os-manual-quote-builder.test.tsx`
- Extend `tests/unit/shop-os-quote-page.test.tsx`

**Red tests**

- ordinary locked-tree job opens the bounded evidence workspace and generates through row 20;
- AI story renders pending, editable narrative, read-only sourced proof, and deliberate review;
- topology job renders an honest manual editor with empty proof and never calls generation; published-wizard remains explicitly unsupported;
- reviewed state survives refresh and stale failures preserve user input;
- prepare remains blocked while any included AI story is pending;
- prepared version shows immutable version, job subtotal before tax, and ticket total;
- advisor/owner can confirm phone or in-person approval and decline for an eligible diagnostic, repair, or maintenance job;
- tech/parts see decision state but no enabled approval actions;
- confirmation retains one request key through retry and refreshes to server truth on success;
- all controls meet the 44px floor, pivotal actions use 48px, and focus return, keyboard, live-region, reduced-motion, and 375px requirements pass;
- timed browser proof shows the verdict immediately, proof in one tap, and phone/in-person decision confirmation in two taps and under 60 seconds.

**Implementation**

1. Add a compact story card inside diagnostic jobs; lazy-load row 20's evidence workspace only when opened.
2. Add the authorization strip to the prepared-version tape and a single accessible confirmation sheet.
3. Keep draft line editing behavior unchanged; when a version exists, render immutable approval facts from the server projection.
4. Use existing tokens and typography; no new global design system or dependency.

**Verify**

```bash
pnpm test -- tests/unit/shop-os-story-review-ui.test.tsx tests/unit/shop-os-quote-approval-ui.test.tsx tests/unit/shop-os-manual-quote-builder.test.tsx tests/unit/shop-os-quote-page.test.tsx
pnpm exec tsc --noEmit
pnpm build
```

Run the required signed-in browser accessibility pass at 375px and desktop width. Prove story generation/review, manual topology story, prepared version, phone approval, in-person approval, decline, stale retry, focus order, announcements, no overflow, immediate verdict visibility, one-tap proof disclosure, and a measured two-tap/under-60-second decision path.

## Task 4 — Convergence and integration

1. Run all row 17, 20, and 21 focused tests.
2. Run the full test suite once from the control lane.
3. Run TypeScript, production build, `git diff --check`, and inspect the complete diff.
4. Obtain independent task reviews and one whole-branch review covering authz, tenant isolation, idempotency, story provenance, quote immutability, accessibility, and scope.
5. Update row 21 in the active plan in the shipping PR only.
6. Merge through GitHub after required checks pass; production deployment is code-only because this row has no migration or feature flag.

## Stop conditions

- A new table or migration appears necessary.
- Story review requires changing diagnostic-engine, wizard, or topology semantics.
- Existing quote decision/snapshot contracts cannot represent the required UI honestly.
- A prepared version can change without supersession.
- Signed-in production verification would require customer data or credentials from Brandon.

## Done when

One fixture ticket demonstrates locked diagnosis → generated/reviewed story or manual topology story → immutable prepared quote → phone/in-person decision, with exact-version audit proof and no unauthorized or stale mutation path.
