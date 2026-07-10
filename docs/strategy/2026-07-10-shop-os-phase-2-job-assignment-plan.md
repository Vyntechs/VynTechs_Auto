# Shop OS Phase-2 Atomic Job Assignment Implementation Plan

**Goal:** Give Shop OS one tenant-safe mutation contract for claiming, unclaiming, and reassigning an open ticket job before row 14 exposes My Jobs/Open Jobs in Today.

**Approved design:** Add one domain handler and one thin authenticated route at `/api/tickets/[id]/jobs/[jobId]/assignment`. `claim` is self-only and succeeds through one conditional update only when the job is open and unassigned and the current active wrenching profile meets its required tier. `unclaim` is allowed to the current assignee or an advisor/owner. `reassign` is advisor/owner-only and reuses the canonical active same-shop tier validation plus explicit below-tier confirmation.

**Truth and race rules:**

- Every mutation requires the job to belong to the named same-shop ticket and have `workStatus='open'`; otherwise it fails closed.
- Claim sets `assignedTechId` to the actor and `claimedAt` to the database timestamp in the same update.
- Unclaim and advisor assignment clear `claimedAt`; assignment is not falsely called a self-claim.
- A losing claim returns a safe projection of the current assignee, not a generic conflict and never cross-tenant identity.
- Null-tier, insufficient-tier, pending, deactivated, unsupported-role, cross-shop, closed-ticket, non-open-job, malformed, and unauthorized mutations fail without writes.
- `reassign` below tier returns the existing structured warning and requires `confirmBelowTier=true`; no silent bypass.
- No work start/status transition, diagnostic bootstrap, quote/approval, Today UI, schema, migration, production, provider, or engine behavior changes.

## Task 1: Claim and publish row 13

- [x] Record PR #123 merge commit/tree equality and close row 12's final shipping checkbox.
- [x] Audit assignment capabilities, creation-time validation, ticket/job schema, API conventions, and Rev-4 race rules against current `main`.
- [x] Choose one domain seam and one route without adding schema or UI.
- [ ] Commit/push this packet and open a draft PR before implementation.

## Task 2: Prove and build atomic assignment mutations

**Files:**

- Modify: `lib/tickets.ts`
- Create: `tests/unit/shop-os-job-assignment.test.ts`

- [ ] Write failing tests first for eligible self-claim, exact `claimedAt`, self-unclaim, privileged unclaim, and privileged reassign.
- [ ] Prove claim is one conditional update over same-shop ticket/job, open ticket/job state, null assignment, and active sufficient-tier actor.
- [ ] Prove a sequential and concurrent losing claim returns the safe current assignee and never overwrites the winner.
- [ ] Prove below-tier reassign warns, explicit confirmation succeeds, and assignment clears `claimedAt`.
- [ ] Prove every tenant, role, membership, tier, ticket/job state, malformed-input, and authorization negative path leaves rows unchanged.
- [ ] Return only the canonical safe ticket projection or safe conflict assignee; expose no profile user/shop fields.
- [ ] Independently review the domain task and resolve every finding.

## Task 3: Add the thin assignment route

**Files:**

- Create: `app/api/tickets/[id]/jobs/[jobId]/assignment/route.ts`
- Create: `tests/unit/shop-os-job-assignment-route.test.ts`

- [ ] Write failing tests for auth, paywall, invalid JSON, actor translation, every action result, warning envelope, and status mapping.
- [ ] Keep the route auth → paywall → parse → domain; do not duplicate assignment policy in the route.
- [ ] Return the updated safe ticket on success and the safe current assignee only on a losing claim.
- [ ] Independently review the route task and resolve every finding.

## Task 4: Verify, review, reconcile, and ship row 13

- [ ] Run focused tests, full suite, TypeScript, production build, and diff check; record exact counts.
- [ ] Inspect the complete diff for non-atomic writes, identity leaks, tier/tenant bypass, work-start drift, and unrelated changes.
- [ ] Obtain task reviews and one whole-branch review; resolve every Critical/Important/Minor finding and re-review.
- [ ] Add the Phase-2 assignment implementation correction, mark row 13 complete, preserve every owner gate, and identify row 14 as next.
- [ ] Push final head, wait for GitHub checks, mark ready, squash-merge, verify `origin/main` tree equality, and immediately continue row 14.

## Verification

```bash
pnpm test tests/unit/shop-os-job-assignment.test.ts tests/unit/shop-os-job-assignment-route.test.ts tests/unit/shop-os-tickets-access.test.ts tests/unit/shop-os-ticket-routes.test.ts
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check origin/main...HEAD
```

## Stop conditions

- Stop before any production data/schema write, external credential/account action, spend, feature enablement, or irreversible operation.
- Stop if atomic claim requires schema or if assignment cannot remain separate from row-15 diagnostic start.
- Stop if a safe losing-racer response would require exposing fields outside the canonical profile projection.
