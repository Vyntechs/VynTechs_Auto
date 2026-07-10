# Shop OS Phase-1 Door B Provisional Wrapper Implementation Plan

**Goal:** Make every quick technician diagnosis create exactly one visible provisional `tech_quick` ticket and one linked diagnostic job with the current session inputs, without fabricating a customer or vehicle or changing diagnostic-engine behavior.

**Approved design:** Door B remains the existing `/sessions/new` diagnosis flow. A browser-generated UUID is both its request key and proposed session ID. The server validates the actor and intake, then atomically creates the session, provisional ticket, and linked diagnostic job. A retry with the same key returns the same IDs; it never allocates another ticket. Row 15 still owns leased provider-call idempotency and diagnostic bootstrap.

**Architecture:** Refactor the canonical ticket creator around one transaction-local core. Its public contract stays unchanged. A narrow internal helper creates only a `tech_quick` ticket with null customer/vehicle and exactly one diagnostic job linked to the just-created session. `createSessionForUser` owns the outer transaction so session and wrapper commit or roll back together.

**Boundaries:**

- Preserve the existing intake fields, retrieval/tree generation, open-session cap, redirect, active-session UI, close loop, and all diagnostic semantics.
- Do not create a customer or vehicle. Do not infer VIN, contact, authorization, quote, approval, or customer identity.
- The diagnostic job is assigned to the active wrenching profile, requires that profile's A/B/C tier, remains open, and links the session immediately.
- Null-tier, pending, deactivated, missing-shop, or malformed actors fail closed. Any active Shop OS role with a non-null tier remains a wrenching profile per Rev 4.
- No schema, migration, production, external account, feature flag, claim/reassign, quote, or engine changes.
- The request key prevents persistence duplication. Row 15 remains responsible for concurrent provider-call leasing and ambiguous upstream attempts.

## Task 1: Claim and publish row 12

**Files:**

- Modify: `docs/strategy/2026-07-10-shop-os-phase-1-door-c-minimal-create-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Create: `docs/strategy/2026-07-10-shop-os-phase-1-door-b-provisional-plan.md`

- [x] Record PR #122 merge commit and reviewed-tree equality; close row 11's shipping checkbox.
- [x] Audit `createSessionForUser`, `/api/sessions`, `/sessions/new`, ticket creation, schema constraints, and existing tests against Rev 4.
- [x] Choose the smallest atomic and retry-safe seam without adding schema or changing provider/engine behavior.
- [x] Commit/push this packet and open draft PR #123 before implementation.

## Task 2: Prove and build the atomic wrapper

**Files:**

- Modify: `lib/tickets.ts`
- Modify: `lib/sessions.ts`
- Modify: `tests/unit/create-session-handler.test.ts`
- Modify: `tests/unit/manual-session-loop.test.ts`
- Create: `tests/unit/shop-os-tech-quick-session.test.ts`

- [ ] Write failing tests first for one transaction creating one session, one provisional ticket, and one linked diagnostic job with null customer/vehicle.
- [ ] Prove the ticket source, concern, creator, assignee, tier, open state, pending-quote state, and session link use only persisted facts.
- [ ] Prove the same request key returns the same session/ticket/job and leaves all three table counts at one.
- [ ] Prove no-profile, no-shop, pending, deactivated, null-tier, malformed intake/key, and cross-actor key collision fail closed.
- [ ] Inject a wrapper failure and prove the session and ticket-number allocation roll back.
- [ ] Refactor the canonical ticket transaction only enough to expose a narrow transaction-local tech-quick helper; preserve the public ticket API contract.
- [ ] Independently review the domain task and resolve every finding.

## Task 3: Carry the idempotency key through the existing flow

**Files:**

- Modify: `app/api/sessions/route.ts`
- Modify: `app/(app)/sessions/new/page.tsx`
- Modify: `components/intake/new-session-form.tsx`
- Modify: `tests/unit/new-session-form.test.tsx`
- Create: `tests/unit/shop-os-tech-quick-route.test.ts`
- Create: `tests/unit/shop-os-new-session-page.test.tsx`

- [ ] Write failing route tests for auth, paywall, parse, active-wrenching actor, quota/open-cap ordering, retry preflight, and returned IDs.
- [ ] Require a UUID request key at the route boundary and pass only the validated intake to retrieval/tree generation.
- [ ] Reuse the same key after a failed submission and short-circuit a completed retry before provider work; never claim row-15 concurrent provider leasing.
- [ ] Keep the existing session redirect and error behavior while adding direct page defense for non-wrenching actors.
- [ ] Prove the form posts all existing intake fields plus one stable request key and redirects only from the returned session ID.
- [ ] Independently review the route/UI task and resolve every finding.

## Task 4: Verify, review, reconcile, and ship row 12

**Files:**

- Modify: `docs/strategy/2026-07-10-shop-os-spec-and-phased-plan.md`
- Modify: `docs/strategy/2026-07-10-shop-os-phase-1-door-b-provisional-plan.md`

- [ ] Run all focused row-12 tests, the full suite, TypeScript, production build, and diff check; record exact counts.
- [ ] Attempt signed-in Chrome only with launch authority; otherwise record the gate and use DOM/static proof because visible flow is intentionally unchanged.
- [ ] Inspect the full diff for fake customer/vehicle identity, partial writes, retry duplication, tenant/tier leaks, provider or engine drift, and unrelated scope.
- [ ] Obtain task reviews and one whole-branch review; resolve every Critical/Important/Minor finding and re-review.
- [ ] Add the Phase-1 Door B implementation correction, mark row 12 complete, preserve every production/external gate, and identify row 13 as next.
- [ ] Push final head, wait for GitHub checks, mark ready, squash-merge, verify `origin/main` tree equality, and immediately continue row 13.

## Verification

```bash
pnpm test tests/unit/create-session-handler.test.ts tests/unit/manual-session-loop.test.ts tests/unit/shop-os-tech-quick-session.test.ts tests/unit/shop-os-tech-quick-route.test.ts tests/unit/new-session-form.test.tsx tests/unit/shop-os-new-session-page.test.tsx
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check origin/main...HEAD
```

## Stop conditions

- Stop before any production data/schema write, external credential/account action, spend, feature enablement, or irreversible operation.
- Stop if persistence idempotency requires schema; row 12 is approved only as a creation-seam change.
- Stop if preserving current provider/engine behavior is impossible; row 15 owns provider leasing and diagnostic bootstrap semantics.
